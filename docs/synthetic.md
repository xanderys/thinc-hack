# Synthetic test suite

Metamorphic and simulation-verified testing of the frozen engine, with the hourly simulator (`engine/app/hourly/`) as the oracle. Nothing is trained. Run: `cd engine && uv run python -m synthetic.run` (about 6 minutes on 10 workers).

For /check:

> Tested on 10,000 synthetic homes built from the real inputs and checked against the hourly physics: 99.4 percent plausible, 3,135 monotonicity violations.

Short:

> Tested on 10,000 synthetic homes against the hourly physics: 99 percent plausible, monotonic in demand 91 percent of the time.

## Method

- Homes: 10,000 from the engine's 1,256 training rows (seed 20261107). In-distribution 70%: a real row with demand, mileage, price, heat and size scattered (lognormal, 8 to 15%), so the joint structure of installer, load profile, EV, heating and existing kit is kept. Edge 20%: demand 1,500 to 2,500 or 10,000 to 20,000 kWh, EV at 30,000 km, heat pump plus EV, existing PV of 3 to 15 kWp. Adversarial 10%: demand 0, negative or 50,000 kWh, price 0, 40 m2 with 10,000 kWh, existing kWp with `has_solar` false, mileage with no EV, storage with no PV.
- Oracle: the API's input check, then `Engine.sizes_batch` (as `/api/inbox`) in one batch with every metamorphic variant, then `Engine._physics` (simulate, validate_physics, optimum) per home in-process. Every simulation, including the optimum's grid, is checked for energy balance.
- Coverage: 98% of the 92 cells seen in the real inputs (installer x load profile x EV x heating x existing PV x demand band) are covered, plus 108 cells the real data never has.
- Runtime: 336 s, 1,205,738 simulations.

## Results

Plausibility, monotonicity, stability and optimum gap are over the 8,918 in-distribution and edge homes; energy balance over every simulated home; honesty over the 1,000 adversarial homes.

| Invariant | Group | Checked | Pass |
|---|---|---|---|
| Raising demand never lowers PV | monotonicity | 8,918 | 91.4% |
| Adding an EV never removes a wallbox | monotonicity | 7,822 | 100.0% |
| Adding an EV never lowers PV | monotonicity | 7,822 | 99.8% |
| A heat pump never lowers PV | monotonicity | 7,600 | 99.9% |
| A higher tariff never shrinks the battery | monotonicity | 8,918 | 73.7% |
| Adding an EV changes the wallbox or PV | coupling | 7,822 | 100.0% |
| No battery without PV | coupling | 8,918 | 100.0% |
| A 5% demand change moves PV at most one catalogue step | stability | 8,918 | 79.6% |
| No implausible flag | plausibility | 8,918 | 99.4% |
| Physics checks pass | plausibility | 8,918 | 95.9% |
| DC/AC within 0.8 to 1.3 | plausibility | 8,885 | 100.0% |
| Battery within HTW cap | plausibility | 8,869 | 42.6% |
| Proposal NPV within 10% or EUR 1,000 of the optimum | optimum gap | 8,847 | 71.5% |
| Proposal never scores above the optimum | optimum gap | 8,847 | 100.0% |
| Energy balance closes | energy balance | 9,541 | 100.0% |
| Adversarial inputs get an error or a flag | honesty | 1,000 | 51.1% |

Optimum gap (optimum NPV minus proposal NPV, EUR): median 320, p90 2,690, p99 6,070, max 12,180; 44% of proposals are the optimum. Largest energy residual 7.3e-12 kWh. Real expert batteries within the HTW cap: 34%. Honesty by kind: demand 0 100%, demand 50000 2%, ev km without ev 2%, negative demand 100%, price 0 100%, small house high demand 100%, solar kwp without solar 1%, storage without solar 4%.

Worst cases (synthetic homes):

- Raising demand never lowers PV: synthetic edge home (heatpump and ev), 2,910 kWh, EV 12,000 km, Heatpump heating; design pv 11.4, battery 10, wallbox 11. Demand up 20%: PV 11.4 to 9.45 kWp.
- A higher tariff never shrinks the battery: synthetic edge home (heatpump and ev), 3,820 kWh, EV 12,000 km, Heatpump heating; design pv 11.7, battery 15, wallbox 11. Tariff +30%: battery 15 to 0 kWh.
- Adversarial inputs get an error or a flag: synthetic adversarial home (demand 50000), 50,000 kWh; design pv 15.3, battery 14. Designed with no error and no flag.

The worst five cases per invariant are in `engine/.cache/synthetic/report.json` and `/api/eval` (`synthetic`); the model is not changed on them.

## Limits

- Synthetic homes share the real inputs' distribution and the simulator's own limits: one Munich year, south roof unless given, greedy dispatch, 2026 average prices.
- Household load is the BDEW H25 standard profile with seeded scatter, not metered load.
- Metamorphic relations prove consistency and plausibility, not accuracy on real homes; accuracy is the scoreboard against held-out expert designs.
