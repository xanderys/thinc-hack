"""8,760-hour energy balance and economics. Method and sources: docs/physics.md."""
from __future__ import annotations

from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

import numpy as np
import pandas as pd

from .. import rules  # cost curve and constants shared with the ratio model

HERE = Path(__file__).parent
CACHE = HERE.parent.parent / ".cache" / "pvgis"
LOCATIONS = {"Munich": (48.137, 11.575)}
YEAR = 2025

PRICE_CT = 32.0             # docs/api.md default
FEEDIN_LOW, FEEDIN_HIGH = rules.FEEDIN_LOW, rules.FEEDIN_HIGH
BAT_EUR_KWH = 450
BAT_USABLE = 0.90           # usable share of nominal
BAT_RTE = 0.90              # round trip, AC to AC
BAT_C_RATE = 0.5            # kW per kWh nominal, floor 2.5 kW
INV_EFF = 0.96
EV_KWH_PER_100KM = 18.0
EV_START_H = 18             # local hour charging starts
JAZ = 3.4                   # Fraunhofer ISE air-water in existing homes, 2025
HEAT_EUR_PER_KWH = 0.12     # fossil heat incl. boiler losses, when no cost given
HP_DEFAULT_HEAT_KWH = 15_000
DHW_SHARE = 0.15            # hot water share of annual heat, flat over the year
HEAT_BASE_C = 15.0          # heating degree-hour base
LOAD_SD_DAY, LOAD_SD_HOUR = 0.35, 1.2  # fitted to 25 points of the HTW Unabhaengigkeitsrechner tables
NEG_PRICE_HOURS = 573      # SMARD, 2025
OPEX_SHARE = 0.015
YEARS, DISCOUNT, PRICE_RISE, DEGRADATION = 20, 0.03, 0.02, 0.005


# ---------- weather and PV ----------

def _key(loc):
    lat, lon = LOCATIONS[loc] if isinstance(loc, str) else loc
    return round(lat, 3), round(lon, 3)


@lru_cache(maxsize=8)
def weather(loc="Munich") -> pd.DataFrame:
    lat, lon = _key(loc)
    f = CACHE / f"{lat}_{lon}.csv"
    if f.exists():
        return pd.read_csv(f, index_col=0, parse_dates=True)
    try:
        import pvlib
        d, _ = pvlib.iotools.get_pvgis_tmy(lat, lon, map_variables=True, timeout=20)
        d = d[["ghi", "dni", "dhi", "temp_air", "wind_speed"]].round(1)
        CACHE.mkdir(parents=True, exist_ok=True)
        d.to_csv(f)
        return d
    except Exception:
        if (lat, lon) == _key("Munich"):
            return pd.read_csv(HERE / "munich_tmy.csv", index_col=0, parse_dates=True)
        raise


def _local_hours():
    """UTC hours of the sim year mapped to local Berlin clock time (DST aware)."""
    utc = pd.date_range(f"{YEAR}-01-01", periods=8760, freq="h", tz="UTC")
    return utc, utc.tz_convert("Europe/Berlin").tz_localize(None)


@lru_cache(maxsize=32)
def pv_per_kwp(loc="Munich", tilt=35.0, azimuth=180.0) -> np.ndarray:
    """AC kWh per kWp for each UTC hour, unclipped, pvlib ModelChain (PVWatts DC, 14% system losses)."""
    import pvlib
    from pvlib.location import Location
    from pvlib.modelchain import ModelChain
    from pvlib.pvsystem import PVSystem
    from pvlib.temperature import TEMPERATURE_MODEL_PARAMETERS

    lat, lon = _key(loc)
    w = weather(loc).copy()
    w.index = _local_hours()[0]
    system = PVSystem(surface_tilt=tilt, surface_azimuth=azimuth,
                      module_parameters={"pdc0": 1000.0, "gamma_pdc": -0.0035},
                      inverter_parameters={"pdc0": 1e6, "eta_inv_nom": INV_EFF},
                      temperature_model_parameters=TEMPERATURE_MODEL_PARAMETERS["sapm"]["open_rack_glass_polymer"])
    mc = ModelChain(system, Location(lat, lon, tz="UTC", altitude=520), aoi_model="physical",
                    spectral_model="no_loss", losses_model="pvwatts")
    mc.run_model(w)
    dc = mc.results.dc.clip(lower=0).fillna(0).to_numpy() / 1000.0
    return dc * INV_EFF


def orientation(inputs):
    tilt = inputs.get("roof_tilt_deg")
    az = inputs.get("roof_azimuth_deg")
    if inputs.get("roof_orientation") == "east-west":
        return [(tilt or 15.0, 90.0, 0.5), (tilt or 15.0, 270.0, 0.5)]
    return [(35.0 if tilt is None else tilt, 180.0 if az is None else az, 1.0)]


def pv_profile(inputs, loc):
    return sum(share * pv_per_kwp(loc, float(t), float(a)) for t, a, share in orientation(inputs))


# ---------- loads ----------

@lru_cache(maxsize=1)
def _h25_local() -> pd.Series:
    from demandlib import bdew
    idx = pd.date_range(f"{YEAR}-01-01", periods=8760 * 4, freq="15min")
    s = pd.Series(np.asarray(bdew.H25(idx), float), index=idx).resample("h").mean()
    return s / s.sum()


@lru_cache(maxsize=1)
def household_shape() -> np.ndarray:
    """BDEW H25 household profile on UTC hours, sums to 1."""
    _, local = _local_hours()
    v = _h25_local().reindex(local, method="nearest").to_numpy()
    rng = np.random.default_rng(7)  # one home, not the average of many: day and hour scatter around H25
    v = v * np.repeat(rng.lognormal(-LOAD_SD_DAY ** 2 / 2, LOAD_SD_DAY, 365), 24)
    v = v * rng.lognormal(-LOAD_SD_HOUR ** 2 / 2, LOAD_SD_HOUR, 8760)
    return v / v.sum()


@lru_cache(maxsize=4)
def heat_shape(loc="Munich"):
    """(heat share per hour summing to 1, hourly COP scaled to seasonal JAZ)."""
    t = weather(loc)["temp_air"].to_numpy()
    space = np.clip(HEAT_BASE_C - t, 0, None)
    shape = (1 - DHW_SHARE) * space / space.sum() + DHW_SHARE / 8760
    cop = np.clip(2.6 + 0.08 * t, 1.8, 5.5)          # air-water, falls about 0.08 per K colder
    cop *= JAZ / (shape.sum() / (shape / cop).sum())   # heat-weighted seasonal COP = JAZ
    return shape, cop


@lru_cache(maxsize=1)
def _local_hour() -> np.ndarray:
    return _local_hours()[1].hour.to_numpy()


def ev_load(daily_kwh, kw):
    """Daily energy charged at full power from EV_START_H local time."""
    h = _local_hour()
    out = np.zeros(8760)
    left = daily_kwh
    for k in range(12):
        e = min(kw, max(left, 0))
        out[h == (EV_START_H + k) % 24] = e
        left -= e
    return out


def heat_demand_kwh(inputs, design):
    """Annual heat (kWh) for the heat pump, and the source of the figure."""
    if inputs.get("heating_demand_kwh"):
        return float(inputs["heating_demand_kwh"]), "heating demand given"
    cost = inputs.get("heating_cost_per_year_eur")
    if cost and inputs.get("heating_type") != "Heatpump":
        return cost / HEAT_EUR_PER_KWH, f"heating cost over {HEAT_EUR_PER_KWH * 100:.0f} ct per kWh of heat"
    if cost:
        return cost / (_price(inputs)) * JAZ, "heat pump electricity cost times JAZ"
    sqm, yr = inputs.get("house_size_sqm"), inputs.get("house_built_year")
    if sqm:
        kwh_m2 = 60 if yr and yr >= 2000 else 110 if yr and yr >= 1980 else 160 if yr else 130
        return sqm * kwh_m2 + 600 * (inputs.get("num_inhabitants") or 3), f"{sqm:.0f} m2 at {kwh_m2} kWh/m2 plus hot water"
    hp = design.get("heatpump_kw") if design else None
    if hp:
        return hp * 2000.0, "heat pump kW over 2,000 full-load hours"
    return float(HP_DEFAULT_HEAT_KWH), "typical single-family value"


def _price(inputs):
    return (inputs.get("electricity_price_ct_kwh") or PRICE_CT) / 100


# ---------- battery ----------

def dispatch(surplus: np.ndarray, deficit: np.ndarray, kwh: float):
    """Greedy self-consumption. Returns (charge AC kWh, discharge AC kWh) per hour."""
    n = len(surplus)
    ch, dis = np.zeros(n), np.zeros(n)
    if not kwh:
        return ch, dis
    cap = kwh * BAT_USABLE
    p = max(2.5, BAT_C_RATE * kwh)
    e_in = e_out = BAT_RTE ** 0.5
    soc = 0.0
    sur, dfc = surplus.tolist(), deficit.tolist()
    for i in range(n):
        s = sur[i]
        if s > 0:
            c = min(s, p, (cap - soc) / e_in)
            soc += c * e_in
            ch[i] = c
        else:
            d = min(dfc[i], p, soc * e_out)
            soc -= d / e_out
            dis[i] = d
    return ch, dis


# ---------- simulate ----------

@dataclass
class SimResult:
    economics: dict
    hourly: dict = field(repr=False)          # numpy arrays, UTC hours; not for the API


def _flows(inputs, design, loc):
    pv_kwp = (design.get("pv_kwp") or 0) + (inputs.get("existing_solar_kwp") or 0 if inputs.get("has_solar") else 0)
    bat = (design.get("battery_kwh") or 0) + (inputs.get("existing_storage_kwh") or 0 if inputs.get("has_storage") else 0)
    inv = design.get("inverter_kw")
    if design.get("pv_kwp") and inv:
        inv = inv + (pv_kwp - design["pv_kwp"]) / 1.15
    pv = pv_profile(inputs, loc) * pv_kwp
    if inv:
        pv = np.minimum(pv, inv)
    house = household_shape() * (inputs.get("annual_demand_kwh") or 0)
    ev = np.zeros(8760)
    if inputs.get("has_ev"):
        kw = design.get("wallbox_kw") or (11.0 if inputs.get("has_wallbox") else 3.7)
        ev = ev_load((inputs.get("ev_annual_km") or 12_000) * EV_KWH_PER_100KM / 100 / 365, kw)
    hp_el = np.zeros(8760)
    heat = 0.0
    if design.get("heatpump_kw") or inputs.get("heating_type") == "Heatpump":
        heat, _ = heat_demand_kwh(inputs, design)
        shape, cop = heat_shape(loc)
        hp_el = heat * shape / cop
    load = house + ev + hp_el
    direct = np.minimum(pv, load)
    ch, dis = dispatch(pv - direct, load - direct, bat)
    imp = load - direct - dis
    exp = pv - direct - ch
    return dict(pv=pv, load=load, house=house, ev=ev, hp=hp_el, direct=direct, charge=ch, discharge=dis,
                grid_import=imp, feed_in=exp, heat=heat, pv_kwp=pv_kwp, bat=bat)


def _feedin_eur_kwh(kwp):
    if not kwp:
        return 0.0
    return (FEEDIN_LOW * min(kwp, 10) + FEEDIN_HIGH * max(kwp - 10, 0)) / kwp / 100


def _capex(inputs, design):
    """(total capex, PV plus battery capex)."""
    pv, bat, hp, wb = (design.get(k) or 0 for k in ("pv_kwp", "battery_kwh", "heatpump_kw", "wallbox_kw"))
    solar = pv * rules.pv_cost_per_kwp(pv) + bat * BAT_EUR_KWH
    return solar + (rules.hp_net_capex(inputs) if hp else 0) + (rules.WALLBOX_COST if wb else 0), solar


@lru_cache(maxsize=4)
def _paid_hours(loc="Munich"):
    """False in the NEG_PRICE_HOURS sunniest hours: proxy for negative spot prices, no feed-in pay (Solarspitzengesetz)."""
    pv = pv_per_kwp(loc, 35.0, 180.0)
    m = np.ones(8760, bool)
    m[np.argsort(pv)[-NEG_PRICE_HOURS:]] = False
    return m


def _bill(inputs, f, new_kwp, loc):
    """(grid import cost, feed-in income) in EUR a year."""
    feed_rate = _feedin_eur_kwh(new_kwp) if new_kwp else _feedin_eur_kwh(f["pv_kwp"])
    income = f["feed_in"][_paid_hours(loc)].sum() * feed_rate
    return f["grid_import"].sum() * _price(inputs), income


def _npv(capex, energy_saving, income, opex):
    """Avoided purchases rise with prices; feed-in is fixed for 20 years; both degrade with the PV."""
    t = np.arange(1, YEARS + 1)
    deg = (1 - DEGRADATION) ** (t - 1)
    flows = energy_saving * (1 + PRICE_RISE) ** (t - 1) * deg + income * deg - opex
    return float((flows / (1 + DISCOUNT) ** t).sum() - capex)


def simulate(inputs: dict, design: dict, location="Munich") -> SimResult:
    loc = location
    after = _flows(inputs, design, loc)
    before_design = {"pv_kwp": 0, "battery_kwh": 0, "heatpump_kw": None, "wallbox_kw": design.get("wallbox_kw")}
    before = _flows(inputs, before_design, loc)
    price = _price(inputs)
    imp_b, inc_b = _bill(inputs, before, 0, loc)
    imp_a, income = _bill(inputs, after, design.get("pv_kwp") or 0, loc)
    bill_b, bill_a = imp_b - inc_b, imp_a - income

    fuel = 0.0
    adds_hp = bool(design.get("heatpump_kw")) and inputs.get("heating_type") != "Heatpump"
    if adds_hp:
        fuel = inputs.get("heating_cost_per_year_eur") or after["heat"] * HEAT_EUR_PER_KWH
        bill_b += fuel
    capex, solar_capex = _capex(inputs, design)
    opex = OPEX_SHARE * solar_capex
    saving = bill_b - bill_a - opex

    pv_y = after["pv"].sum()
    load = after["load"].sum()
    sc_kwh = (after["direct"] + after["charge"]).sum()
    covered = (after["direct"] + after["discharge"]).sum()
    sc = sc_kwh / pv_y if pv_y else 0.0
    aut = covered / load if load else 0.0
    npv = _npv(capex, imp_b + fuel - imp_a, income - inc_b, opex) if capex else None

    a = [f"Hourly simulation over one typical year ({location} PVGIS TMY, pvlib), household load BDEW H25 with single-home scatter."]
    a.append(f"Electricity {price * 100:.0f} ct/kWh" + ("" if inputs.get("electricity_price_ct_kwh") else " (default)")
             + f", rising {PRICE_RISE:.0%} a year; feed-in {FEEDIN_LOW} ct up to 10 kWp, {FEEDIN_HIGH} ct above.")
    t, az, _ = orientation(inputs)[0]
    a.append("Roof east-west." if inputs.get("roof_orientation") == "east-west" else f"Roof {az:.0f} degrees azimuth, {t:.0f} degrees tilt"
             + ("" if inputs.get("roof_azimuth_deg") is not None else " (assumed south)") + ".")
    a.append(f"Battery {BAT_USABLE:.0%} usable, {BAT_RTE:.0%} round trip, greedy self-consumption.")
    if after["ev"].any():
        a.append(f"EV {after['ev'].sum():,.0f} kWh a year at {EV_KWH_PER_100KM:g} kWh/100 km, charged from {EV_START_H}:00.")
    if after["hp"].any():
        _, src = heat_demand_kwh(inputs, design)
        if design.get("heatpump_kw"):
            a.append(rules.hp_capex_note(inputs))
        a.append(f"Heat pump {after['hp'].sum():,.0f} kWh a year: {after['heat']:,.0f} kWh heat ({src}) at JAZ {JAZ}.")
    a.append(f"No feed-in pay in the {NEG_PRICE_HOURS} sunniest hours (negative prices, 2025); upkeep {OPEX_SHARE:.1%} of PV and battery cost a year.")
    a.append(f"NPV over {YEARS} years at {DISCOUNT:.0%} discount, {DEGRADATION:.1%} a year PV degradation, no battery replacement.")
    a.append("PV EUR 1,350 per kWp at 5 kWp falling to EUR 1,000 at 20 kWp; battery EUR 450 per kWh.")

    econ = {
        "capex_eur": float(round(capex, -1)), "annual_saving_eur": float(round(saving, -1)),
        "payback_years": float(round(capex / saving, 1)) if saving > 0 and capex else None,
        "self_consumption_share": round(float(sc), 3), "autarky_share": round(float(aut), 3),
        "assumptions": a, "method": "hourly-simulation",
        "annual": {
            "pv_yield_kwh": round(float(pv_y)), "load_kwh": round(float(load)), "self_consumed_kwh": round(float(sc_kwh)),
            "fed_in_kwh": round(float(after["feed_in"].sum())), "grid_import_kwh": round(float(after["grid_import"].sum())),
            "feed_in_income_eur": round(float(income)), "bill_before_eur": round(float(bill_b)),
            "bill_after_eur": round(float(bill_a)), "npv_20y_eur": round(npv, -1) if npv is not None else None,
        },
    }
    return SimResult(econ, after)
