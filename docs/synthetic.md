# Synthetic test suite

Metamorphic and simulation-verified testing of the frozen engine, with the hourly simulator (`engine/app/hourly/`) as the oracle. Nothing is trained. Run: `cd engine && uv run python -m synthetic.run` (about 1 minutes on 10 workers).

For /check:

> Tested on 1,000 synthetic homes built from the real inputs and checked against the hourly physics: 99.4 percent plausible, 319 monotonicity violations.

## Method

- Homes: 1,000 from the engine's 1,256 training rows (seed 20261107). In-distribution 70%: a real row with demand, mileage, price, heat and size scattered (lognormal, 8 to 15%), so the joint structure of installer, load profile, EV, heating and existing kit is kept. Edge 20%: demand 1,500 to 2,500 or 10,000 to 20,000 kWh, EV at 30,000 km, heat pump plus EV, existing PV of 3 to 15 kWp. Adversarial 10%: demand 0, negative or 50,000 kWh, price 0, 40 m2 with 10,000 kWh, existing kWp with `has_solar` false, mileage with no EV, storage with no PV.
- Oracle: the API's input check, then `Engine.sizes_batch` (as `/api/inbox`) in one batch with every metamorphic variant, then `Engine._physics` (simulate, validate_physics, optimum) per home in-process. Every simulation, including the optimum's grid, is checked for energy balance.
- Coverage: 77% of the 92 cells seen in the real inputs (installer x load profile x EV x heating x existing PV x demand band) are covered, plus 35 cells the real data never has.
- Runtime: 72 s, 121,377 simulations.

## Results

Plausibility, monotonicity, stability and optimum gap are over the 892 in-distribution and edge homes; energy balance over every simulated home; honesty over the 100 adversarial homes.

| Invariant | Group | Checked | Pass |
|---|---|---|---|
| Raising demand never lowers PV | monotonicity | 892 | 90.9% |
| Adding an EV never removes a wallbox | monotonicity | 782 | 100.0% |
| Adding an EV never lowers PV | monotonicity | 782 | 99.9% |
| A heat pump never lowers PV | monotonicity | 768 | 99.6% |
| A higher tariff never shrinks the battery | monotonicity | 892 | 73.8% |
| Adding an EV changes the wallbox or PV | coupling | 782 | 100.0% |
| No battery without PV | coupling | 892 | 100.0% |
| A 5% demand change moves PV at most one catalogue step | stability | 892 | 77.9% |
| No implausible flag | plausibility | 892 | 99.4% |
| Physics checks pass | plausibility | 892 | 95.7% |
| DC/AC within 0.8 to 1.3 | plausibility | 888 | 100.0% |
| Battery within HTW cap | plausibility | 885 | 43.4% |
| Proposal NPV within 10% or EUR 1,000 of the optimum | optimum gap | 885 | 72.0% |
| Proposal never scores above the optimum | optimum gap | 885 | 100.0% |
| Energy balance closes | energy balance | 954 | 100.0% |
| Adversarial inputs get an error or a flag | honesty | 100 | 52.0% |

Optimum gap (optimum NPV minus proposal NPV, EUR): median 330, p90 2,740, p99 6,280, max 9,770; 42% of proposals are the optimum. Largest energy residual 7.3e-12 kWh. Real expert batteries within the HTW cap: 34%. Honesty by kind: demand 0 100%, demand 50000 0%, ev km without ev 0%, negative demand 100%, price 0 100%, small house high demand 100%, solar kwp without solar 8%, storage without solar 0%.

The worst five cases per invariant are in `engine/.cache/synthetic/report.json` and `/api/eval` (`synthetic`); the model is not changed on them.

## Limits

- Synthetic homes share the real inputs' distribution and the simulator's own limits: one Munich year, south roof unless given, greedy dispatch, 2026 average prices.
- Household load is the BDEW H25 standard profile with seeded scatter, not metered load.
- Metamorphic relations prove consistency and plausibility, not accuracy on real homes; accuracy is the scoreboard against held-out expert designs.
