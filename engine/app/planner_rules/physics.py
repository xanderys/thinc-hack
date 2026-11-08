"""rules-2-physics: the design is the knee of this home's own cost-to-value frontier. No fitted constants; every
parameter is cited in PARAMS and docs/rules.md. The installers' designs are only the exam."""
import json
from functools import lru_cache
from pathlib import Path

import numpy as np

from ..hourly import sim as S

RULES_VERSION = "rules-2-physics"
MODULE_KWP = 0.45
M2_PER_KWP = 5.5
NO_ROOF_MAX_KWP = 30.0
DCAC_LO, DCAC_HI, DCAC_MID = 1.1, 1.3, 1.2
HTW_KWH_PER_MWH = 1.5
FULL_LOAD_H = 2000
WALLBOX_KW = 11.0
INVERTER_SIZES = [3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30]
HP_SIZES = [5.5, 7.5, 10.5, 12.5]
FOSSIL = ("Gas", "Oil", "OtherNonRenewable")
WTP_EUR_KWH = 0.29  # Kaps and Netessine, Operations Research (doi 10.1287/opre.2024.1104): median non-market value of not buying a kWh from the grid
PREMIUM_SCALE = {None: 1.0, "independence": 2.0, "payback": 0.0, "upfront": 0.0}


# name: (value, unit, citation, url)
PARAMS = {
    "yield": ("per plane, hourly", "kWh/kWp", "pvlib ModelChain on the PVGIS TMY for Munich, each roof plane's tilt and azimuth, 14% system losses", "https://re.jrc.ec.europa.eu/pvg_tools/en/"),
    "module_kwp": (MODULE_KWP, "kWp", "one 450 W module, the 2026 standard (docs/domain.md 4)", None),
    "m2_per_kwp": (M2_PER_KWP, "m2/kWp", "about 2 m2 per 450 W module plus spacing and edge clearance (docs/domain.md 1)", None),
    "load": ("BDEW H25", "", "BDEW H25 standard household profile (2025), with a one-home scatter fitted to the HTW Unabhaengigkeitsrechner's published tables, not to any installer (docs/physics.md)", "https://demandlib.readthedocs.io/en/latest/bdew.html"),
    "price": (S.PRICE_CT, "ct/kWh", "BDEW Strompreisanalyse August 2026: 37.0 ct/kWh for households (used when the home gives none)", "https://www.bdew.de/service/daten-und-grafiken/bdew-strompreisanalyse/"),
    "price_rise": (S.PRICE_RISE * 100, "% a year", "nominal rise at the ECB's 2% inflation target, a flat real price", "https://www.ecb.europa.eu/mopo/strategy/html/index.en.html"),
    "feed_in": (f"{S.FEEDIN_LOW} / {S.FEEDIN_HIGH}", "ct/kWh", "EEG feed-in for systems from 1 Aug 2026, up to 10 kWp / 10 to 40 kWp, fixed 20 years (docs/domain.md)", None),
    "negative_hours": (S.NEG_PRICE_HOURS, "h", "no feed-in pay in negative-price hours (EEG 51, Solarspitzengesetz); 573 negative hours in 2025 (SMARD)", "https://www.smard.de/page/en/topic-article/5892/219038"),
    "pv_cost": (f"{S.PV_FIXED_EUR:,.0f} + {S.PV_EUR_KWP:,.0f} per kWp", "€", "line through €1,350/kWp at 5 kWp and €1,000 at 20 kWp, midpoints of the 2026 size table (reduco); Fraunhofer ISE average €1,015/kWp at 10 kWp, March 2026", "https://reduco.ai/blog/solar/solaranlage-kosten-nach-groesse-kwp"),
    "battery_cost": (S.BAT_EUR_KWH, "€/kWh", "second-hand: BSW Solar 2026 market average of €315 per kWh installed (range 270 to 420) as quoted by reduco 2026; the BSW primary was not found; Verbraucherzentrale gives 300 to 700", "https://reduco.ai/blog/stromspeicher-kosten-vergleich-2026"),
    "battery_life": (f"{S.BAT_LIFE_YEARS} years or {S.BAT_LIFE_CYCLES:,} cycles", "", "Verbraucherzentrale 10 to 15 years; LFP 6,000 full cycles to 80% capacity; replaced at today's price", "https://42watt.de/magazin/lebensdauer-stromspeicher"),
    "battery_physics": (f"{S.BAT_USABLE:.0%} usable, {S.BAT_RTE:.0%} round trip", "", "HTW Berlin Stromspeicher-Inspektion 2025 and Unabhaengigkeitsrechner FAQ", "https://solar.htw-berlin.de/studien/stromspeicher-inspektion-2025/"),
    "htw_cap": (HTW_KWH_PER_MWH, "kWh per MWh", "HTW Berlin rule: usable storage at most 1.5 kWh per 1,000 kWh of use; flagged, not a hard cap", "https://www.finanztip.de/daily/stromspeicher-zur-pv-anlage-so-gross-darf-er-hoechstens-sein/"),
    "upkeep": (S.OPEX_SHARE * 100, "% of PV and battery cost a year", "1 to 2% (Fraunhofer ISE via co2online, 2026)", "https://www.co2online.de/modernisieren-und-bauen/photovoltaik/kosten-und-finanzierung/"),
    "degradation": (S.DEGRADATION * 100, "% a year", "median PV degradation 0.5% a year (Jordan and Kurtz, NREL, Prog. Photovolt. 2013)", "https://doi.org/10.1002/pip.1182"),
    "discount": (S.DISCOUNT * 100, "% a year", "a homeowner's opportunity cost, about the 10-year Bund yield in 2026 plus margin", "https://www.bundesbank.de/en/statistics/money-and-capital-markets/interest-rates-and-yields"),
    "knee": ("value per euro >= 1", "", "marginal analysis: add a step while its discounted 20-year value exceeds its cost, which is a marginal return above the discount rate (Brealey, Myers and Allen, Principles of Corporate Finance, NPV rule); the knee of the cost-to-value frontier (Satopaa et al., Kneedle, ICDCS 2011)", "https://doi.org/10.1109/ICDCSW.2011.20"),
    "independence_premium": (WTP_EUR_KWH * 100, "ct per kWh not bought from the grid", "per kWh of household and EV use the home supplies itself instead of buying it: median non-market value of avoided grid purchases among German home-storage households, revealed by adoption (Kaps and Netessine, Residential Battery Storage: Reshaping the Way We Do Electricity, Operations Research, doi 10.1287/opre.2024.1104, data from 3,200 Solarwatt households 2018 to 2020; mean 53 ct); counted in the 20-year value, not in the money NPV; x2 for independence, 0 for payback and upfront", "https://doi.org/10.1287/opre.2024.1104"),
    "dcac": (f"{DCAC_LO} to {DCAC_HI}", "", "DC/AC sizing range for German roofs (HTW Berlin; SMA Sunny Design guidance)", None),
    "heat_pump_cost": (f"{S.HP_GROSS_EUR:,} less {S.HP_SUBSIDY:.0%} of up to {S.HP_ELIGIBLE_CAP:,}", "€", "air-water in an existing home €27,000 to €40,000 (reduco 2026), midpoint; BEG base subsidy 30% (KfW 458)", "https://reduco.ai/blog/waermepumpe-kosten-foerderung"),
    "boiler_avoided": (S.BOILER_AVOIDED_EUR, "€", "a new gas boiler the home would otherwise buy, €8,000 to €12,000 (docs/domain.md 3)", None),
    "heat_cost": (S.HEAT_EUR_PER_KWH * 100, "ct per kWh heat", "gas or oil heat incl. boiler losses, 2026 (docs/domain.md 3)", None),
    "cop": (S.JAZ, "", "Fraunhofer ISE field test, 77 existing homes: air-water seasonal COP 3.4 (final report Nov 2025)", "https://www.ise.fraunhofer.de/de/forschungsprojekte/wp-im-bestand.html"),
    "full_load_hours": (FULL_LOAD_H, "h", "VDI 4645 planning value for heating plus hot water; sized at the heat load, not the 1.5 times median that ISE measured in installed heat pumps", "https://www.cleanthinking.de/?p=1074907"),
    "heat_demand": ("by build year", "kWh/m2", "IWU German residential building typology (Loga et al. 2015) when no heat demand or cost is given", "https://iwu.de/fileadmin/publikationen/gebaeudebestand/episcope/2015_IWU_LogaEtAl_Deutsche-Wohngebaeudetypologie.pdf"),
    "ev": (S.EV_KWH_PER_100KM, "kWh/100 km", "17 kWh/100 km (MDPI Energies 2022); charged from 18:00", "https://mdpi.com/1996-1073/15/18/6575"),
    "wallbox": (WALLBOX_KW, "kW", "11 kW needs only registration with the grid operator (VDE-AR-N 4100); without one the car charges at 3.7 kW", None),
}

RULES = [
    {"name": "pv", "sentence": "Fill the roof's best planes first, module by module, and stop at the last step whose 20-year value is at least its cost; never past the roof.", "params": ["yield", "module_kwp", "m2_per_kwp", "pv_cost", "price", "price_rise", "feed_in", "negative_hours", "degradation", "upkeep", "discount", "independence_premium", "knee"]},
    {"name": "battery", "sentence": "Take the largest battery package whose last step still returns at least its cost over 20 years, counting losses and a replacement at end of life; above HTW's 1.5 kWh per 1,000 kWh is flagged.", "params": ["battery_cost", "battery_life", "battery_physics", "htw_cap", "load", "independence_premium", "knee"]},
    {"name": "heatpump", "sentence": "Offer a heat pump where the home burns gas or oil, the year's heat is known and the 20-year value with it beats keeping the boiler; size it at the lead's heat demand or heating bill over 2,000 full-load hours, else at the envelope's heat load, which is an upper bound.", "params": ["heat_pump_cost", "boiler_avoided", "heat_cost", "cop", "full_load_hours", "heat_demand"]},
    {"name": "wallbox", "sentence": "An 11 kW wallbox when there is an electric car and no wallbox.", "params": ["wallbox", "ev"]},
    {"name": "inverter", "sentence": "The inverter that puts the DC/AC ratio between 1.1 and 1.3, nearest 1.2.", "params": ["dcac"]},
    {"name": "objective", "sentence": "The design is the knee of this home's cost-to-value frontier, where the 20-year value is the money saved plus an independence premium of 29 ct for each kWh not bought from the grid; a stated preference moves along it: independence doubles the premium, payback takes the shortest payback and upfront the most money per euro, both without the premium.", "params": ["knee", "independence_premium", "discount"]},
]


def rules_table(inst=None):
    out = []
    for r in RULES:
        cs = [{"name": k, "value": PARAMS[k][0], "unit": PARAMS[k][1], "source": PARAMS[k][2], "url": PARAMS[k][3], "fitted_on": None} for k in r["params"]]
        out.append({"name": r["name"], "sentence": r["sentence"], "constants": cs})
    return out


def sources():
    return [{"key": k, "citation": v[2], **({"url": v[3]} if v[3] else {})} for k, v in PARAMS.items()]


# ---------- roof planes ----------

def _plane_yield(tilt, az):
    return float(S.pv_per_kwp("Munich", float(tilt), float(az)).sum())


FLAT_TILT = 15.0  # assumption: flat roofs carry modules on 15 degree south racks


def _model_planes(inputs, roof):
    m = inputs.get("roof_model") or (roof or {}).get("model") or {}
    pl = m.get("planes") if isinstance(m, dict) else None
    pl = pl or (roof or {}).get("planes")
    return [p for p in pl or [] if p.get("is_target", True) and (p.get("max_panels") or 0) > 0]


def planes(inputs, roof=None):
    """Usable planes, best first: [{tilt, azimuth, area_m2, max_kwp, yield_kwh_kwp, scale, source}].
    House model planes (LoD2 faces, shaded yield) first, else the roof lookup's segments, else one assumed plane."""
    roof = roof or inputs.get("roof") or {}
    mp = _model_planes(inputs, roof)
    out = []
    if mp:
        for p in mp:
            flat = p.get("azimuth") is None
            tilt, az = (FLAT_TILT, 180.0) if flat else (float(p.get("pitch") or 0), float(p["azimuth"]))
            shaded = p.get("yield_shaded_kwh_per_kwp")
            y = float(shaded or p.get("yield_kwh_per_kwp") or _plane_yield(tilt, az))
            out.append({"id": p.get("id"), "tilt": tilt, "azimuth": az, "area_m2": p.get("area_m2"),
                        "max_kwp": int(p["max_panels"]) * MODULE_KWP, "yield_kwh_kwp": round(y),
                        "scale": y / _plane_yield(tilt, az),
                        "source": "LoD2 face (Bayerische Vermessungsverwaltung)" + (", shaded yield from the bDOM surface model" if shaded else ", unshaded yield")
                        + (", flat: 15 deg south racks (assumption)" if flat else ""), "assumed": False})
    else:
        segs = [x for x in roof.get("segments") or [] if x.get("azimuth") is not None and (x.get("area_m2") or 0) > 0]
        if segs and roof.get("max_kwp"):
            tot = sum(x["area_m2"] for x in segs)
            for x in segs:
                t, a = float(x.get("pitch") or 0), float(x["azimuth"])
                out.append({"id": None, "tilt": t, "azimuth": a, "area_m2": float(x["area_m2"]), "max_kwp": float(x["area_m2"] / tot * roof["max_kwp"]),
                            "yield_kwh_kwp": round(_plane_yield(t, a)), "scale": 1.0, "source": f"roof segment ({roof.get('source')}), usable area / 5.5 m2 per kWp", "assumed": False})
        else:
            for t, a, sh in [o[:3] for o in S.orientation(inputs)]:
                out.append({"id": None, "tilt": t, "azimuth": a, "area_m2": None, "max_kwp": NO_ROOF_MAX_KWP * sh,
                            "yield_kwh_kwp": round(_plane_yield(t, a)), "scale": 1.0,
                            "source": "no roof: typical-year default, south 35 deg (assumption), up to 30 kWp (assumption, set at the 30 kWp limit of the zero-VAT rule for homes, UStG 12(3))", "assumed": True})
    return sorted(out, key=lambda p: -p["yield_kwh_kwp"])


def fill(pl, kwp):
    """kWp on each plane, best plane first, whole modules."""
    left, out = kwp, []
    for p in pl:
        k = min(left, int(p["max_kwp"] / MODULE_KWP + 1e-9) * MODULE_KWP)
        out.append(round(k, 2))
        left = round(left - k, 2)
    return out


def max_kwp(pl):
    return round(sum(int(p["max_kwp"] / MODULE_KWP + 1e-9) for p in pl) * MODULE_KWP, 2)


def _planes_arg(pl, kwp):
    a = fill(pl, kwp)
    return [(p["tilt"], p["azimuth"], k / kwp, p["scale"]) for p, k in zip(pl, a) if k > 0] if kwp else None


def inverter(pv, sizes=None):
    if not pv:
        return None
    sizes = sorted(sizes or INVERTER_SIZES)
    ok = [s for s in sizes if DCAC_LO <= pv / s <= DCAC_HI]
    return float(min(ok or sizes, key=lambda s: abs(pv / s - DCAC_MID)))


# ---------- sweep ----------

def _batteries(cat, inst):
    b = (cat or {}).get("battery_kwh")
    if not b:
        f = Path(__file__).with_name("constants.json")  # catalogue packages counted on the fit half, not fitted
        b = (json.loads(f.read_text()).get(inst) or {}).get("battery_packages") if f.exists() else None
    return sorted({float(x) for x in (b or [5, 7, 10, 15, 20])})


def _pv_steps(top, n_max=40):
    n = int(round(top / MODULE_KWP))
    step = max(1, int(np.ceil(n / n_max)))
    ks = list(range(step, n + 1, step))
    if n and ks[-1] != n:
        ks.append(n)
    return [round(k * MODULE_KWP, 2) for k in ks]


def _self_supplied(f):
    cov = f["direct"] + f["discharge"]
    share = np.divide(cov, f["load"], out=np.zeros(len(cov)), where=f["load"] > 0)
    return float((share * (f["house"] + f["ev"])).sum())


def _annuity():
    t = np.arange(1, S.YEARS + 1)
    return float(((1 - S.DEGRADATION) ** (t - 1) / (1 + S.DISCOUNT) ** t).sum())


def sweep(inp, pl, cat, hp_kw, wb_kw, pvs=None, bats=None, inv_fixed=None, scale=1.0):
    """Every (PV, battery) on this home with the heat pump and wallbox decisions fixed. Rows carry the economics."""
    base = {"heatpump_kw": hp_kw or None, "wallbox_kw": wb_kw or None}
    before = S._flows(inp, S.before_design(base), "Munich")
    pvs = pvs if pvs is not None else [0.0] + _pv_steps(max_kwp(pl))
    bats = bats if bats is not None else [0.0] + _batteries(cat, inp.get("installer_id"))
    rows = []
    for pv in pvs:
        i2 = {**inp, "pv_planes": _planes_arg(pl, pv)} if pv else inp
        for b in bats:
            if b and not pv and not inp.get("has_solar"):
                continue
            d = {**base, "pv_kwp": pv or None, "battery_kwh": b or None,
                 "inverter_kw": inv_fixed if (inv_fixed and pv) else inverter(pv, (cat or {}).get("inverter_kw"))}
            if not (pv or b or hp_kw or wb_kw):
                rows.append({"design": d, "capex": 0.0, "npv": 0.0, "value": 0.0, "prem": 0.0, "grid_cut_kwh": 0.0, "autarky": 0.0, "payback": None, "econ": None})
                continue
            after = S._flows(i2, d, "Munich")
            e = S.economics(i2, d, after, before, "Munich")
            npv = e["annual"]["npv_20y_eur"] or 0.0
            # household and EV kWh now supplied by PV (direct or via the battery): the electricity Kaps et al. valued;
            # the heat pump's own supply is neither rewarded nor charged
            cut = _self_supplied(after) - _self_supplied(before)
            prem = WTP_EUR_KWH * max(cut, 0.0) * _annuity()
            rows.append({"design": d, "capex": e["capex_eur"], "npv": npv, "value": npv + e["capex_eur"] + scale * prem,
                         "prem": prem, "grid_cut_kwh": cut,
                         "autarky": e["autarky_share"], "payback": e["payback_years"], "econ": e})
    return rows


def hull(rows):
    """Upper concave hull of (capex, value), from the cheapest design."""
    pts = sorted(rows, key=lambda r: (r["capex"], -r["value"]))
    h = []
    for r in pts:
        if h and r["value"] <= h[-1]["value"]:
            continue
        while len(h) >= 2:
            a, b = h[-2], h[-1]
            if (b["value"] - a["value"]) * (r["capex"] - a["capex"]) <= (r["value"] - a["value"]) * (b["capex"] - a["capex"]):
                h.pop()
            else:
                break
        h.append(r)
    return h


def knee(h):
    """Last hull point reached by steps that each return at least 1 euro of 20-year value per euro."""
    k = 0
    for i in range(1, len(h)):
        dc = h[i]["capex"] - h[i - 1]["capex"]
        if dc > 0 and (h[i]["value"] - h[i - 1]["value"]) / dc >= 1.0:
            k = i
        else:
            break
    return k


def choose(h, pref):
    k = knee(h)
    if pref == "independence":
        return k, "independence: the knee with the independence premium doubled"
    if pref == "payback":
        ok = [i for i in range(len(h)) if h[i]["payback"]]
        return (min(ok, key=lambda i: h[i]["payback"]) if ok else k), "payback: the shortest payback on the frontier"
    if pref == "upfront":
        ok = [i for i in range(len(h)) if h[i]["capex"] > 0 and h[i]["npv"] > 0]
        return (max(ok, key=lambda i: h[i]["npv"] / h[i]["capex"]) if ok else k), "upfront: the most 20-year value per euro"
    return k, None


# ---------- decisions ----------

def _fix(ov, key):
    if ov is None or key not in ov:
        return False, None
    return True, ov[key]


def heat_known(inp):
    """The year's heat comes from the lead (demand, bill or floor area), not only from defaults."""
    return bool(inp.get("heating_demand_kwh") or inp.get("heating_cost_per_year_eur") or inp.get("house_size_sqm"))


def _envelope_kw(inp):
    return (inp.get("envelope") or (inp.get("roof_model") or {}).get("envelope") or {}).get("design_heat_load_kw")


def _hp_size(inp, cat):
    """(size kW, annual heat kWh, source, raw kW, upper bound kW or None). Precedence: the lead's heat demand, else
    its heating bill, else the envelope (an upper bound: unrenovated IWU U-values on the whole LoD2 volume)."""
    heat, src = S.heat_demand_kwh(inp, {})
    env = _envelope_kw(inp)
    upper = None
    if inp.get("heating_demand_kwh") or inp.get("heating_cost_per_year_eur") or not env:
        raw = heat / FULL_LOAD_H
        upper = float(env) if env else None
    else:
        raw, src = float(env), "envelope: LoD2 faces x IWU U-values, DIN EN 12831 simplified"
    sizes = sorted((cat or {}).get("heatpump_kw") or HP_SIZES)
    return float(next((s for s in sizes if s >= raw - 1e-9), sizes[-1])), heat, src, raw, upper


def _solve(inp, cat, overrides, roof):
    pl = planes(inp, roof)
    ov = overrides or {}
    fx, v = _fix(ov, "pv_kwp")
    top = max_kwp(pl)
    pvs = None
    if inp.get("has_solar") and not fx:
        pvs = [0.0]
    elif fx and v == "include":
        pvs = _pv_steps(top)
    elif fx:
        pvs = [float(v or 0)]
    fx, v = _fix(ov, "battery_kwh")
    bats = None
    if inp.get("has_storage") and not fx:
        bats = [0.0]
    elif fx and v == "include":
        bats = _batteries(cat, inp.get("installer_id"))
    elif fx:
        bats = [float(v or 0)]
    fx, v = _fix(ov, "wallbox_kw")
    wb = (WALLBOX_KW if v == "include" else float(v or 0)) if fx else (WALLBOX_KW if inp.get("has_ev") and not inp.get("has_wallbox") else 0.0)
    hp_size = _hp_size(inp, cat)
    fx, v = _fix(ov, "heatpump_kw")
    if fx:
        hps = [hp_size[0] if v == "include" else float(v or 0)]
    else:
        hps = [0.0, hp_size[0]] if inp.get("heating_type") in FOSSIL and heat_known(inp) else [0.0]
    fx, v = _fix(ov, "inverter_kw")
    inv_fixed = float(v) if fx and v not in (None, "include") else None
    pref = inp.get("preference")
    best = None
    for hp in hps:
        rows = sweep(inp, pl, cat, hp, wb, pvs, bats, inv_fixed, PREMIUM_SCALE.get(pref, 1.0))
        h = hull(rows)
        i, why = choose(h, pref)
        cand = (h[i]["value"] - h[i]["capex"], hp, rows, h, i, why)
        if best is None or cand[0] > best[0] + 1e-6:
            best = cand
    return pl, wb, hp_size, hps, best


# ---------- explanation ----------

def _step_ratio(rows, a, b):
    """20-year value per euro of going from design a to design b."""
    dc = b["capex"] - a["capex"]
    return (b["value"] - a["value"]) / dc if dc else None


def _find(rows, pv, bat):
    for r in rows:
        if abs((r["design"]["pv_kwp"] or 0) - pv) < 1e-6 and abs((r["design"]["battery_kwh"] or 0) - bat) < 1e-6:
            return r
    return None


def _neighbours(vals, x):
    vals = sorted(set(vals))
    i = vals.index(x) if x in vals else None
    if i is None:
        return None, None
    return (vals[i - 1] if i > 0 else None), (vals[i + 1] if i + 1 < len(vals) else None)


def _p(k, extra=None):
    v = PARAMS[k]
    return {"name": k, "value": v[0], "unit": v[1], "source": v[2] + (f" ({extra})" if extra else "")}


def recommend(inputs: dict, catalogue: dict | None = None, overrides: dict | None = None, roof: dict | None = None,
              constants: dict | None = None) -> dict:
    """Same signature and shape as rules-1; constants is accepted and ignored (nothing is fitted)."""
    inp = dict(inputs)
    cat = catalogue or {}
    pl, wb, (hp_sz, heat, heat_src, hp_raw, hp_upper), hps, (npv, hp, rows, h, i, why) = _solve(inp, cat, overrides, roof)
    ch = h[i]
    d = dict(ch["design"])
    pv, bat = d["pv_kwp"] or 0.0, d["battery_kwh"] or 0.0
    e = ch["econ"]
    comps, expl = {}, []
    ov = overrides or {}

    # PV
    pv_vals = [r["design"]["pv_kwp"] or 0.0 for r in rows if abs((r["design"]["battery_kwh"] or 0) - bat) < 1e-6]
    lo, hi = _neighbours(pv_vals, pv)
    here = _find(rows, pv, bat)
    r_in = _step_ratio(rows, _find(rows, lo, bat), here) if lo is not None and here else None
    r_out = _step_ratio(rows, here, _find(rows, hi, bat)) if hi is not None and here else None
    top = max_kwp(pl)
    used = [(p, k) for p, k in zip(pl, fill(pl, pv)) if k > 0]
    plane_txt = "; ".join(f"{k:g} kWp at {p['azimuth']:.0f} deg, {p['tilt']:.0f} deg tilt, {p['yield_kwh_kwp']:,} kWh/kWp" for p, k in used)
    if _fix(ov, "pv_kwp")[0] and ov.get("pv_kwp") != "include":
        s_pv = f"Set by the planner: {pv:g} kWp." if pv else "Set by the planner: no PV."
        der_pv = None
    elif inp.get("has_solar") and not pv:
        s_pv, der_pv = "The home already has PV, so none is added.", None
    elif not pv:
        s_pv = "No PV: on this home no array returns its cost over 20 years."
        der_pv = None
    else:
        eq = f"{pv:g} kWp = {pv / MODULE_KWP:.0f} modules ({plane_txt})"
        if r_in is not None:
            eq += f"; step to {pv:g} kWp returns €{r_in:.2f} of 20-year value (money plus {WTP_EUR_KWH * 100:.0f} ct independence premium per kWh not bought) per €"
        if r_out is not None:
            eq += f", next step to {hi:g} kWp {r_out:.2f}"
        elif pv >= top - 1e-6:
            eq += f"; the roof holds {top:g} kWp"
        s_pv = f"{pv:g} kWp on the best planes: the last step returns €{r_in:.2f} of 20-year value per €" if r_in is not None else f"{pv:g} kWp on the best planes"
        s_pv += f", the next would return {r_out:.2f}." if r_out is not None else (", and the roof is full." if pv >= top - 1e-6 else ".")
        der_pv = {"axiom": RULES[0]["sentence"], "equation": eq,
                  "inputs": [{"name": "annual use", "value": round(e["annual"]["load_kwh"]), "unit": "kWh", "source": "inputs, BDEW H25, EV and heat pump profiles"},
                             {"name": "roof", "value": f"{top:g}", "unit": "kWp", "source": pl[0]["source"]}]
                  + [{"name": f"plane {p.get('id') or j + 1}", "value": f"{k:g} kWp, {p['yield_kwh_kwp']:,} kWh/kWp, {p['azimuth']:.0f} deg, {p['tilt']:.0f} deg", "unit": "", "source": p["source"]}
                     for j, (p, k) in enumerate(used)]
                  + [
                             _p("pv_cost"), _p("price", f"{(inp.get('electricity_price_ct_kwh') or S.PRICE_CT):g} ct used"), _p("feed_in"), _p("negative_hours"), _p("discount"), _p("independence_premium", f"x{PREMIUM_SCALE.get(inp.get('preference'), 1.0):g}"), _p("knee")],
                  "axiom_result": pv, "adjustment": {"label": why, "value": pv, "n_similar": None} if why else None, "final": pv}
    comps["pv"] = {"decision": "include" if pv else "none", "size": pv or None, "reason": s_pv, "derivation": der_pv}
    expl.append(s_pv)

    # battery
    b_vals = [r["design"]["battery_kwh"] or 0.0 for r in rows if abs((r["design"]["pv_kwp"] or 0) - pv) < 1e-6]
    blo, bhi = _neighbours(b_vals, bat)
    rb_in = _step_ratio(rows, _find(rows, pv, blo), here) if blo is not None and here and _find(rows, pv, blo) else None
    rb_out = _step_ratio(rows, here, _find(rows, pv, bhi)) if bhi is not None and here and _find(rows, pv, bhi) else None
    htw = HTW_KWH_PER_MWH * (inp.get("annual_demand_kwh") or 0) / 1000
    nt = day(inp, d, roof, _pl=pl)["night"] if (pv or inp.get("has_solar")) else None
    if _fix(ov, "battery_kwh")[0] and ov.get("battery_kwh") != "include":
        s_b, der_b = (f"Set by the planner: {bat:g} kWh." if bat else "Set by the planner: no battery."), None
    elif inp.get("has_storage") and not bat:
        s_b, der_b = "The home already has a battery, so none is added.", None
    elif not bat:
        first = _find(rows, pv, sorted(set(b_vals))[1]) if len(set(b_vals)) > 1 else None
        rr = _step_ratio(rows, here, first) if first and here else None
        s_b = (f"No battery: the smallest package returns €{rr:.2f} per € over 20 years." if rr is not None else "No battery: there is no PV to charge it.")
        der_b = None
    else:
        life = S.battery_life_years(bat, e["annual"]["battery_discharged_kwh"])
        eq = f"{bat:g} kWh, {bat * S.BAT_USABLE:.1f} usable, {e['annual']['battery_discharged_kwh']:,.0f} kWh a year from it"
        if rb_in is not None:
            eq += f"; the step to {bat:g} kWh returns €{rb_in:.2f} per €"
        if rb_out is not None:
            eq += f", next package {bhi:g} kWh {rb_out:.2f}"
        eq += f"; replaced after {life:.0f} years" if life and life < S.YEARS else ""
        warn = bat * S.BAT_USABLE > htw
        s_b = f"{bat:g} kWh: the last package step returns €{rb_in:.2f} per €" if rb_in is not None else f"{bat:g} kWh"
        s_b += f", the next {rb_out:.2f}" if rb_out is not None else ""
        s_b += (f"; one night needs {nt['evening_kwh']:.1f} kWh" if nt else "") + "."
        if warn:
            s_b += f" Above HTW's cap of {htw:.1f} kWh usable."
        der_b = {"axiom": RULES[1]["sentence"], "equation": eq,
                 "inputs": [{"name": "evening and night use", "value": nt and nt["evening_kwh"], "unit": "kWh", "source": "the representative spring weekday, hourly simulation"},
                            {"name": "HTW cap", "value": round(htw, 1), "unit": "kWh usable", "source": PARAMS["htw_cap"][2]},
                            {"name": "packages", "value": ", ".join(f"{x:g}" for x in sorted(set(b_vals)) if x), "unit": "kWh", "source": "installer catalogue"},
                            _p("battery_cost"), _p("battery_life"), _p("battery_physics"), _p("independence_premium", f"x{PREMIUM_SCALE.get(inp.get('preference'), 1.0):g}"), _p("knee")],
                 "axiom_result": bat,
                 "adjustment": {"label": f"above HTW's {htw:.1f} kWh usable: flagged", "value": bat, "n_similar": None} if warn else None,
                 "final": bat}
    comps["battery"] = {"decision": "include" if bat else "none", "size": bat or None, "reason": s_b, "derivation": der_b}
    expl.append(s_b)

    # heat pump
    if _fix(ov, "heatpump_kw")[0] and ov.get("heatpump_kw") != "include":
        s_h, der_h = (f"Set by the planner: {hp:g} kW." if hp else "Set by the planner: no heat pump."), None
    elif len(hps) == 1 and not hp:
        s_h = ("No heat pump: the home does not burn gas or oil." if inp.get("heating_type") not in FOSSIL
               else "No heat pump yet: the year's heat is unknown; ask for the heating bill.")
        s_h = "The home already heats with a heat pump." if inp.get("heating_type") == "Heatpump" else s_h
        der_h = None
    else:
        alt = sweep(inp, pl, cat, 0.0 if hp else hp_sz, wb, [pv], [bat], d.get("inverter_kw"), PREMIUM_SCALE.get(inp.get("preference"), 1.0))
        other = alt[0]["value"] - alt[0]["capex"] if alt else None  # the same PV and battery with the other heat pump decision
        eq = (f"envelope heat load {hp_raw:.1f} kW (LoD2 faces x IWU U-values), next size {hp_sz:g} kW" if heat_src.startswith("envelope")
              else f"{heat:,.0f} kWh heat / {FULL_LOAD_H:,} h = {hp_raw:.1f} kW, next size {hp_sz:g} kW")
        if other is not None:
            eq += f"; 20-year value (money plus independence premium) with €{npv if hp else other:,.0f}, without €{other if hp else npv:,.0f}"
        if hp:
            size_txt = f"the envelope's {hp_raw:.1f} kW heat load" if heat_src.startswith("envelope") else f"{heat:,.0f} kWh of heat over {FULL_LOAD_H:,} full-load hours"
            gain = npv - (other or 0)
            s_h = f"{hp:g} kW heat pump: {size_txt}; it {'adds' if gain >= 0 else 'costs'} €{abs(gain):,.0f} of 20-year value."
        else:
            s_h = f"No heat pump: with one, this home's 20-year value would be €{npv - other:,.0f} lower." if other is not None else "No heat pump."
        der_h = {"axiom": RULES[2]["sentence"], "equation": eq,
                 "inputs": ([{"name": "design heat load", "value": round(hp_raw, 1), "unit": "kW", "source": "envelope: LoD2 faces x IWU U-values, DIN EN 12831 simplified"}] if heat_src.startswith("envelope") else [])
                           + [{"name": "heat a year", "value": round(heat), "unit": "kWh", "source": S.heat_demand_kwh(inp, {})[1]},
                            _p("full_load_hours"), _p("cop"), _p("heat_pump_cost"), _p("boiler_avoided"), _p("heat_cost")],
                 "axiom_result": round(hp_raw, 1),
                 "adjustment": ({"label": f"up to {hp_upper:.0f} kW if the {int(inp['house_built_year']) if inp.get('house_built_year') else ''} fabric is unrenovated (envelope upper bound)".replace("the  fabric", "the fabric"),
                                 "value": round(hp_upper, 1), "n_similar": None} if hp_upper else None),
                 "heat_load_upper_bound_kw": round(hp_upper, 1) if hp_upper else None, "final": hp or None}
    comps["heatpump"] = {"decision": "include" if hp else "none", "size": hp or None, "reason": s_h, "derivation": der_h}
    expl.append(s_h)

    # wallbox
    if _fix(ov, "wallbox_kw")[0]:
        s_w = f"Set by the planner: {wb:g} kW." if wb else "Set by the planner: no wallbox."
        der_w = None
    elif wb:
        s_w = "An electric car and no wallbox: 11 kW."
        der_w = {"axiom": RULES[3]["sentence"], "equation": "EV and no wallbox: 11 kW", "inputs": [_p("wallbox"), _p("ev")],
                 "axiom_result": wb, "adjustment": None, "final": wb}
    else:
        s_w = "The home already has a wallbox." if inp.get("has_wallbox") else "No wallbox: no electric car."
        der_w = None
    comps["wallbox"] = {"decision": "include" if wb else "none", "size": wb or None, "reason": s_w, "derivation": der_w}
    expl.append(s_w)
    if d.get("inverter_kw"):
        expl.append(f"Inverter {d['inverter_kw']:g} kW: DC/AC {pv / d['inverter_kw']:.2f}.")
    if why:
        expl.append(f"Preference {why}.")
    return {"design": {k: d.get(k) for k in ("pv_kwp", "inverter_kw", "battery_kwh", "heatpump_kw", "wallbox_kw")},
            "components": comps, "explanation": expl, "rules": rules_table(), "version": RULES_VERSION,
            "sim_inputs": {"pv_planes": _planes_arg(pl, pv)} if pv else {},
            "objective": objective(why)}


def objective(why=None):
    return {"name": "knee" if not why else why.split(":")[0],
            "sentence": RULES[5]["sentence"] if not why else f"Preference {why}.",
            "sources": [PARAMS["knee"][2], PARAMS["discount"][2]]}


# ---------- frontier and day for /api/explain/layers ----------

def frontier(inputs: dict, roof: dict | None = None, catalogue: dict | None = None, overrides: dict | None = None) -> list[dict]:
    """Every swept (PV, battery) for the chosen heat pump and wallbox decisions; on_frontier marks the hull, chosen the
    design recommend() returns, label the preference points."""
    inp = dict(inputs)
    pl, wb, _, _, (npv, hp, rows, h, i, why) = _solve(inp, catalogue or {}, overrides, roof)
    hid = {id(r) for r in h}
    labels = {}
    for pref in ("payback", "upfront"):
        j, _ = choose(h, pref)
        labels.setdefault(id(h[j]), pref)
    labels.setdefault(id(h[knee(h)]), "knee")
    out = []
    for r in rows:
        out.append({"kwp": r["design"]["pv_kwp"] or 0.0, "kwh": r["design"]["battery_kwh"] or 0.0, "capex_eur": r["capex"],
                    "npv_20y_eur": r["npv"], "independence_eur": round(r["value"] - r["capex"] - r["npv"], -1),
                    "value_20y_eur": round(r["value"] - r["capex"], -1), "autarky_share": r["autarky"], "payback_years": r["payback"],
                    "on_frontier": id(r) in hid, "chosen": r is h[i], **({"label": labels[id(r)]} if id(r) in labels else {})})
    return out


def _soc(surplus, deficit, kwh):
    n = len(surplus)
    soc_t = np.zeros(n)
    if not kwh:
        return soc_t
    cap, p = kwh * S.BAT_USABLE, max(2.5, S.BAT_C_RATE * kwh)
    e = S.BAT_RTE ** 0.5
    soc = 0.0
    for t in range(n):
        if surplus[t] > 0:
            soc += min(surplus[t], p, (cap - soc) / e) * e
        else:
            soc -= min(deficit[t], p, soc * e) / e
        soc_t[t] = soc
    return soc_t


@lru_cache(maxsize=1)
def _spring_weekdays():
    _, local = S._local_hours()
    d = local.normalize()
    m = (local.month.isin([4, 5])) & (local.dayofweek < 5)
    return d, m


def day(inputs: dict, design: dict, roof: dict | None = None, _pl=None, date: str | None = None) -> dict:
    """A representative spring weekday (the April-May weekday with the median PV) hour by hour, and that night.
    inputs["pv_planes"] (the engine's laid-out planes) is used as given; date ("YYYY-MM-DD") picks the day."""
    inp = dict(inputs)
    pv_k = design.get("pv_kwp") or 0
    if inp.get("pv_planes"):
        i2 = inp
    else:
        pl = _pl or planes(inp, roof)
        i2 = {**inp, "pv_planes": _planes_arg(pl, pv_k)} if pv_k else inp
    f = S._flows(i2, design, "Munich")
    soc = _soc(f["pv"] - f["direct"], f["load"] - f["direct"], f["bat"])
    d, m = _spring_weekdays()
    days = sorted(set(d[m]))
    ppd = {x: f["pv"][d == x].sum() for x in days}
    want = None
    if date:
        import pandas as pd
        try:
            want = pd.Timestamp(date) if any(c.isdigit() for c in str(date)[:4]) and "-" in str(date) else pd.Timestamp(f"{date} 2001")
        except Exception:
            want = None
    pick = sorted(x for x in set(d) if want is not None and (x.month, x.day) == (want.month, want.day))
    if pick:
        target = pick[0]
    elif pv_k:
        target = sorted(days, key=lambda x: ppd[x])[len(days) // 2]
    else:
        target = days[len(days) // 2]
    idx = np.where(d == target)[0]
    _, local = S._local_hours()
    hours = [{"h": int(local[t].hour), "pv_kw": round(float(f["pv"][t]), 2), "load_kw": round(float(f["load"][t]), 2),
              "battery_kw": round(float(f["discharge"][t] - f["charge"][t]), 2),
              "grid_kw": round(float(f["grid_import"][t] - f["feed_in"][t]), 2), "soc_kwh": round(float(soc[t]), 2)} for t in idx]
    # the night after it: from the last hour with PV to the first next morning
    lit = S.pv_per_kwp("Munich") > 1e-3
    t = idx[-1]
    while t > idx[0] and not lit[t]:
        t -= 1
    start, end = t + 1, t + 1
    while end < 8760 and not lit[end]:
        end += 1
    night_load = float(f["load"][start:end].sum())
    return {"date": str(target.date()), "hours": hours,
            "night": {"evening_kwh": round(night_load, 1), "night_hours": int(end - start),
                      "battery_kwh": round(float(f["bat"] * S.BAT_USABLE), 1),
                      "htw_cap_kwh": round(HTW_KWH_PER_MWH * (inp.get("annual_demand_kwh") or 0) / 1000, 1)}}


# ---------- docs/rules.md, same words as rules_table() ----------

DOCS = Path(__file__).resolve().parents[3] / "docs" / "rules.md"
START, END = "<!-- rules-2 generated by physics.py: start -->", "<!-- rules-2 generated by physics.py: end -->"


def docs_block():
    out = [START, ""]
    for i, r in enumerate(rules_table(), 1):
        out.append(f"{i}. {r['sentence']}")
    out += ["", "| Parameter | Value | Source |", "|---|---|---|"]
    for k, (v, unit, cite, url) in PARAMS.items():
        val = f"{v:g}" if isinstance(v, (int, float)) else str(v)
        out.append(f"| `{k}` | {val} {unit} | {cite}" + (f" ([link]({url}))" if url else "") + " |")
    out.append(END)
    return "\n".join(out)


def write_docs():
    t = DOCS.read_text()
    a, b = t.index(START), t.index(END) + len(END)
    DOCS.write_text(t[:a] + docs_block() + t[b:])


if __name__ == "__main__":
    write_docs()
    print("docs/rules.md rules-2 section rewritten from rules_table() and PARAMS")
