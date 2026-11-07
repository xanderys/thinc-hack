# Engine pivot (Xander, 7 Nov about 19:50 Munich, after a steer from Reonic staff)

The recommendation comes from a transparent engine a planner can read: physics and economics (the existing hourly simulation, autarky, payback, optimum) plus a short list of named planner rules, each one plain sentence. The learned chain stays only as the "black box" comparison line on the scoreboard. The dataset is the exam.

## Owners (no overlap)
- REONIC PHYSICS owns `engine/app/planner_rules/` (rules, constants, calibration, `recommend()`), `docs/rules.md`.
- REONIC ENGINE owns the wiring in `engine/app/` outside that folder: `RECOMMENDER=rules|ml` env switch (default `ml` until the 23:30 decision), design, refine, ask, intake step, derivation, eval side by side, README.
- MARQUEE ENGINE LAB runs the calibration split and the scoreboard with scripts under `engine/lab/` only; edits nothing in `engine/app/`.
- REONIC STAGE: explanations become the rule sentences; the why reveal maps 1:1 onto rule, equation, named constant, result; a "Rules" disclosure lists every rule and constant with its fitted value and source.

## Rules (first set; PHYSICS confirms or corrects from physics and the data)
1. PV: size to cover annual use at this roof's yield, then oversize by the installer's ratio (constant `oversize_ratio`, per installer), capped by the roof, snapped to whole modules of 450 W.
2. Battery: store one evening's use: daily use times the after-sunset share from the hourly profile (constant `evening_share` from BDEW, not fitted), snapped up to the installer's package steps (constant `battery_packages`, per installer, from the catalogue); no battery when PV is below `battery_min_kwp` (constant) or when the home already has storage.
3. Heat pump: only when the home heats with gas or oil and the boiler is older than `boiler_age_years` (constant, default 20) or the planner asks; size = heat demand / 2,300 full-load hours, else heating cost / 12 ct / 2,300, snapped to catalogue steps.
4. Wallbox: 11 kW when an EV is real or planned; none otherwise.
5. Inverter: the catalogue size nearest 0.85 times PV kWp (DC/AC 1.1 to 1.3).
At most 5 fitted constants, fitted on a fixed half of each installer's projects (seed 42), tested on the other half; every constant, value and source printed in the UI and README. Everything else from PVGIS, BDEW, VDI, HTW.

## Scoreboard (eval, side by side, same tolerances)
(a) expert match within tolerance per component and all four: formula, black box, textbook; on the test half and on the 258-home held-out board for comparability.
(b) deviation analysis: where the formula differs from the expert, counts of homes where ours is better on payback and on autarky by the hourly simulation, and where the expert is better.
Never headline the heat pump score.

## Timeline (Munich)
21:30 first `recommend()` with fitted constants, first scoreboard. 23:30 decision with Xander: flip `RECOMMENDER=rules` on production or keep both wired. Sun 08:00 freeze. Deck and video hold the hero numbers until the decision.
