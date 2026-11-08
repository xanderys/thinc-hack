"""WhatsApp copilot: ask a homeowner for the facts that move the design most, read the replies, fill the lead.

No LLM in the engine: messages come from templates; replies are parsed by the web's POST /api/interpret (mode "whatsapp").
Voice notes are transcribed (ElevenLabs speech to text, else local Whisper) and parsed the same way.
"""
import json
import logging
import mimetypes
import os
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.request
import uuid

from .. import leads
from . import provider as P

log = logging.getLogger("whatsapp")
LOCK = threading.RLock()
POLL_S = 5
MAX_ROUNDS = 3
IDLE_EXPIRE_S = 30 * 60
WEB_URL = (os.environ.get("WEB_URL") or "https://marquee-reonic.vercel.app").rstrip("/")

# how Rina asks for each fact inside a sentence (lower case, no question mark: they are joined)
ASK = {
    "annual_demand_kwh": "roughly how many kWh of electricity do you use a year (it is on your yearly bill)",
    "heating_type": "is the house heated with gas, oil or something else",
    "has_ev": "do you drive an electric car, or plan to buy one",
    "heating_demand_kwh": "roughly how much gas or oil does the heating use a year",
    "has_solar": "are there already solar panels on the roof",
    "num_inhabitants": "how many people live in the house",
}
LABEL = {"annual_demand_kwh": "yearly electricity use", "heating_type": "heating", "has_ev": "electric car",
         "heating_demand_kwh": "heating use", "has_solar": "existing solar", "num_inhabitants": "household size"}

_order = None   # (lead) -> fields missing or estimated, highest design impact first
_step = None    # (lead_id, facts) -> intake step result (writes with source "whatsapp")


def configure(order_fn, step_fn):
    global _order, _step
    _order, _step = order_fn, step_fn


class ConversationError(RuntimeError):
    def __init__(self, code: int, msg: str):
        super().__init__(msg)
        self.code = code


def e164(phone) -> str | None:
    d = P.digits(phone)
    if str(phone or "").strip().startswith("00"):  # 0065... is the international prefix, not part of the number
        d = d[2:]
    return f"+{d}" if 8 <= len(d) <= 15 else None


def first_name(lead: dict) -> str:
    n = (lead.get("customer_name") or "").strip()
    return n.split()[0] if n else "there"


def _join(parts: list[str]) -> str:
    return parts[0] if len(parts) == 1 else f"{parts[0]}, and {parts[1]}"


def compose_ask(lead: dict, fields: list[str]) -> str:
    qs = [ASK.get(f, LABEL.get(f, f)) for f in fields[:2]]
    lead_in = "Two quick things" if len(qs) == 2 else "One quick thing"
    return f"Hi {first_name(lead)}, Rina here from the installer. {lead_in} so I can finish your design: {_join(qs)}?"


def compose_next(fields: list[str]) -> str:
    qs = [ASK.get(f, LABEL.get(f, f)) for f in fields[:2]]
    return f"Thanks, that helps. {'Two more' if len(qs) == 2 else 'One more'} so the design is right: {_join(qs)}?"


def compose_follow_up(fields: list[str]) -> str:
    qs = [ASK.get(f, LABEL.get(f, f)) for f in fields[:2]]
    return f"Sorry, I did not quite catch that. Just to be sure: {_join(qs)}?"


def proposal_link(lead: dict) -> str:
    return f"{WEB_URL}/start/proposal/{lead['lead_id']}"


def compose_closing(lead: dict) -> str:
    text = "Thanks, that's everything, your design is ready."
    if lead.get("status") in ("approved", "sent", "signed"):
        text += f" You can see it here: {proposal_link(lead)}"
    return text


def compose_proposal(lead: dict) -> str:
    return (f"Hi {first_name(lead)}, Rina here from the installer. Your solar proposal is ready: {proposal_link(lead)} "
            "You can go through it, ask me anything, and sign there when you are happy.")


def _wa(lead: dict) -> dict:
    return lead.setdefault("whatsapp", {"state": "none", "messages": []})


def _log(lead: dict, conv_id: str | None, direction: str, kind: str, text: str, **extra) -> dict:
    m = {"id": uuid.uuid4().hex[:10], "conversation_id": conv_id, "dir": direction, "kind": kind, "text": text, "at": leads.now(), **extra}
    _wa(lead)["messages"].append(m)
    return m


def public(lead: dict) -> dict:
    w = lead.get("whatsapp") or {"state": "none", "messages": []}
    keep = ("state", "conversation_id", "round", "open_facts", "opened_at", "closed_at", "last_error", "messages")
    return {k: w.get(k) for k in keep if k in w or k in ("state", "messages")}


def _send(lead: dict, conv_id: str | None, kind: str, text: str) -> dict:
    msg_id = P.get().send(lead["phone"], text)
    return _log(lead, conv_id, "out", kind, text, provider_id=msg_id)


def _drop_dry(w: dict):
    w["messages"] = [m for m in w.get("messages") or [] if m.get("kind") != "dry"]


def ask(lead: dict, facts: list[str] | None = None, dry: bool = False) -> dict:
    """Open one conversation on this lead and send the first message. Raises ConversationError.
    dry: compose and log the message as kind "dry" (state "dry"); nothing is sent and no poll starts."""
    if not lead.get("phone"):
        raise ConversationError(409, "This lead has no phone number; nothing was sent.")
    prov = P.get()
    if prov.number() and P.digits(lead["phone"]) != prov.number():
        raise ConversationError(409, "The WhatsApp line on this engine can only reach its own pinned number; this lead's phone is a different number. Nothing was sent.")
    with LOCK:
        w = _wa(lead)
        if w.get("state") == "open":
            raise ConversationError(409, f"A WhatsApp conversation is already open on this lead ({w.get('conversation_id')}).")
        open_facts = [f for f in (facts or _order(lead)) if f in ASK][:6]
        if not open_facts:
            raise ConversationError(409, "Nothing is missing or estimated on this lead; nothing was sent.")
        asking = open_facts[:2]
        if dry:
            _drop_dry(w)
            conv = uuid.uuid4().hex[:10]
            _log(lead, conv, "out", "dry", compose_ask(lead, asking), purpose="question")
            w.update(state="dry", conversation_id=conv, round=0, open_facts=open_facts, asking=asking, last_error=None)
            lead["updated_at"] = leads.now()
            leads.save(lead)
            return {"conversation_id": conv, "sent": False, "dry": True, "open_facts": open_facts, "asking": asking}
        for other in leads.LEADS.values():  # one line per number: a newer ask on the same phone supersedes the older one
            ow = other.get("whatsapp") or {}
            if other is not lead and ow.get("state") == "open" and P.digits(other.get("phone")) == P.digits(lead["phone"]):
                ow.update(state="superseded", closed_at=leads.now())
                leads.save(other)
        _drop_dry(w)  # a real ask replaces any dry run
        cursor = prov.cursor()
        conv = uuid.uuid4().hex[:10]
        try:
            _send(lead, conv, "question", compose_ask(lead, asking))
        except P.ProviderError as e:
            w.update(last_error=str(e))
            leads.save(lead)
            raise ConversationError(502, str(e))
        w.update(state="open", conversation_id=conv, round=1, open_facts=open_facts, asking=asking, asked={f: 1 for f in asking},
                 cursor=cursor, opened_at=leads.now(), closed_at=None, updated_ts=time.time(), last_error=None)
        lead["updated_at"] = leads.now()
        leads.save(lead)
        return {"conversation_id": conv, "sent": True, "open_facts": open_facts, "asking": asking}


def send_proposal(lead: dict, channel: str, dry: bool = False) -> dict:
    text = compose_proposal(lead)
    if dry:  # compose and log only: nothing sent, status unchanged
        with LOCK:
            w = _wa(lead)
            _drop_dry(w)
            m = _log(lead, w.get("conversation_id"), "out", "dry", text, purpose="proposal", channel=channel)
        lead["updated_at"] = leads.now()
        leads.save(lead)
        return {"channel": channel, "at": m["at"], "text": text, "link": proposal_link(lead), "dry": True}
    if channel == "whatsapp":
        if not lead.get("phone"):
            raise ConversationError(409, "This lead has no phone number; nothing was sent.")
        try:
            with LOCK:
                m = _send(lead, (lead.get("whatsapp") or {}).get("conversation_id"), "proposal", text)
        except P.ProviderError as e:
            raise ConversationError(502, str(e))
    else:
        m = {"text": text, "at": leads.now()}
    _drop_dry(_wa(lead))
    lead["sent"] = {"channel": channel, "at": m["at"], "text": text, "link": proposal_link(lead)}
    lead["status"] = "sent"
    lead["updated_at"] = leads.now()
    leads.save(lead)
    return lead["sent"]


# ---------- replies ----------

def transcribe(path: str, mime: str | None) -> str:
    key = os.environ.get("ELEVENLABS_API_KEY")
    if not key:
        try:
            for line in open(os.path.expanduser("~/.config/marquee/elevenlabs.env")):
                if line.startswith("ELEVENLABS_API_KEY="):
                    key = line.split("=", 1)[1].strip().strip('"')
        except OSError:
            pass
    if key:
        boundary = uuid.uuid4().hex
        data = open(path, "rb").read()
        name = os.path.basename(path)
        body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"model_id\"\r\n\r\nscribe_v1\r\n"
                f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{name}\"\r\n"
                f"Content-Type: {mime or mimetypes.guess_type(path)[0] or 'audio/ogg'}\r\n\r\n").encode() + data + f"\r\n--{boundary}--\r\n".encode()
        req = urllib.request.Request("https://api.elevenlabs.io/v1/speech-to-text", data=body, method="POST",
                                     headers={"xi-api-key": key, "Content-Type": f"multipart/form-data; boundary={boundary}"})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return (json.load(r).get("text") or "").strip()
        except Exception as e:
            log.warning("ElevenLabs speech to text failed, trying local Whisper: %s", e)
    whisper = os.path.expanduser("~/.local/bin/whisper")
    if os.path.exists(whisper):
        with tempfile.TemporaryDirectory() as d:
            subprocess.run([whisper, path, "--model", "base", "--output_format", "txt", "--output_dir", d], capture_output=True, timeout=300, check=True)
            out = [f for f in os.listdir(d) if f.endswith(".txt")]
            if out:
                return open(os.path.join(d, out[0])).read().strip()
    raise RuntimeError("No speech to text available (ElevenLabs failed and no local Whisper).")


UNIT = {"annual_demand_kwh": "kWh a year", "heating_demand_kwh": "kWh a year", "num_inhabitants": "people"}
OPTIONS = {"heating_type": ["Gas", "Oil", "Heat pump", "District", "Electric", "Wood or pellets"], "has_ev": ["Have one", "Planned", "No"],
           "has_solar": ["Yes", "No"]}


def interpret(lead: dict, text: str, open_facts: list[str]) -> dict:
    spec = [{"field": f, "label": LABEL.get(f, f), **({"unit": UNIT[f]} if f in UNIT else {}), **({"options": OPTIONS[f]} if f in OPTIONS else {})}
            for f in open_facts]
    body = {"mode": "whatsapp", "lead_id": lead["lead_id"], "text": text, "open_facts": spec}
    req = urllib.request.Request(f"{WEB_URL}/api/interpret", data=json.dumps(body).encode(), method="POST",
                                 headers={"Content-Type": "application/json", "X-Intake-Secret": os.environ.get("INTAKE_SECRET", "")})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            out = json.load(r)
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"Interpreter answered {e.code} at {WEB_URL}/api/interpret")
    unclear = [u.get("field") if isinstance(u, dict) else u for u in (out.get("unclear") or [])]
    return {"facts": out.get("facts") or {}, "confidence": out.get("confidence"), "unclear": [u for u in unclear if isinstance(u, str)]}


def _handle(lead: dict, entry: dict):
    w = _wa(lead)
    conv = w["conversation_id"]
    t0 = time.time()
    text, extra = entry.get("text") or "", {}
    if entry["kind"] == "voice":
        path = entry.get("media_path")
        if not path or not os.path.exists(path):
            raise RuntimeError("Voice note not downloaded yet.")
        text = transcribe(path, entry.get("media_mimetype"))
        extra = {"transcript": text}
    if not text.strip():
        return
    t1 = time.time()
    parsed = interpret(lead, text, w.get("open_facts") or [])
    t2 = time.time()
    facts = {k: v for k, v in parsed["facts"].items() if v is not None and v != ""}
    if isinstance(facts.get("has_ev"), str):  # the chip words: Have one / Planned / No
        facts["ev"] = {"have one": "now", "planned": "planned", "no": "none"}.get(facts.pop("has_ev").strip().lower(), "none")
    result = _step(lead["lead_id"], facts) if facts else {"dropped": []}
    lead = leads.LEADS.get(lead["lead_id"]) or lead
    w = _wa(lead)
    t3 = time.time()
    dropped = {d.get("field") for d in (result or {}).get("dropped") or []}
    stated = [k for k in facts if k not in dropped]
    w["messages"] = [m for m in w["messages"] if not (m.get("dir") == "in" and m.get("seq") == entry["seq"])]  # a retried reply is logged once
    _log(lead, conv, "in", entry["kind"], text, facts=facts, stated=stated, unclear=parsed["unclear"], confidence=parsed["confidence"],
         seq=entry["seq"], **extra)
    remaining = [f for f in (_order(lead) or []) if f in ASK and w["asked"].get(f, 0) < 2]  # _order: still unknown, by impact
    unclear = [f for f in parsed["unclear"] if f in ASK and f in remaining]
    log.info("whatsapp timing %s: transcribe %.1fs interpret %.1fs step %.1fs order %.1fs", lead["lead_id"], t1 - t0, t2 - t1, t3 - t2, time.time() - t3)
    w.update(updated_ts=time.time(), cursor=entry["seq"])  # this reply is read: a failed send below never replays it
    try:
        if not remaining or w["round"] >= MAX_ROUNDS:
            w.update(state="closed", closed_at=leads.now(), open_facts=remaining)
            _send(lead, conv, "closing", compose_closing(lead))
        else:
            if unclear:
                nxt, kind = unclear, "follow_up"
            elif not stated:
                nxt, kind = [f for f in w.get("asking", []) if f in remaining] or remaining, "follow_up"
            else:
                nxt, kind = remaining, "question"
            nxt = nxt[:2]
            for f in nxt:
                w["asked"][f] = w["asked"].get(f, 0) + 1
            w.update(round=w["round"] + 1, asking=nxt, open_facts=remaining)
            _send(lead, conv, kind, compose_follow_up(nxt) if kind == "follow_up" else compose_next(nxt))
    except P.ProviderError as e:
        w["last_error"] = str(e)
    lead["updated_at"] = leads.now()
    leads.save(lead)


def poll_once():
    with LOCK:
        open_ = [l for l in leads.LEADS.values() if (l.get("whatsapp") or {}).get("state") == "open"]
        if not open_:
            return
        for l in open_:
            w = l["whatsapp"]
            if time.time() - (w.get("updated_ts") or 0) > IDLE_EXPIRE_S:
                w.update(state="expired", closed_at=leads.now())
                leads.save(l)
        open_ = [l for l in open_ if l["whatsapp"]["state"] == "open"]
        prov = P.get()
        for lead in open_:
            w = lead["whatsapp"]
            try:
                entries = [e for e in prov.inbox(w.get("cursor") or 0) if P.digits(e["phone"]) == P.digits(lead.get("phone"))]
            except P.ProviderError as e:
                w["last_error"] = str(e)
                continue
            for e in entries:
                if lead["whatsapp"].get("state") != "open":
                    break
                try:
                    _handle(lead, e)
                    lead = leads.LEADS.get(lead["lead_id"]) or lead
                    lead["whatsapp"].update(cursor=e["seq"], last_error=None)
                    leads.save(lead)
                except Exception as ex:  # interpreter not there yet, voice note still downloading: retry this reply next poll
                    log.warning("whatsapp reply %s on %s: %s", e["seq"], lead["lead_id"], ex)
                    lead["whatsapp"]["last_error"] = str(ex)
                    break


def loop():
    while True:
        try:
            poll_once()
        except Exception:
            log.exception("whatsapp poll failed")
        time.sleep(POLL_S)


def start():
    threading.Thread(target=loop, daemon=True, name="whatsapp-poll").start()
