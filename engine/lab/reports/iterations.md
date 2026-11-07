# rules-2 and rules-3 iterations, fit half only

Population: 654 new-system jobs of the fit half (test half sealed). Reference lines on the same 654: rules-1 calibrated (in-sample, fitted on this half) 41.0 / 49.2 / 74.8 / 17.7% (PV / battery / wallbox / all four); black box 41.4 / 52.0 / 74.8 / 18.7% in-sample (not comparable), 40.2 / 49.2 / 72.0 / 15.2% on the 132 homes it did not train on; textbook 20.0 / 46.2 / 74.8 / 6.4%. Deviation: homes where PV, battery or wallbox is outside tolerance, both designs through simulate() at the row's own ref; NPV is money only.

| Revision | What changed | PV | Battery | Wallbox | All four | Deviation vs expert (differing homes) |
|---|---|---|---|---|---|---|
| c1bf388 | rules-2 first principles, first push: knee of the cost-to-value frontier from hourly physics and sourced 2026 prices, no fitted constants. Sourced throughout. Two small assumptions have no source in the table: the 30 kWp cap on the default roof and the 15 degree flat-roof rack tilt (comment only). The load scatter is fitted to HTW's published tables, not to installers | 29.5% | 30.4% | 74.8% | 8.4% | n=598. NPV ours better 568, expert 12. Payback ours 447, expert 135. Autarky ours 181, expert 417. Medians: NPV +EUR 1,430, payback 11.4 vs 12.6 y, autarky 66% vs 72%, battery 5.0 vs 10.0 kWh |
| 1019bbe (code fc6dae2) | no heat pump while the year's heat is only a default; heat load from demand, bill, then envelope. Structural. Docs-only on top | 29.5% | 30.4% | 74.8% | 8.4% | identical to c1bf388 (heat pump only changed; 99.2% either way) |
| e0a7c78 | battery price 500 to 315 EUR/kWh, BSW Solar 2026 market average. Cited in docs/rules.md at that ref, but only second-hand via a reduco.ai page (range 270 to 420); the BSW primary is not linked. Sourced, secondary | 30.3% | 39.1% | 74.8% | 9.5% | n=591. NPV ours 576, expert 9. Payback ours 379, expert 201. Autarky ours 304, expert 283. Medians: NPV +EUR 1,160, payback 10.6 vs 11.0 y, autarky 73% vs 72%, battery 9.2 vs 10.0 kWh |
| 0be7e44 | independence premium of 29 ct per self-supplied kWh in the value the knee maximises (money NPV unchanged). Source: Kaps and Netessine, Operations Research (DOI 10.1287/opre.2024.1104, [link](https://pubsonline.informs.org/doi/full/10.1287/opre.2024.1104)). A web search confirms the paper exists, in Operations Research, on Solarwatt data for 3,200 German households, with a median nonmarket valuation of 0.29 EUR per kWh. Two flags: the sources I found name Kaps and Netessine, not Marinesi (his name appears only as a committee member of Kaps's thesis), and one index lists it as 2025, not 2024. Citation holds for the figure, author list and year need fixing. It moves designs toward installer habit (larger battery, higher autarky) but overshoots | 21.9% | 22.0% | 74.8% | 5.7% | n=615. NPV ours 327, expert 287 (money NPV falls from 98% better to 53%). Payback ours 158, expert 450. Autarky ours 524, expert 88. Medians: NPV +EUR 100, payback 11.7 vs 10.8 y, autarky 86% vs 71%, battery 14.0 vs 10.0 kWh |
| 9837777 (rules-3-band) | per installer and use band, the most common design (fitted constants, allowed). Paired 5-fold CV inside the fit half, stratified by installer, rules-1 on the same folds. See below | 39.6% | 48.9% | 74.8% | 17.7% | not simulated (quick) |

## rules-3-band against rules-1, paired 5-fold CV inside the fit half (654 jobs)

| Fold seed | Rule | PV | Battery | Wallbox | All four | Only rules-3 hits | Only rules-1 hits | McNemar p (exact) | Paired bootstrap 95% CI, rules-3 minus rules-1 (2,000 resamples) |
|---|---|---|---|---|---|---|---|---|---|
| 42 | rules-3 | 39.6% | 48.9% | 74.8% | 17.7% | 45 | 38 | 0.510 | -1.7 to +3.8 pp |
| 42 | rules-1 | 36.5% | 46.2% | 74.8% | 16.7% | | | | |
| 1 | rules-3 | 40.4% | 49.2% | 74.8% | 19.0% | 42 | 29 | 0.154 | -0.6 to +4.6 pp |
| 1 | rules-1 | 37.8% | 47.7% | 74.8% | 17.0% | | | | |
| 2 | rules-3 | 37.8% | 48.2% | 74.8% | 16.8% | 30 | 28 | 0.896 | -2.0 to +2.6 pp |
| 2 | rules-1 | 37.9% | 47.9% | 74.8% | 16.5% | | | | |

Verdict: noise. The all-four gain is +0.3 to +2.0 points, every interval includes zero, and the sign and size move with the fold seed. PHYSICS' own 18.0% vs 16.2% sits inside that spread.

Run time per row: the rows ran in parallel; the deviation simulation (about 640 homes, 4 to 6 minutes under load 20) is the slow part, so `--quick` skips it. Command: `cd engine && uv run python -m lab.score_rules --physics-ref <sha> [--quick]` and `uv run python -m lab.cv_rules3 --ref <sha>`.
