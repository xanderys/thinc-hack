# Brief: REONIC SYNTHETIC

You own `engine/synthetic/` and `docs/synthetic.md` on branch `synthetic`. Never edit anything else in `engine/` (REONIC ENGINE wires your result into `/api/eval.synthetic`), nor `web/`, `docs/api.md`, `PLAN.md`, `CLAUDE.md`. Read `CLAUDE.md`, `docs/api.md`, `docs/physics.md`, `engine/README.md`, `engine/app/` (read only: model entry points, `app/hourly/` simulate, optimum, validate_physics; `app/rules.py`) and `docs/research/science.md` first. Xander's decision: a physics-grounded synthetic test suite, 10,000 homes, README plus one line on /check. This is testing, not training: the learned model is frozen. Wording rule (corroborated by research, Chen et al. 2018, Segura et al. 2016, Xie et al. 2011, Willard et al. 2022): this is metamorphic and simulation-verified testing with the hourly simulator as the oracle; never call it a physics-informed neural network.

## What to build
1. Generator `engine/synthetic/generate.py`: 10,000 synthetic homes. Start from the real training inputs (REONIC_DATA_DIR, the engine's own parser), fit the empirical marginals and joint structure (demand by load profile, EV share, heating type, existing kit, installer), then sample: 70 percent in-distribution (perturb real rows within realistic ranges), 20 percent edge (demand 1,500 to 20,000 kWh, EV 30,000 km, heat pump plus EV, existing solar), 10 percent adversarial (contradictory or placeholder inputs: demand 0 or 50,000, price 0, 40 m2 house with 10,000 kWh). Fixed seed. Generated rows stay under `engine/.cache/synthetic/` (gitignored); only aggregates are committed. Never write real rows anywhere in the repo.
2. Oracle: for every synthetic home run the engine's design (batched like /api/inbox), simulate, optimum and validate_physics, in-process (import the engine modules; do not go through HTTP).
3. Invariants `engine/synthetic/invariants.py`, each a named check with a pass rate and the worst 5 failures (synthetic inputs and designs, so they can be shown):
   - Monotonicity: raising demand (rest fixed) never lowers pv_kwp; adding an EV never removes a wallbox or lowers pv_kwp; a heat pump replacement never lowers pv_kwp; a higher tariff never shrinks the battery.
   - Coupling: adding an EV changes wallbox or pv_kwp; no battery without PV when has_solar is false.
   - Plausibility: zero "implausible" flags from validate_physics on proposed designs; DC/AC within 0.8 to 1.3; battery within the smaller of 1.5 kWh per kWp and 1.5 kWh per MWh (HTW 2025) reported separately as "within HTW cap", since installers often exceed it.
   - Stability: a 5 percent demand change moves pv_kwp by at most one catalogue step.
   - Optimum gap: proposal NPV within 10 percent or 1,000 EUR of the physics optimum NPV under the same catalogue; report the distribution. The model's recommendation must never score above the simulator's own optimum.
   - Energy balance closes in every simulation (yield = self-consumed + fed in, within 1 kWh).
   - Honesty on adversarial inputs: a plain-word error or a flag, never a silent design.
4. Report `engine/synthetic/report.py` writing `engine/.cache/synthetic/report.json` (n, split shares, pass rate per invariant, worst cases, coverage of the variation space, runtime) and `docs/synthetic.md` (method, one table, limits: synthetic homes share the real inputs' distribution and the simulator's own limits, BDEW is a standard profile not metered load; metamorphic relations prove consistency and plausibility, not accuracy on real homes). Expose `load_report()` for REONIC ENGINE to serve as `/api/eval.synthetic` = `{ n, generated_at, plausible_share, monotonicity_violations, invariants: [{ name, pass_share, n_checked, worst }] }`.
5. One line of copy for /check in `docs/synthetic.md`: "Tested on 10,000 synthetic homes built from the real inputs and checked against the hourly physics: N percent plausible, M monotonicity violations." with the real N and M.

## Milestones (Munich time)
- 19:15: generator and oracle on 1,000 homes, first invariant numbers reported.
- 20:45: 10,000 homes, full report, docs/synthetic.md, branch pushed; report with the headline line.
- Then: fix nothing in the model; worst cases go to REONIC ENGINE and the engine lab as evidence.

Rules: check `uptime` first and wait while the 1-minute load is above 20; batch predictions; keep the full run under 10 minutes; one process at a time. British English, no em dashes, essential text only.
