"""rules-4-readout: the experts reverse-engineered into a short readable rule list. Per installer, a shallow tree
(depth 3) for PV and one for the battery (given the PV), fitted on the fit half; every leaf holds the size the most
signed designs in it match within tolerance. Heat pump, wallbox and inverter as rules-1. See docs/rules-readout.md.

    uv run python -m app.planner_rules.rules4     # 5-fold CV on the fit half, then fit, write rules4.json, print the rules
"""
import json
import math
from functools import lru_cache
from pathlib import Path

import numpy as np

from . import calibrated as R1

RULES_VERSION = "rules-4-readout"
TABLE = Path(__file__).with_name("rules4.json")
MODULE_KWP = 0.45
DEPTH, MIN_LEAF = 3, 15
NAMES = {"2a8ba8e2": "Installer A", "23c108b7": "Installer B"}
FEATURES = ["use_kwh", "has_ev", "heats_with_heat_pump", "use_given", "offer_year"]
LABEL = {"use_kwh": "use incl. EV (kWh)", "has_ev": "electric car", "heats_with_heat_pump": "heats with a heat pump",
         "use_given": "use given (not the 4,500 kWh default)", "offer_year": "offer date (year)", "pv_kwp": "PV (kWp)"}


def features(inp, pv=None):
    from ..data import date_t
    ev = (inp.get("ev_annual_km") or 12000) * 0.18 if inp.get("has_ev") else 0.0
    t = date_t(inp.get("offer_date")) if inp.get("offer_date") else float("nan")
    f = {"use_kwh": float(inp.get("annual_demand_kwh") or 0) + ev, "has_ev": float(bool(inp.get("has_ev"))),
         "heats_with_heat_pump": float(inp.get("heating_type") == "Heatpump"),
         "use_given": float((inp.get("annual_demand_kwh") or 0) != 4500), "offer_year": 2026.3 if math.isnan(t) else t}
    if pv is not None:
        f["pv_kwp"] = float(pv)
    return f


def _within(comp, o, e):
    from .. import rules as R
    return R.within(comp, o, e)


def _best(vals, cands, comp):
    vals = np.asarray(vals, float)
    sc = [int(_within(comp, np.full(len(vals), x), vals).sum()) for x in cands]
    j = int(np.argmax(sc))
    return float(cands[j]), sc[j], len(vals)


def _grow(X, y, comp, cands, cols):
    """sklearn tree for the splits; each leaf then takes the tolerance-best size. Returns a nested dict."""
    from sklearn.tree import DecisionTreeRegressor
    t = DecisionTreeRegressor(max_depth=DEPTH, min_samples_leaf=MIN_LEAF, criterion="absolute_error", random_state=42).fit(X, y)
    tr = t.tree_
    leaf = t.apply(X)

    def node(i):
        if tr.children_left[i] == -1:
            v, k, n = _best(y[leaf == i], cands, comp)
            return {"value": v, "matched": k, "n": n}
        return {"feature": cols[tr.feature[i]], "threshold": round(float(tr.threshold[i]), 2),
                "le": node(tr.children_left[i]), "gt": node(tr.children_right[i])}
    return prune(node(0))


def prune(n):
    """Merge two sibling leaves that give the same size: the split says nothing."""
    if "feature" not in n:
        return n
    a, b = prune(n["le"]), prune(n["gt"])
    if "feature" not in a and "feature" not in b and a["value"] == b["value"]:
        return {"value": a["value"], "matched": a["matched"] + b["matched"], "n": a["n"] + b["n"]}
    return {**n, "le": a, "gt": b}


def calibrate(fit_df) -> dict:
    from .calibrate import inputs as row_in, scope
    d = scope(fit_df)
    out = {"_meta": {"fitted_on": f"fit half (seed 42, same ids as engine/lab/split), {len(d)} new-system jobs",
                     "depth": DEPTH, "min_leaf": MIN_LEAF}}
    for inst, g in d.groupby("installer_id"):
        rows = g.to_dict("records")
        new = g[~g.has_solar]
        Xp = np.array([[features(row_in(r))[c] for c in FEATURES] for r in new.to_dict("records")])
        pv_c = np.arange(1.8, 25.01, MODULE_KWP)
        pv_tree = _grow(Xp, new.pv_kwp.values.astype(float), "pv", pv_c, FEATURES)
        pv_hat = [walk(pv_tree, features(row_in(r)))[0]["value"] if not r["has_solar"] else (r["existing_solar_kwp"] or 0) for r in rows]
        Xb = np.array([[features(row_in(r), p)[c] for c in FEATURES + ["pv_kwp"]] for r, p in zip(rows, pv_hat)])
        vc = g[g.battery_kwh > 0].battery_kwh.value_counts()
        pk = np.sort(np.concatenate([[0.0], vc[vc >= 3].index.values.astype(float)]))
        bat_tree = _grow(Xb, g.battery_kwh.values.astype(float), "battery", pk, FEATURES + ["pv_kwp"])
        out[inst] = {"pv": pv_tree, "battery": bat_tree, "packages": [float(x) for x in pk if x]}
    return out


def walk(tree, f):
    """(leaf, path of (feature, threshold, went_le))."""
    path, n = [], tree
    while "feature" in n:
        le = f[n["feature"]] <= n["threshold"]
        path.append((n["feature"], n["threshold"], le))
        n = n["le"] if le else n["gt"]
    return n, path


def _fmt(feat, thr, le):
    if feat in ("has_ev", "heats_with_heat_pump", "use_given"):
        if feat == "use_given":
            return "use not given (4,500 kWh default)" if le else "use given"
        return {"has_ev": ("no electric car", "an electric car"), "heats_with_heat_pump": ("not heating with a heat pump", "heating with a heat pump")}[feat][0 if le else 1]
    if feat == "offer_year":
        y = int(thr); m = int(round((thr - y) * 12)) + 1
        return f"offer {'before' if le else 'from'} {y}-{min(m, 12):02d}"
    unit = "kWh" if feat == "use_kwh" else "kWp"
    return f"{LABEL[feat].split(' (')[0]} {'up to' if le else 'over'} {thr:,.0f} {unit}" if feat == "use_kwh" else f"PV {'up to' if le else 'over'} {thr:g} kWp"


def say(path):
    """Fold repeated thresholds on one number into a range: 'use incl. EV 2,900 to 3,750 kWh'."""
    lo, hi, order, other = {}, {}, [], []
    for f, t, le in path:
        if f in ("use_kwh", "pv_kwp", "offer_year"):
            if f not in order:
                order.append(f)
            if le:
                hi[f] = min(hi.get(f, t), t)
            else:
                lo[f] = max(lo.get(f, t), t)
        else:
            other.append(_fmt(f, t, le))
    out = []
    for f in order:
        if f == "offer_year":
            out += [_fmt(f, lo[f], False)] * (f in lo) + [_fmt(f, hi[f], True)] * (f in hi)
            continue
        u, name = ("kWh", "use incl. EV") if f == "use_kwh" else ("kWp", "PV")
        fmt = (lambda x: f"{x:,.0f}") if f == "use_kwh" else (lambda x: f"{x:g}")
        if f in lo and f in hi:
            out.append(f"{name} {fmt(lo[f])} to {fmt(hi[f])} {u}")
        elif f in lo:
            out.append(f"{name} over {fmt(lo[f])} {u}")
        else:
            out.append(f"{name} up to {fmt(hi[f])} {u}")
    return ", ".join(out + other) or "all homes"


def rule_list(tree, comp, unit):
    """Every leaf as one sentence."""
    out = []

    def rec(n, path):
        if "feature" in n:
            rec(n["le"], path + [(n["feature"], n["threshold"], True)])
            rec(n["gt"], path + [(n["feature"], n["threshold"], False)])
        else:
            v = f"{n['value']:g} {unit}" if n["value"] else "none"
            out.append({"when": say(path), "then": v, "matched": n["matched"], "n": n["n"]})
    rec(tree, [])
    return out


@lru_cache(1)
def _file():
    return json.loads(TABLE.read_text()) if TABLE.exists() else {}


def rules_table(inst=None, constants=None):
    t = constants or _file()
    out = []
    for i in ([inst] if inst else [k for k in t if not k.startswith("_")]):
        for comp, unit in (("pv", "kWp"), ("battery", "kWh")):
            cs = [{"name": f"{comp}: {r['when']}", "id": f"{i}:{comp}:{r['when']}", "value": r["then"], "unit": "", "source": f"{NAMES.get(i, i)}: {r['matched']} of {r['n']} signed designs within tolerance",
                   "fitted_on": (t.get("_meta") or {}).get("fitted_on")} for r in rule_list(t[i][comp], comp, unit)]
            out.append({"name": f"{comp} ({NAMES.get(i, i)})", "sentence": SENTENCE[comp], "constants": cs})
    return out + [r for r in R1.rules_table(inst or "2a8ba8e2") if r["name"] in ("heatpump", "wallbox", "inverter")]


SENTENCE = {"pv": "PV follows the installer's own sizing, read out as a few thresholds on use, EV, heating and offer date; capped by the roof in whole 450 W modules.",
            "battery": "The battery is the installer's package for this PV size and home, read out the same way; none when the home already has storage."}


def recommend(inputs: dict, catalogue: dict | None = None, overrides: dict | None = None, roof: dict | None = None,
              constants: dict | None = None) -> dict:
    inp = dict(inputs)
    inst = inp.get("installer_id")
    t = (constants or _file())[inst]
    cat = catalogue or {}
    ov = overrides or {}
    roof = roof or inp.get("roof")
    comps, expl, fired = {}, [], {}
    fit_on = ((constants or _file()).get("_meta") or {}).get("fitted_on")

    def put(name, size, sentence, der):
        comps[name] = {"decision": "include" if size else "none", "size": size or None, "reason": sentence, "derivation": der}
        expl.append(sentence)

    f = features(inp)
    if "pv_kwp" in ov and ov["pv_kwp"] != "include":
        pv = float(ov["pv_kwp"] or 0)
        put("pv", pv, f"Set by the planner: {pv:g} kWp." if pv else "Set by the planner: no PV.", None)
    elif inp.get("has_solar") and "pv_kwp" not in ov:
        pv = 0.0
        put("pv", 0.0, "The home already has PV, so none is added.", None)
    else:
        leaf, path = walk(t["pv"], f)
        fired["pv"] = f"{inst}:pv:{say(path)}"
        pv = leaf["value"]
        cap = (roof or {}).get("max_kwp")
        capped = bool(cap and pv > cap)
        if capped:
            pv = round(max(1, math.floor(cap / MODULE_KWP)) * MODULE_KWP, 2)
        s = f"{leaf['value']:g} kWp: {NAMES.get(inst, inst)} fits this for {say(path)} ({leaf['matched']} of {leaf['n']} signed homes within tolerance)"
        s += f", capped by the roof at {pv:g} kWp." if capped else "."
        put("pv", pv, s, {"axiom": SENTENCE["pv"], "equation": say(path) + f" -> {leaf['value']:g} kWp",
                          "inputs": [{"name": LABEL[k], "value": round(f[k], 2), "unit": "", "source": "inputs"} for k in dict.fromkeys(p[0] for p in path)]
                          + [{"name": "leaf", "value": f"{leaf['value']:g} kWp", "unit": "", "source": f"{leaf['matched']} of {leaf['n']} signed designs within tolerance", "fitted_on": fit_on}],
                          "axiom_result": leaf["value"], "adjustment": {"label": f"roof holds {cap:g} kWp", "value": pv, "n_similar": None} if capped else None, "final": pv})

    if "battery_kwh" in ov and ov["battery_kwh"] != "include":
        bat = float(ov["battery_kwh"] or 0)
        put("battery", bat, f"Set by the planner: {bat:g} kWh." if bat else "Set by the planner: no battery.", None)
    elif inp.get("has_storage") and "battery_kwh" not in ov:
        bat = 0.0
        put("battery", 0.0, "The home already has a battery, so none is added.", None)
    else:
        base = pv or (inp.get("existing_solar_kwp") or 0.0)
        leaf, path = walk(t["battery"], features(inp, base))
        fired["battery"] = f"{inst}:battery:{say(path)}"
        bat = leaf["value"]
        if ov.get("battery_kwh") == "include" and not bat:
            bat = float(min(t["packages"], key=lambda p: abs(p - base))) if t["packages"] else 0.0
        pk = sorted(cat.get("battery_kwh") or [])
        snapped = min(pk, key=lambda p: abs(p - bat)) if bat and pk and bat not in pk else None
        final = float(snapped or bat)
        bat_leaf, bat = bat, final
        if final:
            s = f"{final:g} kWh: {NAMES.get(inst, inst)}'s package for {say(path)} ({leaf['matched']} of {leaf['n']} within tolerance)" + (f", nearest on sale to {bat_leaf:g}." if snapped else ".")
        else:
            s = f"No battery: {NAMES.get(inst, inst)} fits none for {say(path)} ({leaf['matched']} of {leaf['n']})."
        put("battery", final, s, {"axiom": SENTENCE["battery"], "equation": say(path) + f" -> {bat_leaf:g} kWh" + (f", package {final:g} kWh" if snapped else ""),
                                  "inputs": [{"name": "leaf", "value": f"{bat_leaf:g} kWh", "unit": "", "source": f"{leaf['matched']} of {leaf['n']} signed designs within tolerance", "fitted_on": fit_on}],
                                  "axiom_result": bat_leaf, "adjustment": None, "final": final} if final else None)

    ask_hp = ov.get("heatpump_kw") == "include"
    if "heatpump_kw" in ov and not ask_hp:
        hp = float(ov["heatpump_kw"] or 0)
        put("heatpump", hp, f"Set by the planner: {hp:g} kW." if hp else "Set by the planner: no heat pump.", None)
    else:
        hp, s, d = R1.heatpump_rule(inp, inst, cat, ask=ask_hp)
        fired["heatpump"] = "heatpump:planner asked" if ask_hp else ("heatpump:gas or oil, old boiler" if hp else "heatpump:none")
        put("heatpump", hp, s, d)
    ask_wb = ov.get("wallbox_kw") == "include"
    if "wallbox_kw" in ov and not ask_wb:
        wb = float(ov["wallbox_kw"] or 0)
        put("wallbox", wb, f"Set by the planner: {wb:g} kW." if wb else "Set by the planner: no wallbox.", None)
    else:
        wb, s, d = R1.wallbox_rule(inp, ask=ask_wb)
        fired["wallbox"] = "wallbox:EV or asked" if wb else "wallbox:none"
        put("wallbox", wb, s, d)
    inv = float(ov["inverter_kw"]) if ov.get("inverter_kw") not in (None, "include") else R1.inverter_rule(pv, cat)
    if inv:
        expl.append(f"Inverter {inv:g} kW, nearest {R1.INVERTER_RATIO} x {pv:g} kWp.")
    return {"design": {"pv_kwp": pv or None, "inverter_kw": inv, "battery_kwh": bat or None, "heatpump_kw": hp or None, "wallbox_kw": wb or None},
            "components": comps, "explanation": expl, "rules": rules_table(inst, constants), "version": RULES_VERSION,
            "rules_fired": fired}


def cv_score(df, k=5, fn=None):
    from .calibrate import inputs as row_in, scope
    d = scope(df).reset_index(drop=True)
    fold = np.random.default_rng(42).permutation(len(d)) % k
    acc = []
    for f in range(k):
        cons = calibrate(d[fold != f])
        te = d[fold == f]
        p = [recommend(row_in(r), constants=cons)["design"] for r in te.to_dict("records")]
        h = [_within(c, np.array([x[kk] or 0 for x in p], float), te[kk].values.astype(float))
             for c, kk in [("pv", "pv_kwp"), ("battery", "battery_kwh"), ("heatpump", "heatpump_kw"), ("wallbox", "wallbox_kw")]]
        acc.append([x.mean() for x in h] + [np.logical_and.reduce(h).mean()])
    r = np.mean(acc, 0)
    return {"pv": round(r[0], 3), "battery": round(r[1], 3), "heatpump": round(r[2], 3), "wallbox": round(r[3], 3), "all_four": round(r[4], 3), "n": len(d)}


if __name__ == "__main__":
    from .split import halves
    fit, _ = halves()
    print("5-fold CV on the fit half:", {k: (float(v) if not isinstance(v, int) else v) for k, v in cv_score(fit).items()})
    cons = calibrate(fit)
    TABLE.write_text(json.dumps(cons, indent=1))
    _file.cache_clear()
    for inst in [k for k in cons if not k.startswith("_")]:
        for comp, unit in (("pv", "kWp"), ("battery", "kWh")):
            print(f"\n{NAMES[inst]} {comp}")
            for r in rule_list(cons[inst][comp], comp, unit):
                print(f"  {r['when']}: {r['then']}  ({r['matched']} of {r['n']})")
