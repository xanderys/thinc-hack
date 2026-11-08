# Engine lab

Iterations on the engine, scored by `uv run python -m lab.cv` (5-fold CV inside the locked train split, stratified by installer, seed 42; sizes only, no hourly simulation; one thread, stops if the 1-minute load is above 30). `--test` scores the locked 314-job test split once through `Engine.evaluate`, only for an accepted change. `--fit-labels` and `--eval-labels` fit on one label rule and score against another, so a label change can be judged on the same targets.

Headline metrics, on new-system jobs (expert fitted PV or PV recorded) and on all jobs: all four within tolerance, PV within tolerance, PV MAE, battery within 2 kWh. A change is accepted only if CV improves on these on both subsets without lowering the other, and the physics checks still pass (no battery without PV; autarky and payback plausible per `app/hourly/validate.py`).

## Baseline

Engine at `9aa03c5`. CV on 1,256 train jobs (1,029 new-system); test via `Engine.evaluate`, which reproduces the README scoreboard exactly.

| Board | All four | PV within | PV MAE kWp | Battery ±2 kWh | Battery MAE kWh |
|---|---|---|---|---|---|
| CV new-system (1,029) | 17.7% | 40.7% | 2.52 | 47.9% | 2.62 |
| CV all (1,256) | 14.5% | 33.4% | 2.52 | 44.8% | 2.69 |
| Test new-system (258) | 17.4% | 36.8% | 2.66 | 49.6% | 2.41 |
| Test all (314) | 14.6% | 30.6% | n/a | 48.1% | n/a |

CV per installer, new-system: 2a8ba8e2 15.5% all four (769 jobs), 23c108b7 24.2% (260). No CV design proposes a battery without PV.

## Iteration 1: PV hidden behind the inverter package at 2a8ba8e2

| | |
|---|---|
| Hypothesis | (b) a missed PV signal. 59 first options at 2a8ba8e2 carry "PV Complete Package N kW" (a Huawei inverter package, 3.68 to 15 kW) and no module, substructure or DC install rows. 40 of them read as PV none, so they train the model as battery-only add-ons, though they carry roof work (metal tiles, snow guards) and 90% a battery. All 2024-07 to 2025-02; none has `has_solar`. |
| Change (label) | In `data._pv`, before the optimiser count: kWp = package kW x 1.17 (median DC/AC at 23c108b7), or the optimiser count if larger (optimisers often cover part of the array). 53 labels change: 40 none to PV, 13 optimiser readings raised; new kWp median 9.36 (4.31 to 17.55). Same projects and split. |
| Evidence weakness | Where package and optimiser count coexist (26 options), kWp per inverter kW has median 0.94 and spread 0.30 to 1.50, so the 1.17 ratio is an assumption, not a measurement at this installer. |
| CV, old labels (fit old, then fit new) | New-system: all four 17.7% to 18.0%, PV 40.7% to 40.0%, PV MAE 2.52 to 2.58, battery 47.9% to 50.3%. All: all four 14.5% to 14.8%, PV 33.4% to 33.0%, battery 44.8% to 47.7%. |
| CV, new labels (fit old, then fit new) | New-system (1,061): all four 17.5% to 17.9%, PV 40.4% to 39.9%, PV MAE 2.51 to 2.56, battery 47.9% to 50.5%. All: all four 14.8% to 15.2%, PV 34.2% to 33.8%, battery 44.8% to 47.7%. |
| Physics checks | Battery without PV: 0 in every run. Autarky and payback not run (sizes-only harness; the change was rejected before the test score). |
| Test | Not scored (rejected). |
| Verdict | Rejected. All four and battery rise on both boards, but PV within tolerance and PV MAE get worse on both, under either label set. The battery gain also shows at 23c108b7 (58.8% to 62.3%), where no label changed, so part of it is the jointly trained battery stage shifting, not this signal. `app/data.py` reverted. |
| Kept | `lab/cv.py` harness; `Engine.fit_on` split out of `Engine.fit` (behaviour unchanged, test reproduces the README). |

Next candidates: (a) option rule, scoring lowest, last and most common component set per installer on CV and counting changed labels (Reonic shows options as side-by-side variants, so the lowest may not be the signed one; reported as a label choice, not a metric win). If this signal returns, it should be a battery-stage feature ("inverter package present"), not a PV label.

## Iteration 2: which offer option is the expert label

| | |
|---|---|
| Hypothesis | Reonic offers are customer-facing variants shown side by side, so the lowest-numbered option may not be the signed one. |
| Option structure | 2a8ba8e2: 280 of 1,257 projects have more than one option (223 two, 57 three to ten). 23c108b7: 20 of 336. Option numbers have gaps (lowest is not 1 for 399 and 132 projects), so drafts were deleted before export. Every project has `first_signed_at`, and no column marks which option was signed. First vs last option at 2a8ba8e2: 95 identical in all four sizes, 55 differ in component set; the last option changes the battery in 126 (80 bigger, 46 smaller, 26 drop it, 8 add it), PV in 86 (44 bigger, 42 smaller, 20 drop it), wallbox in 28 (22 add), heat pump in 3. At 23c108b7 last options are often stubs (median 2 line items against 8; 6 of 20 drop PV, 7 drop the battery). So variants are mostly battery-size and wallbox alternatives around one PV array, not "PV + storage" vs "PV + storage + heat pump". |
| Change (label, in `lab/options.py`; `app/data.py` untouched) | Three rules: lowest option (today); last option; the option whose component set (PV, battery, heat pump, wallbox yes/no) ranks highest by frequency among train lowest options at that installer, lowest number on a tie. Same 1,256 train projects and locked split; no project moved outlier status under any rule. |
| Train labels changed | Last: 159 (54 change component set). Most common set: 16 (all change set). Expert labels with a battery and no PV in train: 173, 172, 171. |
| CV, own labels (fit and score on the rule) | Lowest: new-system (1,029) all four 17.7%, PV 40.7%, PV MAE 2.52, battery 47.9%; all (1,256) 14.5%, 33.4%, 2.52, 44.8%. Last: new-system (1,013) 17.2%, 40.1%, 2.55, 44.2%; all 13.9%, 32.4%, 2.55, 41.3%. Most common set: new-system (1,033) 18.9%, 40.3%, 2.53, 49.0%; all 15.5%, 33.1%, 2.53, 43.9%. |
| CV, lowest labels (fit on the rule, score on lowest) | Last: new-system 16.9%, 40.3%, 2.52, 45.9%; all 14.0%, 33.2%, 43.4%. Most common set: new-system 18.7%, 40.2%, 2.53, 48.7%; all 15.3%, 33.0%, 43.6%. |
| Physics checks | Battery without PV in CV designs: 0 in every run. Autarky and payback not run (sizes only; no rule accepted). |
| Test | Not scored (no rule accepted). |
| Verdict | Keep lowest option. Last is worse on every metric on both boards and has no domain support (at 23c108b7 it is often a stub). Most common set raises all four on both boards (+1.2 and +1.0 points) but PV within tolerance falls on both (40.7% to 40.3%, 33.4% to 33.1%) and battery falls on the all board, so it fails the merge rule; it is also circular (it picks the option that looks like the majority, which makes labels easier to predict by construction) and rests on 16 labels, about 1 point of noise. No column says which option was signed: question for the Reonic experts. |
| Kept | `lab/options.py` (option structure plus the three-rule CV; `--describe` for structure only). |

## Iteration 3: grey-box, physics optimum as the base

Rebased onto `origin/engine` 8cc5749 (chain-hgb-knn-7-mono) first. CV baseline on that engine: new-system (1,029) all four 16.9%, PV 40.8%, PV MAE 2.51, battery 46.1%; all (1,256) 13.9%, 33.4%, 2.51, 40.2%. `Engine.evaluate` reproduces the live test board (258: 17.1%, 37.6%, 48.8%; 314: 14.3%).

| | |
|---|---|
| Hypothesis | A grey-box model does better: base = the physics optimum PV kWp and battery kWh for the home, the learned part = the expert's deviation from it, chained (PV, then battery given the chained PV), decisions from today's classifiers, today's monotone constraints. |
| Base | `Engine.opt_grid`: 20-year NPV from `app.hourly.simulate` for every catalogue PV size (full-train catalogue) times every battery size at the offer date, none included, no heat pump, no wallbox, no expert label; PV capped at the roof when one is known (no training row has one). `opt_base` takes the best NPV ("argmax") or the cheapest design in `optimum.py`'s tie band ("cheap"); the battery base is the best battery for the chained PV. 884 distinct grids for 1,570 homes, cached in `engine/.cache/greybox/` (0.33 s a home, about 5 min single-threaded, full catalogue, no proxy needed). Catalogue sizes come from the whole train split, so in CV the held-out fold's sizes are in the grid (sizes only, not labels per home). |
| The optimum against the expert (train) | Median PV 3.8 kWp against the expert's 9.0; PV none 0.2% against 18.9%; battery in 99.2% against 91.2%; PV within tolerance 15.0%, PV MAE 4.44, correlation with expert PV 0.47; battery within 43.2%. At 7.7 ct feed-in only self-consumed PV pays, so NPV wants small arrays; experts fit twice that (roof-filling, future EV and heat pump load). Cheap base: 3.6 kWp, PV within 9.7%. |
| CV new-system (1,029): all four / PV within / PV MAE / battery | Baseline 16.9% / 40.8% / 2.51 / 46.1%. Ratio (expert / optimum), argmax 8.5% / 20.3% / 5.15 / 45.6%; ratio, cheap 11.3% / 25.9% / 4.10 / 48.2%; residual (expert minus optimum) 12.2% / 27.9% / 3.66 / 47.8%; optimum as a feature 18.1% / 41.0% / 2.55 / 48.8%. |
| CV all (1,256) | Baseline 13.9% / 33.4% / 2.51 / 40.2%. Ratio argmax 6.9% / 16.6% / 5.15 / 46.6%; ratio cheap 9.2% / 21.3% / 4.10 / 49.9%; residual 10.0% / 22.9% / 3.66 / 49.1%; feature 15.0% / 33.9% / 2.55 / 45.1%. |
| Ratio without monotone constraints (diagnostic) | 15.6% / 35.9% / 2.84 / 48.9% new-system: still below baseline, so the ratio form itself loses (the base is small and noisy, so expert / base varies 1 to 5 times), not the constraint. |
| Physics checks | Battery without PV: 0 in every run. `validate_physics` on 50 CV designs (same homes each run): baseline 0 flagged, ratio argmax 1, ratio cheap 1 (2 warnings), residual 0, feature 2 (3 warnings: two batteries of 8 to 9 kWh usable against 4 to 5 kWh of night load, one 96% autarky). |
| Test, feature version (scored once, 314 ids) | New-system (258): all four 17.1% to 18.2%, PV within 37.6% to 36.0%, PV MAE 2.64 to 2.78, battery 48.8% to 52.3%, battery MAE 2.55 to 2.43. All (314): all four 14.3% to 15.3%, PV 31.2% to 31.2%, battery 43.6% to 47.5%. |
| Verdict | Ratio and residual rejected on CV (every headline metric falls on both boards). The feature version passed CV (all four +1.2 and +1.1, PV within +0.2 and +0.5, PV MAE 2.51 to 2.55) but fails the merge rule on test: all four rises while PV within tolerance falls 1.6 points (about 4 of 258 homes) and PV MAE worsens; the gain is the battery stage (+3.5 points), where the optimum battery for the chained PV is informative. Not merged: `GREYBOX["mode"]` stays `None`, so the engine behaves exactly as 8cc5749 (CV and test reproduce). |
| Kept | `lab/greybox.py` (grids, optimum description, CV per mode, physics sample, `--test mode:base`); flag-gated hooks in `app/model.py` (`GREYBOX`, `opt_grid`, `opt_base`, `gb_*`), off by default. |

Next candidate from this: the optimum battery for the chosen PV as a battery-stage feature only (PV stage untouched), which should keep the +3.5 battery points without moving PV.

## Iteration 4: optimum battery as a battery-stage feature only

| | |
|---|---|
| Hypothesis | The iteration 3 gain came from the battery stage, so give only the battery include classifier and size regressor the optimum battery kWh for the stage PV (`GREYBOX["mode"] = "batfeat"`); PV stage and heat pump / wallbox inputs exactly as live. |
| CV new-system (1,029): all four / PV within / PV MAE / battery | Baseline 16.9% / 40.8% / 2.51 / 46.1%. batfeat 17.2% / 40.8% / 2.51 / 46.2%. |
| CV all (1,256) | Baseline 13.9% / 33.4% / 2.51 / 40.2%. batfeat 14.1% / 33.4% / 2.51 / 40.4%. |
| PV identical | Yes: PV within and MAE equal the baseline on both boards, per installer too. |
| Physics | Battery without PV: 0. `validate_physics` on the same 50-design sample: 0 flagged (live model 0). |
| Test | Not scored: all four rises 0.3 and 0.2 points and battery 0.1 and 0.2, below the 0.5 gate on both boards. |
| Verdict | Rejected. The optimum battery given the PV adds almost nothing alone; the iteration 3 battery gain (+3.5 on test, +2.7 on CV) needed the optimum PV and battery as features of the PV stage, which is also what moved PV. Mode kept off by default. |
| Kept | `batfeat` mode in `app/model.py` (off), `lab/greybox.py --modes None:argmax,batfeat:argmax`. |

## Iteration 5: 2025 replay, real weather and real negative prices (additive)

Rebased onto `origin/engine` 1a149b8 first. Requested by Xander via THINC HACK MASTER. Model and typical-year economics untouched.

| | |
|---|---|
| Change | `app/hourly/replay.py` (fetch, build, load); `year` argument on `sim.weather`, `pv_per_kwp`, `heat_shape`, `_flows`, `_bill`, `simulate` and `optimum` (default `None` = the typical year, code path unchanged); `sim.replay_2025(inputs, design)` returns the six fields or a reason; `Engine._physics` attaches `economics.replay_2025` or appends "2025 replay unavailable (...)" to `assumptions`; startup warms it. |
| Prices | Energy-Charts `price?bzn=DE-LU`, 2025 (licence CC BY 4.0, Bundesnetzagentur / SMARD.de). Hourly to 30 Sep, 15-minute from 1 Oct (6,550 hourly plus 8,840 quarter-hour points); quarter-hours averaged per UTC hour, and the share of negative intervals per hour kept. Feed-in is withheld in that share of each hour (Solarspitzengesetz: section 51 EEG 2023 as amended, in force 25 Feb 2025, no payment in negative-price periods for new systems; https://www.gesetze-im-internet.de/eeg_2014/__51.html). The extension of the 20-year term by the lost periods (section 51a) is not counted. Retail stays the fixed tariff in every hour, feed-in the fixed EEG rate: no dynamic tariff is simulated. |
| Weather | Open-Meteo historical API, `models=ecmwf_ifs` (identical to the API's best match for 2025; the `era5` model gives 1,256 instead of 1,302 kWh/m2), Munich 48.137 N 11.575 E, GHI, DNI, DHI, 2 m temperature, 10 m wind (CC BY 4.0). Radiation is the preceding hour's mean, so stamp T+1 feeds sim hour T and the sun position is taken at T+30 min; otherwise the same pvlib chain as the TMY. 2025 temperatures also drive the heat pump shape and COP. |
| Storage | Raw JSON and the built CSV in `engine/.cache/replay2025/` (gitignored); the same 8,760-row CSV bundled as `app/hourly/munich_2025.csv` (519 KB, public data only). Load order cache, bundled; checked: with the cache moved the bundled file gives identical values; with both missing the block is omitted with the reason. |
| Typical year unchanged | 20 designs (hero plus 19 test homes) before and after: design, optimum and every typical-year economics field identical; all 20 carry `replay_2025`. |
| Latency | `replay_2025` alone on the 20 designs: median 1.3 ms, p95 2.3 ms, max 19.7 ms (first call for a new roof orientation builds its 2025 PV profile). Full `Engine.predict` on the same 20: median 207 to 215 ms, p95 245 to 246 ms. |

Hero (Unterhaching, 5,000 kWh, 37 ct, roof east-west at 25 degrees from LoD2; design 7.2 kWp, 7 kWh):

| Field | Typical year | 2025 |
|---|---|---|
| PV yield kWh | 6,533 | 7,095 |
| Autarky | 65.0% | 68.1% |
| Feed-in income EUR | 124 | 171 |
| Bill after EUR | 523 | 419 |
| Payback years | 10.8 | 9.9 |
| Negative-price kWh unpaid | 1,488 (proxy: 573 sunniest hours) | 1,286 |

Optimum (`app.hourly.optimum`, the hero's catalogue: PV 3.6 to 11.25 kWp, battery 5, 7, 10, 15 kWh): as served (expert tie-break) 7.2 kWp + 7 kWh under both years (NPV EUR 7,050 to 8,690); without a proposal (cheapest inside the tie band) 4.5 + 5 to 6.75 + 7; strict NPV argmax 10.35 + 7 under both (EUR 7,350 to 9,370). Real 2025 prices are kinder than the sunniest-hours proxy, so the optimum moves up slightly, not down.

| Sanity | Result |
|---|---|
| PV yield, south 35 degrees | TMY 1,109, 2025 1,256 kWh/kWp: 9% above the top of the 1,000 to 1,150 band. GHI 1,300 kWh/m2 against TMY 1,191 (+9%; secondary sources put 2025 in southern Germany above 1,300, the national mean at 1,187, fourth-highest since 1983: https://gruenes.haus/globalstrahlung/, https://www.energiefluss24.de/solarstrahlung). The extra 4% beyond GHI comes from the split: 2025 DNI 1,558 against 1,150, diffuse 486 against 583, which favours a tilted south roof. Read 2025 yields as a sunny year on a model that likely leans 3 to 5% direct-heavy. Hero east-west: 907 to 986 kWh/kWp. |
| Negative hours 2025 | 573 hours with a negative hourly price (SMARD publishes 573); 588 hours with at least one negative interval; 574.8 interval-hours. |
| Mean day-ahead price | EUR 89.3 per MWh. |

Proposed `docs/api.md` addition for THINC HACK MASTER (not edited here): In `interface Economics`, add `replay_2025?: { pv_yield_kwh: number; autarky_share: number; feed_in_income_eur: number; bill_after_eur: number; payback_years: number | null; negative_price_hours_curtailed_kwh: number; assumptions: string[] };  // v1.8, DesignResponse.economics only: the same design replayed on real 2025 Munich weather (Open-Meteo) and real DE-LU day-ahead prices (Energy-Charts), fixed retail tariff, fixed EEG feed-in withheld in negative-price intervals (Solarspitzengesetz); absent when the replay data cannot be read, with the reason in economics.assumptions. The typical-year fields are unchanged and remain the headline numbers.` Not set on `optimum.economics` or `variants[].economics`.

## What the lab tried overnight (for engine/README.md)

The lab ran five measured changes on 5-fold cross-validation inside the training data, scoring the locked 314-home test set only for changes that passed CV. Four model changes were rejected because PV within tolerance fell or the gain was under 0.5 points: reading PV from inverter packages at 2a8ba8e2 (CV all four 17.7% to 18.0%, PV 40.7% to 40.0%), choosing the last or most common offer option as the expert label (no column records the signed option; options are mostly battery and wallbox variants around one array), a grey-box model learning the expert's deviation from the physics optimum (CV all four 8.5% against 16.9%, because the optimum's median PV is 3.8 kWp against the experts' 9.0), and the optimum as a feature (test all four 17.1% to 18.2% and battery 48.8% to 52.3%, but PV 37.6% to 36.0%). The one merge was additive: a replay of each design on real 2025 Munich weather and day-ahead prices, which for the hero home gives payback 9.9 years against 10.8 in a typical year and 1,286 kWh exported unpaid in 573 negative-price hours. Experts size PV well above the economic optimum, which is the clearest finding of the night.

After the pivot to readable planner rules, the lab became the exam. Projects with parts were split once per installer (seed 42) into a fit half (786) and a sealed test half (784); every rules revision was scored on the fit half only, and the final version (REONIC PHYSICS 6c3b46b) was scored once on the test half. All four within tolerance on the 633 new-system test homes: rules-4 18.6%, rules-3 20.9%, rules-1 17.9%, the learned black box 19.0% (on the 126 homes it never trained on), first-principles physics 7.4%, textbook 6.8%. The differences between the rule sets and the black box are not significant (McNemar p 0.33 to 1.00), so the readable rules match the black box rather than beat it. Where rules-4 differs from the expert, the hourly simulation gives it the better 20-year NPV on 327 homes against 180 (median +EUR 430). Scoring against any option the expert offered adds about 2 points; a battery band of one installer package step favours rules-4 (17.5% against 13.9% for rules-1). Reports: `engine/lab/reports/` (iterations, levers, rule_support, final_test).

## Queue
1. Done in iteration 2 (kept lowest option).
2. Done in iteration 3 (not merged). Grey-box (approved by Xander via THINC HACK MASTER): base = physics optimum (`app.hourly.optimum`, installer catalogue), gradient boosting learns the expert's deviation per component, chained as today. Merge candidate only if it beats the current board.
3. Done in iteration 4 (rejected). 4. Done in iteration 5 (merged). Closed after 19:30 Berlin 7 Nov: documentation only until the Sunday 08:00 stop.

## Rules scoreboard (8 Nov, origin/physics 1329cd2)

`python -m lab.score_rules` with `PLANNER_RULES_ENGINE` pointing at a physics checkout (planner_rules not copied in). Formula calibrated on the fit half, scored on the 633 new-system test homes, the 258 board and the 126 in both. All four: formula 17.9% / 20.9% / 23.8%, black box 19.0% (126 unseen) / 17.1% (board), textbook 6.8% / 6.6% / 6.3%. Matches PHYSICS' self-score to the digit. Deviation (all differing homes simulated): test half 519 differ, payback better for ours in 277 and the expert in 233, autarky ours 315 and expert 200; board 204 differ, payback 124 vs 77, autarky 111 vs 90. Report: `lab/reports/rules_scoreboard.md`.

## Four-line rules scoreboard harness (8 Nov)

`cd engine && uv run python -m lab.score_rules --physics-ref <ref> --calibrated-ref 1329cd2` scores formula-physics (no calibrate, constants=None), formula-calibrated (rules-1, fit half), black box and textbook on the test half, the 258 board and board and test half, plus the deviation analysis and runtime per design. Each ref is a throwaway worktree under /private/tmp/claude-501 imported in its own subprocess (`lab/_rules_worker.py`), designs cached in `engine/.cache/lab_rules/<sha>[-calibrated].json`; `--limit N` times N designs only. Smoke test with rules-1 in both columns (`reports/rules_scoreboard_smoke.md`, not a result) reproduces 3f498d8: 17.9% / 20.9% / 23.8% all four and the same deviation counts. Rules-1 costs about 9 ms per design (7.9 s for the first call).

## FINAL test-half score (8 Nov, run once)

`uv run python -m lab.final_test --final` scored the sealed test half (633 new-system homes) and the clean 126 (258 board and test half) with all engines from origin/physics 6c3b46b, calibrated on the full fit half, plus rules-4 at the leaf-default 445656e as a labelled extra column (both versions fixed before any test score; a first 445656e run was stopped before it produced any score, so nothing was tuned on the test half). Black box is scored on the 126 test homes it never trained on. Blocks: ground truth {lowest option, any offered option (same option for all four)} x band {ours, Reonic-style package step snapped to each installer's own sizes, pending the expert's answer}; paired McNemar and hourly-simulation deviation. Report: `lab/reports/final_test.md`. Not rerun.

## Final v2: second look at the test half (8 Nov)

`uv run python -m lab.final_test --final --rules5-ref 64fa451` scored rules-5 (calibrated on the full fit half) and its uncorrected textbook on the sealed test half, beside the first-look engines (first look was rules-4; its numbers reproduced exactly). Both ground truths, both bands, paired McNemar. Fit-half nested CV first: `uv run python -m lab.iterate --ref 64fa451 --module rules5 --textbook app.planner_rules.rules5:textbook` (calibrate is called on the 4 training folds only, so its inner selection never sees the scored fold). Verdict: production stays rules-4. Reports: `lab/reports/final_test_v2.md`, `iteration_64fa451.md`, `rule_support_64fa451.md`. Per-push scorer: `lab.iterate`; gap table: `lab.gap_table --reonic-ref <sha>`.
