# FINAL test-half score (run once)

Engines: rules-4 6c3b46b, rules-3-band 6c3b46b, rules-1 calibrated 6c3b46b (all calibrated on the full fit half, 786 homes), physics 6c3b46b (no calibration), black box as live, textbook. Populations: test half new-system (633 homes) and the clean 126 (126 homes: 258 board and test half). Black box is scored only on homes it never trained on: 126 of 633 on the test half and 126 of 126 on the clean 126. Projects with more than one expert option: 119 of 633 (test half), 26 of 126 (clean 126).

Bands. Ours: PV 1 kWp or 15%, battery 2 kWh. Reonic-style, **pending the expert's answer**: PV as ours, battery within one package step of the installer's own sold sizes (each design snapped to its own installer's sizes, never pooled), wallbox decision only. Heat pump is the decision in both. Any offered option: the same option must satisfy all four.

## test half: lowest option, ours

| Engine | n | PV | Battery | Wallbox | All four | Heat pump |
|---|---|---|---|---|---|---|
| rules-4 | 633 | 40.9% | 50.1% | 78.8% | 18.6% | 99.5% |
| rules-4 leaf default (445656e) | 633 | 42.0% | 48.3% | 78.8% | 19.9% | 99.5% |
| rules-3-band | 633 | 41.4% | 50.7% | 78.8% | 20.9% | 99.5% |
| rules-1 | 633 | 40.0% | 47.9% | 78.8% | 17.9% | 99.5% |
| physics | 633 | 22.1% | 23.9% | 78.8% | 7.4% | 99.2% |
| black box | 126 | 34.9% | 48.4% | 79.4% | 19.0% | 98.4% |
| textbook | 633 | 19.4% | 43.6% | 78.7% | 6.8% | 99.5% |

## test half: lowest option, Reonic-style (pending the expert answer)

| Engine | n | PV | Battery | Wallbox | All four | Heat pump |
|---|---|---|---|---|---|---|
| rules-4 | 633 | 40.9% | 48.5% | 78.8% | 17.5% | 99.5% |
| rules-4 leaf default (445656e) | 633 | 42.0% | 50.7% | 78.8% | 19.4% | 99.5% |
| rules-3-band | 633 | 41.4% | 46.4% | 78.8% | 18.2% | 99.5% |
| rules-1 | 633 | 40.0% | 40.8% | 78.8% | 13.9% | 99.5% |
| physics | 633 | 22.1% | 24.6% | 78.8% | 7.1% | 99.2% |
| black box | 126 | 34.9% | 49.2% | 79.4% | 19.0% | 98.4% |
| textbook | 633 | 19.4% | 41.5% | 78.7% | 6.6% | 99.5% |

## test half: any offered option, ours

| Engine | n | PV | Battery | Wallbox | All four | Heat pump |
|---|---|---|---|---|---|---|
| rules-4 | 633 | 42.2% | 52.4% | 79.1% | 19.7% | 99.7% |
| rules-4 leaf default (445656e) | 633 | 43.1% | 50.7% | 79.1% | 20.9% | 99.7% |
| rules-3-band | 633 | 42.2% | 52.9% | 79.1% | 22.1% | 99.7% |
| rules-1 | 633 | 41.1% | 50.2% | 79.1% | 18.8% | 99.7% |
| physics | 633 | 22.7% | 25.4% | 79.1% | 7.7% | 99.4% |
| black box | 126 | 36.5% | 49.2% | 79.4% | 19.8% | 100.0% |
| textbook | 633 | 19.6% | 46.3% | 79.0% | 7.7% | 99.7% |

## test half: any offered option, Reonic-style (pending the expert answer)

| Engine | n | PV | Battery | Wallbox | All four | Heat pump |
|---|---|---|---|---|---|---|
| rules-4 | 633 | 42.2% | 50.7% | 79.1% | 18.6% | 99.7% |
| rules-4 leaf default (445656e) | 633 | 43.1% | 52.9% | 79.1% | 20.7% | 99.7% |
| rules-3-band | 633 | 42.2% | 48.8% | 79.1% | 19.6% | 99.7% |
| rules-1 | 633 | 41.1% | 42.8% | 79.1% | 15.0% | 99.7% |
| physics | 633 | 22.7% | 26.2% | 79.1% | 7.7% | 99.4% |
| black box | 126 | 36.5% | 50.0% | 79.4% | 19.8% | 100.0% |
| textbook | 633 | 19.6% | 44.2% | 79.0% | 7.6% | 99.7% |

## clean 126: lowest option, ours

| Engine | n | PV | Battery | Wallbox | All four | Heat pump |
|---|---|---|---|---|---|---|
| rules-4 | 126 | 42.1% | 50.8% | 79.4% | 23.0% | 99.2% |
| rules-4 leaf default (445656e) | 126 | 43.7% | 48.4% | 79.4% | 24.6% | 99.2% |
| rules-3-band | 126 | 43.7% | 49.2% | 79.4% | 23.8% | 99.2% |
| rules-1 | 126 | 38.9% | 50.0% | 79.4% | 23.8% | 99.2% |
| physics | 126 | 23.8% | 23.8% | 79.4% | 7.1% | 99.2% |
| black box | 126 | 34.9% | 48.4% | 79.4% | 19.0% | 98.4% |
| textbook | 126 | 18.3% | 47.6% | 79.4% | 6.3% | 99.2% |

## clean 126: lowest option, Reonic-style (pending the expert answer)

| Engine | n | PV | Battery | Wallbox | All four | Heat pump |
|---|---|---|---|---|---|---|
| rules-4 | 126 | 42.1% | 50.0% | 79.4% | 20.6% | 99.2% |
| rules-4 leaf default (445656e) | 126 | 43.7% | 50.0% | 79.4% | 23.0% | 99.2% |
| rules-3-band | 126 | 43.7% | 44.4% | 79.4% | 21.4% | 99.2% |
| rules-1 | 126 | 38.9% | 42.1% | 79.4% | 15.9% | 99.2% |
| physics | 126 | 23.8% | 23.0% | 79.4% | 7.1% | 99.2% |
| black box | 126 | 34.9% | 49.2% | 79.4% | 19.0% | 98.4% |
| textbook | 126 | 18.3% | 46.0% | 79.4% | 6.3% | 99.2% |

## clean 126: any offered option, ours

| Engine | n | PV | Battery | Wallbox | All four | Heat pump |
|---|---|---|---|---|---|---|
| rules-4 | 126 | 43.7% | 52.4% | 79.4% | 23.0% | 100.0% |
| rules-4 leaf default (445656e) | 126 | 45.2% | 50.0% | 79.4% | 24.6% | 100.0% |
| rules-3-band | 126 | 44.4% | 50.8% | 79.4% | 24.6% | 100.0% |
| rules-1 | 126 | 39.7% | 51.6% | 79.4% | 23.8% | 100.0% |
| physics | 126 | 23.8% | 25.4% | 79.4% | 7.1% | 100.0% |
| black box | 126 | 36.5% | 49.2% | 79.4% | 19.8% | 100.0% |
| textbook | 126 | 18.3% | 49.2% | 79.4% | 7.9% | 100.0% |

## clean 126: any offered option, Reonic-style (pending the expert answer)

| Engine | n | PV | Battery | Wallbox | All four | Heat pump |
|---|---|---|---|---|---|---|
| rules-4 | 126 | 43.7% | 50.8% | 79.4% | 20.6% | 100.0% |
| rules-4 leaf default (445656e) | 126 | 45.2% | 50.8% | 79.4% | 23.0% | 100.0% |
| rules-3-band | 126 | 44.4% | 46.0% | 79.4% | 22.2% | 100.0% |
| rules-1 | 126 | 39.7% | 42.9% | 79.4% | 15.9% | 100.0% |
| physics | 126 | 23.8% | 24.6% | 79.4% | 7.1% | 100.0% |
| black box | 126 | 36.5% | 50.0% | 79.4% | 19.8% | 100.0% |
| textbook | 126 | 18.3% | 47.6% | 79.4% | 7.9% | 100.0% |

## Paired McNemar, rules-4 against the others, all four, ours band

| Population | Ground truth | Against | Homes | Only rules-4 | Only other | Exact p |
|---|---|---|---|---|---|---|
| test half | lowest option | rules-1 | 633 | 41 | 36 | 0.649 |
| test half | lowest option | black box | 126 | 11 | 6 | 0.332 |
| test half | any offered option | rules-1 | 633 | 43 | 37 | 0.576 |
| test half | any offered option | black box | 126 | 11 | 7 | 0.481 |
| clean 126 | lowest option | rules-1 | 126 | 8 | 9 | 1.000 |
| clean 126 | lowest option | black box | 126 | 11 | 6 | 0.332 |
| clean 126 | any offered option | rules-1 | 126 | 8 | 9 | 1.000 |
| clean 126 | any offered option | black box | 126 | 11 | 7 | 0.481 |

## Deviation quality (hourly simulation at 6c3b46b, money NPV)

Homes where the engine's PV, battery or wallbox is outside tolerance of the lowest-option expert design. Both designs run through the same simulate().

| Engine | Population | Differ | NPV ours / expert | Payback ours / expert | Autarky ours / expert |
|---|---|---|---|---|---|
| rules-4 | test half | 514 (514 simulated) | 327 / 180 | 299 / 205 | 264 / 247 |
| rules-4 | clean 126 | 97 (97 simulated) | 63 / 32 | 59 / 36 | 45 / 50 |
| physics | test half | 584 (584 simulated) | 293 / 287 | 131 / 449 | 512 / 69 |
| physics | clean 126 | 117 (117 simulated) | 63 / 52 | 30 / 86 | 97 / 18 |

Medians over the simulated homes, ours vs expert:

| Engine | Population | NPV gain, EUR | Payback, years | Autarky | Battery, kWh |
|---|---|---|---|---|---|
| rules-4 | test half | +430 | 10.5 vs 10.6 | 74% vs 69% | 9.2 vs 9.0 |
| rules-4 | clean 126 | +420 | 11.0 vs 11.1 | 76% vs 72% | 9.2 vs 9.0 |
| physics | test half | +60 | 11.6 vs 10.4 | 86% vs 69% | 14.0 vs 9.0 |
| physics | clean 126 | +140 | 11.6 vs 10.6 | 86% vs 71% | 14.0 vs 9.0 |

Run once, 289 s.

Correction: the two test-half McNemar p-values against rules-1 were printed as 1.000 by an integer overflow in the harness (counts above 60 discordant pairs). They are recomputed here from the same counts; no score changed. The harness now casts counts to int.
