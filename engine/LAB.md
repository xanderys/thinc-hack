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

## Queue
1. Label choice (offer variants): lowest vs last vs installer's most common component set, compared on CV.
2. Grey-box (approved by Xander via THINC HACK MASTER): base = physics optimum (`app.hourly.optimum`, installer catalogue), gradient boosting learns the expert's deviation per component, chained as today. Merge candidate only if it beats the current board.
