# Reonic planner engine

Statistics plus physics, no LLM. Proposes PV, battery, heat pump and wallbox in the style of one installer, and scores itself against held-out expert designs.

## What it removes from the planner's day

- Enquiry to first design: `/api/design` drafts PV, battery, heat pump and wallbox from the facts in a lead, with reasons, in under 300 ms.
- Site check: `/api/roof` reads the roof from an address (Bavarian LoD2), so no roof sketch before the first offer.
- Back-and-forth with the homeowner: `/api/ask` names the one missing fact that changes the design most; nothing else is asked.
- Offer variants: `variants` gives the planners' design plus most independence, best payback and lowest upfront cost, each simulated hour by hour, so the offer has options without re-planning.
- Checking: `plausibility`, `/api/validate` and each component's `derivation` show why a number is what it is, so a senior planner signs off exceptions only.
- The morning queue: `/api/inbox` is the overnight drafts, held-out real projects already designed, with the misses flagged and explained.

## Run

```bash
cd engine && uv sync && REONIC_DATA_DIR="/path/to/Project Data" uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
```

`./run.sh` keeps it up on port 8000 and restarts it in 2 s if it exits. The first start trains (about 35 s); later starts load the model from `engine/.cache/` (gitignored, keyed on data files and engine code) in about 4 s. Contract: `docs/api.md` v1.3 (`/api/ask`, `/api/inbox`; refine overrides take a number, null or "include"; eval carries textbook, floor-slope and near-identical-homes shares; economics from the hourly simulation; `optimum`). Extra fields beyond the contract: `/api/ask` takes optional `unknown: string[]`; `HomeInputs.roof_area_sqm`, `roof_azimuth_deg`, `roof_tilt_deg`, `roof_orientation` (read by the simulation), `HomeInputs.offer_date` (optional ISO date, picks the battery catalogue of that time; default latest); `/api/eval` adds `baselines` (full detail per rule), `ceiling.covered_test_share`, `all_projects` (all 314 test jobs), `size_mae_when_both_include`, `within_2kwp_share` (PV) and per-installer `baseline_design_match_share`; `/api/projects/{id}` adds `split`; `/api/projects` items add a one-line `label` and come in a varied order (both installers; battery, heat pump, EV, PV only, wallbox, no PV).

## Two recommenders (v2.0)

The Reonic export has no address, roof, orientation, shade or building fabric, so any model trained on it is blind to what decides the panel size; for live leads the engine reads those from open spatial data (Bavarian LoD2 roof planes, the DOP20 orthophoto, and shade and envelope heat loss as REONIC MODEL adds them; `/health.spatial_inputs` lists what is wired). The exam homes carry no address, so every column is scored without roof, shade or envelope data; live leads add them.

`RECOMMENDER=rules|ml` (in `~/.config/marquee/engine.env` on the mini, read by `run.sh`; default `ml`) picks what designs, refines, asks and runs the call. `rules` is the transparent formula in `app/planner_rules/` (REONIC PHYSICS; full detail in `docs/rules.md`): five plain rules on the hourly physics, four fitted constants per installer. `ml` is the learned chain below, kept as the black box to compare against. Either way the same neighbour evidence, hourly economics, plausibility, optimum and variants wrap the design, and `/health` says which one is live.

The formula is a reading of what planners do, measured against 1,619 real designs: it reproduces their habits where the data shows a habit, and the physics says where those habits cost the homeowner.

Rules:
1. PV is the installer's base array plus enough to cover annual use at this roof's yield, times the installer's ratio, capped by the roof, in whole 450 W modules.
2. The battery follows the array at the installer's kWh per kWp, snapped up to its packages on sale at the offer date; one evening's use is shown beside it as the physics check.
3. A heat pump when gas or oil heats the home and the boiler is 20 years or older (`boiler_age_years`, from the call's `heating_age`), or the planner asks; heat over 2,300 full-load hours, next size up.
4. An 11 kW wallbox when an electric car is real or planned.
5. The inverter nearest 0.85 times the PV kWp.

Constants, fitted on half of each installer's projects (seed 42), scored on the other half; the rule sentences in `DesignResponse.rules` and `docs/rules.md` come from the same `rules_table()` and carry each installer's numbers:

| Constant | 2a8ba8e2 / 23c108b7 | Source |
|---|---|---|
| `base_kwp` | 4.95 / 11.7 kWp | fitted |
| `per_use_slope` | 0.95 / 0 | fitted; 23c108b7 sells one array whatever the use |
| `battery_kwh_per_kwp` | 0.80 / 0.85 kWh per kWp | fitted |
| `boiler_age_years` | 20 | default, not in the data |
| `battery_packages` | the installer's packages on sale at the offer date | catalogue, not fitted |
| `evening_share` | 0.52 | BDEW H25 against the PVGIS Munich TMY, not fitted |

Side by side, `/api/eval.recommenders`, on the 126 held-out homes that neither the black box nor the fitted constants saw (all four within tolerance / PV / battery):

| Recommender | All four | PV | Battery |
|---|---|---|---|
| Formula (rules) | 23.8% | 38.9% | 50.0% |
| Black box (ml) | 19.0% | 34.9% | 48.4% |
| Textbook | 6.3% | 18.3% | 47.6% |

On the full 258 board (half of it in the formula's fit half): 20.9% / 17.1% / 6.6%. 126 homes is small (about ±4 points). Where the formula's PV or battery differs from the expert's (92 of the 126), both designs go through the same hourly simulation: the formula pays back sooner in 52 homes and the expert in 38; the formula gives more autarky in 51 and the expert in 39 (`deviation_quality`; ties under 0.1 years or 1 point left out; costs are our 2026 averages, not installer prices). The lab's report (`engine/lab/reports/rules_scoreboard.md`, branch engine-lab) counts the same on the whole 633-home test half, wallbox differences included: 519 differ, payback ours 277 / expert 233, autarky ours 315 / expert 200.

## If the mini is unreachable

If the mini is unreachable, run `engine/fallback.sh` on the MacBook and set `ENGINE_URL` to its Tailscale address. It finds the data pack under `.handoff`, reads the same `~/.config/marquee/*.env` switches, copies the bundled hero roof (`engine/fallback/roof2`, public LoD2 and Zensus figures only), and serves on port 8000 with `RECOMMENDER=rules` unless the env file says otherwise; the first start trains for about a minute, later starts load `engine/.cache`. The intake step needs `~/.config/marquee/intake.env` copied from the mini (it holds the secret, so copy it by hand, never through git).

## Final scoreboard (sealed test half, run once by the lab)

Production is rules-4-readout (`RECOMMENDER=readout`): the experts' own designs read back as a short rule list per installer. `/api/eval` serves this table as it is (`recommenders`, `recommenders_detail`, `deviation_quality`, `final_test`), so `/check`, this README and the deck show the same numbers. Source: `engine/lab/reports/final_test.md` (engine-lab cda46bd).

All four within tolerance, lowest option, our bands:

| Engine | Test half (633) | Clean 126 |
|---|---|---|
| rules-4-readout (production) | 18.6% | 23.0% |
| rules-3-band | 20.9% | 23.8% |
| rules-1-calibrated | 17.9% | 23.8% |
| black box (126 unseen) | 19.0% | 19.0% |
| rules-2-physics | 7.4% | 7.1% |
| textbook | 6.8% | 6.3% |

The differences between the rule sets and the black box are not significant (McNemar p 0.33 to 1.00): they are ties. Counting a hit against any option the expert offered, rules-4 reaches 19.7% on the test half. Where rules-4 differs from the expert (514 of 633 homes), both designs through the same hourly simulation: rules-4 has the better 20-year NPV in 327 homes and the expert in 180, median gain EUR 430.

## Data

| | 2a8ba8e2 | 23c108b7 |
|---|---|---|
| Projects in status quo | 1,277 | 342 |
| With parts (used) | 1,257 | 336 |
| Without parts (excluded) | 20 | 6 |
| Lowest option is not 1 | 399 | 132 |

The expert design is the lowest-numbered option of each project (option 1 where it exists). 23 outliers are dropped before the split: PV over 40 kWp, battery over 40 kWh, or demand outside 500 to 30,000 kWh.

Inputs are sparse. Demand, load profile, EV flag and existing kit are always present; heating type is present for about 12%, house size, build year and inhabitants for under 1%.

## How sizes were derived

Size columns in the parts file are in W or Wh, and two are swapped: battery Wh sits in `inverter_power_kw`, inverter W in `battery_capacity_kwh`. Battery kWh = that column / 1,000 x quantity, falling back to "NkWh" in the name (names understate FoxESS: "5kWh L2" is 9.84 kWh), then the package name. Module Wp comes from `module_watt_peak` (450, which the packages follow; names say 463). Heat pump kW comes from the name, wallbox kW from its column. Inverter kW comes from inverter rows (rare; otherwise physics, PV / 1.15 snapped to standard sizes). `storage_size_kwh` in status quo is Wh.

PV kWp, first signal that exists per project:

| Signal | 2a8ba8e2 | 23c108b7 |
|---|---|---|
| Module rows (count x rated W) | 3 | 60 |
| "Complete Package ... N kWp" name | 0 | 115 |
| DC install count x 450 Wp | 931 | 0 |
| Substructure count x 450 Wp | 3 | 143 |
| Power optimiser count x 450 Wp | 18 | 0 |
| "Roof Mounting A-B kWp" fee, midpoint | 0 | 8 |
| None (battery or wallbox-only job, PV = none) | 302 | 10 |

At 2a8ba8e2 the "DC Install ..." and "Substructure ..." rows are priced per module: their quantities agree on 99.9% of projects, and optimiser counts agree where present. 450 Wp is assumed for those modules (2026 TOPCon standard; the one module row at that installer says 475 W, so PV may read about 5% low there).

## Jobs without PV

- 2a8ba8e2 has 302 jobs with no PV in the first option, but only 13 have `has_solar` true. Of the 289 others: 179 battery only, 54 wallbox only, 25 battery plus wallbox, 5 heat pump, 26 nothing sized (fees only).
- 160 of the 204 battery jobs there contain "Battery ... Extension" rows (median 5 kWh), which extend an existing battery, yet none has `has_storage` true. So `has_solar` and `has_storage` look unreliable for retrofits: question for the Reonic experts.
- Demand looks like the PV jobs (median 4,500 kWh both); almost none have an EV (0.7%) or a known heating type.
- The share without PV climbs over time at 2a8ba8e2: 12 to 27% per quarter from 2024 Q2 to 2026 Q1, then 88% in 2026 Q2 (42 projects so far).
- 23c108b7 has 18: 15 battery only, 2 battery plus wallbox, 1 nothing. Eight carry a "Roof Mounting 8.8-15kWp" style fee, so PV is now read from that range's midpoint for them, leaving 10 without PV.

## Model

Chained, per `docs/briefs/engine.md`:

1. PV: include or none (gradient boosting classifier), then kWp (gradient boosting, absolute error), snapped to sizes that installer sold at least twice in train.
2. Battery: include or none, then kWh, both given predicted PV (out-of-fold PV during training), snapped to sizes that installer sold at least three times within 6 months of the offer date (A switched battery line in 2025 Q1). The offer date only picks the catalogue: as a model feature it lowered the scoreboard (all four 22.0% without it, 19.1% with it).
3. Heat pump: classifier on 13 sold units, never proposed where one exists; size = heat demand / 2,300 full-load hours (installer median, `docs/data-insights.md`), or heating cost / 12 ct per kWh of heat, or area x W/m2 by build year, snapped up to the installer's sizes. A planner "include" on a heat-pump home is a replacement job.
4. Wallbox: if the home has an EV. Size is the installer's own if it sells one size at least 60% of the time, else 11 kW (registration only; 22 kW needs grid operator approval). 2a8ba8e2 sells 11 and 22 kW 49/51, 23c108b7 84% 11 kW, so both get 11 kW unless the planner fixes it. A learned 11-vs-22 choice flipped between 12,000 and 15,000 km a year, which is noise. See limits.
5. A battery needs PV: when the model proposes a battery, no PV, and no PV is recorded, it proposes PV instead; when the planner fixes PV to none on such a home, the battery goes too. `/api/validate` flags a battery with no PV as implausible.

A planner override (number or null) replaces a stage's output; "include" forces the component in and the engine sizes it; the later stages re-size around both. Overrides replace a stage's output and the later stages re-size around it. kNN (k = 15, same installer, scaled log demand, EV, heating, existing kit, load profile) gives `neighbours`, `alternatives` and confidence (share agreeing on the decision, averaged with share within tolerance of the size).

The test split (20%, stratified by installer, seed 42) is never used for fitting, catalogue snapping or neighbours.

## Physics and economics

Economics come from the hourly simulation in `app/hourly/` (REONIC PHYSICS; method and limits in `docs/physics.md`): one typical Munich year, BDEW load profile, greedy battery dispatch. `economics.method` says `hourly-simulation`; if the simulation fails the engine falls back to the annual ratio model (`annual-lookup`, `app/rules.py`) and says so in `assumptions`. `DesignResponse.optimum` is the economically best PV and battery from the installer's own sizes (up to 12 PV sizes around the proposal, the battery sizes on sale at the offer date), with a one-line note on where the expert habit and the maths disagree. `validate_physics` checks (clipping, battery cycles against night load, heat pump full-load hours, extreme autarky or self-consumption) are appended to `plausibility` and, when not ok, to `/api/validate` as "unusual". The scoreboard skips the simulation (sizes only).

`economics.replay_2025` (lab, additive; the typical-year fields above are unchanged) replays the same design on calendar 2025: real Munich weather (Open-Meteo historical API, ECMWF IFS) and real DE-LU day-ahead prices (Energy-Charts, Fraunhofer ISE; Bundesnetzagentur | SMARD.de), both CC BY 4.0. Fields: `pv_yield_kwh`, `autarky_share`, `feed_in_income_eur`, `bill_after_eur`, `payback_years`, `negative_price_hours_curtailed_kwh` (kWh exported in negative-price intervals, which earn no feed-in under the Solarspitzengesetz), plus `assumptions`. Retail stays the fixed tariff; feed-in stays the fixed EEG rate and is withheld only in negative intervals (15-minute prices from October 2025 averaged per hour, the negative share of each hour kept). Data load order: `engine/.cache/replay2025/munich_2025.csv`, then the bundled `app/hourly/munich_2025.csv` (8,760 hourly rows of public data only); never a network call during a request. Refresh with `uv run python -m app.hourly.replay --fetch`. If both files are missing the block is omitted and `assumptions` says why. Cost about 1.3 ms a design. `hourly.simulate(..., year="2025")` and `hourly.optimum(..., year="2025")` run the full simulation or optimum on the replay. Munich weather is used for every home, as in the typical year.

2025 was a sunny year: global irradiance in Germany was about 9% above normal ([gruenes.haus](https://gruenes.haus/globalstrahlung/)), and the Open-Meteo reanalysis leans towards direct sun, so a south roof yields 1,256 kWh/kWp in the replay against 1,000 to 1,150 in a normal Munich year. Read the 2025 figures as one sunny year, not as a forecast; the typical-year figures stay the pinned ones. The replay counts 573 negative-price hours, matching SMARD.

### What the lab tried overnight

The lab ran five measured changes on 5-fold cross-validation inside the training data, scoring the locked 314-home test set only for changes that passed CV. Four model changes were rejected because PV within tolerance fell or the gain was under 0.5 points: reading PV from inverter packages at 2a8ba8e2 (CV all four 17.7% to 18.0%, PV 40.7% to 40.0%), choosing the last or most common offer option as the expert label (no column records the signed option; options are mostly battery and wallbox variants around one array), a grey-box model learning the expert's deviation from the physics optimum (CV all four 8.5% against 16.9%, because the optimum's median PV is 3.8 kWp against the experts' 9.0), and the optimum as a feature (test all four 17.1% to 18.2% and battery 48.8% to 52.3%, but PV 37.6% to 36.0%). The one merge was additive: a replay of each design on real 2025 Munich weather and day-ahead prices, which for the hero home gives payback 9.9 years against 10.8 in a typical year and 1,286 kWh exported unpaid in 573 negative-price hours. Experts size PV well above the economic optimum, which is the clearest finding of the night.


Latency through the Funnel: `/api/design` p50 194 ms, p95 280 ms; `/api/refine` about 275 ms.

## Question picker and inbox (v1.3)

`POST /api/ask` re-sizes the home once per answer to each open question (heating type, EV, annual use, heat demand, existing PV) in one batched pass through the chain, and ranks questions by how far the design moves: the sum over components of |change in size| / tolerance (1 kWp, 2 kWh, 2 kW) plus 1 per include/none flip, the largest over the answers. Top 3; an empty list when no answer moves the design. With `unknown` in the request only those fields are asked, so a fact the lead stated is never asked. About 80 ms at normal load.

`GET /api/inbox` is the overnight drafts: held-out new-system jobs with real inputs (no sub-2 kWp leftovers, no untouched 4,500 kWh defaults), each with the draft, the expert design, within-tolerance per component and, on a miss, one plain sentence naming it. `confidence` is the share of the 15 most similar past homes whose design is within tolerance of the draft on all four components; rows come least sure first. On 60 held-out rows, agreement 0.4 to 0.6 hits 56% against about 33% below 0.4, so it halves the miss rate, no more. Built once at training and stored with the model cache, so it serves in about 20 ms, also right after a restart.

Heat pump cost: EUR 36,400 less the 30% base subsidy, less EUR 10,000 for the boiler replacement it avoids when it replaces gas or oil (`rules.hp_net_capex`, used by both the hourly simulation and the fallback).

## Roof (v1.6)

`GET /api/roof?address=` calls `roof/roof.py` (Bavarian LoD2 first, Google Solar with a key, OpenStreetMap footprint last) and caches the result under `engine/.cache/roof`. A design request with `address` (or a prior `roof`) caps PV at `roof.max_kwp` = usable m2 / 5.5, the largest catalogue size that fits; the PV reason and plausibility cite the roof, and the hourly simulation takes the measured pitch and orientation. The hero tile (Unterhaching) is indexed at startup; the first lookup in any other 2 km tile takes 3 to 10 s.

## Derivation (v1.5)

Each component carries `derivation`: one physical axiom with this home's numbers, then the learned adjustment that closes the gap to the engine's value, so the axiom is never shown as the whole story.

- PV: (household + EV) kWh / this roof's yield per kWp (hourly PVGIS year, measured orientation when known) gives the kWp that would cover a year of use; the adjustment is the ratio to the learned size (gradient boosting on this installer's history, snapped to a module count), with the similar homes' median ratio for reference.
- Battery: daily household use x the share of the household load that falls in dark hours, from the same hourly year; the adjustment is the learned size given the PV, snapped to the installer's packages on sale at the offer date.
- Heat pump: heat demand / 2,300 full-load hours (the installer's median); heat demand from the input, else heating cost / 12 ct per kWh of heat, else floor area x W/m2 by build year (not an IWU typology); rounded up to the installer's sizes. "None" says how many similar homes got one.
- Wallbox: the installer's standard size when an EV is planned; no adjustment unless the planner sets one.

## Scoreboard

Numbers in this section are from before the synthetic fixes; the current board is live at `/api/eval` and summarised under "Fixes from the synthetic suite".

Scored on 258 new-system test jobs: the expert fitted PV, or PV is recorded. The other 56 test jobs are add-ons (battery extensions, wallboxes) to PV the status quo does not record; a design tool proposing for a home without PV cannot reproduce them, so they are reported separately. About 200 battery-only add-ons to homes recorded without PV are excluded from the main board; on all 314 test jobs we score 14.6% vs 5.4%. "Near-identical homes" is the agreement between near-identical training homes: each test home against the median design of 5 or more training homes with identical installer, demand, EV flag and heating type (covers 72% of test homes).

| Within tolerance | Ours | Textbook | Floor-slope | Near-identical homes |
|---|---|---|---|---|
| PV ±1 kWp or 15% | 36.8% | 17.8% | 31.0% | 31.7% |
| Battery ±2 kWh | 49.6% | 47.7% | 47.7% | 53.2% |
| Heat pump decision | 98.8% | 98.8% | 98.8% | 100% |
| Wallbox decision | 75.6% | 75.6% | 75.6% | 74.7% |
| All four at once | 17.4% | 6.6% | 14.0% | 16.1% |

Textbook: 1.3 kWp per MWh plus 2.5 kWp with an EV. Floor-slope: 6.5 kWp plus 0.58 kWp per MWh (`docs/data-insights.md`). Both take the installer's majority battery decision and median size, no heat pump, 11 kW wallbox if EV.

Also on the new-system jobs: PV within ±2 kWp 50.8% (textbook 27.9%), PV MAE 2.66 kWp (textbook 4.16), battery MAE 2.41 kWh (2.46). Per installer, all four: 2a8ba8e2 16.6%, 23c108b7 20.0%.

All 314 test jobs, add-ons included: all four 14.6% (textbook 5.4%), PV 30.6%, battery 48.1%. Before the battery-needs-PV rule the engine scored 22.0% here by copying the add-on pattern (PV none, battery 5 kWh) onto homes that record no PV; that design is not plausible to show a planner, so the rule stays.

## Fixes from the synthetic suite

The synthetic suite (`engine/synthetic`, 10,000 physics-checked homes) found two faults; both are fixed and the model is monotone now (`MONO` in `app/model.py`):

- Demand up lowered PV in 8.6% of homes, because the 4,500 kWh default was learned as a value. Exactly 4,500 (or 0) is now treated as missing and imputed with the training median for the load profile (FamilyOfFour 4,000, H0 4,350, HomeOfficeOnePerson 3,550, else 4,300), and PV is fitted with `monotonic_cst` +1 on demand.
- A higher tariff dropped the battery in 26.3% of homes. A missing price is now 32 ct (not "missing"), and the battery decision and size carry `monotonic_cst` +1 on price.

Held-out board, before fixes / now:

| Within tolerance | Before fixes | Now |
|---|---|---|
| All four at once | 17.4% | 17.1% |
| PV ±1 kWp or 15% | 36.8% | 37.6% |
| Battery ±2 kWh | 49.6% | 48.8% |
| PV MAE | 2.66 kWp | 2.64 kWp |

On 150 held-out homes swept through demand and price: demand up lowers PV 36 before, 0 now; price up shrinks the battery 88 before, 21 now (the rest move through the PV size, which price does not constrain).

## Known limits

- PV size is limited by the inputs: we agree with the expert slightly more often than near-identical homes agree with each other. In 5-fold CV on train, GBM, kNN medians (k 15 and 30), kWp-per-MWh models and a blend are all within 0.1 kWp MAE (about 2.5 kWp on PV jobs). Many homes carry the 4,500 kWh default demand and nothing else; roof, orientation and budget are not in the data.
- Wallbox: 297 of 319 wallboxes at 2a8ba8e2 went to homes with no EV recorded. A learned classifier scored 75.2% on test against 76.1% for the EV rule, so the engine uses the rule. The data does not say who will buy a car.
- Heat pump: 13 sold in the whole pack, 5 in test. The model ties the always-none baseline; size is physics, not learned.
- Economics: costs are 2026 German averages, not installer prices (the pack has none). The hourly simulation assumes a south roof at 35 degrees unless roof inputs are given; the fallback ratio model gives about 30% autarky with no battery at PV equal to demand, about 66% for 10 kWp with 10 kWh on 4,500 kWh. Every assumption is returned in `economics.assumptions`.
