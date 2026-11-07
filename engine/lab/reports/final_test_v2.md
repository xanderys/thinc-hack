# FINAL v2: second look at the test half (first look was rules-4)

Engines: rules-4 6c3b46b, rules-3-band 6c3b46b, rules-1 calibrated 6c3b46b (all calibrated on the full fit half, 786 homes), physics 6c3b46b (no calibration), black box as live, textbook. Populations: test half new-system (633 homes) and the clean 126 (126 homes: 258 board and test half). Black box is scored only on homes it never trained on: 126 of 633 on the test half and 126 of 126 on the clean 126. Projects with more than one expert option: 119 of 633 (test half), 26 of 126 (clean 126).

Bands. Ours: PV 1 kWp or 15%, battery 2 kWh. Reonic-style, **pending the expert's answer**: PV as ours, battery within one package step of the installer's own sold sizes (each design snapped to its own installer's sizes, never pooled), wallbox decision only. Heat pump is the decision in both. Any offered option: the same option must satisfy all four.

## test half: lowest option, ours

| Engine | n | PV | Battery | Wallbox | All four | Heat pump |
|---|---|---|---|---|---|---|
| rules-5 (64fa451) | 633 | 41.4% | 48.7% | 78.7% | 19.6% | 99.5% |
| rules-5 textbook (no corrections) | 633 | 13.3% | 37.6% | 78.7% | 3.9% | 99.5% |
| rules-4 (6c3b46b) | 633 | 40.9% | 50.1% | 78.8% | 18.6% | 99.5% |
| rules-3-band | 633 | 41.4% | 50.7% | 78.8% | 20.9% | 99.5% |
| rules-1 | 633 | 40.0% | 47.9% | 78.8% | 17.9% | 99.5% |
| black box | 126 | 34.9% | 48.4% | 79.4% | 19.0% | 98.4% |
| textbook | 633 | 19.4% | 43.6% | 78.7% | 6.8% | 99.5% |

## test half: lowest option, Reonic-style (pending the expert answer)

| Engine | n | PV | Battery | Wallbox | All four | Heat pump |
|---|---|---|---|---|---|---|
| rules-5 (64fa451) | 633 | 41.4% | 41.4% | 78.7% | 15.6% | 99.5% |
| rules-5 textbook (no corrections) | 633 | 13.3% | 37.8% | 78.7% | 4.1% | 99.5% |
| rules-4 (6c3b46b) | 633 | 40.9% | 48.5% | 78.8% | 17.5% | 99.5% |
| rules-3-band | 633 | 41.4% | 46.4% | 78.8% | 18.2% | 99.5% |
| rules-1 | 633 | 40.0% | 40.8% | 78.8% | 13.9% | 99.5% |
| black box | 126 | 34.9% | 49.2% | 79.4% | 19.0% | 98.4% |
| textbook | 633 | 19.4% | 41.5% | 78.7% | 6.6% | 99.5% |

## test half: any offered option, ours

| Engine | n | PV | Battery | Wallbox | All four | Heat pump |
|---|---|---|---|---|---|---|
| rules-5 (64fa451) | 633 | 42.7% | 50.4% | 79.0% | 21.0% | 99.7% |
| rules-5 textbook (no corrections) | 633 | 14.1% | 39.0% | 79.0% | 4.3% | 99.7% |
| rules-4 (6c3b46b) | 633 | 42.2% | 52.4% | 79.1% | 19.7% | 99.7% |
| rules-3-band | 633 | 42.2% | 52.9% | 79.1% | 22.1% | 99.7% |
| rules-1 | 633 | 41.1% | 50.2% | 79.1% | 18.8% | 99.7% |
| black box | 126 | 36.5% | 49.2% | 79.4% | 19.8% | 100.0% |
| textbook | 633 | 19.6% | 46.3% | 79.0% | 7.7% | 99.7% |

## test half: any offered option, Reonic-style (pending the expert answer)

| Engine | n | PV | Battery | Wallbox | All four | Heat pump |
|---|---|---|---|---|---|---|
| rules-5 (64fa451) | 633 | 42.7% | 43.3% | 79.0% | 17.2% | 99.7% |
| rules-5 textbook (no corrections) | 633 | 14.1% | 39.3% | 79.0% | 4.4% | 99.7% |
| rules-4 (6c3b46b) | 633 | 42.2% | 50.7% | 79.1% | 18.6% | 99.7% |
| rules-3-band | 633 | 42.2% | 48.8% | 79.1% | 19.6% | 99.7% |
| rules-1 | 633 | 41.1% | 42.8% | 79.1% | 15.0% | 99.7% |
| black box | 126 | 36.5% | 50.0% | 79.4% | 19.8% | 100.0% |
| textbook | 633 | 19.6% | 44.2% | 79.0% | 7.6% | 99.7% |

## clean 126: lowest option, ours

| Engine | n | PV | Battery | Wallbox | All four | Heat pump |
|---|---|---|---|---|---|---|
| rules-5 (64fa451) | 126 | 39.7% | 50.8% | 79.4% | 22.2% | 99.2% |
| rules-5 textbook (no corrections) | 126 | 11.1% | 38.1% | 79.4% | 4.8% | 99.2% |
| rules-4 (6c3b46b) | 126 | 42.1% | 50.8% | 79.4% | 23.0% | 99.2% |
| rules-3-band | 126 | 43.7% | 49.2% | 79.4% | 23.8% | 99.2% |
| rules-1 | 126 | 38.9% | 50.0% | 79.4% | 23.8% | 99.2% |
| black box | 126 | 34.9% | 48.4% | 79.4% | 19.0% | 98.4% |
| textbook | 126 | 18.3% | 47.6% | 79.4% | 6.3% | 99.2% |

## clean 126: lowest option, Reonic-style (pending the expert answer)

| Engine | n | PV | Battery | Wallbox | All four | Heat pump |
|---|---|---|---|---|---|---|
| rules-5 (64fa451) | 126 | 39.7% | 41.3% | 79.4% | 15.9% | 99.2% |
| rules-5 textbook (no corrections) | 126 | 11.1% | 38.9% | 79.4% | 4.8% | 99.2% |
| rules-4 (6c3b46b) | 126 | 42.1% | 50.0% | 79.4% | 20.6% | 99.2% |
| rules-3-band | 126 | 43.7% | 44.4% | 79.4% | 21.4% | 99.2% |
| rules-1 | 126 | 38.9% | 42.1% | 79.4% | 15.9% | 99.2% |
| black box | 126 | 34.9% | 49.2% | 79.4% | 19.0% | 98.4% |
| textbook | 126 | 18.3% | 46.0% | 79.4% | 6.3% | 99.2% |

## clean 126: any offered option, ours

| Engine | n | PV | Battery | Wallbox | All four | Heat pump |
|---|---|---|---|---|---|---|
| rules-5 (64fa451) | 126 | 40.5% | 51.6% | 79.4% | 23.0% | 100.0% |
| rules-5 textbook (no corrections) | 126 | 11.9% | 38.9% | 79.4% | 4.8% | 100.0% |
| rules-4 (6c3b46b) | 126 | 43.7% | 52.4% | 79.4% | 23.0% | 100.0% |
| rules-3-band | 126 | 44.4% | 50.8% | 79.4% | 24.6% | 100.0% |
| rules-1 | 126 | 39.7% | 51.6% | 79.4% | 23.8% | 100.0% |
| black box | 126 | 36.5% | 49.2% | 79.4% | 19.8% | 100.0% |
| textbook | 126 | 18.3% | 49.2% | 79.4% | 7.9% | 100.0% |

## clean 126: any offered option, Reonic-style (pending the expert answer)

| Engine | n | PV | Battery | Wallbox | All four | Heat pump |
|---|---|---|---|---|---|---|
| rules-5 (64fa451) | 126 | 40.5% | 42.1% | 79.4% | 16.7% | 100.0% |
| rules-5 textbook (no corrections) | 126 | 11.9% | 39.7% | 79.4% | 4.8% | 100.0% |
| rules-4 (6c3b46b) | 126 | 43.7% | 50.8% | 79.4% | 20.6% | 100.0% |
| rules-3-band | 126 | 44.4% | 46.0% | 79.4% | 22.2% | 100.0% |
| rules-1 | 126 | 39.7% | 42.9% | 79.4% | 15.9% | 100.0% |
| black box | 126 | 36.5% | 50.0% | 79.4% | 19.8% | 100.0% |
| textbook | 126 | 18.3% | 47.6% | 79.4% | 7.9% | 100.0% |

## Paired McNemar, rules-5 (64fa451) against the others, all four, ours band

| Population | Ground truth | Against | Homes | Only rules-5 | Only other | Exact p |
|---|---|---|---|---|---|---|
| test half | lowest option | rules-4 | 633 | 49 | 43 | 0.602 |
| test half | lowest option | rules-1 | 633 | 43 | 32 | 0.248 |
| test half | lowest option | black box | 126 | 12 | 8 | 0.503 |
| test half | any offered option | rules-4 | 633 | 53 | 45 | 0.480 |
| test half | any offered option | rules-1 | 633 | 46 | 32 | 0.141 |
| test half | any offered option | black box | 126 | 13 | 9 | 0.523 |
| clean 126 | lowest option | rules-4 | 126 | 8 | 9 | 1.000 |
| clean 126 | lowest option | rules-1 | 126 | 6 | 8 | 0.791 |
| clean 126 | lowest option | black box | 126 | 12 | 8 | 0.503 |
| clean 126 | any offered option | rules-4 | 126 | 9 | 9 | 1.000 |
| clean 126 | any offered option | rules-1 | 126 | 7 | 8 | 1.000 |
| clean 126 | any offered option | black box | 126 | 13 | 9 | 0.523 |


## Verdict

Final v2, second look at the test half; the first look was rules-4 (`final_test.md`). Rules-5 (64fa451, calibrated on the full fit half) against rules-4 on the same 633 test homes, lowest option, ours band: PV 41.4% vs 40.9% (+0.5 pp), all four 19.6% vs 18.6% (+1.0 pp), paired McNemar p = 0.60. On the fit-half nested 5-fold CV rules-5 is below rules-4: PV 36.9% vs 40.7% (-3.8 pp, p = 0.060), all four 15.9% vs 17.4% (-1.5 pp, p = 0.38; `iteration_64fa451.md`). Production flips only if PV or all four beats rules-4 beyond noise (p < 0.05 and above 2.5 points) on both nested CV and test: neither does, so production stays rules-4. In the package-step band rules-5 is worse on the test half (battery 41.4% vs 48.5%, all four 15.6% vs 17.5%), because its battery sizes are not the installer's packages.
