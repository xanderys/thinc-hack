"""Blockers (v2.19): the facts whose stated value would change the kit or the price, ranked by the euro swing, from the
next-question ranking (Engine.ask: each candidate fact with its plausible answers and the design each answer gives)."""
import logging

from ..hourly import sim as S
from ..whatsapp import conversation as wa

log = logging.getLogger("engine")
_CACHE: dict = {}
MOVES = (("heatpump_kw", "heat pump"), ("wallbox_kw", "wallbox"), ("battery_kwh", "battery"))
TEXT = {"heat pump": "decides the heat pump", "battery": "changes the battery", "wallbox": "decides the wallbox",
        "PV size": "changes the PV size", "price": "changes the price"}


_RUNNING: set = set()


def compute(eng, lead: dict, sources: dict) -> list:
    """Never blocks a lead read: the first read starts the ranking in the background and returns the last known list."""
    import threading
    key = (lead["lead_id"], int(lead.get("version") or 0))
    if key in _CACHE:
        return _CACHE[key]
    if key not in _RUNNING:
        _RUNNING.add(key)
        threading.Thread(target=lambda: (_compute(eng, lead, sources, key), _RUNNING.discard(key)), daemon=True).start()
    prev = [v for k, v in _CACHE.items() if k[0] == key[0]]
    return prev[-1] if prev else []


def _compute(eng, lead: dict, sources: dict, key) -> list:
    inp = dict(lead.get("inputs") or {})
    base = ((lead.get("draft") or {}).get("design")) or {}
    unknown = [c for c in (lead.get("unknown") or []) if c != "boiler_age_years"]
    out = []
    try:
        base_eur = S.capex_exact(inp, base)
        for q in eng.ask(inp, unknown) if unknown else []:
            f = q["field"]
            best, moved = 0, None
            for o in q.get("options") or []:
                from .. import catalogue
                d = catalogue.snap(o.get("design") or {})[0]  # compare catalogue sizes with the catalogue draft
                opt_inp = {**inp, **({f: o.get("value")} if f != "has_ev" else {"has_ev": bool(o.get("value"))})}
                eur = S.capex_exact(opt_inp, d) - base_eur
                if abs(eur) > abs(best):
                    best = eur
                if bool(d.get("pv_kwp")) != bool(base.get("pv_kwp")) or abs((d.get("pv_kwp") or 0) - (base.get("pv_kwp") or 0)) >= 0.9:
                    moved = moved or "PV size"
                for k, name in MOVES:
                    if bool(d.get(k)) != bool(base.get(k)) or (d.get(k) and base.get(k) and d.get(k) != base.get(k)):
                        moved = moved or name
            if not moved and abs(best) < 50:
                continue  # neither the kit nor the price moves: not a blocker
            moved = moved or "price"
            val = inp.get(f)
            state = "missing" if val in (None, "Unknown", "") else "estimated"
            w = lead.get("whatsapp") or {}
            asked_at = w.get("opened_at") if f in (w.get("asked") or {}) else None
            answered_at = next((m["at"] for m in w.get("messages") or [] if m.get("dir") == "in" and f in (m.get("stated") or [])), None)
            out.append({"field": f, "label": wa.LABEL.get(f, f), "state": state, "moves": moved, "delta_eur": int(round(best)),
                        "delta_text": TEXT[moved], **({"asked_at": asked_at} if asked_at else {}), **({"answered_at": answered_at} if answered_at else {})})
        out.sort(key=lambda b: -abs(b["delta_eur"]))
    except Exception:
        log.exception("blockers")
    _CACHE[key] = out
    return out
