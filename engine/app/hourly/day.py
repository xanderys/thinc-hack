"""One typical day at hourly resolution from the same simulation the economics use (v2.18): solar and household load,
the battery filling and draining, the car charging and the heat pump against the outdoor temperature, with the
headline figures for each ladder size. Summer is the median June day of the PVGIS typical year; winter is the median
day (by mean temperature) of its coldest week."""
import numpy as np

from . import sim as S

LADDER = {"battery": [5.0, 7.0, 9.0, 10.0, 18.0], "wallbox": [11.0, 22.0], "heatpump": [5.5, 7.5, 10.5, 12.5]}
EV_BATTERY_KWH = 60.0      # assumption: a typical mid-size car battery, 10 to 90 % is about 48 kWh of charging
EV_CHARGE_KWH = 0.8 * EV_BATTERY_KWH
CAR_ONBOARD_KW = 11.0      # assumption: most cars on sale take at most 11 kW AC, so a 22 kW box charges them at 11
_CACHE: dict = {}


def _days(year=None):
    loc = "Munich"
    _, local = S._local_hours()
    dates = local.normalize()
    return local, dates


def pick_day(kind: str, pv_shape: np.ndarray):
    """Positions (24 hourly indices) and the local date of the typical day."""
    local, dates = _days()
    temp = S.weather("Munich", None)["temp_air"].to_numpy()
    uniq = sorted(set(dates))
    by = {d: np.where(dates == d)[0] for d in uniq}
    full = [d for d in uniq if len(by[d]) == 24]
    if kind == "winter":
        means = np.array([temp[by[d]].mean() for d in full])
        week = np.convolve(means, np.ones(7) / 7, mode="valid")
        start = int(np.argmin(week))
        days = full[start:start + 7]
        m = [temp[by[d]].mean() for d in days]
        d = days[int(np.argsort(m)[len(m) // 2])]
    else:
        june = [d for d in full if d.month == 6]
        sums = [pv_shape[by[d]].sum() for d in june]
        d = june[int(np.argsort(sums)[len(sums) // 2])]
    i = full.index(d)
    nxt = by[full[i + 1]] if i + 1 < len(full) else by[d]
    return by[d], nxt, d


def _soc(ch, dis, kwh):
    if not kwh:
        return np.zeros(len(ch))
    e = S.BAT_RTE ** 0.5
    soc = np.cumsum(ch * e - dis / e)
    return np.clip(soc / (kwh * S.BAT_USABLE), 0, 1)


def _battery(f, idx, nxt, kwh, sunset, sunrise_next):
    load, pv = f["load"], f["pv"]
    direct = np.minimum(pv, load)
    ch, dis = S.dispatch(pv - direct, load - direct, kwh)
    deficit = load - direct
    covered = 0
    for h in list(idx[sunset:]) + list(nxt[:sunrise_next]):
        if deficit[h] <= 1e-6:
            covered += 1
            continue
        if dis[h] >= 0.9 * deficit[h]:
            covered += 1
        else:
            break
    day_load = load[idx].sum()
    ss = (direct[idx].sum() + dis[idx].sum()) / day_load if day_load else 0.0
    return ch, dis, covered, round(float(ss), 3)


def view(inputs: dict, design: dict, kind: str = "summer", sizes: dict | None = None) -> dict:
    sizes = sizes or {}
    d = {**design, **{k: v for k, v in sizes.items() if v is not None}}
    f = S._flows(inputs, d, "Munich")
    pv_shape = S.pv_profile(inputs, "Munich", None)
    idx, nxt, date = pick_day(kind, pv_shape)
    pv_d = f["pv"][idx]
    lit = np.where(pv_d > 0.02 * max(pv_d.max(), 1e-9))[0]
    sunrise, sunset = (int(lit[0]), int(lit[-1]) + 1) if len(lit) else (8, 16)
    pv_n = f["pv"][nxt]
    lit_n = np.where(pv_n > 0.02 * max(pv_n.max(), 1e-9))[0]
    sunrise_next = int(lit_n[0]) if len(lit_n) else 8
    r = lambda a: [round(float(x), 3) for x in a]
    out = {"day": kind, "date": str(date.date()), "hours": 24, "solar_kwh": r(pv_d), "load_kwh": r(f["house"][idx]),
           "sunrise_h": sunrise, "sunset_h": sunset}

    kwh = d.get("battery_kwh") or 0
    ch, dis, cov, ss = _battery(f, idx, nxt, kwh, sunset, sunrise_next)
    soc = _soc(ch, dis, kwh)
    by = {}
    for s in LADDER["battery"]:
        _, _, c2, s2 = _battery(f, idx, nxt, s, sunset, sunrise_next)
        by[f"{s:g}"] = {"hours_after_sunset_covered": c2, "self_sufficiency_share": s2}
    out["battery"] = {"kwh": kwh or None, "soc": r(soc[idx]), "charge_kwh": r(ch[idx]), "discharge_kwh": r(dis[idx]),
                      "hours_after_sunset_covered": cov, "self_sufficiency_share": ss, "ladder": LADDER["battery"], "by_size": by}

    wb = d.get("wallbox_kw")
    if inputs.get("has_ev") or sizes.get("wallbox_kw"):
        def ev_stats(kw):
            g = S._flows({**inputs, "has_ev": True}, {**d, "wallbox_kw": kw}, "Munich")
            ev = g["ev"]
            spare = np.clip(g["pv"] - g["house"] - g["hp"], 0, None)
            solar = np.minimum(spare, ev).sum()
            return g, round(float(solar / ev.sum()), 3) if ev.sum() else 0.0, round(EV_CHARGE_KWH / min(kw, CAR_ONBOARD_KW), 1)
        g, share, hrs = ev_stats(wb or 11.0)
        out["wallbox"] = {"kw": wb, "ev_kwh_year": round(float(g["ev"].sum())), "charging_kwh": r(g["ev"][idx]),
                          "solar_share_of_charging": share, "full_charge_hours": hrs, "ladder": LADDER["wallbox"],
                          "by_size": {f"{k:g}": dict(zip(("solar_share_of_charging", "full_charge_hours"), ev_stats(k)[1:])) for k in LADDER["wallbox"]},
                          "assumptions": f"{EV_CHARGE_KWH:.0f} kWh for a full charge (10 to 90 % of a {EV_BATTERY_KWH:.0f} kWh car), car takes at most "
                                         f"{CAR_ONBOARD_KW:g} kW AC; {S.EV_HOME_SHARE:.0%} of the car's kWh charged at home from {S.EV_START_H}:00"}
    else:
        out["wallbox"] = None

    hp = d.get("heatpump_kw")
    if hp or sizes.get("heatpump_kw"):
        heat, src = S.heat_demand_kwh(inputs, d)
        shape, cop = S.heat_shape("Munich", None)
        temp = S.weather("Munich", None)["temp_air"].to_numpy()
        el = heat * shape / cop
        price = S._price(inputs)
        import copy
        from .. import envelope_view
        env = envelope_view.correct(copy.deepcopy(inputs.get("envelope") or {}))  # the heated rooms (v2.14 C), as the cards show
        load_kw = env.get("design_heat_load_kw") or round(heat / 2300, 1)
        boiler = inputs.get("heating_cost_per_year_eur") or round(heat * S.HEAT_EUR_PER_KWH)
        cost = round(float(el.sum() * price))
        out["heatpump"] = {"kw": hp, "heat_demand_kwh": r(heat * shape[idx]), "outdoor_temp_c": r(temp[idx]), "heat_load_kw": load_kw,
                           "heating_kwh_year": round(heat), "heating_source": src, "electricity_kwh_year": round(float(el.sum())),
                           "cop": S.JAZ, "cost_eur_year": cost, "boiler_cost_eur_year": round(float(boiler)), "ladder": LADDER["heatpump"],
                           "by_size": {f"{k:g}": {"electricity_kwh_year": round(float(el.sum())), "cost_eur_year": cost,
                                                  "covers_heat_load": bool(k >= load_kw)} for k in LADDER["heatpump"]}}
    else:
        out["heatpump"] = None
    return out
