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


def _day(sim_in, design) -> dict:
    res = hourly.simulate(sim_in, design)
    h = res.hourly
    utc, local = hourly.sim._local_hours()
    # the April or May weekday whose PV total sits at the 70th percentile of those months: sunny, not exceptional
    days = local.normalize()
    pv = np.asarray(h["pv"])
    window = (local.month >= 4) & (local.month <= 5)
    totals = {}
    for i in np.where(window)[0]:
        totals.setdefault(days[i], 0.0)
        totals[days[i]] += pv[i]
    cand = [(d, v) for d, v in totals.items() if d.weekday() < 5]
    target = float(np.percentile([v for _, v in cand], 70)) if cand else 0.0
    day = min(cand, key=lambda dv: abs(dv[1] - target))[0] if cand else days[0]
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
                      "battery_kw": round(float(h["discharge"][i] - h["charge"][i]), 3),  # + = battery supplies the home
                      "grid_kw": round(float(h["grid_import"][i] - h["feed_in"][i]), 3),  # + = import
                      "soc_kwh": round(float(soc_all[i]), 3)})
    dark = [x for x in hours if x["pv_kw"] < 0.01]
    evening = sum(x["load_kw"] for x in dark)  # what the home uses while the panels are dark that day
    return {"date": f"{day.strftime('%d %B')} (a typical-year weekday, PV at the 70th percentile of April and May)", "hours": hours}, {"evening_kwh": round(evening, 2), "night_hours": len(dark)}, res.economics


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
    rid = L.run_id(inp, design, sim_in.get("pv_planes"))
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
    fr = f2(eng.rules_inputs(inp), None, eng.rules_catalogue(inp["installer_id"], t), None)
    obj = resp.get("objective") or {"name": resp.get("model_version"),
                                    "sentence": "The design is the readable rule list; the frontier is the home's own physics.", "sources": []}
    out = {"planes": planes, "day": day, "night": night, "frontier": fr, "chosen": design, "objective": obj, "sources": P.sources(),
           "economics": econ,
           "consistency": {"modules_on_roof": lo["modules"] if lo else None, "modules_in_design": L.modules_for(design.get("pv_kwp")),
                           "pv_yield_kwh_used": econ["annual"]["pv_yield_kwh"], "layout_kwh_per_year": lo["kwh_per_year"] if lo else None,
                           "shaded": bool(lo and lo["shaded"]), "battery_kwh_used": design.get("battery_kwh") or 0,
                           "heat_load_kw_used": hp_kw, "same_run_id": rid,
                           "design_economics_match": all(a == b for a, b in pairs.values())}}
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
