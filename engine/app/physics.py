"""Rules of thumb, plausibility and rough economics. Sources in docs/domain.md."""
import numpy as np

YIELD = 950  # kWh per kWp per year, Germany (domain.md 1: 880 to 1,350)
PRICE_CT = 32.0
FEEDIN_LOW, FEEDIN_HIGH = 7.70, 6.66  # ct/kWh, up to 10 kWp / 10 to 40 kWp portion, EEG from 1 Aug 2026
EV_KWH_PER_KM = 0.2
HP_COST = 36_400  # mean of 160 real offers, before subsidy
WALLBOX_COST = 1_200
INVERTER_SIZES = np.array([3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30], float)

TOL_LABEL = {"pv": "±1 kWp or ±15%, whichever is larger", "battery": "±2 kWh", "heatpump": "decision exact",
             "wallbox": "decision exact"}

ASSUMPTIONS = [
    f"Yield {YIELD} kWh per kWp per year.",
    "PV EUR 1,400 per kWp at 5 kWp falling to EUR 1,000 at 20 kWp, excl. battery.",
    "Battery EUR 450 per kWh installed.",
    f"Heat pump EUR {HP_COST:,} before subsidy; replaces heating at seasonal COP 3.5.",
    f"Wallbox EUR {WALLBOX_COST:,} installed; EV charging cost not counted as saving.",
    f"Feed-in {FEEDIN_LOW} ct/kWh up to 10 kWp, {FEEDIN_HIGH} ct above (EEG, Aug 2026).",
    "Self-consumption and autarky from a simple ratio model, not a simulation.",
]


def tolerance(comp, size):
    if comp == "pv":
        return max(1.0, 0.15 * size)
    if comp == "battery":
        return 2.0
    return 0.01


def within(comp, ours, expert):
    o, e = np.asarray(ours, float), np.asarray(expert, float)
    same = (o > 0) == (e > 0)
    if comp == "pv":
        return same & ((e == 0) | (np.abs(o - e) <= np.maximum(1.0, 0.15 * e)))
    if comp == "battery":
        return same & ((e == 0) | (np.abs(o - e) <= 2.0))
    return same


def ev_kwh(inp):
    if not inp.get("has_ev"):
        return 0.0
    return (inp.get("ev_annual_km") or 12_000) * EV_KWH_PER_KM


def heat_load_kw(inp):
    sqm = inp.get("house_size_sqm")
    yr = inp.get("house_built_year")
    if inp.get("heating_demand_kwh"):
        return inp["heating_demand_kwh"] / 2000 + 1.0, "heating demand over 2,000 full-load hours, plus 1 kW hot water"
    if sqm:
        wpm = 40 if yr and yr >= 2000 else 70 if yr and yr >= 1980 else 120 if yr else 90
        return sqm * wpm / 1000 + 1.0, f"{sqm:.0f} m2 at {wpm} W/m2, plus 1 kW hot water"
    return 10.0, "no building data, typical single-family value"


def heatpump_kw(inp):
    return heat_load_kw(inp)[0]


def heat_load_note(inp):
    return heat_load_kw(inp)[1]


def inverter_kw(pv):
    if not pv:
        return None
    return float(INVERTER_SIZES[np.argmin(np.abs(INVERTER_SIZES - pv / 1.15))])


def pv_cost_per_kwp(kwp):
    return float(np.interp(kwp, [5, 8, 10, 15, 20], [1350, 1250, 1150, 1050, 1000]))


def shares(demand, pv, bat):
    """Return (self_consumption, autarky). Ratio model calibrated to domain.md 2: no battery about 30% autarky
    at PV = demand, 10 kWp with 10 kWh about 60% at 4,500 kWh."""
    if not pv or demand <= 0:
        return 0.0, 0.0
    gen = pv * YIELD
    rho = gen / demand
    aut0 = min(0.3 * rho ** 0.4, 0.45)
    daily = demand / 365
    aut = aut0 + (0.25 * (1 - np.exp(-(bat or 0) / (0.6 * daily))) if bat else 0)
    aut = float(min(aut, 0.9, 0.95 * rho))
    return float(min(aut * demand / gen, 1.0)), aut


def economics(inp, design):
    pv, bat, hp, wb = (design.get(k) or 0 for k in ["pv_kwp", "battery_kwh", "heatpump_kw", "wallbox_kw"])
    price = (inp.get("electricity_price_ct_kwh") or PRICE_CT) / 100
    hp_el = 0.0
    if hp:
        heat = inp.get("heating_demand_kwh") or hp * 2000
        hp_el = heat / 3.5
    demand = (inp.get("annual_demand_kwh") or 0) + ev_kwh(inp) + hp_el
    sc, aut = shares(demand, pv, bat)
    gen = pv * YIELD
    used = gen * sc
    exported = gen - used
    feed = (FEEDIN_LOW * min(pv, 10) + FEEDIN_HIGH * max(pv - 10, 0)) / max(pv, 1e-9) / 100 if pv else 0
    saving = used * price + exported * feed
    capex = pv * pv_cost_per_kwp(pv) + bat * 450 + (HP_COST if hp else 0) + (WALLBOX_COST if wb else 0)
    if hp:
        heat_cost = inp.get("heating_cost_per_year_eur") or (inp.get("heating_demand_kwh") or hp * 2000) * 0.12
        saving += heat_cost - hp_el * price
    a = list(ASSUMPTIONS)
    a.insert(0, f"Electricity {price * 100:.0f} ct/kWh" + ("" if inp.get("electricity_price_ct_kwh") else " (default)") + ".")
    if inp.get("has_ev"):
        a.append(f"EV adds {ev_kwh(inp):,.0f} kWh a year at {EV_KWH_PER_KM} kWh/km.")
    if hp and not inp.get("heating_cost_per_year_eur"):
        a.append("Heating cost not given: 12 ct per kWh of heat assumed.")
    return {"capex_eur": round(capex, -1), "annual_saving_eur": round(saving, -1),
            "payback_years": round(capex / saving, 1) if saving > 0 else None,
            "self_consumption_share": round(sc, 3), "autarky_share": round(aut, 3), "assumptions": a}


def hard_rules(inp, design):
    """Physically or economically implausible combinations."""
    out = {}
    pv, bat, hp, wb = (design.get(k) or 0 for k in ["pv_kwp", "battery_kwh", "heatpump_kw", "wallbox_kw"])
    inv = design.get("inverter_kw")
    demand = inp.get("annual_demand_kwh") or 0
    total = demand + ev_kwh(inp) + (hp * 2000 / 3.5 if hp else 0)
    if pv and total and pv / (total / 1000) > 5:
        out["pv"] = f"{pv:g} kWp is {pv / (total / 1000):.1f} kWp per 1,000 kWh of demand; above 5 almost all of it is exported."
    if pv > 40:
        out["pv"] = f"{pv:g} kWp is beyond a single-family roof (about {pv * 5.5:.0f} m2 needed)."
    if pv and inp.get("house_size_sqm") and pv * 5.5 > inp["house_size_sqm"] * 0.9:
        out["pv"] = f"{pv:g} kWp needs about {pv * 5.5:.0f} m2 of roof; the house has {inp['house_size_sqm']:.0f} m2."
    if pv and inv and not (0.6 <= inv / pv <= 1.5):
        out["pv"] = f"Inverter {inv:g} kW on {pv:g} kWp is a DC/AC ratio of {pv / inv:.2f}; usual is 0.8 to 1.3."
    if bat and not pv and not inp.get("has_solar"):
        out["battery"] = "A battery with no PV, new or existing, cannot charge from solar."
    if bat and demand and bat > 3 * demand / 365:
        out["battery"] = f"{bat:g} kWh is more than 3 days of household demand ({demand / 365:.1f} kWh a day)."
    pv_all = pv + (inp.get("existing_solar_kwp") or 0)
    if bat and pv_all and bat > 2.5 * pv_all:
        out["battery"] = f"{bat:g} kWh on {pv_all:g} kWp: the PV cannot fill it on most days."
    if hp and inp.get("heating_type") == "Heatpump":
        out["heatpump"] = "The home already has a heat pump."
    if hp and (hp < 3 or hp > 25):
        out["heatpump"] = f"{hp:g} kW is outside the single-family range of 3 to 25 kW."
    if wb and wb not in (3.7, 7.4, 11, 22):
        out["wallbox"] = f"{wb:g} kW is not a standard wallbox rating (11 or 22 kW)."
    return out


def plausibility(inp, design, econ):
    msgs = [{"level": "warn", "message": m} for m in hard_rules(inp, design).values()]
    pv, bat, wb = design.get("pv_kwp") or 0, design.get("battery_kwh") or 0, design.get("wallbox_kw") or 0
    inv = design.get("inverter_kw")
    demand = (inp.get("annual_demand_kwh") or 0) + ev_kwh(inp)
    if pv and demand:
        r = pv / (demand / 1000)
        msgs.append({"level": "ok" if 0.8 <= r <= 3.5 else "warn",
                     "message": f"{pv:g} kWp for {demand:,.0f} kWh is {r:.1f} kWp per 1,000 kWh (typical 1 to 2.5)."})
        msgs.append({"level": "ok", "message": f"Roof needed about {pv * 5.5:.0f} m2 at 5.5 m2 per kWp."})
    if pv and inv:
        msgs.append({"level": "ok" if 0.8 <= pv / inv <= 1.3 else "warn", "message": f"DC/AC ratio {pv / inv:.2f} ({inv:g} kW inverter)."})
    if bat and pv:
        r = bat / pv
        msgs.append({"level": "ok" if 0.5 <= r <= 1.5 else "warn", "message": f"Battery {r:.1f} kWh per kWp (typical about 1)."})
    if wb and not inp.get("has_ev"):
        msgs.append({"level": "warn", "message": "Wallbox with no EV recorded: confirm a car is planned."})
    if inp.get("has_ev") and not wb and not inp.get("has_wallbox"):
        msgs.append({"level": "warn", "message": "EV recorded but no wallbox, existing or planned."})
    pb = econ.get("payback_years")
    if pb is not None:
        msgs.append({"level": "ok" if 5 <= pb <= 15 else "warn", "message": f"Payback about {pb:.0f} years (sanity band 5 to 15)."})
    seen, out = set(), []
    for m in msgs:
        if m["message"] not in seen:
            seen.add(m["message"])
            out.append(m)
    return out
