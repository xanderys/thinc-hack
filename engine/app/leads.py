"""v1.9: the engine runs the call. A lead holds facts, the unknowns still open, a rolling draft and its history.
State in memory plus JSON under engine/.cache/leads/; every intake step is appended to steps.jsonl."""
import json
import re
import threading
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

DIR = Path(__file__).resolve().parent.parent / ".cache" / "leads"
STEPS = DIR / "steps.jsonl"
LEADS: dict = {}
_lock = threading.Lock()

# fields the call can ask about; the order is only the starting point, /api/ask ranks them
CANDIDATES = ["annual_demand_kwh", "heating_type", "has_ev", "heating_demand_kwh", "has_solar"]
QUESTION = {
    "annual_demand_kwh": ("Roughly how much electricity does the home use in a year?",
                          "Everything is sized from it: PV, battery and the payback."),
    "heating_type": ("How is the house heated today?",
                     "A gas or oil boiler can be replaced by a heat pump, which changes the PV and battery."),
    "has_ev": ("Do you drive an electric car, or plan to buy one?",
               "A car adds about 2,000 to 3,000 kWh a year and needs a wallbox."),
    "heating_demand_kwh": ("Do you know the yearly heating use, or the heating bill?",
                           "It sizes the heat pump."),
    "has_solar": ("Is there already a solar system on the roof?",
                  "Existing panels change what the new system needs to cover."),
}
HEATING = {"gas": "Gas", "oil": "Oil", "heat pump": "Heatpump", "heatpump": "Heatpump", "waermepumpe": "Heatpump",
           "wärmepumpe": "Heatpump", "district": "OtherNonRenewable", "wood": "OtherRenewable", "pellets": "OtherRenewable",
           "electric": "OtherNonRenewable", "unknown": "Unknown", "dont know": "Unknown", "don't know": "Unknown"}
PC = re.compile(r"^\s*\d{5}\s*$")


def now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def load_all():
    DIR.mkdir(parents=True, exist_ok=True)
    for p in DIR.glob("lead-*.json"):
        try:
            d = json.loads(p.read_text())
            LEADS[d["lead_id"]] = d
        except Exception:
            pass


import contextvars

REQUEST = contextvars.ContextVar("lead_request", default=None)  # set per request by main's middleware
PINNED_LOG = DIR / "pinned_writes.jsonl"


def save(lead: dict):
    DIR.mkdir(parents=True, exist_ok=True)
    if lead.get("pinned"):  # every write to a pinned (demo) lead, with who sent it
        try:
            ctx = REQUEST.get() or {"source": "engine background (refresh or roof redraft)"}
            d = (lead.get("draft") or {}).get("design") or {}
            rec = {"at": now(), "lead_id": lead["lead_id"], "status": lead.get("status"), "steps": len(lead.get("history") or []),
                   "design": {k: v for k, v in d.items() if v}, **ctx}
            with _lock, PINNED_LOG.open("a") as f:
                f.write(json.dumps(rec, ensure_ascii=False, default=float) + "\n")
        except Exception:
            pass
    tmp = DIR / f"lead-{lead['lead_id']}.json.tmp"
    tmp.write_text(json.dumps(lead, ensure_ascii=False, default=float))
    tmp.replace(DIR / f"lead-{lead['lead_id']}.json")


STALE_S = 600  # a call with no step for 10 minutes has ended


def expire_stale() -> int:
    """In-call leads with no step for 10 minutes end: "done" if they have a design, else "ended"; no pending question."""
    n = 0
    t = datetime.now(timezone.utc)
    for lead in list(LEADS.values()):
        if lead.get("status") != "in_call":
            continue
        try:
            last = datetime.strptime(lead["updated_at"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
        except Exception:
            continue
        if (t - last).total_seconds() < STALE_S:
            continue
        has = bool(((lead.get("draft") or {}).get("design") or {}).get("pv_kwp"))
        lead.update(status="done" if has else "ended", next_question=None)
        lead.setdefault("history", []).append({"step": None, "field": None, "answer": {}, "changed": [],
                                               "note": "no step for 10 minutes: call ended", "at": now()})
        save(lead)
        n += 1
    return n


def delete(lead_id: str):
    """Remove a lead from memory and disk; its lines in steps.jsonl stay (the priors keep what the call taught)."""
    LEADS.pop(lead_id, None)
    (DIR / f"lead-{lead_id}.json").unlink(missing_ok=True)
    (DIR / "sig" / f"{lead_id}.png").unlink(missing_ok=True)  # a signature never outlives its lead


def log_step(rec: dict):
    DIR.mkdir(parents=True, exist_ok=True)
    with _lock, STEPS.open("a") as f:
        f.write(json.dumps(rec, ensure_ascii=False, default=float) + "\n")


def new_id() -> str:
    return uuid.uuid4().hex[:10]


def where(address_or_postcode: str) -> dict:
    s = (address_or_postcode or "").strip()
    return {"postcode": s} if PC.match(s) else ({"address": s} if s else {})


def _bool(v):
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return bool(v)
    t = str(v).strip().lower()
    if t in ("yes", "y", "true", "ja", "1", "planned", "soon", "next year"):
        return True
    if t in ("no", "n", "false", "nein", "0", "none"):
        return False
    raise ValueError(f"'{v}' is not yes or no")


WORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
         "eins": 1, "zwei": 2, "drei": 3, "vier": 4, "fünf": 5, "sechs": 6}
KNOWN: set = set()  # HomeInputs field names, set by main; unknown keys are dropped, not coerced


def _num(v):
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return float(v)
    w = str(v).strip().lower()
    if w in WORDS:
        return float(WORDS[w])
    t = str(v).lower().replace("kwh", "").replace("eur", "").replace("€", "").replace("km", "").strip()
    t = t.replace(".", "").replace(",", "") if re.fullmatch(r"\d{1,3}([.,]\d{3})+", t) else t.replace(",", ".")
    m = re.search(r"\d+(\.\d+)?", t)
    if not m:
        raise ValueError(f"'{v}' is not a number")
    x = float(m.group())
    if re.search(r"\d\s*k\b", t) or "thousand" in t or "tausend" in t:
        x *= 1000
    return x


BOOLS = {"has_ev", "has_wallbox", "has_solar", "has_storage"}
STRINGS = {"installer_id", "load_profile", "address", "postcode", "preference", "roof_orientation", "offer_date"}


def normalise(answers, dropped: list | None = None) -> dict:
    """Answers from a form or a voice agent: a dict, or a list of {field, value}; spoken values are normalised.
    With `dropped`, a value that cannot be read is skipped and recorded there instead of raising."""
    if isinstance(answers, list):
        answers = {a.get("field"): a.get("value") for a in answers if isinstance(a, dict) and a.get("field")}
    out = {}
    for k, v in (answers or {}).items():
        if dropped is not None:
            if KNOWN and k not in KNOWN:
                dropped.append({"field": k, "value": v, "reason": "not a field the engine uses"})
                continue
            try:
                out.update(normalise({k: v}))
            except (ValueError, TypeError) as e:
                dropped.append({"field": k, "value": v, "reason": str(e)})
            continue
        if v is None:
            out[k] = None
        elif k == "heating_type":
            t = str(v).strip().lower()
            out[k] = next((h for key, h in HEATING.items() if key in t), None) or str(v)
        elif k in BOOLS:
            out[k] = _bool(v)
        elif k in STRINGS or k == "roof":
            out[k] = v
        else:
            out[k] = _num(v)
    return out


META = ("customer_name", "installer_name")


def map_intake(f: dict, dropped: list | None = None) -> tuple[dict, dict]:
    """Voice intake names to HomeInputs (latest value per field wins); returns (inputs, meta). Nulls are skipped.
    With `dropped`, unreadable values are skipped and recorded instead of raising."""
    f = {k: v for k, v in (f or {}).items() if v is not None and v != ""}
    meta = {k: f.pop(k) for k in META if k in f}
    out = {}
    if "ev" in f:
        ev = str(f.pop("ev")).strip().lower()
        out["has_ev"] = ev in ("now", "planned", "yes", "true")
    if "home_office" in f:
        v = f.pop("home_office")
        try:
            ho = _bool(v)
            people = out.get("num_inhabitants") or f.get("num_inhabitants") or 1
            if ho and _num(people) <= 1:
                out["load_profile"] = "HomeOfficeOnePerson"
        except ValueError as e:
            if dropped is None:
                raise
            dropped.append({"field": "home_office", "value": v, "reason": str(e)})
    if "heating_age" in f:  # the boiler's age in years feeds rule 3 (heat pump)
        f["boiler_age_years"] = f.pop("heating_age")
    bill = f.pop("monthly_bill_eur", None)
    out.update(normalise(f, dropped))
    if bill is not None and not out.get("annual_demand_kwh"):
        try:
            price = (out.get("electricity_price_ct_kwh") or 32.0) / 100
            # 90% of the bill is energy, 10% the standing charge (assumption); at the tariff
            out["annual_demand_kwh"] = round(_num(bill) * 12 * 0.9 / price, -1)
            meta["annual_demand_from_bill"] = f"EUR {_num(bill):g} a month at {price * 100:.0f} ct/kWh, 10% standing charge"
        except ValueError as e:
            if dropped is None:
                raise
            dropped.append({"field": "monthly_bill_eur", "value": bill, "reason": str(e)})
    return out, meta


def norm_key(name: str, place: str) -> str:
    return re.sub(r"\W+", "", f"{name}|{place}".lower())


def find_linked(name: str, place: str):
    k = norm_key(name or "", place or "")
    if not name or not place:
        return None
    for lead in sorted(LEADS.values(), key=lambda l: l["updated_at"], reverse=True):
        if norm_key(lead.get("customer_name") or "", lead.get("address_or_postcode") or "") == k:
            return lead
    return None


def swing_text(base: dict, options: list) -> str:
    """Plain range of what the answer would do to the design."""
    parts = []
    for key, name, unit in (("pv_kwp", "PV", "kWp"), ("battery_kwh", "battery", "kWh"), ("heatpump_kw", "heat pump", "kW"),
                            ("wallbox_kw", "wallbox", "kW")):
        vals = [o["design"].get(key) or 0 for o in options] + [base.get(key) or 0]
        lo, hi = min(vals), max(vals)
        if hi - lo > 1e-9:
            f = lambda x: "none" if not x else f"{x:g} {unit}"
            parts.append(f"{name} {f(lo)} to {f(hi)}")
    return ", ".join(parts) if parts else "no change"


def priors() -> dict:
    """Mean swing per field from the step log: which questions have moved designs most."""
    stats = {}
    n = 0
    if STEPS.exists():
        for line in STEPS.read_text().splitlines():
            try:
                r = json.loads(line)
            except Exception:
                continue
            n += 1
            f = r.get("field_asked")
            if not f:
                continue
            s = stats.setdefault(f, [0.0, 0])
            s[0] += float(r.get("swing") or 0)
            s[1] += 1
    order = sorted(({"field": f, "mean_swing": round(s[0] / s[1], 2), "times_asked": s[1]} for f, s in stats.items()),
                   key=lambda x: -x["mean_swing"])
    return {"n_steps_logged": n, "order": order}


def title(lead: dict) -> str:
    d = (lead.get("draft") or {}).get("design") or {}
    kit = []
    if d.get("pv_kwp"):
        kit.append(f"{d['pv_kwp']:g} kWp")
    if d.get("battery_kwh"):
        kit.append(f"{d['battery_kwh']:g} kWh")
    if d.get("heatpump_kw"):
        kit.append(f"{d['heatpump_kw']:g} kW heat pump")
    if d.get("wallbox_kw"):
        kit.append(f"{d['wallbox_kw']:g} kW wallbox")
    return f"{lead.get('customer_name') or 'Lead'}, {lead.get('address_or_postcode') or 'no address'}: " + (" + ".join(kit) or "no design yet")
