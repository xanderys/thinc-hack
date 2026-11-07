# Planner rules: the transparent recommender

Module `engine/app/planner_rules/` (`recommend`, `test_ids`, `calibrate`). Five rules, each one sentence, on the hourly physics in `engine/app/hourly/` (yield from pvlib on PVGIS for this roof's orientation, the evening share from the BDEW H25 profile). Fit and score: `cd engine && uv run python -m app.planner_rules.calibrate`.

## Rules
1. PV is the installer's base array plus enough to cover annual use at this roof's yield, times the installer's ratio, capped by the roof, in whole 450 W modules. None when the home already has PV.
2. The battery is sized to the array at the installer's kWh per kWp, snapped up to its packages; none when the home already has storage. One evening's use (daily use times the after-sunset share) is shown beside it as the physics check.
3. A heat pump when gas or oil heats the home and the boiler is 20 years or older, or the planner asks; size = the year's heat (given, or heating cost at 12 ct per kWh, or floor area by build year) over 2,300 full-load hours, next catalogue size up.
4. An 11 kW wallbox when an electric car is real or planned.
5. The inverter is the catalogue size nearest 0.85 times the PV kWp (DC/AC 1.1 to 1.3).

The brief's first rules 1 and 2 changed after the data: covering use times a ratio alone scored PV 28% on the test half against 40% with a base array, and one evening's use sized the battery right in 41% against 48% for kWh per kWp. The experts fit a standard array first and size the battery to the array, not to the evening.

## Constants
Fitted on the fit half (the same ids as `engine/lab/split`: per installer, ids sorted, shuffled with numpy `default_rng(42)`, first half), 654 new-system jobs. Four fitted, one textbook default that the data cannot fit.

| Constant | 2a8ba8e2 / 23c108b7 | Source |
|---|---|---|
| `pv_base_kwp` | 4.95 / 11.7 kWp | fitted with the ratio, most PV within tolerance |
| `oversize_ratio` | 0.95 / 0.0 | fitted with the base; 23c108b7 sells one array whatever the use |
| `battery_per_kwp` | 0.80 / 0.85 kWh per kWp | fitted given rule 1's PV |
| `battery_packages` | sizes sold 3 or more times | fit half; the engine passes the packages on sale at the offer date |
| `boiler_age_years` | 20 | not in the data; boilers are replaced at 20 to 30 years, GEG 72 caps most at 30 |

Textbook: 450 W modules; evening share 0.52 (BDEW H25 load in hours with no PV on the PVGIS Munich TMY); 2,300 full-load hours (VDI 4645 1,800 to 2,400, installer median); 12 ct per kWh of gas or oil heat; DC/AC 0.85; 11 kW wallbox (registration only, 22 kW needs approval).

## Score (within tolerance: PV ±1 kWp or ±15%, battery ±2 kWh, decisions exact)
| Set | PV | Battery | All four |
|---|---|---|---|
| Test half, 633 new-system jobs | 40.0% | 47.9% | 17.9% |
| 2a8ba8e2 / 23c108b7 | 38.2% / 45.1% | 44.2% / 58.6% | 14.2% / 28.4% |
| Engine's 258 held-out board (half seen in the fit) | 38.0% | 49.2% | 20.9% |
| Board and test half, 126 homes | 38.9% | 50.0% | 23.8% |

Wallbox 78.8% on the test half; heat pump not headlined (13 sold in the pack).

## Interface
`recommend(inputs, catalogue=None, overrides=None, roof=None, constants=None) -> {design, components, explanation, rules, version}`. `overrides`: a number fixes a size, null fixes none, "include" asks for it; the battery re-sizes around a fixed PV. `constants`: a `calibrate(fit_df)` result in place of `constants.json`.
