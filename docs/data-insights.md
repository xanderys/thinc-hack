# Data insights: what the 1,600 signed designs say

Aggregates only. Scripts live in `analysis/` (gitignored). Installer A = `2a8ba8e2`, installer B = `23c108b7`.

## 0. What the data is

| | A | B |
|---|---|---|
| Projects (all signed: `first_signed_at` 100% filled) | 1,277 | 342 |
| Projects with any parts | 1,257 | 336 |
| Projects whose parts include option number 1 (the "858 / 204") | 858 | 204 |
| Projects with a PV option | 998 | 327 |
| PV projects with a recoverable size (evaluation set) | 961 | 327 |
| Offer dates | Jun 2024 to Apr 2026 | Jun 2025 to Apr 2026 |
| Median line items per PV option | 14 | 8 |

Projects without a PV option are add-on orders: in A, 143 battery-extension-only, 54 wallbox-only, 31 battery-only, 5 heat-pump-only.

## 1. Planners' hidden rules

### PV size vs annual demand (kWp, median and p25 to p75)

| Demand kWh | n | All | A median | B median |
|---|---|---|---|---|
| up to 2,500 | 109 | 7.2 (6.2 to 9.0) | 7.65 | 6.5 |
| 2,501 to 3,500 | 285 | 8.1 (6.3 to 10.8) | 7.65 | 9.45 |
| 3,501 to 4,500 | 378 | 9.0 (7.2 to 10.8) | 9.0 | 10.8 |
| 4,501 to 5,500 | 147 | 9.45 (7.4 to 10.8) | 9.0 | 10.8 |
| 5,501 to 7,000 | 161 | 10.35 (8.1 to 11.7) | 9.9 | 10.8 |
| 7,001 to 9,000 | 105 | 10.8 (9.0 to 13.5) | 10.8 | 11.5 |
| 9,001 to 12,000 | 60 | 13.3 (10.7 to 15.9) | 12.6 | 13.5 |
| over 12,000 | 36 | 14.2 (11.6 to 18.2) | 14.2 | 14.4 |

- The rule planners follow is a floor plus a slope, not a ratio: median fit **kWp = 6.5 + 0.58 x MWh** (A: 6.0 + 0.60, B: 8.55 + 0.45). Nobody gets less than about 6 kWp unless the roof forbids it.
- Planners install a median **2.0 kWp per MWh** (p25 1.5, p75 2.7). The textbook 1.3 kWp per MWh under-sizes 82% of real designs.
- Demand is a weak predictor: Spearman 0.36 with kWp. At 4,500 kWh the p10 to p90 range is 4.5 to 14 kWp. The roof decides, and the roof is not in the inputs.
- EV: A 10.35 vs 9.0 kWp (n = 39 EV). B no difference (n = 21). Existing heat pump: A 10.35 vs 9.0, B 11.55 vs 10.8, despite lower recorded household demand (4,000 vs 4,500), so planners add PV for heat-pump load that the demand field omits.
- Module counts, not kWp, are the decision unit: top counts 18, 20, 16, 24, 22, 14 modules. B packages are exact multiples of 450 W (14, 24, 30 modules = 6.3, 10.8, 13.5 kWp).

### Battery

- Included in **95%** of PV projects (A 94.4%, B 98.2%). "No battery" is the exception, so the decision is barely a decision.
- No battery is predicted by small PV (A: 44% of systems up to 4 kWp have none, 10% at 4 to 6, 2 to 6% above 6 kWp) and by offers without the All-Inclusive Package (29% vs 4.8%). Share fell over time: 7 to 8% up to 2025 Q1, 2 to 5% after.
- Size follows PV more than demand: Spearman 0.52 with kWp, 0.31 with demand. **kWh per kWp median 0.97** (p10 0.62, p25 0.79, p75 1.23, p90 1.55). Matches the 1 kWh per kWp prior in `docs/domain.md`.
- But size is mostly the installer's default product: A sells 10 kWh in 41% of battery designs, B 9 kWh in 47%. Bigger only above about 12 kWp (A 15 kWh from 15 kWp, B 18 kWh from 20 kWp).
- Battery catalogue actually sold. A: 10 (367), 5 (189), 7 (145), 15 (90), 14 (59), 20 (10), 21 (8). B: 9 (151), 6 (38), 18 (30), 10 (25), 15 (19), 5 (13).
- Time trend, the one strong one: A switched battery line in 2025 Q1. "7 kWh" and "14 kWh" fell from 69 and 23 options per quarter to near zero; "LFP 5 / 10 / 15 kWh" took over. Median battery went 7 to 10 kWh. Any model must know the offer date or the current catalogue.

### Heat pump

- Only 17 of 1,593 projects with parts (all A; B sells none). Never offered when the existing heating is a heat pump (0 of 171).
- With fossil heating recorded (gas, oil, other non-renewable): A 58% get a heat pump (14 of 24). With heating type blank: 3 of 1,105.
- Sizes sold: 5.5, 7.5, 8, 10.5 (most), 12.5 kW. **Heat demand per kW median 2.29 MWh** (p25 1.99, p75 2.38), so kW is about heat demand / 2,300 h, snapped up to the catalogue. Strong rule, tiny sample.

### Wallbox

- In 26% of PV projects. EV recorded: 56% (A) and 67% (B) get one. No EV recorded: 26% and 20% still get one. 91% of wallboxes (384 of 421) go to homes flagged without an EV, so `has_ev` is under-recorded (3% of A projects).
- km does not separate: median 13,500 km with wallbox, 15,000 without.
- Power: A 50/50 11 and 22 kW (its generic "Wallbox" item is 22 kW); B 79% 11 kW. Treat 11 kW as default.
- Weak rule. Decision accuracy from inputs cannot beat "wallbox if EV" (75%).

### Packages and installer styles

| | A | B |
|---|---|---|
| Brands | Huawei inverters and optimisers, EcoFlow, SAJ, SolarEdge, Vaillant HP | Sigenergy (most), GoodWe, FoxESS, EcoFlow |
| How PV is itemised | No module rows; substructure and DC install lines carry the module count | Module rows (18% of options) or a named Complete Package (47% of PV projects) |
| Bundle | "All-Inclusive Package" service wrapper on 93% of PV designs | Complete Package tiers with fixed sizes |
| Median PV | 9.0 kWp | 10.8 kWp |
| Default battery | 10 kWh | 9 kWh |
| Inverter visible | 6 inverter rows plus 73 "PV Complete Package N kW" (3.68 to 15 kW, Huawei steps) | 46 inverter rows: 10 kW (16), 5 (9), 8 (5), 20 (5) |

B tiers (kWp + kWh, count): T1 6.3 + 5 or 6 (24), T2 10.8 + 9 or 10 (80), T3 13.5 + 9 (29), T4 18 + 9 (6), T5 6.3 + 9 (7). T2 is the most common tier in every demand band (20 to 26% of projects; 55% use no package); T3 rises to 22% above 7,000 kWh. B's inverter: 5 kW up to about 7.7 kWp, 10 kW from 8 to 16 kWp, 20 kW above 23 kWp (DC/AC median 1.17).

### Strong vs noise

| Rule | Strength |
|---|---|
| Battery almost always included, about 1 kWh per kWp, snapped to the installer's default product | Strong |
| PV floor near 6 kWp plus 0.6 kWp per MWh, in module steps | Strong in median, wide spread |
| No heat pump if one exists; heat pump in about half of fossil homes; kW = heat MWh / 2.3 | Strong, n = 17 |
| Battery catalogue change in A in 2025 Q1 | Strong |
| B Complete Package tiers | Strong |
| EV adds PV | Weak (A only) |
| Wallbox from EV flag | Noise: flag under-recorded |
| Load profile, electricity price | Noise: 93% H0, 71% of A at the 32 ct default |

## 2. Data quality: answers for the Reonic experts

**Projects without parts are not lost deals.** All 1,619 projects are signed. Only 20 (A) and 6 (B) have no parts. Of A's 20, 95% carry the 4,500 kWh default, none has EV or heating data, and they signed faster (median 9.5 vs 20 days). They look like quick offers whose line items were not exported.

**The export holds a subset of options, probably the accepted ones.** In B, 94% of projects have one option, yet that option's number ranges from 1 to 5 (132 projects start at 2 or higher). In A, 399 projects start above 1. Lower-numbered options were offered but not exported. Where several options remain (22% of A), they are mostly a main design plus add-ons (wallbox, heat pump, battery extension). Question for Reonic: is the exported set exactly the signed options?

**Recovering PV size for A (no module rows).** Test of each signal:

| Signal | Coverage (A PV options) | Agreement |
|---|---|---|
| Substructure quantity | 74.5% | Equals DC install quantity in 99.6% (n = 1,218) |
| DC Install quantity | 74.8% | As above |
| Scaffolding m2 | 52.3% | Equals substructure count in 90.7%, so it is a module count, not an area |
| Power Optimizer count | 19.2% | Equals substructure in 63%, fewer in 36% (partial optimisation) |
| PV Complete Package N kW | 4.5% | Inverter kW only, never alongside substructure lines |
| Inverter rows | 0.4% | Too rare |
| Module rows with Wp | 4 options | Add-on modules (1 to 5), unusable as ground truth |

Rule used: kWp = substructure count x 0.45 kWp. Cross-check in B, where truth exists: module count equals substructure count in 68% and roof-mounting count in 74% (failures are flat-rate lines with quantity 1); B package names are module count x 450 W exactly (10.8 = 24 x 450). A's assumption of 450 W is unverified; 430 to 475 W shifts a 20-module system by -0.4 to +0.5 kWp, inside the 1 kWp tolerance. Recovered for 961 of 998 A PV projects.

**B module Wp column vs name.** The `module_watt_peak` column says 450 W where the name says 463 W in 52 of 65 rows. Package naming follows 450 W, so use the column.

**Swapped and scaled columns.** `inverter_power_kw` holds battery Wh on battery rows; `battery_capacity_kwh` holds inverter W on inverter rows. All size columns are W or Wh (x 1,000). `storage_size_kwh` in status quo is Wh too. FoxESS battery names understate modules (name "5kWh L2", column 9.84 kWh): trust the column.

**Input reliability.**

| Field | Fill A / B | Note |
|---|---|---|
| energy_demand_wh | 100% / 100% | 4,500 kWh in 32% of A and 20% of B; PV at 4,500 has the same spread as all projects, so it is the default. 14 zeros, one 50,000 in A. 86% are round 500s |
| energy_price_per_wh | 100% | A 71% at 0.32 EUR (default), 2 zeros |
| load_profile | 100% | H0 93% |
| has_ev | 100% | True in 3% / 6%; km filled for every EV and never otherwise |
| heating_existing_type | 12% / 14% | When filled: heat pump 86%, gas or oil 13% |
| heating_existing_heating_demand_wh | 12% / 14% | Median 15.8 MWh, some zeros |
| house size, built year, inhabitants | 0.4% / 0.6% | Unusable |
| has_solar, has_storage | 100% | False for 96% of battery-extension-only projects: existing systems are under-recorded |

**Option 1 vs later options.** On 300 multi-option projects, first and last PV option differ in 71 (PV) and 112 (battery). Among 226 A projects with several PV options, later ones are bigger more often: battery up in 27%, down in 8%; PV up in 18%, down in 10%. First vs last PV agree within tolerance in 80% (n = 257). Our ground truth is the last PV option, plus wallbox and heat pump from any option.

## 3. Economics calibration

The parts file has no prices. What it can ground is scope, not cost.

- Typical PV offer: A 14 lines (p25 12, p75 16), B 8 (4 to 9). Mix by line: installation fees 35% / 29%, service fees 20% / 22%, mounting 12% / 11%, battery 8% / 12%.
- Cost drivers present per PV option, A / B: meter cabinet work 82% / 62%, scaffolding 80% / 0%, travel or delivery 93% / 60%, planning fee 93% / 27%, energy manager 55% / 0%, surge protection 39% / 1%, optimisers 24% / 7%, backup power 12% / 33%, grid registration 0% / 61%.
- Package tiers give relative price steps, not euros (B T1 to T4: 6.3, 10.8, 13.5, 18 kWp).

What to use from `docs/domain.md`:

| Item | Use | Source line |
|---|---|---|
| PV capex | 1,350 EUR/kWp at 5 kWp, 1,150 at 10, 1,050 at 15, 1,000 at 20 (midpoints, interpolate) | reduco Aug 2026 |
| Battery | 450 EUR/kWh installed | Verbraucherzentrale index |
| Fixed adders | Meter cabinet and scaffolding are in 80% of A offers; keep them inside the per-kWp figure, do not add again | parts mix above |
| Wallbox | 1,200 EUR installed (564 unit plus install line); our assumption, flag it | reduco |
| Heat pump | 36,000 EUR before subsidy, 30% base subsidy | reduco 160 offers, VZ RLP |
| Saving | Price from input (default 32 ct), feed-in 7.70 ct up to 10 kWp, 6.66 above | EEG Aug 2026 |
| Payback sanity | 7 to 11 years for PV plus battery; warn outside 5 to 15 | photovoltaik.info |

## 4. Evaluation design

Ground truth: last PV option per project, 1,288 projects (A 961, B 327). 5-fold cross-validation by project.

Tolerances (strict but fair):

| Component | Tolerance | Why |
|---|---|---|
| PV | within max(1 kWp, 15%) | About 2 modules at 10 kWp; median tolerance 1.4 kWp |
| Battery | decision exact; size within 2 kWh | One catalogue step (A 5/7/10, B 6/9) |
| Heat pump, wallbox | decision exact | Sizes are catalogue defaults |
| Design match | all four at once | Headline candidate |

Held-out results:

| Model | PV in tolerance | PV MAE kWp | Battery in tolerance | Wallbox | Design match |
|---|---|---|---|---|---|
| Textbook rule (1.3 kWp/MWh, +2.5 EV, battery 1 x kWp, wallbox if EV) | 16.8% | 4.11 | 30.9% | 74.8% | 6.9% |
| Installer median | 36.3% | 2.91 | 44.3% | 73.7% | 14.6% |
| Installer x demand-band lookup | 38.3% | 2.74 | 45.7% | 74.8% | 15.5% |
| Gradient boosting, battery snapped to catalogue | 38.9% | 2.68 | 50.7% | 73.6% | 17.9% |
| Ceiling: median of homes with identical inputs (in-sample, groups of 5+) | 43.3% | | | | |

Base rates: battery 95%, wallbox 26%, heat pump 0.9%. Heat-pump accuracy is 99% for every model and says nothing; report its recall on the 14 fossil cases instead.

The inputs cap PV accuracy near 43%: identical homes get designs that differ by more than the tolerance. With looser bands the fitted floor-plus-slope rule reaches 51% within 2 kWp and 70% within 3 kWp.

**Headline for the slide:** PV within tolerance on held-out projects, ours against the textbook rule and the ceiling: "39% vs 17%, where 43% is the most these inputs allow". Compute: for each held-out project, hit = |ours - expert| <= max(1, 0.15 x expert); headline = mean of hits; ceiling = same with the median of training homes with identical installer, demand, EV and heating type. Show PV MAE alongside (2.7 vs 4.1 kWp, 35% lower).

## Top 10 facts for the pitch

1. All 1,619 projects are signed deals; 1,288 carry a recoverable PV design.
2. Planners install a median 2.0 kWp per MWh, not the textbook 1.3; the textbook under-sizes 82% of real designs.
3. The real rule is a floor plus a slope: kWp = 6.5 + 0.58 x MWh.
4. 95% of PV designs include a battery.
5. Battery size is about 1 kWh per kWp (median 0.97), snapped to a default: 10 kWh at A (41%), 9 kWh at B (47%).
6. Homes with a heat pump already get 1.35 kWp more PV (A) on lower recorded demand.
7. Heat pumps go only to fossil-heated homes: 58% of them at A, 0 of 171 heat-pump homes; kW = heat MWh / 2.3.
8. 91% of wallboxes go to homes flagged without an EV: the EV flag is missing, not the demand.
9. A switched battery line in 2025 Q1 (7/14 kWh to LFP 5/10/15): the model must know the catalogue date.
10. Identical inputs, different roofs: the inputs cap PV accuracy at about 43% within 1 kWp or 15%; we reach 39%, the textbook 17%.

## Feature list for the model (ranked by evidence)

1. Installer id: +1.8 kWp median gap, different catalogues and defaults.
2. Annual demand, with 4,500 kWh and 0 treated as missing (Spearman 0.36 with kWp).
3. Predicted PV kWp as input to battery size (Spearman 0.52; ratio 0.97).
4. Offer date or catalogue version (battery line change 2025 Q1).
5. Existing heating type: fossil drives heat-pump decision; existing heat pump adds PV.
6. Heating demand kWh: heat-pump kW (2.3 MWh per kW).
7. has_ev and km: small PV uplift at A, weak wallbox signal.
8. Installer catalogues as output constraints: module steps of 0.45 kWp, B package tiers, battery products, inverter steps (Huawei 3.68 to 15 kW; Sigenergy 5/8/10/20 kW).
9. Load profile, electricity price: no measurable effect; keep for economics only.
