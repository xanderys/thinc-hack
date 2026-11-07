# Iteration score, rules-5 64fa451 (fit half only)

654 new-system fit-half jobs, 5-fold CV (fold seed 42); rules and black box out-of-fold, rule of thumb has no fitting. Test half not read. 136 of 654 projects have more than one expert option. A gain under 2.5 points over rules-4 is marked noise.

## lowest option, ours band

| Engine | PV | Battery | Wallbox | All four | vs rules-4, all four | Heat pump |
|---|---|---|---|---|---|---|
| rules-5 (64fa451) | 36.9% | 48.9% | 74.8% | 15.9% | -1.5 pp (noise) | 99.2% |
| rules-4 (6c3b46b) | 40.7% | 46.9% | 74.8% | 17.4% |  | 99.2% |
| black box (out-of-fold) | 36.5% | 49.5% | 74.8% | 15.3% | -2.1 pp (noise) | 99.2% |
| pure Reonic textbook | 11.5% | 32.7% | 74.8% | 5.4% | -12.1 pp | 99.2% |
| rule of thumb (1.3 kWp/MWh + 2.5 EV) | 19.6% | 46.2% | 74.8% | 6.4% | -11.0 pp | 99.2% |

Paired against rules-4, all four: only rules-5 47, only rules-4 57, exact McNemar p = 0.378; difference -1.5 pp, 95% CI -4.4 to +1.5 (2,000 bootstrap resamples).
PV: only rules-5 69, only rules-4 94, exact McNemar p = 0.060; difference -3.8 pp, 95% CI -7.5 to +0.2.

## lowest option, package step band (pending the expert's answer)

| Engine | PV | Battery | Wallbox | All four | vs rules-4, all four | Heat pump |
|---|---|---|---|---|---|---|
| rules-5 (64fa451) | 36.9% | 45.4% | 74.8% | 13.3% | -3.1 pp | 99.2% |
| rules-4 (6c3b46b) | 40.7% | 45.0% | 74.8% | 16.4% |  | 99.2% |
| black box (out-of-fold) | 36.5% | 45.9% | 74.8% | 12.8% | -3.5 pp | 99.2% |
| pure Reonic textbook | 11.5% | 33.2% | 74.8% | 5.7% | -10.7 pp | 99.2% |
| rule of thumb (1.3 kWp/MWh + 2.5 EV) | 19.6% | 43.3% | 74.8% | 6.3% | -10.1 pp | 99.2% |

Paired against rules-4, all four: only rules-5 35, only rules-4 55, exact McNemar p = 0.045; difference -3.1 pp, 95% CI -5.8 to -0.2 (2,000 bootstrap resamples).
PV: only rules-5 69, only rules-4 94, exact McNemar p = 0.060; difference -3.8 pp, 95% CI -7.5 to +0.2.

## any offered option, ours band

| Engine | PV | Battery | Wallbox | All four | vs rules-4, all four | Heat pump |
|---|---|---|---|---|---|---|
| rules-5 (64fa451) | 38.7% | 51.8% | 75.2% | 17.6% | -1.7 pp (noise) | 99.7% |
| rules-4 (6c3b46b) | 42.2% | 49.5% | 75.2% | 19.3% |  | 99.7% |
| black box (out-of-fold) | 38.1% | 51.8% | 75.2% | 16.7% | -2.6 pp | 99.7% |
| pure Reonic textbook | 11.9% | 34.9% | 75.2% | 6.0% | -13.3 pp | 99.7% |
| rule of thumb (1.3 kWp/MWh + 2.5 EV) | 20.5% | 48.6% | 75.2% | 6.7% | -12.5 pp | 99.7% |

Paired against rules-4, all four: only rules-5 51, only rules-4 62, exact McNemar p = 0.347; difference -1.7 pp, 95% CI -4.7 to +1.4 (2,000 bootstrap resamples).
PV: only rules-5 70, only rules-4 93, exact McNemar p = 0.085; difference -3.5 pp, 95% CI -7.2 to +0.5.

## any offered option, package step band (pending the expert's answer)

| Engine | PV | Battery | Wallbox | All four | vs rules-4, all four | Heat pump |
|---|---|---|---|---|---|---|
| rules-5 (64fa451) | 38.7% | 47.6% | 75.2% | 15.0% | -3.1 pp | 99.7% |
| rules-4 (6c3b46b) | 42.2% | 46.6% | 75.2% | 18.0% |  | 99.7% |
| black box (out-of-fold) | 38.1% | 48.0% | 75.2% | 14.4% | -3.7 pp | 99.7% |
| pure Reonic textbook | 11.9% | 35.2% | 75.2% | 6.3% | -11.8 pp | 99.7% |
| rule of thumb (1.3 kWp/MWh + 2.5 EV) | 20.5% | 45.7% | 75.2% | 6.6% | -11.5 pp | 99.7% |

Paired against rules-4, all four: only rules-5 39, only rules-4 59, exact McNemar p = 0.054; difference -3.1 pp, 95% CI -6.0 to -0.2 (2,000 bootstrap resamples).
PV: only rules-5 70, only rules-4 93, exact McNemar p = 0.085; difference -3.5 pp, 95% CI -7.2 to +0.5.


Run 89 s. Per-rule support: `rule_support_64fa451.md`.
