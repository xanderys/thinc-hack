"""One pipeline for every design with an address: size -> lay out exactly round(pv_kwp / 0.45) modules on the real planes by
shaded yield (roof/model lay_out) -> simulate the hourly year on those planes with their shaded yields. Economics, the day,
the night and the 3D panels all read this one layout, so they cannot disagree."""
import hashlib
import json
import logging

from . import hourly, roofs

log = logging.getLogger("engine")
MODULE_KWP = 0.45
FLAT_TILT = 15.0  # flat roofs carry modules on 15 degree south racks (same assumption as planner_rules)
_MEMO: dict = {}


def modules_for(pv_kwp) -> int:
    return int(round((pv_kwp or 0) / MODULE_KWP))


def layout(inp: dict, pv_kwp: float):
    """{"planes": model JSON with chosen_panels for this kWp, "pv_planes": [(tilt, az, share, scale)], "modules": n,
    "kwh_per_year": layout yield} or None without an address or a built model."""
    addr = inp.get("address")
    if not addr or not pv_kwp or not roofs.model_available():
        return None
    year = inp.get("house_built_year")
    key = (addr.strip().lower(), int(year) if year else None, round(float(pv_kwp), 2))
    if key in _MEMO:
        return _MEMO[key]
    try:
        res = roofs._roof().model(addr, kwp=float(pv_kwp), build_year=int(year) if year else None)
    except Exception as e:
        log.warning("layout failed for %s: %s", addr, e)
        return None
    m = res.get("model") if isinstance(res, dict) else None
    if not m:
        try:
            m = json.loads(open(res["planes_json_path"]).read())
        except Exception:
            return None
    rows, total = [], 0
    for p in m.get("planes", []):
        n = len(p.get("chosen_panels") or [])
        if not n or not p.get("is_target"):
            continue
        flat = p.get("azimuth") is None
        tilt, az = (FLAT_TILT, 180.0) if flat else (float(p.get("pitch") or 0), float(p["azimuth"]))
        y = float(p.get("yield_shaded_kwh_per_kwp") or p.get("yield_kwh_per_kwp") or 0)
        base = float(hourly.sim.pv_per_kwp("Munich", tilt, az).sum())  # the simulation's own unshaded yield there
        rows.append((tilt, az, n, y / base if base else 1.0, p.get("id")))
        total += n
    if not total:
        return None
    out = {"planes": m, "modules": total, "kwh_per_year": (m.get("layout") or {}).get("kwh_per_year"),
           "pv_planes": [(t, a, n / total, s) for t, a, n, s, _ in rows],
           "plane_ids": [i for *_, i in rows], "shaded": any(m_.get("yield_shaded_kwh_per_kwp") is not None for m_ in m.get("planes", []))}
    if len(_MEMO) > 256:
        _MEMO.clear()
    _MEMO[key] = out
    return out


def sim_inputs(inp: dict, design: dict) -> dict:
    """The inputs the hourly simulation runs on for this design: the laid-out planes when there is a house model."""
    lo = layout(inp, design.get("pv_kwp"))
    return {**inp, "pv_planes": lo["pv_planes"]} if lo else inp


def run_id(inp: dict, design: dict, pv_planes) -> str:
    clean = {k: v for k, v in inp.items() if not k.startswith("_") and k not in ("roof", "roof_model", "envelope")}
    return hashlib.sha256(json.dumps([clean, design, pv_planes], sort_keys=True, default=str).encode()).hexdigest()[:12]


_FRONTIER: dict = {}
OBJECTIVE = {"name": "20-year value on this roof",
             "sentence": ("Every PV size and battery package is laid out on this roof's own planes by shaded yield and run through the "
                          "same hourly year; best value is the highest 20-year net present value, best payback the shortest payback, "
                          "most independence the highest autarky."),
             "sources": ["lod2", "bdom", "pvgis", "pvlib", "bdew", "eeg"]}


MAX_KWH_PER_KWP = 1.6


def value_frontier(eng, inp: dict, design: dict) -> list:
    """Every (PV, battery) rules-2 sweeps, each simulated on its own laid-out planes with the design's heat pump and
    wallbox; labels value, payback, independence, upfront and chosen. Cached per inputs and design."""
    from . import rules
    from .model import _frontier, base_features, roof_to_sim
    k = run_id(inp, design, None)
    if k in _FRONTIER:
        return _FRONTIER[k]
    inst = inp["installer_id"]
    t = base_features(inp, inst)["t"]
    raw = _frontier(eng.rules_inputs(inp), eng.rules_catalogue(inst, t), None)
    cands = {(r["kwp"], r["kwh"]) for r in raw if r["kwp"]} | {(design.get("pv_kwp") or 0.0, design.get("battery_kwh") or 0.0)}
    base = roof_to_sim({kk: v for kk, v in inp.items() if not kk.startswith("_")})
    keep = {kk: design.get(kk) for kk in ("heatpump_kw", "wallbox_kw")}
    rows = []
    for pv, b in sorted(cands):
        if not pv:
            continue
        d = {"pv_kwp": pv, "inverter_kw": design.get("inverter_kw") if pv == design.get("pv_kwp") else rules.inverter_kw(pv),
             "battery_kwh": b or None, **keep}
        lo = layout(inp, pv)
        chosen = pv == (design.get("pv_kwp") or 0) and (b or 0) == (design.get("battery_kwh") or 0)
        if lo and lo["modules"] < modules_for(pv) and not chosen:
            continue  # more PV than this roof's layout places: not a design for this house
        sim_in = {**base, "pv_planes": lo["pv_planes"]} if lo else base
        from . import cashflow
        e = cashflow.add(sim_in, d, hourly.simulate(sim_in, d).economics)
        rows.append({"kwp": pv, "kwh": b or 0.0, "capex_eur": e["capex_eur"], "npv_20y_eur": e["annual"]["npv_20y_eur"],
                     "autarky_share": e["autarky_share"], "payback_years": e["payback_years"],
                     "modules": lo["modules"] if lo else modules_for(pv),
                     "chosen": pv == (design.get("pv_kwp") or 0) and (b or 0) == (design.get("battery_kwh") or 0),
                     "_design": d, "_econ": e})
    if not rows:
        return []
    mine = next((r for r in rows if r["chosen"]), None)
    # a variant is a design a planner would sign: battery at most MAX_KWH_PER_KWP of the array (signed designs: median
    # 1.1 to 1.2 kWh per kWp from 4 kWp up, Reonic about 1); the design itself always stays eligible
    full = rows
    rows = [r for r in rows if r["chosen"] or not r["kwh"] or r["kwh"] / r["kwp"] <= MAX_KWH_PER_KWP] or rows
    best = max(rows, key=lambda r: (r["npv_20y_eur"] or -1e9, -r["capex_eur"]))
    if mine is not None and (mine["npv_20y_eur"] or -1e9) >= (best["npv_20y_eur"] or -1e9):
        best = mine  # a tie goes to the design: it is already the best value
    top_aut = max(r["autarky_share"] for r in rows)
    ind = min((r for r in rows if r["autarky_share"] >= top_aut - 0.005), key=lambda r: r["capex_eur"])
    pay = min((r for r in rows if r["payback_years"]), key=lambda r: (r["payback_years"], r["capex_eur"]), default=None)
    paying = [r for r in rows if (r["npv_20y_eur"] or 0) > 0] or rows  # cheapest that still pays for itself in 20 years
    up = min(paying, key=lambda r: (r["capex_eur"], -r["autarky_share"]))
    for key, r in (("value", best), ("payback", pay), ("independence", ind), ("upfront", up)):
        if r is not None:
            r.setdefault("labels", []).append(key)
    rows = full
    for r in rows:
        r["plausible"] = r["chosen"] or not r["kwh"] or r["kwh"] / r["kwp"] <= MAX_KWH_PER_KWP
    # the hull in (capex, npv): points no cheaper option beats on value
    for r in rows:
        r["on_frontier"] = not any(o["capex_eur"] <= r["capex_eur"] and (o["npv_20y_eur"] or 0) > (r["npv_20y_eur"] or 0) and o is not r for o in rows)
        r["label"] = "chosen" if r["chosen"] else (r.get("labels") or [None])[0]
        if r["chosen"] and r.get("labels"):
            r["also"] = r["labels"]  # the design is also the best value (or another pick)
    rows.sort(key=lambda r: (r["capex_eur"], r["kwp"]))
    if len(_FRONTIER) > 128:
        _FRONTIER.clear()
    _FRONTIER[k] = rows
    return rows


def public_rows(rows: list) -> list:
    return [{kk: v for kk, v in r.items() if not kk.startswith("_")} for r in rows]
