# Rules scoreboard

Split: fit 786, test 784 (seed 42 per installer, lab/split); new-system scope on the test half: 633; board: 258. Tolerances as the engine scoreboard (PV max(1 kWp, 15%), battery 2 kWh, wallbox and heat pump on the decision).

| Line | Population | n | PV | Battery | Wallbox | All four | Heat pump |
|---|---|---|---|---|---|---|---|
| formula (rules) | test half (new-system) | 633 | 40.0% | 47.9% | 78.8% | 17.9% | 99.5% |
| black box (chain) | test half, homes the chain did not train on | 126 | 34.9% | 48.4% | 79.4% | 19.0% | 98.4% |
| textbook | test half (new-system) | 633 | 19.4% | 43.6% | 78.7% | 6.8% | 99.5% |
| formula (rules) | 258 board (new-system) | 258 | 38.0% | 49.2% | 75.6% | 20.9% | 98.8% |
| black box (chain) | 258 board | 258 | 37.6% | 48.8% | 75.6% | 17.1% | 98.4% |
| textbook | 258 board (new-system) | 258 | 17.8% | 47.7% | 75.6% | 6.6% | 98.8% |
| formula (rules) | board and test half | 126 | 38.9% | 50.0% | 79.4% | 23.8% | 99.2% |
| black box (chain) | board and test half | 126 | 34.9% | 48.4% | 79.4% | 19.0% | 98.4% |
| textbook | board and test half | 126 | 18.3% | 47.6% | 79.4% | 6.3% | 99.2% |

## Deviation analysis (hourly simulation, formula vs expert)

Homes where PV, battery or wallbox is outside tolerance. Payback: lower is better, no payback is worst. Autarky: higher is better.

| Population | Differ | Simulated | Payback ours | Payback expert | Payback tie | Autarky ours | Autarky expert | Autarky tie |
|---|---|---|---|---|---|---|---|---|
| test half | 519 | 519 | 277 | 233 | 9 | 315 | 200 | 4 |
| 258 board | 204 | 204 | 124 | 77 | 3 | 111 | 90 | 3 |


Fitted constants (fit half only):

- 2a8ba8e2: {'oversize_ratio': 0.95, 'pv_base_kwp': 4.95, 'battery_per_kwp': 0.8, 'battery_packages': [4.6, 5.0, 7.0, 9.2, 10.0, 14.0, 15.0, 20.0, 21.0]}
- 23c108b7: {'oversize_ratio': 0.0, 'pv_base_kwp': 11.7, 'battery_per_kwp': 0.85, 'battery_packages': [5.0, 6.0, 9.0, 9.84, 10.0, 12.0, 15.0, 18.0]}

Black box on the test half is scored only on 126 homes it did not train on; the rest are in its train split.
