"""Working-shown bars for /api/explain/layers (docs/api.md v2.6): roof, day and charging, each a sum of named terms
with a source tag, ending in the sentence the planner says. No fitted numbers; no effect on any score.

    bars(inputs, design, roof=None, provenance=None) -> [roof, day, charging]   (charging only with an EV)

provenance: optional {input field: "lead" | "rina"} for where each lead field came from (the intake knows; default "lead").
REONIC ENGINE adds the heat_loss bar and the checks.
"""
from ..hourly import sim as S
from . import physics as P

HOME_SHARE = 0.8  # assumption: 80% of the car's kWh charged at home (Fraunhofer ISI, press release 21/2025, counts cars); same as the simulation
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
    tag = "default" if pl and pl[0]["assumed"] else "address"
    src = pl[0]["source"] if pl else ""
    if inputs.get("pv_planes") and pv:  # the engine's layout, as the 3D panels, economics and day use it
        faces_used = []
        for x in inputs["pv_planes"]:
            t, a, sh = map(float, x[:3])
            sc = float(x[3]) if len(x) > 3 else 1.0
            faces_used.append((t, a, sh * pv, round(P._plane_yield(t, a) * sc)))
        src = "the engine's module layout by shaded yield; " + src
    else:
        faces_used = [(p["tilt"], p["azimuth"], k, p["yield_kwh_kwp"]) for p, k in zip(pl, P.fill(pl, pv) if pv else [])]
    segs, used, kwh = [], 0, 0.0
    for t, a, k, y in faces_used:
        if k < P.MODULE_KWP / 2:
            continue
        n = round(k / P.MODULE_KWP)
        segs.append(_seg(f"{_compass(a)} face {t:.0f} deg", round(k, 2), "kWp", tag,
                         f"{n} modules x {P.MODULE_KWP * 1000:.0f} W, {y:,} kWh per kWp a year; {src}"))
        used += 1
        kwh += k * y
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


def day_bar(inputs, design, pl, provenance, day_date=None):
    d = P.day(inputs, design, _pl=pl, date=day_date or inputs.get("day_date"))
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
    use_y = float(inputs.get("annual_demand_kwh") or 0)
    cap = min(1.5 * use_y / 1000, 1.5 * pv) if use_y and pv else 1.5 * pv
    s = f"On a spring weekday the home uses {use:.1f} kWh, {solar:.1f} kWh straight from the roof; from sunset to midnight it needs {eve_use:.1f} kWh."
    if bat:
        band = "within" if bat <= cap + 0.05 else "above"
        s += (f" The {bat:g} kWh battery covers {eve_bat:.1f} kWh of that"
              + (f" and is empty by {empty:02d}:00" if empty is not None else " and carries on past midnight")
              + f"; its size is {band} HTW Berlin's upper guide of {cap:.1f} kWh (1.5 kWh per 1,000 kWh of use, at most 1.5 per kWp, "
              f"the lower one); your planners' signed designs sit at a median 1.1 to 1.2 kWh per kWp.")
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


def checks(inputs: dict, design: dict, econ: dict | None = None) -> list[dict]:
    """Reonic's own validation bands as ticks, in the v2.6 checks shape. Battery: "Storage capacity has to stay between
    0.2 and 0.6 kWh per kWh of daily consumption" (Reonic docs), daily use including EV and heat pump when econ is given.
    DC/AC: Reonic's 70 to 130% inverter gauge."""
    out = []
    bat, pv, inv = (float(design.get(k) or 0) for k in ("battery_kwh", "pv_kwp", "inverter_kw"))
    use = ((econ or {}).get("annual") or {}).get("load_kwh") or float(inputs.get("annual_demand_kwh") or 0)
    if bat and use:
        r = bat / (use / 365)
        out.append({"name": "battery per daily use", "value": round(r, 2), "unit": "kWh per kWh a day",
                    "pass": 0.2 <= r <= 0.6, "band": "0.2 to 0.6 (Reonic)"})
    if pv and inv:
        r = pv / inv * 100
        out.append({"name": "DC/AC ratio", "value": round(r), "unit": "%", "pass": 70 <= r <= 130, "band": "70 to 130% (Reonic)"})
    if econ and econ.get("capex_eur"):
        be = econ.get("break_even_year")
        out.append({"name": "break-even", "value": be, "unit": "years", "pass": be is not None,
                    "band": "within 20 years, undiscounted (Reonic)"})
    return out


def bars(inputs: dict, design: dict, roof: dict | None = None, provenance: dict | None = None,
         day_date: str | None = None) -> list[dict]:
    """Roof, day and charging bars in chain order (charging only with an EV). Pass the engine's laid-out
    inputs["pv_planes"] and the Day layer's date (day_date or inputs["day_date"]) so all bars share one run."""
    inp = dict(inputs)
    pl = P.planes(inp, roof)
    out = [roof_bar(inp, design, pl), day_bar(inp, design, pl, provenance, day_date), charging_bar(inp, design, provenance)]
    return [b for b in out if b]


if __name__ == "__main__":
    import json
    hero = {"annual_demand_kwh": 5200, "has_ev": True, "ev_annual_km": 15000, "heating_type": "Gas", "installer_id": "2a8ba8e2"}
    print(json.dumps(bars(hero, {"pv_kwp": 10.35, "battery_kwh": 10, "wallbox_kw": 11}, provenance={"ev_annual_km": "rina"}), indent=1))
