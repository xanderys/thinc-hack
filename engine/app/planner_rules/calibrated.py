"""Five planner rules, each one sentence; constants named with value and source. See docs/rules.md."""
import json
import math
from functools import lru_cache
from pathlib import Path

import numpy as np

from ..hourly import sim as S

RULES_VERSION = "rules-1-calibrated"
FITTED = Path(__file__).with_name("constants.json")
MODULE_KWP = 0.45
FULL_LOAD_H = 2300
HEAT_CT = 12
WALLBOX_KW = 11.0
INVERTER_RATIO = 0.85
INVERTER_SIZES = [3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30]
BOILER_AGE_YEARS = 20
HP_SIZES = [5.5, 7.5, 10.5, 12.5]

TEXTBOOK = {
    "evening_share": ("share of a day's household use after sunset and before sunrise", "",
                      "BDEW H25 profile against the PVGIS Munich TMY (hours with no PV output); not fitted"),
    "module_kwp": (MODULE_KWP, "kWp", "one 450 W module, the 2026 standard (docs/domain.md 4)"),
    "full_load_hours": (FULL_LOAD_H, "h", "VDI 4645 range 1,800 to 2,400; installer median 2,300"),
    "heat_price": (HEAT_CT, "ct/kWh", "gas or oil heat incl. boiler losses, 2026 (docs/domain.md 3)"),
    "boiler_age_years": (BOILER_AGE_YEARS, "years", "boilers are replaced at 20 to 30 years (GEG 72: 30-year limit); no boiler age in the data, so not fitted"),
    "inverter_ratio": (INVERTER_RATIO, "", "DC/AC 1.1 to 1.3 (HTW, SMA sizing guides)"),
    "wallbox_kw": (WALLBOX_KW, "kW", "11 kW needs only registration with the grid operator; 22 kW needs approval (docs/domain.md 1)"),
}


@lru_cache(1)
def evening_share() -> float:
    house = S._h25_local().to_numpy()
    dark = S.pv_per_kwp() < 1e-3
    return float(house[dark].sum() / house.sum())


FITTED_OVERRIDE = None  # calibrate.py sets this while it searches


@lru_cache(1)
def _fitted_file() -> dict:
    return json.loads(FITTED.read_text()) if FITTED.exists() else {}


def fitted() -> dict:
    return FITTED_OVERRIDE or _fitted_file()


fitted.cache_clear = _fitted_file.cache_clear


def _c(inst, name):
    f = fitted().get(inst) or fitted().get("_default") or {}
    return f.get(name)


def ev_kwh(inp):
    return (inp.get("ev_annual_km") or 12000) * S.EV_KWH_PER_100KM / 100 if inp.get("has_ev") else 0.0


def _sim_inputs(inp):
    from ..model import roof_to_sim  # orientation and area of a measured roof, as the engine passes them
    return roof_to_sim(inp)


def pv_need(inp):
    """(annual use incl. EV in kWh, yield in kWh/kWp at this roof's orientation)."""
    return inp["annual_demand_kwh"] + ev_kwh(inp), float(S.pv_profile(_sim_inputs(inp), "Munich").sum())


def pv_rule(inp, inst, cat, roof):
    """1. The installer's base array plus enough PV to cover annual use at this roof's yield (times its ratio),
    capped by the roof, whole modules."""
    if inp.get("has_solar"):
        return 0.0, "The home already has PV, so none is added.", None
    ratio, base = _c(inst, "per_use_slope"), _c(inst, "base_kwp") or 0.0
    use, yld = pv_need(inp)
    cover = use / yld * ratio
    raw = base + cover
    pv = max(1, round(raw / MODULE_KWP)) * MODULE_KWP
    cap = (roof or {}).get("max_kwp")
    capped = bool(cap and pv > cap)
    if capped:
        pv = max(1, math.floor(cap / MODULE_KWP)) * MODULE_KWP
    pv = round(pv, 2)
    eq = f"{base:g} kWp + {use:,.0f} kWh / {yld:,.0f} kWh/kWp x {ratio:.2f} = {raw:.2f} kWp"
    eq += f", roof cap {cap:g} kWp" if capped else ""
    eq += f" -> {pv:g} kWp, {pv / MODULE_KWP:.0f} modules of 450 W"
    if ratio:
        sentence = (f"{use:,.0f} kWh a year at {yld:,.0f} kWh per kWp is covered by {use / yld:.1f} kWp; "
                    f"{base:g} kWp base plus {ratio:g} times that is {pv:g} kWp")
    else:
        sentence = f"This installer fits about {base:g} kWp whatever the use: {pv:g} kWp"
    sentence += f", capped by the roof at {cap:g} kWp." if capped else "."
    der = {"axiom": rule_sentences(inst)[0]["sentence"], "equation": eq,
           "inputs": [{"name": "annual use incl. EV", "value": round(use), "unit": "kWh", "source": "inputs"},
                      {"name": "yield", "value": round(yld), "unit": "kWh/kWp", "source": "pvlib on PVGIS TMY, this roof's orientation"},
                      _k(inst, "per_use_slope"), _k(inst, "base_kwp")],
           "axiom_result": round(raw, 2),
           "adjustment": {"label": f"roof holds {cap:g} kWp", "value": pv, "n_similar": None} if capped else None,
           "final": pv}
    return pv, sentence, der


def battery_rule(inp, inst, cat, pv):
    """2. Battery in proportion to the array (the installer's kWh per kWp), snapped up to its packages; none when
    the home has storage or there is no PV. One evening's use is shown beside it as the physics check."""
    if inp.get("has_storage"):
        return 0.0, "The home already has a battery, so none is added.", None
    base = pv or (inp.get("existing_solar_kwp") or 0.0)
    if not base:
        return 0.0, "No battery: there is no PV to charge it.", None
    k = _c(inst, "battery_kwh_per_kwp")
    pk = sorted(cat.get("battery_kwh") or _c(inst, "battery_packages"))
    raw = base * k
    size = next((p for p in pk if p >= raw - 1e-9), pk[-1])
    es = evening_share()
    evening = inp["annual_demand_kwh"] / 365 * es
    src = "new PV" if pv else "existing PV"
    eq = f"{base:g} kWp x {k:.2f} kWh/kWp = {raw:.1f} kWh, next package {size:g} kWh"
    der = {"axiom": rule_sentences(inst)[1]["sentence"], "equation": eq,
           "inputs": [{"name": src, "value": base, "unit": "kWp", "source": "rule 1" if pv else "inputs"},
                      _k(inst, "battery_kwh_per_kwp"),
                      {"name": "battery_packages", "value": ", ".join(f"{p:g}" for p in pk), "unit": "kWh", "source": "installer catalogue"},
                      {"name": "one evening's use (check)", "value": round(evening, 1), "unit": "kWh",
                       "source": f"daily use x evening_share {es:.2f}, {TEXTBOOK['evening_share'][2]}"}],
           "axiom_result": round(raw, 1), "adjustment": None, "final": size}
    tail = "about one evening's use" if 0.67 * evening <= size * S.BAT_USABLE <= 1.5 * evening else (
        f"more than one evening's use ({evening:.1f} kWh)" if size * S.BAT_USABLE > 1.5 * evening else f"less than one evening's use ({evening:.1f} kWh)")
    return float(size), f"The battery follows the array at {k:.2f} kWh per kWp, the next package up: {size:g} kWh, {tail}.", der


def heatpump_rule(inp, inst, cat, ask=False):
    """3. Heat pump when gas or oil heats the home and the boiler is old, or the planner asks; heat over 2,300 h."""
    fossil = inp.get("heating_type") in ("Gas", "Oil")
    age = inp.get("boiler_age_years")
    old = age is not None and age >= BOILER_AGE_YEARS
    if not (ask or (fossil and old)):
        why = "the home does not heat with gas or oil" if not fossil else (
            "the boiler's age is not known" if age is None else f"the boiler is {age:g} years old, under {BOILER_AGE_YEARS}")
        return 0.0, f"No heat pump: {why}.", None
    if inp.get("heating_demand_kwh"):
        heat, src = inp["heating_demand_kwh"], "heat demand given"
        eq = f"{heat:,.0f} kWh / {FULL_LOAD_H:,} h"
    elif inp.get("heating_cost_per_year_eur"):
        heat, src = inp["heating_cost_per_year_eur"] / (HEAT_CT / 100), "heating cost at 12 ct per kWh"
        eq = f"€{inp['heating_cost_per_year_eur']:,.0f} / {HEAT_CT} ct / {FULL_LOAD_H:,} h"
    else:
        heat, src = S.heat_demand_kwh(inp, {})
        eq = f"{heat:,.0f} kWh / {FULL_LOAD_H:,} h"
    raw = heat / FULL_LOAD_H
    sizes = sorted(cat.get("heatpump_kw") or HP_SIZES)
    kw = next((s for s in sizes if s >= raw - 1e-9), sizes[-1])
    eq += f" = {raw:.1f} kW, next size {kw:g} kW"
    der = {"axiom": _GENERIC[0]["sentence"], "equation": eq,
           "inputs": [{"name": "heat a year", "value": round(heat), "unit": "kWh", "source": src},
                      {"name": "full_load_hours", "value": FULL_LOAD_H, "unit": "h", "source": TEXTBOOK["full_load_hours"][2]},
                      {"name": "heat pump sizes", "value": ", ".join(f"{s:g}" for s in sizes), "unit": "kW", "source": "installer catalogue"}],
           "axiom_result": round(raw, 1), "adjustment": None, "final": kw}
    lead = "The planner asked for a heat pump" if ask else f"The {inp['heating_type'].lower()} boiler is {age:g} years old"
    return float(kw), f"{lead}; {heat:,.0f} kWh of heat over {FULL_LOAD_H:,} full-load hours needs {kw:g} kW.", der


def wallbox_rule(inp, ask=False):
    """4. 11 kW wallbox when an EV is real or planned."""
    if inp.get("has_wallbox") and not ask:
        return 0.0, "The home already has a wallbox.", None
    if not (inp.get("has_ev") or ask):
        return 0.0, "No wallbox: no electric car now or planned.", None
    der = {"axiom": _GENERIC[1]["sentence"], "equation": "EV real or planned: 11 kW",
           "inputs": [{"name": "wallbox_kw", "value": WALLBOX_KW, "unit": "kW", "source": TEXTBOOK["wallbox_kw"][2]}],
           "axiom_result": WALLBOX_KW, "adjustment": None, "final": WALLBOX_KW}
    lead = "An electric car is real or planned" if inp.get("has_ev") else "The planner asked for a wallbox"
    return WALLBOX_KW, f"{lead}, so an 11 kW wallbox.", der


def inverter_rule(pv, cat):
    """5. Inverter: catalogue size nearest 0.85 times PV."""
    if not pv:
        return None
    sizes = cat.get("inverter_kw") or INVERTER_SIZES
    return float(min(sizes, key=lambda s: abs(s - INVERTER_RATIO * pv)))


def _k(inst, name):
    f = fitted()
    v = (f.get(inst) or {}).get(name)
    meta = f.get("_meta", {}).get(name, {})
    return {"name": name, "value": v, "unit": meta.get("unit", ""), "source": meta.get("source", "fitted"),
            "fitted_on": (f.get("_fitted_on") or {}).get(inst) if meta.get("fitted", True) else None}


_GENERIC = [
    {"name": "heatpump", "sentence": f"A heat pump when gas or oil heats the home and the boiler is {BOILER_AGE_YEARS} years or older, or the planner asks; sized at the year's heat over {FULL_LOAD_H:,} full-load hours, next size up."},
    {"name": "wallbox", "sentence": "An 11 kW wallbox when an electric car is real or planned."},
    {"name": "inverter", "sentence": f"The inverter nearest {INVERTER_RATIO} times the PV kWp (DC/AC 1.1 to 1.3)."},
]


def rule_sentences(inst) -> list[dict]:
    """The five rules with this installer's fitted numbers in the words; the UI, derivations and docs/rules.md use these."""
    base, slope, k = _c(inst, "base_kwp") or 0.0, _c(inst, "per_use_slope") or 0.0, _c(inst, "battery_kwh_per_kwp") or 0.0
    if slope:
        pv = (f"PV is a base array of {base:g} kWp plus {slope:g} times the kWp that covers the year's use at this roof's yield, "
              "capped by the roof, in whole 450 W modules.")
    else:
        pv = f"PV is about {base:g} kWp on nearly every home, whatever the use, capped by the roof, in whole 450 W modules."
    bat = f"The battery is {k:g} kWh per kWp of array, snapped up to the package on sale; none when the home already has storage."
    return [{"name": "pv", "sentence": pv}, {"name": "battery", "sentence": bat}] + _GENERIC


RULES = [{"name": "pv"}, {"name": "battery"}] + _GENERIC  # names and order only


def rules_table(inst):
    t = {k: {"name": k, "value": v[0] if k != "evening_share" else round(evening_share(), 3), "unit": v[1], "source": v[2], "fitted_on": None}
         for k, v in TEXTBOOK.items()}
    use = {"pv": [_k(inst, "per_use_slope"), _k(inst, "base_kwp"), t["module_kwp"]],
           "battery": [_k(inst, "battery_kwh_per_kwp"), _k(inst, "battery_packages"), t["evening_share"]],
           "heatpump": [t["boiler_age_years"], t["full_load_hours"], t["heat_price"]],
           "wallbox": [t["wallbox_kw"]], "inverter": [t["inverter_ratio"]]}
    return [{**r, "constants": use[r["name"]]} for r in rule_sentences(inst)]


def _fix(ov, key):
    """Planner override: number fixes the size, None fixes none, 'include' asks for it; missing key means free."""
    if ov is None or key not in ov:
        return False, None
    return True, ov[key]


def recommend(inputs: dict, catalogue: dict | None = None, overrides: dict | None = None, roof: dict | None = None,
              constants: dict | None = None) -> dict:
    """constants: a calibrate() result to use instead of constants.json (the lab's scorer passes it)."""
    global FITTED_OVERRIDE
    if constants is not None:
        prev, FITTED_OVERRIDE = FITTED_OVERRIDE, constants
        try:
            return recommend(inputs, catalogue, overrides, roof)
        finally:
            FITTED_OVERRIDE = prev
    inp = dict(inputs)
    inst = inp.get("installer_id")
    cat = catalogue or {"battery_kwh": _c(inst, "battery_packages")}
    roof = roof or inp.get("roof")
    comps, expl = {}, []

    def put(name, size, sentence, der, fixed=False):
        if fixed:
            sentence = f"Set by the planner: {size:g}." if size else "Set by the planner: none."
            der = None
        comps[name] = {"decision": "include" if size else "none", "size": size or None, "reason": sentence, "derivation": der}
        expl.append(sentence)

    fx, v = _fix(overrides, "pv_kwp")
    if fx and v != "include":
        pv = float(v or 0); put("pv", pv, "", None, True)
    else:
        pv, s, d = pv_rule(inp, inst, cat, roof)
        if fx and not pv:  # "include" on a home with PV: size it anyway
            pv, s, d = pv_rule({**inp, "has_solar": False}, inst, cat, roof)
        put("pv", pv, s, d)

    fx, v = _fix(overrides, "battery_kwh")
    if fx and v != "include":
        bat = float(v or 0); put("battery", bat, "", None, True)
    else:
        bat, s, d = battery_rule(inp if not fx else {**inp, "has_storage": False}, inst, cat, pv)
        put("battery", bat, s, d)

    fx, v = _fix(overrides, "heatpump_kw")
    if fx and v != "include":
        hp = float(v or 0); put("heatpump", hp, "", None, True)
    else:
        hp, s, d = heatpump_rule(inp, inst, cat, ask=fx)
        put("heatpump", hp, s, d)

    fx, v = _fix(overrides, "wallbox_kw")
    if fx and v != "include":
        wb = float(v or 0); put("wallbox", wb, "", None, True)
    else:
        wb, s, d = wallbox_rule(inp, ask=fx)
        put("wallbox", wb, s, d)

    fx, v = _fix(overrides, "inverter_kw")
    inv = float(v) if fx and v not in (None, "include") else inverter_rule(pv, cat)
    design = {"pv_kwp": pv or None, "inverter_kw": inv, "battery_kwh": bat or None, "heatpump_kw": hp or None, "wallbox_kw": wb or None}
    if inv:
        expl.append(f"Inverter {inv:g} kW, nearest {INVERTER_RATIO} x {pv:g} kWp.")
    return {"design": design, "components": comps, "explanation": expl, "rules": rules_table(inst), "version": RULES_VERSION}
