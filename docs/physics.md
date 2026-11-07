# Physics: hourly simulation, plausibility, economic optimum

Module `engine/app/hourly/` (`simulate`, `validate_physics`, `optimum`). The learned model proposes; this module explains and checks. Check: `cd engine && uv run python -m app.hourly.check`.

## Method

| Part | What we do | Source |
|---|---|---|
| Weather | PVGIS TMY via `pvlib.iotools.get_pvgis_tmy`, cached in `engine/.cache/pvgis/`, Munich bundled (`munich_tmy.csv`, 8,760 h) for offline use | [pvlib docs](https://pvlib-python.readthedocs.io/en/stable/reference/generated/pvlib.iotools.get_pvgis_tmy.html) (v0.16, 2026) |
| PV | pvlib `ModelChain`, PVWatts DC with 14% system losses (PVGIS default), SAPM cell temperature, physical AOI, inverter 96%, clipped at the design's inverter kW. Default south, 35 degrees; `roof_azimuth_deg`, `roof_tilt_deg` or `roof_orientation: "east-west"` override | pvlib; tilt 30 to 35 optimal, east-west 80 to 87% of south ([reduco](https://reduco.ai/blog/solar/photovoltaik-ertrag-pro-kwp-tabelle), 2026; [aceflex](https://www.aceflex.de/pv-informationen/ertrag/)) |
| Household load | BDEW H25 (the 2025 successor to H0, dynamic), `demandlib.bdew.H25`, 15 min averaged to hourly, scaled to `annual_demand_kwh`. One-home scatter on top (seeded lognormal, day sd 0.35, hour sd 1.2) because a standard profile averages many homes and overstates self-consumption; both values fitted to the HTW calculator's own tables (below). All `load_profile` values use H25 | [demandlib BDEW](https://demandlib.readthedocs.io/en/latest/bdew.html) (v0.2.2) |
| Heat pump | Annual heat from `heating_demand_kwh`, else heating cost at 12 ct per kWh heat, else floor area by build year, else heat pump kW x 2,000 h. Hourly shape: heating degree-hours below 15 C from the TMY plus 15% flat hot water (VDI 4655 style; the full VDI method needs a DWD TRY file). Hourly COP falls 0.08 per K colder, scaled so the heat-weighted seasonal COP is JAZ 3.4 | Fraunhofer ISE field test, 77 existing homes: air-water JAZ 3.4, range 2.6 to 4.9 ([ISE](https://www.ise.fraunhofer.de/de/forschungsprojekte/wp-im-bestand.html), final report Nov 2025) |
| EV | `ev_annual_km` (default 12,000) at 18 kWh per 100 km, the daily share charged from 18:00 at wallbox power (11 kW; 3.7 kW without wallbox) | 17 kWh/100 km ([MDPI Energies](https://mdpi.com/1996-1073/15/18/6575), 2022); 18 to 19 in consumer guides (2026) |
| Battery | Greedy: charge from PV surplus, discharge into any deficit. 90% of nominal usable, 90% round trip, power 0.5 C (at least 2.5 kW) | HTW calculator assumes 90% usable after ageing, 83.9% round trip, 1 kW per kWh ([HTW FAQ](https://solar.htw-berlin.de/faq-unabhaengigkeitsrechner/)); best 2025 systems exceed 98% conversion ([HTW Stromspeicher-Inspektion 2025](https://solar.htw-berlin.de/studien/stromspeicher-inspektion-2025/)) |
| Clock | Weather in UTC, load in Berlin local time, DST handled | |

Definitions follow HTW: self-consumption = (direct use + battery charging) / PV yield; autarky = (direct use + battery discharge) / load.

## Economics

| Item | Value | Source |
|---|---|---|
| Grid price | `electricity_price_ct_kwh`, default 37 ct, rising 2% a year | [BDEW Strompreisanalyse Aug 2026](https://www.bdew.de/service/daten-und-grafiken/bdew-strompreisanalyse/); ECB 2% target |
| Feed-in | 7.70 ct up to 10 kWp, 6.66 ct on the 10 to 40 kWp part, fixed 20 years | EEG from 1 Aug 2026, `docs/domain.md` |
| Negative prices | No feed-in pay in the 573 sunniest hours of the year (Solarspitzengesetz) | 573 negative hours in 2025 ([SMARD](https://www.smard.de/page/en/topic-article/5892/219038)) |
| Capex | PV EUR 2,333 plus 883 per kWp (1,350 per kWp at 5 kWp, 1,000 at 20); battery EUR 315 per kWh (BSW 2026); heat pump EUR 33,500 less 30% BEG on up to 28,000, less EUR 10,000 boiler avoided; wallbox EUR 1,200 | [reduco 2026 size table](https://reduco.ai/blog/solar/solaranlage-kosten-nach-groesse-kwp); Verbraucherzentrale via [42watt](https://42watt.de/magazin/stromspeicher-kosten); [reduco heat pump](https://reduco.ai/blog/waermepumpe-kosten-foerderung); `docs/domain.md` |
| Battery life | Replaced after 15 years or 6,000 cycles, whichever first, at today's price; residual value at year 20 | [42watt](https://42watt.de/magazin/lebensdauer-stromspeicher) |
| Upkeep | 1.5% of PV and battery capex a year | 1 to 2% (Fraunhofer ISE via [co2online](https://www.co2online.de/modernisieren-und-bauen/photovoltaik/kosten-und-finanzierung/), 2026) |
| Heat pump saving | Old heating cost (given, or 12 ct per kWh heat) removed; heat pump electricity enters the simulated load | |
| NPV | 20 years, 3% discount, 0.5% a year PV degradation ([Jordan and Kurtz 2013](https://doi.org/10.1002/pip.1182)), battery replacement as above | |

`annual_saving_eur` = bill before minus bill after minus upkeep. "Before" keeps existing PV and battery.

## Optimum

Grid search over the installer's catalogue (`{"pv_kwp": [...], "battery_kwh": [...]}`, none always tried), heat pump and wallbox kept from the proposal, maximising 20-year NPV. NPV gaps under EUR 500 or 10% of the best are inside the model error: among those, the design closest to the proposal wins. About 0.1 s for 70 designs.

## Plausibility (`validate_physics`)

DC/AC ratio with simulated clipping loss (ok 0.8 to 1.35); battery usable kWh against the 75th percentile of daily load not covered directly by PV (oversized above 1.5 x) and full cycles a year (under 150 warns); roof area at 5.5 m2 per kWp when `roof_area_sqm` is given; heat pump full-load hours (ok 1,400 to 2,800; data median about 2,300); autarky above 95%; self-consumption under 20%.

## Check against HTW Berlin

HTW Unabhängigkeitsrechner: minute-resolution simulation of a year, VDI 4655 household profile, Brandenburg weather, 1,024 kWh/kWp, households without heat pump or EV ([HTW FAQ](https://solar.htw-berlin.de/faq-unabhaengigkeitsrechner/)). Its results are lookup tables by kWp per MWh and usable kWh per MWh, published with the calculator ([tabelleAutarkie.json](https://solar.htw-berlin.de/unabhaengigkeitsrechner/js/tabelleAutarkie.json), [tabelleEigenverbrauch.json](https://solar.htw-berlin.de/unabhaengigkeitsrechner/js/tabelleEigenverbrauch.json)). `check.py` downloads them to `engine/.cache/htw/` and compares at equal energy ratios (our PV scaled to 1,024 kWh/kWp, HTW battery settings).

Result over 25 points (0.5 to 3 kWp per MWh, 0 to 2 kWh per MWh): RMSE 1.5 points, worst 3.2 points (autarky and self-consumption). Without the one-home scatter the plain H25 profile read up to 10 points high on large batteries.

Selected autarky, ours / HTW: 1 kWp/MWh no battery 29% / 30%; 1 kWp/MWh, 1 kWh/MWh 56% / 56%; 2 kWp/MWh, 1 kWh/MWh 66% / 63%; 3 kWp/MWh, 2 kWh/MWh 83% / 81%. We read 2 to 3 points high when PV and battery are both large.

With Munich weather (1,109 kWh/kWp, 8% above HTW's Brandenburg; PVGIS gives about 1,140 for Munich at optimum, [rechner-hub](https://rechner-hub.de/photovoltaik-ertrag/)) and our battery (90% round trip): 4,500 kWh with 7.2 kWp and 10 kWh gives 77.1% autarky, 46.2% self-consumption. HTW reads 74.6% at its lower yield and about 76.5% at the same energy ratio.

Simulation cost: about 1.5 ms per call after the first (0.6 s cold, PV profile and load built once).
