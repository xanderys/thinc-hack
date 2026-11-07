# Reonic planner engine

Statistics plus physics, no LLM. Proposes PV, battery, heat pump and wallbox in the style of one installer, and scores itself against held-out expert designs.

## Run

```bash
cd engine && uv sync && REONIC_DATA_DIR="/path/to/Project Data" uv run uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Trains at startup (about 35 s on the mini). Contract: `docs/api.md`. Extra fields beyond the contract: `/api/eval` adds `baseline_within_tolerance_share`, `size_mae_when_both_include`, `within_2kwp_share` (PV) and per-installer `baseline_design_match_share`; `/api/projects/{id}` adds `split`.

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

Sizes live in `component_name` text. Battery kWh is the sum of "NkWh" in battery rows times quantity (package name as fallback). Heat pump and wallbox kW come from the name or the `*_kw` columns, which hold watts. Inverter kW comes from inverter rows (rare; otherwise physics, PV / 1.15 snapped to standard sizes).

PV kWp, first signal that exists per project:

| Signal | 2a8ba8e2 | 23c108b7 |
|---|---|---|
| Module rows (count x rated W) | 3 | 60 |
| "Complete Package ... N kWp" name | 0 | 115 |
| DC install count x 450 Wp | 931 | 0 |
| Substructure count x 450 Wp | 3 | 143 |
| Power optimiser count x 450 Wp | 18 | 0 |
| None (battery or wallbox-only job, PV = none) | 302 | 18 |

At 2a8ba8e2 the "DC Install ..." and "Substructure ..." rows are priced per module: their quantities agree on 99.9% of projects, and optimiser counts agree where present. 450 Wp is assumed for those modules (2026 TOPCon standard; the one module row at that installer says 475 W, so PV may read about 5% low there).

## Model

Chained, per `docs/briefs/engine.md`:

1. PV: include or none (gradient boosting classifier), then kWp (gradient boosting, absolute error), snapped to sizes that installer sold at least twice in train.
2. Battery: include or none, then kWh, both given predicted PV (out-of-fold PV during training), snapped to sizes sold at least three times.
3. Heat pump: classifier on 13 sold units; size from heat load (heating demand, or area x W/m2 by build year, plus 1 kW hot water), snapped to the installer's heat pump sizes.
4. Wallbox: 11 or 22 kW if the home has an EV. See limits.

A planner override replaces a stage's output and the later stages re-size around it. kNN (k = 15, same installer, scaled log demand, EV, heating, existing kit, load profile) gives `neighbours`, `alternatives` and confidence (share agreeing on the decision, averaged with share within tolerance of the size).

The test split (20%, stratified by installer, seed 42) is never used for fitting, catalogue snapping or neighbours.

## Scoreboard (314 held-out projects)

Baseline: 1 kWp per 1,000 kWh snapped to catalogue, battery by installer majority and median size, no heat pump, 11 kW wallbox if EV.

| Component | Ours | Baseline |
|---|---|---|
| PV decision accuracy | 86.6% | 80.9% |
| PV within ±1 kWp or 15% | 39.5% | 8.6% |
| PV within ±2 kWp | 50.6% | 13.4% |
| PV MAE (expert has PV) | 3.4 kWp | 5.19 kWp |
| Battery decision accuracy | 92.7% | 92.4% |
| Battery within ±2 kWh | 52.9% | 40.4% |
| Battery MAE | 2.47 kWh | 2.73 kWh |
| Heat pump decision accuracy | 98.7% | 98.4% |
| Wallbox decision accuracy | 76.1% | 76.1% |
| All four within tolerance | 20.4% | 2.5% |

Per installer, all four within tolerance: 2a8ba8e2 21.1% (baseline 2.0%), 23c108b7 17.9% (baseline 4.5%).

## Known limits

- PV size has hit the ceiling of the inputs. In 5-fold CV on train, GBM, kNN medians (k 15 and 30), kWp-per-MWh models and a blend are all within 0.1 kWp MAE (about 2.5 kWp on PV jobs). Many homes carry the 4,500 kWh default demand and nothing else; roof, orientation and budget are not in the data.
- PV MAE 3.4 includes homes where we said none and the expert fitted PV. Where both include PV the MAE is 2.7 kWp.
- Wallbox: 297 of 319 wallboxes at 2a8ba8e2 went to homes with no EV recorded. A learned classifier scored 75.2% on test against 76.1% for the EV rule, so the engine uses the rule. The data does not say who will buy a car.
- Heat pump: 13 sold in the whole pack. The decision is near-always none; size is physics, not learned.
- Economics are rough and labelled: ratio model for autarky (no battery about 30% at PV equal to demand; 10 kWp with 10 kWh on 4,500 kWh about 66%), cost per kWp and per kWh from 2026 German averages. Every assumption is returned in `economics.assumptions`.
