"""Autopilot: works the open enquiries the way a planner would, one step at a time, and says what it did.

Per lead: read the intake, measure the roof, draft and qualify, ask the homeowner on WhatsApp for what is missing (real
sends, only to the number on the lead), wait for replies within the run's window and look again, then complete and send
the proposal when the verdict is Priority and nothing is missing; everything else is flagged for the planner.
No LLM: every line comes from a template; replies are parsed by the existing WhatsApp path.
"""
import json
import logging
import os
import threading
import time
from datetime import datetime, timezone

from .. import leads
from ..whatsapp import conversation as wa

log = logging.getLogger("engine")
LOCK = threading.Lock()
STATUS = {"running": False, "started_at": None, "events_n": 0, "last": None}
WAIT_S = 45
_api: dict = {}  # set by main: refresh, approve, roof, lead_out


def configure(**fns):
    _api.update(fns)


def _now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def first(lead):
    return wa.first_name(lead) if wa.first_name(lead) != "there" else (lead.get("customer_name") or "this lead")


def surname(lead):
    n = (lead.get("customer_name") or "").split()
    return n[-1] if n and wa.first_name(lead) != "there" else (lead.get("customer_name") or "this lead")


LABEL = {"annual_demand_kwh": "yearly use", "heating_type": "heating", "has_ev": "an electric car", "heating_demand_kwh": "heating use",
         "has_solar": "existing panels", "boiler_age_years": "the boiler's age", "num_inhabitants": "household size"}


def verdict(lead) -> tuple[str, str]:
    """(visit | call_first | decline, reason), the board's rules (web/lib/qualify.ts) on the engine's own fields."""
    f = lead.get("inputs") or {}
    d = (lead.get("draft") or {}).get("design") or {}
    e = (lead.get("draft") or {}).get("economics") or {}
    src = _api["sources"](lead)
    street = bool(f.get("address"))
    roof = f.get("roof") or {}
    if lead.get("status") == "declined":
        return "decline", "Declined by the homeowner"
    if not street:
        return "call_first", "No street address yet"
    if roof.get("source") not in ("lod2", "google-solar", "osm"):
        return "call_first", "No 3D roof at this address"
    if roof.get("max_kwp") is not None and roof["max_kwp"] < 3:
        return "decline", "Roof too small for a system"
    import re as _re
    m = _re.match(r"\s*(\d+)", str(roof.get("dwellings_class") or ""))
    if (m and int(m.group(1)) >= 3) or (roof.get("footprint_m2") or 0) > 400:
        return "call_first", "Shared roof, a house or a flat?"
    if not d.get("pv_kwp"):
        return "decline", "No system fits this home"
    be = e.get("break_even_year")
    if be is None or be > 20:
        return "decline", "Would not break even within 20 years"
    if src.get("annual_demand_kwh") == "estimated":
        return "call_first", "Yearly use is the default"
    if (f.get("heating_type") or "Unknown") == "Unknown":
        return "call_first", "Heating type unknown"
    return "visit", "Priority"


def gaps(lead) -> list:
    """The facts that keep a lead from Priority, most important first."""
    f = lead.get("inputs") or {}
    out = []
    if _api["sources"](lead).get("annual_demand_kwh") == "estimated":
        out.append("annual_demand_kwh")
    if (f.get("heating_type") or "Unknown") == "Unknown":
        out.append("heating_type")
    return out


def _ev(lead, step, text, glyph, state="done", **extra):
    e = {"at": _now(), "lead_id": lead["lead_id"] if lead else None, "name": (lead or {}).get("customer_name"), "step": step,
         "text": text, "glyph": glyph, "state": state, **extra}
    STATUS["events_n"] += 1
    STATUS["last"] = e
    return e


def pick(lead_ids=None) -> list:
    if lead_ids:
        return [l for i in lead_ids if (l := _api["find"](i))]
    out = []
    for l in leads.LEADS.values():
        if l.get("pinned"):
            continue  # never a pinned demo lead unless the planner lists it
        if l.get("test") and not (l.get("meta") or {}).get("seed"):
            continue  # old test leads stay out; the shoot's seeded enquiries are in
        if l.get("status") in ("sent", "signed", "declined", "approved"):
            continue
        out.append(l)
    return sorted(out, key=lambda l: l.get("created_at") or "")


def _pass(lead, dry, first_pass=True):
    """One look at a lead; yields events; returns via the last event what happened ('sent', 'asked', 'needs_you')."""
    meta = lead.get("meta") or {}
    if first_pass:
        kind = meta.get("intake_kind") or ("WhatsApp thread" if (lead.get("whatsapp") or {}).get("messages") else "enquiry")
        yield _ev(lead, "read", f"Read {surname(lead)}'s {kind}", "doc")
        if lead.get("inputs", {}).get("address"):
            yield _ev(lead, "measure", f"Measuring the roof at {lead['inputs']['address'].split(',')[0]}", "ruler", "active")
    lead = _api["refresh"](lead)
    f = lead.get("inputs") or {}
    roof = f.get("roof") or {}
    if first_pass and f.get("address"):
        planned = int(round(((lead.get("draft") or {}).get("design") or {}).get("pv_kwp", 0) / 0.463)) if \
            ((lead.get("draft") or {}).get("design") or {}).get("pv_kwp") else 0
        if roof.get("max_panels") and roof.get("capacity_source") == "layout" and planned:
            yield _ev(lead, "measure", f"Measured the roof, {planned} of {roof['max_panels']} modules planned", "ruler")
        elif planned:
            yield _ev(lead, "measure", f"Measured the roof, {planned} modules planned", "ruler")
        elif roof.get("usable_area_m2"):
            yield _ev(lead, "measure", f"Measured the roof, about {roof['usable_area_m2']:.0f} m2 usable", "ruler")
        else:
            yield _ev(lead, "measure", "No 3D roof found at this address", "ruler", "needs_you")
    d = (lead.get("draft") or {}).get("design") or {}
    v, why = verdict(lead)
    word = {"visit": "Priority", "call_first": "Call first", "decline": "Decline"}[v]
    yield _ev(lead, "draft", f"Draft {d.get('pv_kwp') or 0:g} kWp, {word}", "pencil", verdict=v)
    g = gaps(lead)
    if v == "visit" and not g:
        if dry:
            yield _ev(lead, "send", "Would send the proposal (dry run)", "paperplane", outcome="sent")
            return
        try:
            _api["complete"](lead)
            wa.send_proposal(lead, "whatsapp")
            yield _ev(lead, "send", "Sent the proposal", "paperplane", outcome="sent")
        except Exception as e:
            yield _ev(lead, "needs_you", f"Needs you: {_short(e)}", "hand", "needs_you", outcome="needs_you")
        return
    if v == "decline" or not g or why in ("No street address yet", "No 3D roof at this address", "Shared roof, a house or a flat?"):
        yield _ev(lead, "needs_you", f"Needs you: {why[0].lower() + why[1:]}", "hand", "needs_you", outcome="needs_you")
        return
    if not first_pass:
        yield _ev(lead, "needs_you", "Needs you: no reply yet", "hand", "needs_you", outcome="needs_you")
        return
    if not lead.get("phone"):
        yield _ev(lead, "needs_you", f"Needs you: {LABEL.get(g[0], g[0])}, and no phone to ask", "hand", "needs_you", outcome="needs_you")
        return
    w = lead.get("whatsapp") or {}
    if w.get("state") == "open":
        yield _ev(lead, "ask", f"Already asked {surname(lead)} on WhatsApp, waiting", "message", outcome="asked")
        return
    try:
        wa.ask(lead, g[:2], dry=dry)
        about = " and ".join(LABEL.get(x, x) for x in g[:2])
        yield _ev(lead, "ask", f"Asked {surname(lead)} on WhatsApp about {about}" + (" (dry run)" if dry else ""), "message", outcome="asked")
    except Exception as e:
        yield _ev(lead, "needs_you", f"Needs you: {_short(e)}", "hand", "needs_you", outcome="needs_you")


def _short(e) -> str:
    s = str(e)
    if "rate" in s.lower() or "429" in s:
        return "WhatsApp is rate limited, try again in a minute"
    return s.split(";")[0].rstrip(".")[:90]


def run(lead_ids=None, dry=False, wait_s=None):
    """Generator of events for one autopilot run."""
    if not LOCK.acquire(blocking=False):
        yield _ev(None, "summary", "Autopilot is already running", "check", "error")
        return
    try:
        STATUS.update(running=True, started_at=_now(), events_n=0, last=None)
        todo = pick(lead_ids)
        sent = needs = asked_n = 0
        waiting = []
        for lead in todo:
            outcome = None
            for e in _pass(lead, dry):
                outcome = e.get("outcome") or outcome
                yield e
            if outcome == "sent":
                sent += 1
            elif outcome == "asked":
                asked_n += 1
                waiting.append(lead)
            elif outcome == "needs_you":
                needs += 1
        if dry:  # nothing waits on a dry run: an asked lead still needs the homeowner's reply
            needs += len(waiting)
            waiting = []
        wait = WAIT_S if wait_s is None else max(0, int(wait_s))
        if waiting and not dry and wait:
            t0 = time.time()
            seen = {l["lead_id"]: len([m for m in (l.get("whatsapp") or {}).get("messages", []) if m.get("dir") == "in"]) for l in waiting}
            while time.time() - t0 < wait:
                fresh = [l for l in waiting if len([m for m in (_api["find"](l["lead_id"]) or l).get("whatsapp", {}).get("messages", [])
                                                     if m.get("dir") == "in"]) > seen[l["lead_id"]]]
                if len(fresh) == len(waiting):
                    break
                time.sleep(3)
        for lead in waiting:
            lead = _api["find"](lead["lead_id"]) or lead
            outcome = None
            for e in _pass(lead, dry, first_pass=False):
                outcome = e.get("outcome") or outcome
                yield e
            if outcome == "sent":
                sent += 1
            else:
                needs += 1
        line = f"{sent} proposal{'s' if sent != 1 else ''} sent, {needs} need{'s' if needs == 1 else ''} you"
        yield _ev(None, "summary", line, "check", summary={"sent": sent, "needs_you": needs, "asked": asked_n})
    except Exception as e:
        log.exception("autopilot")
        yield _ev(None, "summary", f"Autopilot stopped: {_short(e)}", "check", "error")
    finally:
        STATUS["running"] = False
        LOCK.release()


def status() -> dict:
    return dict(STATUS)


# ---------- seed for the shoot ----------

SEEDS = [
    {"name": "Thomas Weber", "kind": "email", "address": "Katharinenstraße 7, 82008 Unterhaching",
     "text": "Hello, we are the Webers at Katharinenstraße 7 in Unterhaching. Four of us, gas heating, we use about 5,200 kWh a year. We would like solar with a battery.",
     "facts": {"num_inhabitants": 4, "heating_type": "Gas", "annual_demand_kwh": 5200}},
    {"name": "Julia Schneider", "kind": "email", "address": "Katharinenstraße 9, 82008 Unterhaching",
     "text": "Hi, Julia Schneider here, Katharinenstraße 9. Three of us, oil heating. Could you quote for PV?",
     "facts": {"num_inhabitants": 3, "heating_type": "Oil"}},
    {"name": "Anna Fischer", "kind": "voice note", "address": "Katharinenstraße 11, 82008 Unterhaching",
     "text": "Hi, it's Anna Fischer from Katharinenstraße 11. We get an electric car next year and use around 6,000 kilowatt hours.",
     "facts": {"annual_demand_kwh": 6000, "ev": "planned"}},
    {"name": "Lukas Becker", "kind": "note", "address": "Katharinenstraße 4, 82008 Unterhaching",
     "text": "Becker, Katharinenstr 4 Unterhaching, 2 people", "facts": {"num_inhabitants": 2}},
    {"name": "Maria Hoffmann", "kind": "note", "address": "Lindwurmstraße 12, 80337 München",
     "text": "Hoffmann, Lindwurmstr 12, 5000 kWh, gas", "facts": {"annual_demand_kwh": 5000, "heating_type": "Gas"}},
    {"name": "Stefan Koch", "kind": "note", "address": None, "postcode": "82008",
     "text": "Koch, 82008, 3 people, gas", "facts": {"num_inhabitants": 3, "heating_type": "Gas"}},
]


def seed() -> list:
    """Six test enquiries for the shoot; re-seeding deletes the previous six first."""
    for l in list(leads.LEADS.values()):
        if (l.get("meta") or {}).get("seed"):
            _api["delete"](l["lead_id"])
    phone = os.environ.get("MARQUEE_DEMO_PHONE")
    out = []
    for s in SEEDS:
        lead = _api["create"](s["name"], s.get("address") or s.get("postcode"), s["facts"], phone)
        lead.setdefault("meta", {}).update(seed=True, intake_kind=s["kind"], intake_text=s["text"])
        lead["test"] = False  # real board leads for the shoot; the 13:00 hide-unpinned sweep clears them
        leads.save(lead)
        out.append({"lead_id": lead["lead_id"], "customer_name": s["name"], "kind": s["kind"]})
        if s.get("address"):  # build the 3D model now, so the run measures from the layout, not the area estimate
            threading.Thread(target=_api["build_model"], args=(s["address"], lead["inputs"].get("house_built_year")), daemon=True).start()
    return out


# ---------- nightly ----------

def nightly():
    """ENGINE_AUTOPILOT_NIGHTLY=1: one run at 04:30 Europe/Berlin each night."""
    from zoneinfo import ZoneInfo
    done = None
    while True:
        now = datetime.now(ZoneInfo("Europe/Berlin"))
        if now.strftime("%H:%M") == "04:30" and done != now.date():
            done = now.date()
            try:
                for _ in run():
                    pass
            except Exception:
                log.exception("nightly autopilot")
        time.sleep(30)


def start():
    if os.environ.get("ENGINE_AUTOPILOT_NIGHTLY") == "1":
        threading.Thread(target=nightly, daemon=True, name="autopilot-nightly").start()
