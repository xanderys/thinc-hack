"""Working-shown bars for /api/explain/layers (docs/api.md v2.6): roof, day and charging, each a sum of named terms
with a source tag, ending in the sentence the planner says. No fitted numbers; no effect on any score.

    bars(inputs, design, roof=None, provenance=None) -> [roof, day, charging]   (charging only with an EV)

provenance: optional {input field: "lead" | "rina"} for where each lead field came from (the intake knows; default "lead").
REONIC ENGINE adds the heat_loss bar and the checks.
"""
from ..hourly import sim as S
from . import physics as P

HOME_SHARE = 0.8  # Fraunhofer ISI, press release 21/2025
WINDOW = (18, 6)  # local hours: the hourly simulation starts charging at 18:00 (sim.EV_START_H); 06:00 is first light in spring
SOURCES = {
    "lod2": "LoD2 building model, Bayerische Vermessungsverwaltung; shade from the bDOM surface model",
    "pvgis": "PVGIS typical meteorological year, Munich (EU JRC)",
    "h25": "BDEW H25 standard household load profile",
    "htw": "HTW Berlin rule of thumb: at most 1.5 kWh of storage per 1,000 kWh of use (via finanztip)",
    "ev": "18 kWh per 100 km, a mid-size EV in mixed driving (engine hourly simulation)",
    "isi": "Fraunhofer ISI, press release 21/2025: about 80% of electric cars in Germany are charged at home",
    "wb": "11 kW needs registration with the grid operator, 22 kW its approval and a 3-phase 32 A supply (Vattenfall)",
}


def _tag(field, inputs, provenance, default_ok=True):
    """lead | rina when the field was given, else default."""
    v = inputs.get(field)
    if v in (None, "", "Unknown") or (field == "annual_demand_kwh" and v == 4500 and not (provenance or {}).get(field)):
        return "default"
    return (provenance or {}).get(field, "lead")


def _seg(name, value, unit, tag, citation=None):
    return {"name": name, "value": value, "unit": unit, "source_tag": tag, **({"citation": citation} if citation else {})}


def _compass(az):
    return ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"][int(((az % 360) + 22.5) // 45) % 8]


def roof_bar(inputs, design, pl):
    pv = float(design.get("pv_kwp") or 0)
    alloc = P.fill(pl, pv) if pv else [0.0] * len(pl)
    segs, used, kwh = [], 0, 0.0
    for j, (p, k) in enumerate(zip(pl, alloc)):
        if not k:
            continue
        n = round(k / P.MODULE_KWP)
        tag = "default" if p["assumed"] else "address"
        segs.append(_seg(f"{_compass(p['azimuth'])} face {p['tilt']:.0f} deg", round(k, 2), "kWp", tag,
                         f"{n} modules x {P.MODULE_KWP * 1000:.0f} W, {p['yield_kwh_kwp']:,} kWh per kWp a year; {p['source']}"))
        used += 1
        kwh += k * p["yield_kwh_kwp"]
    cap = P.max_kwp(pl)
    faces = sum(1 for p in pl if p["max_kwp"] >= P.MODULE_KWP)
    if pv:
        s = (f"The roof takes {cap:g} kWp on {faces} usable face{'s' if faces != 1 else ''}; we use {pv:g} kWp "
             f"({round(pv / P.MODULE_KWP)} modules on {used} face{'s' if used != 1 else ''}), about {kwh:,.0f} kWh a year.")
    else:
        s = f"No new PV: the roof would take {cap:g} kWp."
    if pl and pl[0]["assumed"]:
        s += " No roof data yet, so this assumes one south face; the address fills it in."
    return {"key": "roof", "title": "Roof", "total": round(pv, 2), "unit": "kWp", "segments": segs, "sentence": s,
            "sources": [SOURCES["pvgis"]] + ([] if pl and pl[0]["assumed"] else [SOURCES["lod2"]])}


def day_bar(inputs, design, pl, provenance):
    d = P.day(inputs, design, _pl=pl)
    hrs, nt = d["hours"], d["night"]
    solar = sum(min(h["pv_kw"], h["load_kw"]) for h in hrs)
    from_bat = sum(max(h["battery_kw"], 0.0) for h in hrs)
    grid = sum(max(h["grid_kw"], 0.0) for h in hrs)
    use = sum(h["load_kw"] for h in hrs)
    eve = [h for h in hrs if h["h"] >= 12 and h["pv_kw"] < 0.01]
    empty = next((h["h"] for h in eve if h["soc_kwh"] < 0.05), None)
    eve_use, eve_bat = sum(h["load_kw"] for h in eve), sum(max(h["battery_kw"], 0.0) for h in eve)
    lead_tag = _tag("annual_demand_kwh", inputs, provenance)
    cite = f"{d['date']}, hour by hour; household {SOURCES['h25']}" + ("; EV from 18:00" if inputs.get("has_ev") else "")
    segs = [_seg("solar-covered", round(solar, 1), "kWh", lead_tag, cite),
            _seg("from the battery", round(from_bat, 1), "kWh", lead_tag, cite),
            _seg("from the grid", round(grid, 1), "kWh", lead_tag, cite)]
    pv, bat = float(design.get("pv_kwp") or 0), float(design.get("battery_kwh") or 0)
    lo, hi = 0.7 * pv, 1.0 * pv
    s = f"On a spring weekday the home uses {use:.1f} kWh, {solar:.1f} kWh straight from the roof; from sunset to midnight it needs {eve_use:.1f} kWh."
    if bat:
        band = "inside" if lo - 0.5 <= bat <= hi + 0.5 else "outside"
        s += (f" The {bat:g} kWh battery covers {eve_bat:.1f} kWh of that"
              + (f" and is empty by {empty:02d}:00" if empty is not None else " and carries on past midnight")
              + f"; its size is {band} the usual 0.7 to 1.0 kWh "
              f"per kWp ({lo:.1f} to {hi:.1f} kWh for {pv:g} kWp).")
    elif pv:
        s += " No battery, so the evening comes from the grid."
    return {"key": "day", "title": "A spring weekday", "total": round(use, 1), "unit": "kWh", "segments": segs, "sentence": s,
            "sources": [SOURCES["h25"], SOURCES["pvgis"], SOURCES["htw"]]}


def charging_bar(inputs, design, provenance):
    if not inputs.get("has_ev"):
        return None
    km_tag = _tag("ev_annual_km", inputs, provenance)
    km = float(inputs.get("ev_annual_km") or 12000)
    per100 = float(S.EV_KWH_PER_100KM)
    year = km * per100 / 100
    home = year * HOME_SHARE
    night = home / 365
    hours = (24 - WINDOW[0]) + WINDOW[1]
    need = night / hours
    wb = float(design.get("wallbox_kw") or 11.0)
    kmh = 11 / (per100 / 100)
    segs = [_seg("km a year", round(km), "km", km_tag, None if km_tag != "default" else "12,000 km assumed"),
            _seg("energy a year", round(year), "kWh", "default", SOURCES["ev"]),
            _seg("charged at home", round(home), "kWh", "default", SOURCES["isi"]),
            _seg("a night", round(night, 1), "kWh", "default", f"{WINDOW[0]:02d}:00 to {WINDOW[1]:02d}:00, {hours} hours"),
            _seg("power needed", round(need, 2), "kW", "default", f"{night:.1f} kWh over {hours} hours")]
    s = (f"{km:,.0f} km a year is {year:,.0f} kWh, about {home:,.0f} kWh charged at home, {night:.1f} kWh a night. "
         f"That needs {need:.1f} kW over the night; an {wb:g} kW wallbox refills it in {night / wb:.1f} hours "
         f"(about {kmh:.0f} km per hour). 22 kW only pays with a 3-phase 32 A supply and the grid operator's approval.")
    return {"key": "charging", "title": "Charging", "total": round(night, 1), "unit": "kWh a night", "segments": segs,
            "sentence": s, "sources": [SOURCES["ev"], SOURCES["isi"], SOURCES["wb"]]}


def bars(inputs: dict, design: dict, roof: dict | None = None, provenance: dict | None = None) -> list[dict]:
    """Roof, day and charging bars in chain order (charging only with an EV)."""
    inp = dict(inputs)
    pl = P.planes(inp, roof)
    out = [roof_bar(inp, design, pl), day_bar(inp, design, pl, provenance), charging_bar(inp, design, provenance)]
    return [b for b in out if b]


if __name__ == "__main__":
    import json
    hero = {"annual_demand_kwh": 5200, "has_ev": True, "ev_annual_km": 15000, "heating_type": "Gas", "installer_id": "2a8ba8e2"}
    print(json.dumps(bars(hero, {"pv_kwp": 10.35, "battery_kwh": 10, "wallbox_kw": 11}, provenance={"ev_annual_km": "rina"}), indent=1))
