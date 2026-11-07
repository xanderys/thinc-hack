# Rules scoreboard, fit half

> Fit half only. The test half is not scored until PHYSICS declares final. Calibrated is fitted on this half, so its row is in-sample.

Split: fit 786, test 784 (seed 42 per installer, lab/split); new-system scope on the test half: 633; board: 258; both: 126. Tolerances as the engine scoreboard (PV max(1 kWp, 15%), battery 2 kWh, wallbox and heat pump on the decision).

| Line | Population | n | PV | Battery | Wallbox | All four | Heat pump |
|---|---|---|---|---|---|---|---|
| formula-physics (0be7e44, no calibration) | fit half (new-system) | 654 | 21.9% | 22.0% | 74.8% | 5.7% | 99.2% |
| formula-calibrated (1329cd2, fit half), in-sample, fitted on this half | fit half (new-system) | 654 | 41.0% | 49.2% | 74.8% | 17.7% | 99.2% |
| black box (chain), in-sample, not comparable | fit half (new-system) | 654 | 41.4% | 52.0% | 74.8% | 18.7% | 99.4% |
| black box (chain), homes it did not train on | 132 of the fit half | 132 | 40.2% | 49.2% | 72.0% | 15.2% | 98.5% |
| textbook | fit half (new-system) | 654 | 20.0% | 46.2% | 74.8% | 6.4% | 99.2% |

## Deviation analysis (hourly simulation, formula vs expert)

Homes where PV, battery or wallbox is outside tolerance. Both designs run through simulate() at the physics ref (formula-physics with its sim_inputs plane fill). Payback: lower is better, no payback is worst. Autarky: higher is better.

NPV is the 20-year value from simulate(); a gap under EUR 5 counts as a tie. Medians are over the simulated homes.

| Line | Population | Differ | Simulated | Payback ours | Payback expert | Payback tie | Autarky ours | Autarky expert | Autarky tie | NPV ours | NPV expert | NPV tie |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| formula-physics (0be7e44, no calibration) | fit half | 615 | 615 | 158 | 450 | 7 | 524 | 88 | 3 | 327 | 287 | 0 |
| formula-calibrated (1329cd2, fit half) | fit half | 537 | 537 | 337 | 191 | 9 | 311 | 225 | 1 | 412 | 122 | 2 |

Medians, ours vs expert:

| Line | NPV gain, EUR | Payback, years | Autarky | Battery, kWh | Sim failures |
|---|---|---|---|---|---|
| formula-physics (0be7e44, no calibration) | +100 | 11.7 vs 10.8 | 86% vs 71% | 14.0 vs 10.0 | 0 |
| formula-calibrated (1329cd2, fit half) | +690 | 10.8 vs 10.9 | 77% vs 71% | 9.2 vs 10.0 | 0 |

## Runtime per design (ms, formula only)

| Line | Designs | Median ms | Mean ms | p95 ms | Max ms | Calibrate |
|---|---|---|---|---|---|---|
| formula-physics (0be7e44, no calibration) | 654 | 461 | 483 | 643 | 5143 | none |
| formula-calibrated (1329cd2, fit half) | 654 | 0 | 20 | 0 | 12900 | 1 s |


Fitted constants (calibrated line, fit half only):

- 2a8ba8e2: {'oversize_ratio': 0.95, 'pv_base_kwp': 4.95, 'battery_per_kwp': 0.8, 'battery_packages': [4.6, 5.0, 7.0, 9.2, 10.0, 14.0, 15.0, 20.0, 21.0]}
- 23c108b7: {'oversize_ratio': 0.0, 'pv_base_kwp': 11.7, 'battery_per_kwp': 0.85, 'battery_packages': [5.0, 6.0, 9.0, 9.84, 10.0, 12.0, 15.0, 18.0]}

Black box on the fit half: 132 of 654 homes were outside its train split (out-of-sample); the all-homes row is in-sample.
