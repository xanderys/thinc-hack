"""v2.3: POST /api/explain/layers, the data behind the spatial demonstration of one home.
Until REONIC PHYSICS's frontier() and day() land, the frontier is the engine's catalogue grid and the day comes straight
from the hourly simulation; both through the same hourly physics as every other number."""
import hashlib
import json

import logging

import numpy as np

from . import hourly, roofs, rules

_CACHE: dict = {}
log = logging.getLogger("engine")
SOURCES = [
    {"key": "pvgis", "citation": "PVGIS typical meteorological year, Munich, European Commission JRC", "url": "https://re.jrc.ec.europa.eu/pvg_tools/en/"},
    {"key": "pvlib", "citation": "pvlib python, Holmgren et al., J. Open Source Software 3(29), 884, 2018", "url": "https://pvlib-python.readthedocs.io"},
    {"key": "bdew", "citation": "BDEW standard load profile H25 (household), via demandlib", "url": "https://github.com/oemof/demandlib"},
    {"key": "htw", "citation": "HTW Berlin, Stromspeicher-Inspektion and Unabhängigkeitsrechner: storage up to about 1.5 kWh per MWh of use", "url": "https://solar.htw-berlin.de/rechner/unabhaengigkeitsrechner/"},
    {"key": "eeg", "citation": "EEG feed-in from 1 Aug 2026: 7.70 ct/kWh up to 10 kWp, 6.66 above", "url": "https://www.bundesnetzagentur.de"},
    {"key": "lod2", "citation": "Bayerische Vermessungsverwaltung – www.geodaten.bayern.de, LoD2 and DOP20, CC BY 4.0", "url": "https://www.geodaten.bayern.de"},
]


def _key(inp, design):
    clean = {k: v for k, v in inp.items() if not k.startswith("_") and k != "roof"}
    return hashlib.sha256(json.dumps([clean, design], sort_keys=True, default=str).encode()).hexdigest()[:16]


def _cf(sim_in, design, econ):
    from . import cashflow
    return cashflow.add(sim_in, design, econ)


def _day(sim_in, design) -> dict:
    res = hourly.simulate(sim_in, design)
    h = res.hourly
    utc, local = hourly.sim._local_hours()
    # the April or May weekday whose PV total sits at the 70th percentile of those months: sunny, not exceptional
    days = local.normalize()
    pv = np.asarray(h["pv"])
    window = (local.month >= 4) & (local.month <= 5)
    load = np.asarray(h["load"])
    totals, uses = {}, {}
    for i in np.where(window)[0]:
        totals[days[i]] = totals.get(days[i], 0.0) + pv[i]
        uses[days[i]] = uses.get(days[i], 0.0) + load[i]
    cand = [d for d in totals if d.weekday() < 5]
    if cand:  # typical on both counts: PV near the 70th percentile, the home's use near its median for those weeks
        t_pv = float(np.percentile([totals[d] for d in cand], 70))
        t_use = float(np.median([uses[d] for d in cand]))
        day = min(cand, key=lambda d: abs(totals[d] - t_pv) / t_pv + abs(uses[d] - t_use) / t_use)
    else:
        day = days[0]
    idx = np.where(days == day)[0][:24]
    e = float(np.sqrt(hourly.sim.BAT_RTE))
    cap = (design.get("battery_kwh") or 0) * hourly.sim.BAT_USABLE
    soc_all = np.zeros(len(h["charge"]))  # state of charge, hour by hour from the dispatch flows
    soc = 0.0
    if cap:
        for i, (c, d) in enumerate(zip(h["charge"], h["discharge"])):
            soc = min(max(soc + c * e - d / e, 0.0), cap)
            soc_all[i] = soc
    hours = []
    for i in idx:
        hours.append({"h": int(local[i].hour), "pv_kw": round(float(h["pv"][i]), 3), "load_kw": round(float(h["load"][i]), 3),
                      "direct_self_kw": round(float(h["direct"][i]), 3),  # PV used in the home the same hour
                      "battery_kw": round(float(h["discharge"][i] - h["charge"][i]), 3),  # + = battery supplies the home
                      "grid_kw": round(float(h["grid_import"][i] - h["feed_in"][i]), 3),  # + = import
                      "soc_kwh": round(float(soc_all[i]), 3)})
    dark = [x for x in hours if x["pv_kw"] < 0.01]
    evening = sum(x["load_kw"] for x in dark if x["h"] >= 12)  # after sunset to midnight
    overnight = sum(x["load_kw"] for x in dark if x["h"] < 12)  # midnight to sunrise
    return {"date": f"{day.strftime('%d %B')} (a typical-year weekday: PV at the 70th percentile of April and May, the home's use at its median)", "hours": hours}, {"evening_kwh": round(evening, 2), "night_kwh": round(overnight, 2), "dark_kwh": round(evening + overnight, 2),
                                               "night_hours": len(dark)}, _cf(sim_in, design, res.economics)


EV_SOURCES = [
    {"key": "ev_consumption", "citation": "18 kWh per 100 km, the engine's hourly simulation (app/hourly/sim.py), a mid-size EV in mixed driving"},
    {"key": "home_share", "citation": "Fraunhofer ISI, press release 21/2025: about 80 percent of electric cars registered in Germany are charged at home",
     "url": "https://www.isi.fraunhofer.de/en/presse/2025/presseinfo-21-elektroautos-ladeinfrastruktur-mehrparteienhaus.html"},
    {"key": "wallbox", "citation": "11 kW needs registration with the grid operator, 22 kW its approval; 22 kW needs a 3-phase 32 A supply",
     "url": "https://www.vattenfall.de/infowelt-energie/wallbox-anmelden"},
]


def ev_block(inp: dict, design: dict):
    """The car in numbers, when the home has one: what it adds to the home's load and what the wallbox must deliver."""
    if not inp.get("has_ev"):
        return None
    from .hourly import sim as S
    km = float(inp.get("ev_annual_km") or 12000)
    per100 = float(S.EV_KWH_PER_100KM)
    annual = km * per100 / 100
    share = 0.8
    night = annual * share / 365
    window_h = 12  # 18:00 to 06:00
    wb = design.get("wallbox_kw") or 11.0
    return {"annual_km": km, "kwh_per_100km": per100, "annual_kwh": round(annual), "home_share": share,
            "annual_kwh_at_home": round(annual * share),
            "simulated_at_home_kwh": round(annual),  # the hourly year charges every km at home: an upper bound for the home's load
            "charging_window": "18:00 to 06:00", "kwh_per_night_typical": round(night, 1),
            "kw_needed": round(night / window_h, 2), "wallbox_kw": wb, "hours_per_night_at_wallbox": round(night / wb, 1),
            "km_per_hour_at_11kw": round(11 / (per100 / 100)), "note_22kw": "22 kW only with a 3-phase 32 A supply",
            "note": ("The hourly simulation charges the whole year at home from 18:00 (an upper bound); about 80% is the German "
                     "average share charged at home."),
            "sources": EV_SOURCES}


def explain(eng, inp: dict, design: dict | None) -> dict:
    """One run: the design's laid-out modules, its hourly year, its day and night; the frontier from rules-2's sweep."""
    try:
        from .planner_rules import physics as P, frontier as f2
    except Exception:
        return explain_grid(eng, inp, design)
    from . import layout as L
    from .model import roof_to_sim
    resp = eng.predict(dict(inp), extras=False)  # hourly economics on the laid-out planes (same pipeline as /api/design)
    if design is not None:
        design = {kk: design.get(kk) for kk in ("pv_kwp", "inverter_kw", "battery_kwh", "heatpump_kw", "wallbox_kw")}
        if design.get("pv_kwp") and not design.get("inverter_kw"):
            design["inverter_kw"] = rules.inverter_kw(design["pv_kwp"])
    else:
        design = resp["design"]
    k = _key(inp, design) + "-one-run"
    if k in _CACHE:
        return _CACHE[k]
    clean = roof_to_sim({kk: v for kk, v in inp.items() if not kk.startswith("_")})
    lo = L.layout(inp, design.get("pv_kwp"))
    sim_in = {**clean, "pv_planes": lo["pv_planes"]} if lo else clean
    day, night, econ = _day(sim_in, design)
    use = float(inp.get("annual_demand_kwh") or 0) + rules.ev_kwh(inp)
    night.update(battery_kwh=design.get("battery_kwh") or 0, htw_cap_kwh=round(1.5 * use / 1000, 1))
    rid = L.run_id(inp, design, lo["pv_planes"] if lo else None)
    # the design endpoint's economics must be this run's
    d_econ = resp["economics"] if resp["design"] == design else econ
    pairs = {"pv_yield_kwh": (econ["annual"]["pv_yield_kwh"], d_econ["annual"]["pv_yield_kwh"]),
             "capex_eur": (econ["capex_eur"], d_econ["capex_eur"])}
    if lo and lo["modules"] != L.modules_for(design.get("pv_kwp")):
        log.warning("layers: %d modules on the roof against %d in the design (%s)", lo["modules"], L.modules_for(design.get("pv_kwp")), inp.get("address"))
    for name, (a, b) in pairs.items():
        if a != b:
            log.warning("layers: %s differs between explain (%s) and design (%s) for %s", name, a, b, inp.get("address"))
    hp_kw = (resp["components"]["heatpump"].get("derivation") or {}).get("axiom_result") if design.get("heatpump_kw") else None
    planes = None
    if lo:
        planes = {**lo["planes"], "glb_url": roofs.model_url(inp["address"])}
    t = __import__("app.model", fromlist=["base_features"]).base_features(inp, inp["installer_id"])["t"]
    fr = L.public_rows(L.value_frontier(eng, inp, design))  # the same simulated set the variants are picked from
    obj = resp.get("objective") or L.OBJECTIVE
    ev = ev_block(inp, design)
    out = {"planes": planes, "day": day, "night": night, "frontier": fr, "chosen": design, "objective": obj, "sources": P.sources(),
           **({"ev": ev} if ev else {}),
           "economics": econ,
           "consistency": {"modules_on_roof": lo["modules"] if lo else None, "modules_in_design": L.modules_for(design.get("pv_kwp")),
                           "pv_yield_kwh_used": econ["annual"]["pv_yield_kwh"], "layout_kwh_per_year": lo["kwh_per_year"] if lo else None,
                           "shaded": bool(lo and lo["shaded"]), "battery_kwh_used": design.get("battery_kwh") or 0,
                           "heat_load_kw_used": hp_kw, "same_run_id": rid,
                           "design_economics_match": all(a == b for a, b in pairs.values())}}
    out.update(bars(out, resp, inp))
    _CACHE[k] = out
    return out


def explain_grid(eng, inp: dict, design: dict | None) -> dict:
    if design is None:
        design = eng.predict(dict(inp), full=False)["design"]
    design = {k: design.get(k) for k in ("pv_kwp", "inverter_kw", "battery_kwh", "heatpump_kw", "wallbox_kw")}
    if design.get("pv_kwp") and not design.get("inverter_kw"):
        design["inverter_kw"] = rules.inverter_kw(design["pv_kwp"])
    k = _key(inp, design)
    if k in _CACHE:
        return _CACHE[k]
    from .model import roof_to_sim
    sim_in = roof_to_sim({kk: v for kk, v in inp.items() if not kk.startswith("_")})
    day, night, econ = _day(sim_in, design)
    use = float(inp.get("annual_demand_kwh") or 0) + rules.ev_kwh(inp)
    night.update(battery_kwh=design.get("battery_kwh") or 0, htw_cap_kwh=round(1.5 * use / 1000, 1))

    # frontier: every PV size near the design x every battery package, same hourly simulation; labels for the variants
    inst = inp["installer_id"]
    t = __import__("app.model", fromlist=["base_features"]).base_features(inp, inst)["t"]
    pvs = eng.catalogue[inst]["pv"]
    pv0 = design.get("pv_kwp") or float(np.median(pvs))
    cap = (inp.get("roof") or {}).get("max_kwp") or 1e9
    cand = pvs[(pvs >= 0.4 * pv0) & (pvs <= 2.0 * pv0) & (pvs <= cap + 1e-9)]
    if len(cand) > 8:
        cand = cand[np.unique(np.linspace(0, len(cand) - 1, 8).round().astype(int))]
    pvset = sorted({float(x) for x in cand} | ({float(pv0)} if design.get("pv_kwp") else set()))
    bats = [0.0] + [float(x) for x in eng.battery_catalogue(inst, t)]
    keep = {kk: design.get(kk) for kk in ("heatpump_kw", "wallbox_kw")}
    frontier = []
    for pv in pvset:
        for b in bats:
            d = {"pv_kwp": pv, "inverter_kw": rules.inverter_kw(pv), "battery_kwh": b or None, **keep}
            e = hourly.simulate(sim_in, d).economics
            frontier.append({"kwp": pv, "kwh": b, "capex_eur": e["capex_eur"], "npv_20y_eur": e["annual"]["npv_20y_eur"],
                             "autarky_share": e["autarky_share"], "payback_years": e["payback_years"],
                             "chosen": pv == (design.get("pv_kwp") or 0) and b == (design.get("battery_kwh") or 0)})
    best_aut = max(f["autarky_share"] for f in frontier)
    for lab, pick in (("Most independence", min((f for f in frontier if f["autarky_share"] >= best_aut - 0.01), key=lambda f: f["capex_eur"])),
                      ("Best payback", min((f for f in frontier if f["payback_years"]), key=lambda f: (f["payback_years"], f["capex_eur"]), default=None)),
                      ("Lowest upfront cost", min(frontier, key=lambda f: (f["capex_eur"], -f["autarky_share"]))),
                      ("Best 20-year value", max(frontier, key=lambda f: f["npv_20y_eur"] or -1e9))):
        if pick is not None:
            pick["label"] = pick.get("label", lab)
    for f in frontier:
        if f["chosen"]:
            f["label"] = "This design"
    frontier.sort(key=lambda f: (f["capex_eur"], f["kwp"]))

    # planes with the panels for this design
    planes = None
    if inp.get("address") and roofs.model_available():
        try:
            m = roofs._roof().model(inp["address"], kwp=design.get("pv_kwp"))
            p = m.get("planes_json_path")
            planes = json.loads(open(p).read()) if p else None
            if planes is not None:
                planes = {**planes, "glb_url": roofs.model_url(inp["address"])}
        except Exception as ex:
            planes = {"error": str(ex)}

    rec = __import__("app.model", fromlist=["RECOMMENDER"]).RECOMMENDER["mode"]
    out = {"planes": planes, "day": day, "night": night, "frontier": frontier, "chosen": design,
           "objective": {"name": "planner rules (rules-1)" if rec == "rules" else "learned chain",
                         "sentence": ("The design follows the installer's fitted rules; the frontier shows every catalogue size "
                                      "through the same hourly simulation so the trade-off is visible."),
                         "sources": ["pvgis", "pvlib", "bdew", "eeg"]},
           "sources": SOURCES, "economics": econ}
    _CACHE[k] = out
    return out


# ---------- v2.6: derivation bars (Reonic-style working, chain order) ----------

ADDRESS_SOURCES = ("lod2", "pvgis", "bdom", "dom20", "zensus", "envelope", "roof", "address", "google-solar", "osm")
KIND_NAME = {"roof": "Roof", "wall": "Outer walls", "window": "Windows", "floor": "Floor", "ceiling": "Top ceiling", "door": "Doors"}


def tagger(inp: dict, lead: dict | None):
    """lead | rina | address | default for a field: a fact from a call step is Rina's, one in the form the lead's."""
    rina = set()
    if lead:
        for h in lead.get("history") or []:
            if (h.get("step") or 0) >= 1 or (lead.get("source") == "call" and h.get("step") == 0):
                rina |= set((h.get("answer") or {}).keys())
    given = set(inp.get("_given") or [])
    est = set(inp.get("_estimated") or [])

    def tag(field=None, source=None):
        if field and field in rina:
            return "rina"
        if field and field in given and not (field == "house_built_year" and "build year" in est):
            return "lead"
        s = (source or "").lower()
        if s in ("lead", "inputs"):
            return "lead"
        if any(a in s for a in ADDRESS_SOURCES):
            return "address"
        return "default"
    return tag


def _face_name(p):
    az = p.get("azimuth")
    if az is None:
        return "Flat roof"
    d = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"][int(((az + 22.5) % 360) // 45)]
    return f"{d.capitalize()} face ({az:.0f} degrees, {p.get('pitch') or 0:.0f} degree pitch)"


def bars(out: dict, resp: dict, inp: dict, lead: dict | None = None) -> dict:
    tag = tagger(inp, lead)
    d = out["chosen"]
    pv = d.get("pv_kwp") or 0
    comps = resp.get("components") or {}
    res = []

    # ROOF
    segs = []
    planes = (out.get("planes") or {}).get("planes") or []
    for p in planes:
        n = len(p.get("chosen_panels") or [])
        if not p.get("is_target") or not n:
            continue
        y = p.get("yield_shaded_kwh_per_kwp") or p.get("yield_kwh_per_kwp")
        loss = p.get("shade_loss_share")
        segs.append({"name": _face_name(p), "value": round(n * 0.45, 2), "unit": "kWp", "modules": n, "source_tag": "address",
                     "citation": f"LoD2 roof plane, {y:,.0f} kWh per kWp after shade" + (f" ({loss:.0%} lost to shade, DOM20 ray-cast)" if loss is not None else "")})
    pv_reason = (comps.get("pv") or {}).get("reason") or ""
    roof_cap = ((inp.get("roof") or {}).get("max_kwp"))
    res.append({"key": "roof", "title": "Roof", "total": pv, "unit": "kWp", "segments": segs,
                "sentence": pv_reason + (f" The roof holds up to {roof_cap:g} kWp." if roof_cap else ""),
                "sources": ["lod2", "bdom", "pvgis"]})

    # HEAT LOSS
    env = (out.get("planes") or {}).get("envelope") or inp.get("envelope") or {}
    segs = []
    if env.get("faces"):
        by = {}
        for f in env["faces"]:
            by[f.get("kind")] = by.get(f.get("kind"), 0.0) + float(f.get("loss_w") or 0)
        for k, w in sorted(by.items(), key=lambda kv: -kv[1]):
            segs.append({"name": KIND_NAME.get(k, str(k).capitalize()), "value": round(w / 1000, 2), "unit": "kW", "source_tag": "address",
                         "citation": "U-value (IWU typology) x LoD2 area x temperature difference, DIN EN 12831 simplified"})
        if env.get("ventilation_w"):
            de = env.get("design") or {}
            segs.append({"name": "Ventilation", "value": round(env["ventilation_w"] / 1000, 2), "unit": "kW", "source_tag": "address",
                         "citation": f"{de.get('volume_m3', 0):,.0f} m3 x {de.get('air_changes_per_h', 0.5):g} air changes x 0.34 Wh/m3K x temperature difference"})
        if env.get("thermal_bridges_w"):
            segs.append({"name": "Thermal bridges", "value": round(env["thermal_bridges_w"] / 1000, 2), "unit": "kW", "source_tag": "address",
                         "citation": "IWU allowance on the envelope area"})
        de = env.get("design") or {}
        yr = env.get("build_year")
        yr_tag = tag("house_built_year", env.get("build_year_source"))
        sentence = (f"At {de.get('outside_c', -16):g} C outside the house loses about {env.get('design_heat_load_kw'):g} kW"
                    + (f" if the {int(yr)} fabric is unrenovated" if yr else "") + "; Reonic's room scan refines this on site.")
        segs.append({"name": "Build year", "value": yr, "unit": "", "source_tag": yr_tag, "citation": "sets the IWU typology and U-values"})
        total = env.get("design_heat_load_kw")
    else:
        sentence, total = "No building model for this address yet, so no heat-loss breakdown.", None
    res.append({"key": "heat_loss", "title": "Heat loss", "total": total, "unit": "kW", "segments": segs, "sentence": sentence,
                "sources": env.get("sources") or ["IWU, Deutsche Wohngebaeudetypologie (Loga et al. 2015)", "DIN EN 12831"]})

    # DAY
    hrs = (out.get("day") or {}).get("hours") or []
    night = out.get("night") or {}
    direct = sum(x.get("direct_self_kw", 0) for x in hrs)
    from_bat = sum(max(x.get("battery_kw", 0), 0) for x in hrs)
    imp = sum(max(x.get("grid_kw", 0), 0) for x in hrs)
    exp = sum(max(-x.get("grid_kw", 0), 0) for x in hrs)
    load = sum(x.get("load_kw", 0) for x in hrs)
    bat = d.get("battery_kwh") or 0
    segs = [{"name": "Solar used directly", "value": round(direct, 1), "unit": "kWh", "source_tag": "address", "citation": "hourly simulation on the laid-out planes"},
            {"name": "From the battery", "value": round(from_bat, 1), "unit": "kWh", "source_tag": "default", "citation": "greedy self-consumption, 90% usable"},
            {"name": "From the grid", "value": round(imp, 1), "unit": "kWh", "source_tag": "default", "citation": "hourly simulation"},
            {"name": "Evening use (after sunset)", "value": night.get("evening_kwh"), "unit": "kWh", "source_tag": tag("annual_demand_kwh"), "citation": "BDEW H25 load, this home's annual use"},
            {"name": "Night use (before sunrise)", "value": night.get("night_kwh"), "unit": "kWh", "source_tag": tag("annual_demand_kwh"), "citation": "BDEW H25 load, this home's annual use"},
            {"name": "Battery per kWp", "value": round(bat / pv, 2) if pv else None, "unit": "kWh/kWp", "source_tag": "default",
             "citation": "0.7 to 1.0 kWh per kWp is the usual range; snapped to the installer's package"}]
    res.append({"key": "day", "title": "A day", "total": round(load, 1), "unit": "kWh", "segments": segs,
                "sentence": (f"On {(out.get('day') or {}).get('date', 'a typical day').split(' (')[0]} the home uses {load:.1f} kWh: the panels cover "
                             f"{direct:.1f} directly, the battery {from_bat:.1f} after sunset and the grid {imp:.1f}; {exp:.1f} kWh go to the grid."),
                "sources": ["pvgis", "bdew", "pvlib"]})

    # CHARGING
    ev = out.get("ev")
    if ev:
        segs = [{"name": "Driving", "value": ev["annual_km"], "unit": "km a year", "source_tag": tag("ev_annual_km"), "citation": "the lead or the call"},
                {"name": "Consumption", "value": ev["kwh_per_100km"], "unit": "kWh/100 km", "source_tag": "default", "citation": EV_SOURCES[0]["citation"]},
                {"name": "Energy a year", "value": ev["annual_kwh"], "unit": "kWh", "source_tag": "default", "citation": "km x consumption"},
                {"name": "Charged at home", "value": ev["home_share"], "unit": "", "source_tag": "default", "citation": EV_SOURCES[1]["citation"]},
                {"name": "A typical night", "value": ev["kwh_per_night_typical"], "unit": "kWh", "source_tag": "default", "citation": "energy at home / 365, 18:00 to 06:00"},
                {"name": "Power needed", "value": ev["kw_needed"], "unit": "kW", "source_tag": "default", "citation": "a night's kWh over the 12-hour window"}]
        res.append({"key": "charging", "title": "Charging", "total": ev["kwh_per_night_typical"], "unit": "kWh a night", "segments": segs,
                    "sentence": (f"{ev['annual_km']:,.0f} km a year is about {ev['kwh_per_night_typical']:g} kWh a night; 11 kW refills that in about "
                                 f"{ev['kwh_per_night_typical'] / 11 * 60:.0f} minutes ({ev['km_per_hour_at_11kw']} km of range an hour). {ev['note_22kw']}."),
                    "sources": [x["citation"] for x in EV_SOURCES]})
    else:
        res.append({"key": "charging", "title": "Charging", "total": 0, "unit": "kWh a night", "segments": [],
                    "sentence": "No electric car now or planned, so no wallbox.", "sources": []})

    # CHECKS
    econ = out.get("economics") or {}
    pb, aut = econ.get("payback_years"), econ.get("autarky_share")
    inv = d.get("inverter_kw")
    c = out.get("consistency") or {}
    checks = [{"name": "Payback", "value": pb, "unit": "years", "pass": bool(pb and 5 <= pb <= 15), "band": "5 to 15 years"},
              {"name": "Autarky", "value": aut, "unit": "share", "pass": True, "level": "info",
               "inside_band": bool(aut is not None and 0.3 <= aut <= 0.9), "band": "30 to 90%"},
              {"name": "DC/AC ratio", "value": round(pv / inv, 2) if pv and inv else None, "unit": "", "pass": bool(pv and inv and 1.0 <= pv / inv <= 1.35),
               "band": "1.1 to 1.3 usual"},
              {"name": "Roof fit", "value": c.get("modules_on_roof"), "unit": "modules",
               "pass": c.get("modules_on_roof") is None or c.get("modules_on_roof") == c.get("modules_in_design"),
               "band": f"{c.get('modules_in_design')} modules in the design"}]
    # roof, day and charging are REONIC PHYSICS's when planner_rules has bars(); heat loss and the checks stay here
    try:
        from .planner_rules.bars import bars as physics_bars
        fields = ("annual_demand_kwh", "has_ev", "ev_annual_km", "house_built_year", "heating_type", "heating_cost_per_year_eur",
                  "heating_demand_kwh", "num_inhabitants", "house_size_sqm", "electricity_price_ct_kwh", "load_profile")
        prov = {f: tag(f) for f in fields if tag(f) in ("lead", "rina")}
        clean = {k: v for k, v in inp.items() if not k.startswith("_")}
        # roof and day stay the engine's (they read the one laid-out run the 3D model and the economics use); charging is
        # PHYSICS's, which has no layout or day of its own to disagree with
        from . import layout as L
        lo = L.layout(inp, d.get("pv_kwp"))
        if lo:  # the laid-out planes, so faces, kWp and kWh a year are this design's run
            clean["pv_planes"] = lo["pv_planes"]
        date = ((out.get("day") or {}).get("date") or "").split(" (")[0]  # the Day layer's date, e.g. "22 April"
        theirs = {b["key"]: b for b in physics_bars(clean, d, roof=inp.get("roof"), provenance=prov, day_date=date or None) or []
                  if b.get("key") in ("roof", "day", "charging")}
        if "roof" in theirs and pv_reason and pv_reason not in theirs["roof"].get("sentence", ""):
            theirs["roof"] = {**theirs["roof"], "sentence": f"{theirs['roof']['sentence']} {pv_reason}".strip()}  # keep the tier cap
        res = [theirs.get(b["key"], b) for b in res]
    except ImportError:
        pass
    except Exception as e:
        log.warning("planner_rules.bars failed, engine bars used: %s", e)
    # Reonic's published orientation factors and shading classes, informational ticks on the laid-out planes
    tot = sum(len(p.get("chosen_panels") or []) for p in planes if p.get("is_target"))
    if tot:
        def ofac(az):
            if az is None:
                return 0.95  # flat roof on south racks
            a = az % 360
            return 0.99 if 157.5 <= a <= 202.5 else 0.935 if 112.5 <= a < 157.5 or 202.5 < a <= 247.5 else 0.81 if 67.5 <= a < 112.5 else 0.79 if 247.5 < a <= 292.5 else 0.6
        of = sum(len(p.get("chosen_panels") or []) * ofac(p.get("azimuth")) for p in planes if p.get("is_target")) / tot
        sh = sum(len(p.get("chosen_panels") or []) * float(p.get("shade_loss_share") or 0) for p in planes if p.get("is_target")) / tot
        cls = "excellent" if sh < 0.05 else "typical" if sh <= 0.10 else "significant"
        checks.append({"name": "Orientation factor", "value": round(of, 3), "unit": "share", "pass": True, "informational": True, "level": "info",
                       "band": "Reonic: south 98 to 100%, south-east or south-west 93 to 94%, east 81%, west 79%"})
        checks.append({"name": "Shading", "value": round(sh, 3), "unit": "share", "pass": True, "informational": True, "level": "info",
                       "class": cls, "band": "Reonic: under 5% excellent, 5 to 10% typical, over 10% significant"})
    try:  # Reonic's own conventions from planner_rules: battery 0.2 to 0.6 kWh per kWh of daily use, DC/AC gauge, break-even
        from .planner_rules.bars import checks as physics_checks
        extra = physics_checks({k: v for k, v in inp.items() if not k.startswith("_")}, d, econ) or []
        if any("dc" in (c.get("name") or "").lower() for c in extra):
            checks = [c for c in checks if c["name"] != "DC/AC ratio"]  # one DC/AC tick, Reonic's gauge
        for c in extra:  # Reonic's battery guide is a reference line, never a fail: most signed designs sit above it
            if "battery" in (c.get("name") or "").lower():
                v = c.get("value")
                inside = v is not None and 0.2 <= v <= 0.6
                c.update(level="reference", pass_=inside, **{"pass": True})
                c["message"] = (f"Battery {v:.2f} kWh per kWh of daily use: inside Reonic's 0.2 to 0.6 guide." if inside else
                                f"Battery {v:.2f} kWh per kWh of daily use: above Reonic's 0.6 guide, like 63% of your planners' signed designs.")
                c["inside_band"] = c.pop("pass_")
            elif "dc" in (c.get("name") or "").lower():
                c["level"] = "ok" if c.get("pass") else "fail"
            else:
                c.setdefault("level", "info")
                c["pass"] = True if c["level"] == "info" else c.get("pass")
        checks = checks + list(extra)
    except ImportError:
        pass
    except Exception as e:
        log.warning("planner_rules.bars.checks failed: %s", e)
    for c in checks:
        c.setdefault("level", "ok" if c.get("pass") else "fail")
    return {"bars": res, "checks": checks}
