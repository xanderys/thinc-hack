"""rules-3: the installer's most common signed design for homes with this much electricity use, as a named table
(calibrated on the fit half), then the roof cap, inverter, heat pump and wallbox rules of rules-1. See docs/rules.md.

    uv run python -m app.planner_rules.rules3      # calibrate on the fit half, 5-fold CV score, write rules3.json
"""
import json
import math
from functools import lru_cache
from pathlib import Path

import numpy as np

from . import calibrated as R1

RULES_VERSION = "rules-3-band"
TABLE = Path(__file__).with_name("rules3.json")
MODULE_KWP = 0.45
EV_KWH_PER_KM = 0.18
# use bands in kWh a year incl. EV; 4,500 exactly is the pack's default when the lead gives no use
BANDS = [0, 2500, 3500, 4499, 4501, 5500, 7000, 9000, 1e9]
MIN_HOMES = 3
NAMES = {"2a8ba8e2": "Installer A", "23c108b7": "Installer B"}


def use_kwh(inp):
    ev = (inp.get("ev_annual_km") or 12000) * EV_KWH_PER_KM if inp.get("has_ev") else 0.0
    return float(inp.get("annual_demand_kwh") or 0) + ev


def band(u):
    return int(np.digitize(u, BANDS))


def band_label(b):
    lo, hi = BANDS[b - 1], BANDS[b] if b < len(BANDS) else None
    if lo == 4499:
        return "use not given (4,500 kWh default)"
    if hi is None or hi >= 1e9:
        return f"over {lo:,.0f} kWh"
    return f"{lo:,.0f} to {hi:,.0f} kWh" if lo else f"up to {hi:,.0f} kWh"


def _within(comp, o, e):
    from .. import rules as R
    return R.within(comp, o, e)


def calibrate(fit_df) -> dict:
    """Per installer and use band, the (PV, battery) pair that the most signed designs match within tolerance."""
    from .calibrate import inputs as row_in, scope
    d = scope(fit_df)
    out = {"_meta": {"fitted_on": f"fit half (seed 42, same ids as engine/lab/split), {len(d)} new-system jobs",
                     "rule": "most common design within tolerance per installer and use band", "min_homes": MIN_HOMES}}
    for inst, g in d.groupby("installer_id"):
        u = np.array([use_kwh(row_in(r)) for r in g.to_dict("records")])
        bs = np.array([band(x) for x in u])
        pairs = g[["pv_kwp", "battery_kwh"]].drop_duplicates().values

        def best(gg):
            pv, bt = gg.pv_kwp.values[:, None], gg.battery_kwh.values[:, None]
            P = _within("pv", np.broadcast_to(pairs[:, 0], (len(gg), len(pairs))), np.broadcast_to(pv, (len(gg), len(pairs)))) & \
                _within("battery", np.broadcast_to(pairs[:, 1], (len(gg), len(pairs))), np.broadcast_to(bt, (len(gg), len(pairs))))
            k = P.sum(0)
            j = int(np.argmax(k))
            return {"pv_kwp": float(pairs[j, 0]), "battery_kwh": float(pairs[j, 1]), "n": int(len(gg)), "matched": int(k[j])}

        tab = {"_all": best(g)}
        for b in np.unique(bs):
            m = bs == b
            if m.sum() >= MIN_HOMES:
                tab[str(int(b))] = best(g[m])
        out[inst] = tab
    return out


@lru_cache(1)
def _table_file():
    return json.loads(TABLE.read_text()) if TABLE.exists() else {}


def _cell(constants, inst, b):
    t = (constants or _table_file()).get(inst) or {}
    c = t.get(str(b))
    return (c, False) if c else (t.get("_all"), True)


def rules_table(inst=None, constants=None):
    t = (constants or _table_file())
    rows = []
    for i in ([inst] if inst else [k for k in t if not k.startswith("_")]):
        tab = t.get(i) or {}
        for k in sorted((k for k in tab if k != "_all"), key=int):
            c = tab[k]
            rows.append({"name": f"{i} band {k}", "value": f"{c['pv_kwp']:g} kWp + {c['battery_kwh']:g} kWh", "unit": "",
                         "source": f"{NAMES.get(i, i)}, {band_label(int(k))}: {c['matched']} of {c['n']} signed designs within tolerance",
                         "fitted_on": t.get("_meta", {}).get("fitted_on")})
    base = [r for r in R1.rules_table(inst or "2a8ba8e2") if r["name"] in ("heatpump", "wallbox", "inverter")]
    return [{"name": "design", "sentence": "Start from this installer's most common signed design for homes with this much electricity use (household plus EV), capped by the roof in whole 450 W modules.", "constants": rows}] + base


def recommend(inputs: dict, catalogue: dict | None = None, overrides: dict | None = None, roof: dict | None = None,
              constants: dict | None = None) -> dict:
    inp = dict(inputs)
    inst = inp.get("installer_id")
    cat = catalogue or {}
    roof = roof or inp.get("roof")
    ov = overrides or {}
    u = use_kwh(inp)
    b = band(u)
    cell, fallback = _cell(constants, inst, b)
    comps, expl = {}, []
    where = f"{NAMES.get(inst, inst)}'s most common design for homes using {band_label(b)}" if not fallback else f"{NAMES.get(inst, inst)}'s most common design overall"

    def put(name, size, sentence, der):
        comps[name] = {"decision": "include" if size else "none", "size": size or None, "reason": sentence, "derivation": der}
        expl.append(sentence)

    # PV
    if "pv_kwp" in ov and ov["pv_kwp"] != "include":
        pv = float(ov["pv_kwp"] or 0)
        put("pv", pv, f"Set by the planner: {pv:g} kWp." if pv else "Set by the planner: no PV.", None)
    elif inp.get("has_solar") and "pv_kwp" not in ov:
        pv = 0.0
        put("pv", 0.0, "The home already has PV, so none is added.", None)
    else:
        pv = cell["pv_kwp"]
        cap = (roof or {}).get("max_kwp")
        capped = bool(cap and pv > cap)
        if capped:
            pv = round(max(1, math.floor(cap / MODULE_KWP)) * MODULE_KWP, 2)
        s = f"{cell['pv_kwp']:g} kWp: {where} ({cell['matched']} of {cell['n']} homes within tolerance)"
        s += f", capped by the roof at {pv:g} kWp." if capped else "."
        put("pv", pv, s, {"axiom": rules_table(inst, constants)[0]["sentence"],
                          "equation": f"use {u:,.0f} kWh a year -> band {band_label(b)} -> {cell['pv_kwp']:g} kWp" + (f", roof cap {pv:g} kWp" if capped else ""),
                          "inputs": [{"name": "use incl. EV", "value": round(u), "unit": "kWh", "source": "inputs; EV at 18 kWh/100 km"},
                                     {"name": "band design", "value": f"{cell['pv_kwp']:g} kWp + {cell['battery_kwh']:g} kWh", "unit": "",
                                      "source": f"{cell['matched']} of {cell['n']} signed designs in this band within tolerance", "fitted_on": ((constants or _table_file()).get("_meta") or {}).get("fitted_on")}],
                          "axiom_result": cell["pv_kwp"],
                          "adjustment": {"label": f"roof holds {cap:g} kWp", "value": pv, "n_similar": None} if capped else None, "final": pv})

    # battery
    if "battery_kwh" in ov and ov["battery_kwh"] != "include":
        bat = float(ov["battery_kwh"] or 0)
        put("battery", bat, f"Set by the planner: {bat:g} kWh." if bat else "Set by the planner: no battery.", None)
    elif inp.get("has_storage") and "battery_kwh" not in ov:
        bat = 0.0
        put("battery", 0.0, "The home already has a battery, so none is added.", None)
    elif not pv and not inp.get("has_solar") and "battery_kwh" not in ov:
        bat = 0.0
        put("battery", 0.0, "No battery: there is no PV to charge it.", None)
    else:
        bat = cell["battery_kwh"]
        pk = sorted(cat.get("battery_kwh") or [])
        snapped = None
        if bat and pk and bat not in pk:
            snapped = min(pk, key=lambda p: abs(p - bat))
        final = float(snapped or bat)
        s = f"{final:g} kWh: the battery in the same design." + (f" Nearest package on sale to {bat:g} kWh." if snapped else "")
        put("battery", final, s, {"axiom": rules_table(inst, constants)[0]["sentence"], "equation": f"band {band_label(b)} -> {bat:g} kWh" + (f", package {final:g} kWh" if snapped else ""),
                                  "inputs": [{"name": "band design", "value": f"{cell['pv_kwp']:g} kWp + {cell['battery_kwh']:g} kWh", "unit": "", "source": f"{cell['matched']} of {cell['n']} signed designs within tolerance"}],
                                  "axiom_result": bat, "adjustment": None, "final": final})

    # heat pump and wallbox: rules-1
    ask_hp = ov.get("heatpump_kw") == "include"
    if "heatpump_kw" in ov and not ask_hp:
        hp = float(ov["heatpump_kw"] or 0)
        put("heatpump", hp, f"Set by the planner: {hp:g} kW." if hp else "Set by the planner: no heat pump.", None)
    else:
        hp, s, d = R1.heatpump_rule(inp, inst, cat, ask=ask_hp)
        put("heatpump", hp, s, d)
    ask_wb = ov.get("wallbox_kw") == "include"
    if "wallbox_kw" in ov and not ask_wb:
        wb = float(ov["wallbox_kw"] or 0)
        put("wallbox", wb, f"Set by the planner: {wb:g} kW." if wb else "Set by the planner: no wallbox.", None)
    else:
        wb, s, d = R1.wallbox_rule(inp, ask=ask_wb)
        put("wallbox", wb, s, d)
    inv = float(ov["inverter_kw"]) if ov.get("inverter_kw") not in (None, "include") else R1.inverter_rule(pv, cat)
    if inv:
        expl.append(f"Inverter {inv:g} kW, nearest {R1.INVERTER_RATIO} x {pv:g} kWp.")
    return {"design": {"pv_kwp": pv or None, "inverter_kw": inv, "battery_kwh": bat or None, "heatpump_kw": hp or None, "wallbox_kw": wb or None},
            "components": comps, "explanation": expl, "rules": rules_table(inst, constants), "version": RULES_VERSION}


def cv_score(df, k=5):
    """5-fold CV of calibrate + recommend on df (the fit half); per component and all four."""
    from .calibrate import inputs as row_in, scope
    d = scope(df).reset_index(drop=True)
    fold = np.random.default_rng(42).permutation(len(d)) % k
    hits = {c: [] for c in ("pv", "battery", "heatpump", "wallbox", "all_four")}
    for f in range(k):
        cons = calibrate(d[fold != f])
        te = d[fold == f]
        p = [recommend(row_in(r), constants=cons)["design"] for r in te.to_dict("records")]
        h = {c: _within(c, np.array([x[kk] or 0 for x in p], float), te[kk].values.astype(float))
             for c, kk in [("pv", "pv_kwp"), ("battery", "battery_kwh"), ("heatpump", "heatpump_kw"), ("wallbox", "wallbox_kw")]}
        for c in h:
            hits[c].append(h[c].mean())
        hits["all_four"].append(np.logical_and.reduce(list(h.values())).mean())
    return {c: round(float(np.mean(v)), 3) for c, v in hits.items()} | {"n": len(d)}


if __name__ == "__main__":
    from .split import halves
    fit, _ = halves()
    print("5-fold CV on the fit half:", cv_score(fit))
    cons = calibrate(fit)
    TABLE.write_text(json.dumps(cons, indent=1))
    _table_file.cache_clear()
    for r in rules_table():
        for c in r["constants"]:
            print(f"  {c['name']}: {c['value']}  [{c['source']}]")
