# Physics: hourly simulation, plausibility, economic optimum

Module `engine/app/hourly/` (`simulate`, `validate_physics`, `optimum`). The learned model proposes; this module explains and checks. Check: `cd engine && uv run python -m app.hourly.check`.

## Method

| Part | What we do | Source |
|---|---|---|
| Weather | PVGIS TMY via `pvlib.iotools.get_pvgis_tmy`, cached in `engine/.cache/pvgis/`, Munich bundled (`munich_tmy.csv`, 8,760 h) for offline use | [pvlib docs](https://pvlib-python.readthedocs.io/en/stable/reference/generated/pvlib.iotools.get_pvgis_tmy.html) (v0.16, 2026) |
| PV | pvlib `ModelChain`, PVWatts DC with 14% system losses (PVGIS default), SAPM cell temperature, physical AOI, inverter 96%, clipped at the design's inverter kW. Default south, 35 degrees; `roof_azimuth_deg`, `roof_tilt_deg` or `roof_orientation: "east-west"` override | pvlib; tilt 30 to 35 optimal, east-west 80 to 87% of south ([reduco](https://reduco.ai/blog/solar/photovoltaik-ertrag-pro-kwp-tabelle), 2026; [aceflex](https://www.aceflex.de/pv-informationen/ertrag/)) |
| Household load | BDEW H25 (the 2025 successor to H0, dynamic), `demandlib.bdew.H25`, 15 min averaged to hourly, scaled to `annual_demand_kwh`. One-home scatter on top (seeded lognormal, day sd 0.3, hour sd 0.8) because a standard profile averages many homes and overstates self-consumption; calibrated so 1 kWp per MWh without battery lands near HTW's 30%. All `load_profile` values use H25 | [demandlib BDEW](https://demandlib.readthedocs.io/en/latest/bdew.html) (v0.2.2) |
| Heat pump | Annual heat from `heating_demand_kwh`, else heating cost at 12 ct per kWh heat, else floor area by build year, else heat pump kW x 2,000 h. Hourly shape: heating degree-hours below 15 C from the TMY plus 15% flat hot water (VDI 4655 style; the full VDI method needs a DWD TRY file). Hourly COP falls 0.08 per K colder, scaled so the heat-weighted seasonal COP is JAZ 3.4 | Fraunhofer ISE field test, 77 existing homes: air-water JAZ 3.4, range 2.6 to 4.9 ([ISE](https://www.ise.fraunhofer.de/de/forschungsprojekte/wp-im-bestand.html), final report Nov 2025) |
| EV | `ev_annual_km` (default 12,000) at 18 kWh per 100 km, the daily share charged from 18:00 at wallbox power (11 kW; 3.7 kW without wallbox) | 17 kWh/100 km ([MDPI Energies](https://mdpi.com/1996-1073/15/18/6575), 2022); 18 to 19 in consumer guides (2026) |
| Battery | Greedy: charge from PV surplus, discharge into any deficit. 90% of nominal usable, 90% round trip, power 0.5 C (at least 2.5 kW) | HTW calculator assumes 90% usable after ageing, 83.9% round trip, 1 kW per kWh ([HTW FAQ](https://solar.htw-berlin.de/faq-unabhaengigkeitsrechner/)); best 2025 systems exceed 98% conversion ([HTW Stromspeicher-Inspektion 2025](https://solar.htw-berlin.de/studien/stromspeicher-inspektion-2025/)) |
| Clock | Weather in UTC, load in Berlin local time, DST handled | |

Definitions follow HTW: self-consumption = (direct use + battery charging) / PV yield; autarky = (direct use + battery discharge) / load.

## Economics

| Item | Value | Source |
|---|---|---|
| Grid price | `electricity_price_ct_kwh`, default 32 ct (contract default; domain.md has 37), rising 2% a year | `docs/api.md`, `docs/domain.md` |
| Feed-in | 7.70 ct up to 10 kWp, 6.66 ct on the 10 to 40 kWp part, fixed 20 years | EEG from 1 Aug 2026, `docs/domain.md` |
| Negative prices | No feed-in pay in the 573 sunniest hours of the year (Solarspitzengesetz) | 573 negative hours in 2025 ([SMARD](https://www.smard.de/page/en/topic-article/5892/219038)) |
| Capex | PV EUR 1,350 per kWp at 5 kWp to 1,000 at 20; battery EUR 450 per kWh; heat pump EUR 36,400 before subsidy; wallbox EUR 1,200 | `docs/domain.md` (shared with `engine/app/physics.py`) |
| Upkeep | 1.5% of PV and battery capex a year | 1 to 2% (Fraunhofer ISE via [co2online](https://www.co2online.de/modernisieren-und-bauen/photovoltaik/kosten-und-finanzierung/), 2026) |
| Heat pump saving | Old heating cost (given, or 12 ct per kWh heat) removed; heat pump electricity enters the simulated load | |
| NPV | 20 years, 3% discount, 0.5% a year PV degradation, no battery replacement, no subsidy | |

`annual_saving_eur` = bill before minus bill after minus upkeep. "Before" keeps existing PV and battery.

## Optimum

Grid search over the installer's catalogue (`{"pv_kwp": [...], "battery_kwh": [...]}`, none always tried), heat pump and wallbox kept from the proposal, maximising 20-year NPV. NPV gaps under EUR 500 or 10% of the best are inside the model error: among those, the design closest to the proposal wins. About 0.1 s for 70 designs.

## Plausibility (`validate_physics`)

DC/AC ratio with simulated clipping loss (ok 0.8 to 1.35); battery usable kWh against the 75th percentile of daily load not covered directly by PV (oversized above 1.5 x) and full cycles a year (under 150 warns); roof area at 5.5 m2 per kWp when `roof_area_sqm` is given; heat pump full-load hours (ok 1,400 to 2,800; data median about 2,300); autarky above 95%; self-consumption under 20%.

## Check against HTW Berlin

HTW Unabhängigkeitsrechner: minute-resolution simulation of a year, VDI 4655 household profile, Brandenburg weather, 1,024 kWh/kWp, households without heat pump or EV ([HTW FAQ](https://solar.htw-berlin.de/faq-unabhaengigkeitsrechner/)). Reference values: about 30% self-consumption without battery at 1 kWp per MWh; 4 kWh usable on 5 kWp roughly doubles it to 60% ([Weniger 2012, via Solarserver](https://www.solarserver.de/2014/07/17/htw-berlin-entwickelt-rechner-zur-analyse-der-photovoltaik-eigenversorgung-in-kombination-mit-solarstrom-speicher)); 50 to 70% autarky with a battery (`docs/domain.md`).

Check output (Munich, south 35 degrees, any demand; results scale):

| Case | Yield kWh/kWp | Self-consumption | Autarky |
|---|---|---|---|
| 1 kWp/MWh, no battery | 1,109 | 31.7% | 35.1% |
| 1 kWp/MWh, 1 kWh/kWp | 1,109 | 56.7% | 60.1% |
| 2 kWp/MWh, 1 kWh/kWp | 1,109 | 39.6% | 83.1% |
| 4,500 kWh + EV 15,000 km + 8 kW heat pump, 4.5 kWp, 4.5 kWh | 1,109 | 66.9% | 25.9% |

How close: yield is 8% above HTW's 1,024 (Munich against Brandenburg; PVGIS gives about 1,140 for Munich at optimum, [rechner-hub](https://rechner-hub.de/photovoltaik-ertrag/)). Without battery and at 1 kWh per kWp we land within 2 to 5 points of HTW. At 2 kWp per MWh with a battery we read about 10 points above the 60 to 75% that blogs quote: hourly steps and a smooth profile let the battery cover nights a real home's spikes would not. Read large-system autarky as an upper bound.

Simulation cost: about 1.5 ms per call after the first (0.9 s cold, PV profile and load built once).
