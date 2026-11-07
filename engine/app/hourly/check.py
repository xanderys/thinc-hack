"""uv run python -m app.hourly.check : sanity against HTW Berlin reference values."""
import time

from . import optimum, simulate, validate_physics

HOMES = {
    "2 persons, 2,500 kWh": dict(annual_demand_kwh=2500, load_profile="H0", has_ev=False, has_wallbox=False, heating_type="Gas"),
    "family, 4,500 kWh": dict(annual_demand_kwh=4500, load_profile="H0", has_ev=False, has_wallbox=False, heating_type="Gas"),
    "family, 4,500 kWh + EV 15,000 km + heat pump": dict(annual_demand_kwh=4500, load_profile="H0", has_ev=True, ev_annual_km=15000,
                                                       has_wallbox=False, heating_type="Gas", heating_demand_kwh=18000),
}
CAT = {"pv_kwp": [4.5, 6.3, 7.2, 8.1, 9.0, 10.35, 10.8, 12.6, 13.5, 15.3, 18.0], "battery_kwh": [5, 7, 10, 15, 20]}


def row(inp, d):
    e = simulate(inp, d).economics
    a = e["annual"]
    return f"{a['pv_yield_kwh'] / d['pv_kwp']:5.0f} kWh/kWp  SC {e['self_consumption_share']:5.1%}  autarky {e['autarky_share']:5.1%}  payback {e['payback_years']} y  NPV {a['npv_20y_eur']:,.0f}"


def main():
    t = time.time()
    simulate(HOMES["family, 4,500 kWh"], {"pv_kwp": 4.5})
    print(f"cold start {time.time() - t:.1f} s")
    for name, inp in HOMES.items():
        mwh = inp["annual_demand_kwh"] / 1000
        hp = {"heatpump_kw": 8.0, "wallbox_kw": 11.0} if inp["has_ev"] else {}
        print(f"\n{name}")
        for label, d in [("1 kWp/MWh, no battery", {"pv_kwp": mwh}),
                         ("1 kWp/MWh, 1 kWh/kWp", {"pv_kwp": mwh, "battery_kwh": mwh}),
                         ("2 kWp/MWh, 1 kWh/kWp", {"pv_kwp": 2 * mwh, "battery_kwh": 2 * mwh})]:
            d = {**d, "inverter_kw": d["pv_kwp"] / 1.15, **hp}
            print(f"  {label:24s} {row(inp, d)}")
    print("\nHTW reference: about 30% SC without battery at 1 kWp/MWh; 50 to 70% autarky with 1 kWh per kWp.")

    inp = HOMES["family, 4,500 kWh"]
    prop = {"pv_kwp": 9.0, "inverter_kw": 8.0, "battery_kwh": 10.0, "heatpump_kw": None, "wallbox_kw": None}
    t = time.time()
    n = 20
    for _ in range(n):
        simulate(inp, prop)
    print(f"\nsimulate {1000 * (time.time() - t) / n:.1f} ms per call")
    for p in validate_physics(inp, prop):
        print(f"  [{p['level']}] {p['message']}")
    t = time.time()
    o = optimum(inp, CAT, prop)
    print(f"optimum {time.time() - t:.2f} s: {o['design']['pv_kwp']} kWp, {o['design']['battery_kwh']} kWh; {o['note']}")
    print(f"  delta {o['delta_vs_proposal']}")


if __name__ == "__main__":
    main()
