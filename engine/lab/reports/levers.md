# Levers: which definition of right moves the score

Fit half only, 654 new-system jobs, 5-fold CV (fold seed 42). Rules and black box are out-of-fold; physics c1bf388 and textbook have no fitting. Test half not read.

Projects with more than one expert option: 136 of 654 (20.8%); with options that differ in PV, battery, wallbox or heat pump: 98 of 654 (15.0%).

Bands. Ours: PV 1 kWp or 15%, battery 2 kWh, wallbox and heat pump on the decision. Reonic-style, pending the expert's answer: PV as ours, battery within one installer package step (the installer's sold battery sizes in the fit-half options; our size snaps to the nearest sold size and an adjacent step counts), wallbox decision only.
Any option: a hit if within tolerance of at least one option the expert offered for that project. All four under any option needs the SAME option to satisfy all four components; the looser per-component-any version is in the footnote of each block.

## lowest option, ours

| Engine | PV | Battery | Wallbox | All four | Heat pump |
|---|---|---|---|---|---|
| rules-1 | 36.5% | 46.2% | 74.8% | 16.7% | 99.2% |
| rules-3 | 39.6% | 48.9% | 74.8% | 17.7% | 99.2% |
| rules-4 | 40.2% | 49.1% | 74.8% | 17.6% | 99.2% |
| physics | 29.5% | 30.4% | 74.8% | 8.4% | 99.2% |
| black box (out-of-fold) | 36.5% | 49.5% | 74.8% | 15.3% | 99.2% |
| textbook | 19.6% | 46.2% | 74.8% | 6.4% | 99.2% |

## lowest option, Reonic-style (pending)

| Engine | PV | Battery | Wallbox | All four | Heat pump |
|---|---|---|---|---|---|
| rules-1 | 36.5% | 42.4% | 74.8% | 14.1% | 99.2% |
| rules-3 | 39.6% | 44.8% | 74.8% | 15.3% | 99.2% |
| rules-4 | 40.2% | 49.8% | 74.8% | 17.6% | 99.2% |
| physics | 29.5% | 30.7% | 74.8% | 8.3% | 99.2% |
| black box (out-of-fold) | 36.5% | 45.9% | 74.8% | 12.8% | 99.2% |
| textbook | 19.6% | 43.3% | 74.8% | 6.3% | 99.2% |

## any option, ours

| Engine | PV | Battery | Wallbox | All four | Heat pump |
|---|---|---|---|---|---|
| rules-1 | 38.1% | 49.4% | 75.2% | 18.8% | 99.7% |
| rules-3 | 41.6% | 51.5% | 75.2% | 20.2% | 99.7% |
| rules-4 | 41.7% | 51.8% | 75.2% | 19.7% | 99.7% |
| physics | 30.9% | 33.2% | 75.2% | 9.8% | 99.5% |
| black box (out-of-fold) | 38.1% | 51.8% | 75.2% | 16.7% | 99.7% |
| textbook | 20.5% | 48.6% | 75.2% | 6.7% | 99.7% |

Footnote, per-component-any (each component may match a different option), all four: rules-1 19.4%; rules-3 20.5%; rules-4 20.0%; physics 9.8%; black box (out-of-fold) 16.7%; textbook 7.2%.

## any option, Reonic-style (pending)

| Engine | PV | Battery | Wallbox | All four | Heat pump |
|---|---|---|---|---|---|
| rules-1 | 38.1% | 44.8% | 75.2% | 16.1% | 99.7% |
| rules-3 | 41.6% | 47.6% | 75.2% | 17.7% | 99.7% |
| rules-4 | 41.7% | 51.4% | 75.2% | 19.6% | 99.7% |
| physics | 30.9% | 33.0% | 75.2% | 9.3% | 99.5% |
| black box (out-of-fold) | 38.1% | 48.0% | 75.2% | 14.4% | 99.7% |
| textbook | 20.5% | 45.7% | 75.2% | 6.6% | 99.7% |

Footnote, per-component-any (each component may match a different option), all four: rules-1 16.5%; rules-3 18.0%; rules-4 19.7%; physics 9.3%; black box (out-of-fold) 14.4%; textbook 7.0%.

Note: the Reonic-style battery band is not a superset of ours. Where the installer sells sizes closer than 2 kWh apart, one step is narrower than 2 kWh, so some engines score lower there (rules-1, rules-3, black box); rules-4 gains because its sizes are the installer's own package sizes.
