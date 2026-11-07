"""Physics plausibility of a design, from the hourly simulation."""
import numpy as np

from .sim import heat_demand_kwh, pv_profile, simulate, BAT_USABLE

M2_PER_KWP = 5.5


def _p(ok, msg):
    return {"level": "ok" if ok else "warn", "message": msg}


def validate_physics(inputs: dict, design: dict, location="Munich", sim=None) -> list[dict]:
    r = sim or simulate(inputs, design, location)
    h, e = r.hourly, r.economics
    out = []
    pv, inv, bat, hp = (design.get(k) or 0 for k in ("pv_kwp", "inverter_kw", "battery_kwh", "heatpump_kw"))

    if pv and inv:
        raw = (pv_profile(inputs, location) * pv).sum()
        clip = 1 - np.minimum(pv_profile(inputs, location) * pv, inv).sum() / raw if raw else 0
        ratio = pv / inv
        out.append(_p(0.8 <= ratio <= 1.35, f"DC/AC ratio {ratio:.2f}: {clip:.1%} of the yield is clipped by the {inv:g} kW inverter."))

    if bat:
        usable = bat * BAT_USABLE
        cycles = h["discharge"].sum() / usable
        night = (h["load"] - h["direct"]).reshape(365, 24).sum(1)
        need = float(np.percentile(night, 75))
        if usable > 1.5 * need:
            out.append(_p(False, f"{usable:.1f} kWh usable against {need:.1f} kWh of evening and night load on a typical day: oversized."))
        else:
            out.append(_p(cycles >= 150, f"Battery does {cycles:.0f} full cycles a year ({usable:.1f} kWh usable, evening and night load {need:.1f} kWh)."))

    roof = inputs.get("roof_area_sqm")
    if pv and roof:
        out.append(_p(pv * M2_PER_KWP <= roof, f"{pv:g} kWp needs about {pv * M2_PER_KWP:.0f} m2; usable roof {roof:.0f} m2."))

    if hp:
        heat, src = heat_demand_kwh(inputs, design)
        flh = heat / hp
        if "full-load hours" in src:
            out.append(_p(True, f"No heating demand, cost or floor area given: {hp:g} kW cannot be checked against the house."))
        elif flh < 1400:
            msg = f"{hp:g} kW for {heat:,.0f} kWh of heat is {flh:,.0f} full-load hours: oversized (typical 1,800 to 2,400)."
        elif flh > 2800:
            msg = f"{hp:g} kW for {heat:,.0f} kWh of heat is {flh:,.0f} full-load hours: undersized (typical 1,800 to 2,400)."
        else:
            msg = f"{hp:g} kW for {heat:,.0f} kWh of heat ({src}) is {flh:,.0f} full-load hours."
        if "full-load hours" not in src:
            out.append(_p(1400 <= flh <= 2800, msg))

    if pv:
        aut, sc = e["autarky_share"], e["self_consumption_share"]
        if aut > 0.95:
            out.append(_p(False, f"Autarky {aut:.0%}: the system is sized past the point where more kit pays."))
        if sc < 0.2:
            out.append(_p(False, f"Only {sc:.0%} of the PV is used in the house; the rest is exported at feed-in rates."))
    return out
