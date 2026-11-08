"""rules-5: Reonic's published rules first, the installers' signed designs as named corrections.

Every component starts from Reonic's own rule of thumb (blog and docs, refs DECISION-LOGIC.md). A correction is a ratio
(signed design / textbook) per group of homes, fitted on the fit half; a grouping dimension is kept only if it raises
5-fold CV on the fit half. Each kept correction reads as one line: "Reonic textbook 1.0 kWp per MWh; your planners 1.9;
this design 1.9".

    uv run python -m app.planner_rules.rules5      # select corrections by CV, fit, write rules5.json, print the rules
"""
import json
import math
from functools import lru_cache
from pathlib import Path

import numpy as np

from . import calibrated as R1

RULES_VERSION = "rules-5-textbook-corrected"
TEXTBOOK_VERSION = "rules-5-textbook"
TABLE = Path(__file__).with_name("rules5.json")
MODULE_KWP = 0.45
EV_KWH_PER_KM = 0.18
NAMES = {"2a8ba8e2": "Installer A", "23c108b7": "Installer B"}
MIN_GROUP = 25  # as rules-4's minimum leaf
FIXED = True
GAIN = 0.005  # a dimension must raise CV by half a point to be kept

# ---------- Reonic's published rules (DECISION-LOGIC.md) ----------
R = "https://reonic.com/de-de/blog/"
SRC = {
    "pv": ("about 1 kWp of PV per 1,000 kWh of annual use, at 980 kWh per kWp", R + "eigenverbrauch-autarkiegrad-pv-berechnen/"),
    "orient": ("orientation factors: south 98 to 100%, south-east and south-west 93 to 94%, east 81%, west 79%, flat 84%", R + "pv-anlage-berechnen-formeln/"),
    "fill": ("auto-fill covers 80 to 90% of a roof face", "https://docs.reonic.com/docs/en/offers-plan-pv-plan-modules"),
    "cap": ("residential planning up to about 30 kWp", "https://docs.reonic.com/docs/en/offers-plan-additional-optional-commercial-planning"),
    "bat": ("1.0 to 1.5 kWh of storage per 1,000 kWh of annual use", R + "eigenverbrauch-autarkiegrad-pv-berechnen/"),
    "bat_kwp": ("storage about as large as the array's rated power (1 kWh per kWp)", R + "solaranlagen-speicher/"),
    "bat_day": ("storage between 0.2 and 0.6 kWh per kWh of daily use (Validation AI rule)", "https://reonic.com/en-gb/ai-validation/"),
    "inv": ("DC/AC ratio 1.1 to 1.3; south 1.1 to 1.15, east-west up to 1.3", R + "wechselrichter-auslegen-dc-ac-verhaeltnis/"),
    "hp": ("heat load in W per m2 by build class (120 to 150 unrenovated, 80 to 100 renovated, 50 to 70 after 1995, 40 after 2002, 30 new build), plus 0.5 kW per person for hot water, margin at most 10 to 15%", R + "waermepumpe-dimensionierung/"),
    "wb": ("charging power = grid connection / 1.5; 35 A, the most common, gives 11 kW", "https://docs.reonic.com/docs/en/offers-plan-wallbox-add-components"),
}
PV_KWP_PER_MWH = 1.0
BAT_KWH_PER_MWH = 1.25   # middle of 1.0 to 1.5
TB_BAT_MODE = "mwh"      # textbook battery: "mwh" (1.25 kWh per MWh) or "kwp" (1 kWh per kWp)
DCAC = 1.15              # south, middle of 1.1 to 1.15
FILL = 0.85              # middle of 80 to 90%
CAP_KWP = 30.0
GRID_A = 35              # assumption: the most common connection (Reonic docs); not in the data
HP_W_M2 = [(1977, 135), (1994, 90), (2001, 60), (2015, 40), (9999, 30)]  # unrenovated before the 1977 WSchVO
HP_DEFAULT_M2 = 140      # assumption when the floor area is missing


def orient_factor(az):
    if az is None:
        return 0.84
    d = abs(((float(az) - 180) + 180) % 360 - 180)  # degrees off south
    return 0.99 if d <= 22.5 else 0.935 if d <= 67.5 else 0.80 if d <= 112.5 else 0.65  # north: assumption, not published


# ---------- features ----------
BANDS = [0, 2500, 3500, 4499, 4501, 5500, 7000, 9000, 1e9]  # 4,500 exactly is the pack's default


def use_kwh(inp):
    ev = (inp.get("ev_annual_km") or 12000) * EV_KWH_PER_KM if inp.get("has_ev") else 0.0
    return float(inp.get("annual_demand_kwh") or 0) + ev


def feats(inp):
    from ..data import date_t
    u = use_kwh(inp)
    t = date_t(inp.get("offer_date")) if inp.get("offer_date") else float("nan")
    price = inp.get("electricity_price_ct_kwh")
    return {"installer": inp.get("installer_id") or "?", "band": int(np.digitize(u, BANDS)), "ev": int(bool(inp.get("has_ev"))),
            "heating": inp.get("heating_type") or "Unknown", "era": "?" if math.isnan(t) else ("before 2025" if t < 2025 else "2025 on"),
            "profile": "H0" if (inp.get("load_profile") or "H0") == "H0" else "other",
            "price": "?" if not price else ("under 35 ct" if price < 35 else "35 ct or more"),
            "people": "?" if not inp.get("num_inhabitants") else ("1 to 2" if inp["num_inhabitants"] <= 2 else "3 or more")}


DIMS = ["installer", "band", "ev", "heating", "era", "profile", "price", "people"]
DIM_LABEL = {"installer": "", "band": "use", "ev": "EV", "heating": "heating", "era": "offer", "profile": "load profile",
             "price": "electricity price", "people": "people"}


def band_label(b):
    lo, hi = BANDS[b - 1], BANDS[b] if b < len(BANDS) else None
    if lo == 4499:
        return "use not given (4,500 kWh default)"
    if hi is None or hi >= 1e9:
        return f"use over {lo:,.0f} kWh"
    return f"use {lo:,.0f} to {hi:,.0f} kWh" if lo else f"use up to {hi:,.0f} kWh"


def group_label(key, dims):
    out = []
    for d, v in zip(dims, key):
        if d == "installer":
            out.append(NAMES.get(v, v))
        elif d == "band":
            out.append(band_label(v))
        elif d == "ev":
            out.append("with an EV" if v else "no EV")
        else:
            out.append(f"{DIM_LABEL[d]} {v}")
    return ", ".join(out)


# ---------- textbook ----------
def _roof(inp, roof):
    """(max kWp, orientation factor of the best face) from the roof model or lookup; (None, south) without a roof."""
    from . import physics as P
    roof = roof or inp.get("roof") or {}
    if not (inp.get("roof_model") or roof.get("model") or roof.get("planes") or roof.get("segments")):
        return (roof.get("max_kwp"), 0.99)
    pl = P.planes(inp, roof)
    if not pl or pl[0]["assumed"]:
        return (roof.get("max_kwp"), 0.99)
    return (P.max_kwp(pl), orient_factor(pl[0]["azimuth"]) if pl[0]["tilt"] > 5 else 0.84)


def snap_pv(x):
    return round(float(max(1, round(x / MODULE_KWP)) * MODULE_KWP), 2) if x > 0 else 0.0


def tb_pv(inp, roof=None):
    """kWp before rounding, the cap, and the orientation factor."""
    mx, f = _roof(inp, roof)
    raw = PV_KWP_PER_MWH * use_kwh(inp) / 1000 * 0.99 / f
    cap = min(CAP_KWP, FILL * mx) if mx else CAP_KWP
    return raw, cap, f


def tb_bat(inp):
    u = use_kwh(inp)
    b = BAT_KWH_PER_MWH * u / 1000
    return float(np.clip(b, 0.2 * u / 365, 0.6 * u / 365)) if u else 0.0


def tb_hp_kw(inp):
    y = inp.get("house_built_year") or 1980
    w = next(v for lim, v in HP_W_M2 if y <= lim)
    a = inp.get("house_size_sqm") or HP_DEFAULT_M2
    return a * w / 1000 + 0.5 * (inp.get("num_inhabitants") or 3)


def snap(x, pk):
    return float(min(pk, key=lambda p: abs(p - x))) if pk and x > 0 else float(x)


# ---------- corrections ----------
RATIOS = np.round(np.arange(0.3, 4.001, 0.025), 3)


def _best_ratio(base, y, comp, pk=None):
    from .. import rules as RR
    best = (-1, 1.0)
    pka = np.array(pk or [], float)
    for r in RATIOS:
        x = base * r
        if comp == "pv":
            p = np.where(x > 0, np.maximum(1, np.round(x / MODULE_KWP)) * MODULE_KWP, 0.0)
        else:
            p = pka[np.abs(x[:, None] - pka[None, :]).argmin(1)] if len(pka) else x
        k = int(RR.within(comp, p, y).sum())
        if k > best[0]:
            best = (k, float(r))
    if comp == "pv" and FIXED:  # the planners' standard array: one size for the whole group (stored as -kWp)
        for c in np.unique(y):
            k = int(RR.within("pv", np.full(len(y), c), y).sum())
            if k > best[0]:
                best = (k, -float(c))
    return best[1], best[0]


def _fit_table(F, base, y, comp, dims, pk_by_inst=None):
    """{key tuple -> (ratio, matched, n)} for every prefix of dims with at least MIN_GROUP homes."""
    tab = {}
    for L in range(1, len(dims) + 1):
        ks = [tuple(f[d] for d in dims[:L]) for f in F]
        for key in set(ks):
            m = np.array([k == key for k in ks])
            if m.sum() >= MIN_GROUP:
                pk = (pk_by_inst or {}).get(key[0]) if dims[0] == "installer" else None
                r, k = _best_ratio(base[m], y[m], comp, pk)
                tab[key] = (r, k, int(m.sum()))
    return tab


def _pv_from(tb, ratio, cap):
    return snap_pv(min(-ratio, cap)) if ratio < 0 else snap_pv(min(tb * ratio, cap))


def _lookup(tab, f, dims):
    for L in range(len(dims), 0, -1):
        key = tuple(f[d] for d in dims[:L])
        if key in tab:
            return key, tab[key]
    return None, (1.0, None, None)


def _packages(rows):
    from collections import Counter
    out = {}
    for inst in {r["installer_id"] for r in rows}:
        c = Counter(r["battery_kwh"] for r in rows if r["installer_id"] == inst and r["battery_kwh"] > 0)
        out[inst] = sorted(float(k) for k, v in c.items() if v >= 3)
    return out


def _bases(rows, inps):
    pv_tb = np.array([snap_pv(min(*tb_pv(i)[:2])) for i in inps])
    bat_d = np.array([tb_bat(i) for i in inps])
    return pv_tb, bat_d


def calibrate(fit_df, select=True) -> dict:
    """Fit the corrections on fit_df (new-system jobs). With select, choose the grouping dimensions by inner 5-fold CV."""
    from .calibrate import scope
    d = scope(fit_df)
    rows = d.to_dict("records")
    inps = [_row_in(r) for r in rows]
    cons = {"_meta": {"fitted_on": f"fit half (seed 42, same ids as engine/lab/split), {len(d)} new-system jobs",
                      "rule": "ratio of signed design to Reonic's textbook per group, kept only where 5-fold CV improves"}}
    if select:
        cons["pv_dims"], cons["bat_dims"], cons["bat_base"], cons["log"] = select_dims(d)
    else:
        cons.update({"pv_dims": ["installer"], "bat_dims": ["installer"], "bat_base": "use", "log": []})
    return _fit(rows, inps, cons)


def _fit(rows, inps, cons):
    F = [feats(i) for i in inps]
    pv_tb, bat_tb = _bases(rows, inps)
    y_pv = np.array([r["pv_kwp"] for r in rows], float)
    y_b = np.array([r["battery_kwh"] for r in rows], float)
    pk = _packages(rows)
    cons["packages"] = pk
    m = y_pv > 0
    cons["pv"] = {"|".join(map(str, k)): v for k, v in _fit_table([F[i] for i in np.where(m)[0]], pv_tb[m], y_pv[m], "pv", cons["pv_dims"]).items()}
    # battery base: Reonic's per-use rule, or the signed PV's kWh per kWp; fitted on homes with PV and a battery
    mb = (y_b > 0) & m
    if cons["bat_base"] == "pv_pred":
        pvt = _tab(cons, "pv")
        pred = np.array([_pv_from(pv_tb[i], _lookup(pvt, F[i], cons["pv_dims"])[1][0], CAP_KWP) for i in range(len(rows))])
        base = pred[mb]
    else:
        base = bat_tb[mb] if cons["bat_base"] == "use" else y_pv[mb]
    cons["bat"] = {"|".join(map(str, k)): v for k, v in _fit_table([F[i] for i in np.where(mb)[0]], base, y_b[mb], "battery", cons["bat_dims"], pk).items()}
    cons["bat_share"] = {inst: round(float(np.mean([r["battery_kwh"] > 0 for r in rows if r["installer_id"] == inst and r["pv_kwp"] > 0])), 3) for inst in pk}
    return cons


def _row_in(r):
    from .calibrate import inputs
    return {**inputs(r), "offer_date": r.get("offer_date")}


def _tab(cons, comp):
    out = {}
    for k, v in (cons.get(comp) or {}).items():
        key = tuple(int(x) if x.lstrip("-").isdigit() else x for x in k.split("|"))
        out[key] = tuple(v)
    return out


# ---------- recommend ----------
@lru_cache(1)
def _table_file():
    return json.loads(TABLE.read_text()) if TABLE.exists() else {}


def _put(comps, expl, name, size, sentence, der):
    comps[name] = {"decision": "include" if size else "none", "size": size or None, "reason": sentence, "derivation": der}
    expl.append(sentence)


def recommend(inputs: dict, catalogue: dict | None = None, overrides: dict | None = None, roof: dict | None = None,
              constants: dict | None = None, corrections: bool = True) -> dict:
    inp = dict(inputs)
    cons = constants or _table_file()
    cat = catalogue or {}
    ov = overrides or {}
    roof = roof or inp.get("roof")
    inst = inp.get("installer_id")
    f = feats(inp)
    u = use_kwh(inp)
    comps, expl = {}, []
    pk = sorted(cat.get("battery_kwh") or []) or (cons.get("packages") or {}).get(inst) or []

    # PV
    raw, cap, fac = tb_pv(inp, roof)
    tb = snap_pv(min(raw, cap))
    key, (ratio, k, n) = _lookup(_tab(cons, "pv"), f, cons.get("pv_dims") or ["installer"]) if corrections else (None, (1.0, None, None))
    if "pv_kwp" in ov and ov["pv_kwp"] != "include":
        pv = float(ov["pv_kwp"] or 0)
        _put(comps, expl, "pv", pv, f"Set by the planner: {pv:g} kWp." if pv else "Set by the planner: no PV.", None)
    elif inp.get("has_solar") and "pv_kwp" not in ov:
        pv = 0.0
        _put(comps, expl, "pv", 0.0, "The home already has PV, so none is added.", None)
    else:
        pv = _pv_from(tb, ratio, cap)
        line = f"Reonic textbook {PV_KWP_PER_MWH:.1f} kWp per MWh ({tb:g} kWp)"
        if key and ratio < 0:
            line += f"; your planners fit a standard {-ratio:g} kWp array here ({group_label(key, cons.get('pv_dims'))}, {k} of {n} within tolerance)"
        elif key and ratio != 1.0:
            line += f"; your planners {PV_KWP_PER_MWH * ratio:.2g} ({group_label(key, cons.get('pv_dims'))}, {k} of {n} within tolerance)"
        line += f"; this design {pv / (u / 1000):.2g}" if u else ""
        s = (f"{pv:g} kWp ({round(pv / MODULE_KWP)} modules): {u:,.0f} kWh of use a year. {line}."
             + (f" Capped at {cap:g} kWp ({'85% of the roof' if cap < CAP_KWP else 'the 30 kWp residential limit'})." if tb * ratio > cap + 1e-6 else ""))
        _put(comps, expl, "pv", pv, s, {"axiom": SRC["pv"][0], "equation": f"{u:,.0f} kWh / 1,000 x {PV_KWP_PER_MWH:g} x {0.99:g} / {fac:g} = {raw:.2f} kWp -> textbook {tb:g} kWp" + (f" -> standard array {pv:g} kWp" if ratio < 0 else f" x {ratio:g} = {pv:g} kWp"),
                                        "inputs": [{"name": "use incl. EV", "value": round(u), "unit": "kWh", "source": "inputs; EV at 18 kWh/100 km"},
                                                   {"name": "orientation factor", "value": fac, "unit": "", "source": SRC["orient"][0]},
                                                   {"name": "correction", "value": ratio, "unit": "x textbook", "source": f"{group_label(key, cons.get('pv_dims'))}: {k} of {n} signed designs within tolerance" if key else "none (textbook only)", "fitted_on": cons.get("_meta", {}).get("fitted_on") if key else None}],
                                        "axiom_result": tb, "adjustment": None, "final": pv})

    # battery
    btb = tb_bat(inp)
    bdims = cons.get("bat_dims") or ["installer"]
    base_kind = cons.get("bat_base", "use") if corrections else ("pv" if TB_BAT_MODE == "kwp" else "use")
    base_kind = "pv" if base_kind == "pv_pred" else base_kind
    bkey, (bratio, bk, bn) = _lookup(_tab(cons, "bat"), f, bdims) if corrections else (None, (1.0, None, None))
    if "battery_kwh" in ov and ov["battery_kwh"] != "include":
        bat = float(ov["battery_kwh"] or 0)
        _put(comps, expl, "battery", bat, f"Set by the planner: {bat:g} kWh." if bat else "Set by the planner: no battery.", None)
    elif inp.get("has_storage") and "battery_kwh" not in ov:
        bat = 0.0
        _put(comps, expl, "battery", 0.0, "The home already has a battery, so none is added.", None)
    elif not pv and "battery_kwh" not in ov:
        bat = 0.0
        _put(comps, expl, "battery", 0.0, "No battery: there is no new PV to charge it.", None)
    else:
        x = (btb if base_kind == "use" else pv) * bratio
        bat = snap(x, pk)
        unit = "kWh per MWh" if base_kind == "use" else "kWh per kWp"
        line = (f"Reonic textbook {BAT_KWH_PER_MWH:g} kWh per MWh ({btb:.1f} kWh)" if base_kind == "use"
                else f"Reonic textbook: storage about the array's kWp, 1 kWh per kWp ({pv:g} kWh)")
        if bkey and bratio != 1.0:
            line += f"; your planners {(BAT_KWH_PER_MWH if base_kind == 'use' else 1) * bratio:.2g} {unit} ({group_label(bkey, bdims)}, {bk} of {bn} within tolerance)"
        daily = bat / (u / 365) if u else 0
        line += f"; this design {bat / (u / 1000):.2g} kWh per MWh" if u else ""
        s = (f"{bat:g} kWh: {line}." + (f" Nearest package on sale to {x:.1f} kWh." if pk else "")
             + (f" Reonic's check (0.2 to 0.6 kWh per kWh a day): {daily:.2f}{'' if 0.2 <= daily <= 0.6 else ', outside it, as most signed designs are'}." if u else ""))
        _put(comps, expl, "battery", bat, s, {"axiom": (SRC["bat"][0] if base_kind == "use" else SRC["bat_kwp"][0]) + "; " + SRC["bat_day"][0],
                                              "equation": (f"{u:,.0f} kWh / 1,000 x {BAT_KWH_PER_MWH:g} = {btb:.1f} kWh" if base_kind == "use" else f"{pv:g} kWp")
                                              + f" x {bratio:g} = {x:.1f} kWh" + (f" -> package {bat:g} kWh" if pk else ""),
                                              "inputs": [{"name": "packages", "value": ", ".join(f"{p:g}" for p in pk), "unit": "kWh", "source": "catalogue" if cat.get("battery_kwh") else "sizes sold 3 or more times in the fit half"},
                                                         {"name": "correction", "value": bratio, "unit": f"x {'textbook' if base_kind == 'use' else 'kWp'}", "source": f"{group_label(bkey, bdims)}: {bk} of {bn} within tolerance" if bkey else "none (textbook only)"}],
                                              "axiom_result": round(btb, 1), "adjustment": None, "final": bat})

    # heat pump: rules-1's decision (gas or oil, boiler 20 years or older, or the planner asks), Reonic's size
    ask_hp = ov.get("heatpump_kw") == "include"
    if "heatpump_kw" in ov and not ask_hp:
        hp = float(ov["heatpump_kw"] or 0)
        _put(comps, expl, "heatpump", hp, f"Set by the planner: {hp:g} kW." if hp else "Set by the planner: no heat pump.", None)
    else:
        hp, s, d = R1.heatpump_rule(inp, inst, cat, ask=ask_hp)
        if hp:
            kw = tb_hp_kw(inp)
            sizes = sorted(cat.get("heatpump_kw") or [])
            hp = float(min((x for x in sizes if x >= kw), default=sizes[-1]) if sizes else round(kw, 1))
            s = (f"{hp:g} kW heat pump: Reonic's {next(v for lim, v in HP_W_M2 if (inp.get('house_built_year') or 1980) <= lim)} W per m2 for this build year"
                 f" x {inp.get('house_size_sqm') or HP_DEFAULT_M2:g} m2 plus 0.5 kW per person for hot water = {kw:.1f} kW"
                 + (", next size up on sale." if sizes else ".") + (" Floor area assumed 140 m2." if not inp.get("house_size_sqm") else ""))
            d = {"axiom": SRC["hp"][0], "equation": f"area x W/m2 + 0.5 kW x people = {kw:.1f} kW", "inputs": [], "axiom_result": round(kw, 1), "adjustment": None, "final": hp}
        _put(comps, expl, "heatpump", hp, s, d)

    # wallbox: Reonic's grid / 1.5 at the most common 35 A connection
    ask_wb = ov.get("wallbox_kw") == "include"
    if "wallbox_kw" in ov and not ask_wb:
        wb = float(ov["wallbox_kw"] or 0)
        _put(comps, expl, "wallbox", wb, f"Set by the planner: {wb:g} kW." if wb else "Set by the planner: no wallbox.", None)
    elif inp.get("has_ev") or ask_wb:
        wb = 11.0
        _put(comps, expl, "wallbox", wb, "11 kW wallbox: Reonic's charging power = grid connection / 1.5, and 35 A, the most common connection, gives 11 kW.",
             {"axiom": SRC["wb"][0], "equation": f"{GRID_A} A connection -> 11 kW", "inputs": [], "axiom_result": 11.0, "adjustment": None, "final": 11.0})
    else:
        wb = 0.0
        _put(comps, expl, "wallbox", 0.0, "No wallbox: no electric car.", None)

    inv = float(ov["inverter_kw"]) if ov.get("inverter_kw") not in (None, "include") else _inverter(pv, cat)
    if inv:
        expl.append(f"Inverter {inv:g} kW: Reonic's DC/AC 1.1 to 1.15 for a south roof, {pv / inv:.2f} here.")
    return {"design": {"pv_kwp": pv or None, "inverter_kw": inv, "battery_kwh": bat or None, "heatpump_kw": hp or None, "wallbox_kw": wb or None},
            "components": comps, "explanation": expl, "rules": rules_table(inst, cons, corrections),
            "version": RULES_VERSION if corrections else TEXTBOOK_VERSION,
            "rules_fired": {"pv": "|".join(map(str, key)) if key else "textbook", "battery": "|".join(map(str, bkey)) if bkey else "textbook"}}


def recommend_textbook(inputs, catalogue=None, overrides=None, roof=None, constants=None):
    """Reonic's published rules alone, no corrections: the 'your rules alone' line."""
    return recommend(inputs, catalogue, overrides, roof, constants, corrections=False)


def _inverter(pv, cat):
    if not pv:
        return None
    sizes = sorted(cat.get("inverter_kw") or [3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30])
    return float(min(sizes, key=lambda s: abs(pv / s - DCAC)))


# ---------- rules table ----------
def rules_table(inst=None, constants=None, corrections=True):
    cons = constants or _table_file()
    out = []
    for comp, rate, unit, srck, dims_k in [("pv", PV_KWP_PER_MWH, "kWp per MWh", "pv", "pv_dims"), ("battery", BAT_KWH_PER_MWH, "kWh per MWh", "bat", "bat_dims")]:
        rows = []
        tab = _tab(cons, "pv" if comp == "pv" else "bat") if corrections else {}
        dims = cons.get(dims_k) or ["installer"]
        per_kwp = comp == "battery" and cons.get("bat_base") in ("pv", "pv_pred")
        per = 1 if per_kwp else rate
        u2 = "kWh per kWp" if per_kwp else unit
        for key, (r, k, n) in sorted(tab.items(), key=lambda kv: [str(x) for x in kv[0]]):
            if inst and key[0] != inst:
                continue
            rows.append({"name": "|".join(map(str, key)), "value": -r if r < 0 else round(per * r, 2), "unit": "kWp, standard array" if r < 0 else u2,
                         "source": f"{group_label(key, dims)}: {k} of {n} signed designs within tolerance", "fitted_on": cons.get("_meta", {}).get("fitted_on")})
        out.append({"name": comp, "sentence": f"Reonic textbook: {SRC[srck][0]}. Your planners: the corrections below, kept only where they improve 5-fold CV.",
                    "textbook": {"value": rate, "unit": unit, "source": SRC[srck][0], "url": SRC[srck][1]}, "constants": rows})
    for k in ("bat_kwp", "bat_day", "inv", "hp", "wb", "fill", "cap", "orient"):
        out.append({"name": k, "sentence": f"Reonic textbook: {SRC[k][0]}.", "textbook": {"source": SRC[k][0], "url": SRC[k][1]}, "constants": []})
    return out


# ---------- CV ----------
def cv_score(df, k=5, cons_fn=None, textbook=False):
    from .. import rules as RR
    from .calibrate import scope
    d = scope(df).reset_index(drop=True)
    fold = np.random.default_rng(42).permutation(len(d)) % k
    hits = {c: [] for c in ("pv", "battery", "heatpump", "wallbox", "all_four")}
    for fi in range(k):
        tr, te = d[fold != fi], d[fold == fi]
        cons = (cons_fn or (lambda x: calibrate(x, select=False)))(tr) if not textbook else {}
        p = [recommend(_row_in(r), constants=cons, corrections=not textbook)["design"] for r in te.to_dict("records")]
        h = {c: RR.within(c, np.array([x[kk] or 0 for x in p], float), te[kk].values.astype(float))
             for c, kk in [("pv", "pv_kwp"), ("battery", "battery_kwh"), ("heatpump", "heatpump_kw"), ("wallbox", "wallbox_kw")]}
        for c in h:
            hits[c].append(h[c].mean())
        hits["all_four"].append(np.logical_and.reduce(list(h.values())).mean())
    return {c: round(float(np.mean(v)), 3) for c, v in hits.items()} | {"n": len(d)}


def select_dims(d, log_print=False):
    """Greedy forward selection of grouping dimensions by 5-fold CV on d, PV first then battery (given the chosen PV)."""
    log = []

    def run(pvd, bd, bb):
        return cv_score(d, cons_fn=lambda tr: _fit([r for r in tr.to_dict("records")], [_row_in(r) for r in tr.to_dict("records")],
                                                   {"_meta": {}, "pv_dims": pvd, "bat_dims": bd, "bat_base": bb}))

    pvd, bd, bb = ["installer"], ["installer"], "use"
    base = run(pvd, bd, bb)
    log.append({"step": "start: textbook x one ratio per installer", "pv": base["pv"], "battery": base["battery"], "all_four": base["all_four"]})
    for comp in ("pv", "battery"):
        if comp == "battery":
            for kind, lab in (("pv", "the signed PV"), ("pv_pred", "this design's PV")):
                alt = run(pvd, bd, kind)
                ok = alt["battery"] > base["battery"] + GAIN
                log.append({"step": f"battery as kWh per kWp of {lab} instead of from use", "pv": alt["pv"], "battery": alt["battery"], "all_four": alt["all_four"], "kept": ok})
                if ok:
                    bb, base = kind, alt
        while True:
            cur = pvd if comp == "pv" else bd
            trials = []
            for dim in DIMS:
                if dim in cur:
                    continue
                nd = cur + [dim]
                s = run(nd, bd, bb) if comp == "pv" else run(pvd, nd, bb)
                trials.append((s[comp], dim, s))
                log.append({"step": f"{comp}: add {dim}", "pv": s["pv"], "battery": s["battery"], "all_four": s["all_four"], "kept": False})
                if log_print:
                    print(log[-1], flush=True)
            if not trials:
                break
            best = max(trials, key=lambda t: t[0])
            if best[0] > base[comp] + GAIN:
                for e in log:
                    if e["step"] == f"{comp}: add {best[1]}" and e["pv"] == best[2]["pv"] and e["battery"] == best[2]["battery"]:
                        e["kept"] = True
                cur.append(best[1])
                base = best[2]
            else:
                break
    return pvd, bd, bb, log


if __name__ == "__main__":
    import sys
    from .split import halves
    fit, _ = halves()
    print("textbook only, 5-fold CV on the fit half:", cv_score(fit, textbook=True), flush=True)
    cons = calibrate(fit, select=True)
    for e in cons["log"]:
        print(e)
    print("chosen", cons["pv_dims"], cons["bat_dims"], cons["bat_base"])
    print("corrected, 5-fold CV on the fit half:", cv_score(fit, cons_fn=lambda tr: _fit(tr.to_dict("records"), [_row_in(r) for r in tr.to_dict("records")],
                                                                                      {"_meta": {}, "pv_dims": cons["pv_dims"], "bat_dims": cons["bat_dims"], "bat_base": cons["bat_base"]})))
    TABLE.write_text(json.dumps(cons, indent=1))
    _table_file.cache_clear()


textbook = recommend_textbook
