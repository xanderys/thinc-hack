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

## Queue
1. Done in iteration 2 (kept lowest option).
2. Grey-box (approved by Xander via THINC HACK MASTER): base = physics optimum (`app.hourly.optimum`, installer catalogue), gradient boosting learns the expert's deviation per component, chained as today. Merge candidate only if it beats the current board.
