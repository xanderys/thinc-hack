# First-principles formula and the spatial demonstration (Xander, 7 Nov 18:20 Munich)

Xander's words: we cannot rely on a machine learning model; the recommendation and the quote must be built entirely from core first principles, physics and the scientific literature; the installers' past designs are the exam, never an input; the objective is dynamic, not one fixed goal; and the planner site must show, spatially and progressively over the real house model, how the design is computed.

## The formula (REONIC PHYSICS owns engine/app/planner_rules/, rewrite in place, same `recommend()` signature)
No fitted constants. Every parameter has a citation in docs/rules.md (PVGIS, BDEW H25, VDI 4655, HTW Berlin Stromspeicher-Inspektion 2025, Fraunhofer ISE field data, BSW and pvXchange 2026 prices, EEG 2026 tariff, BNetzA negative hours, Fraunhofer ISE 1.5x heat pump finding).
1. Roof and sun: usable planes, modules per plane, yield per kWp per plane from the hourly PVGIS year (already in roof/model).
2. Load: the home's hourly year (BDEW H25 scaled to annual use, EV charging profile, heat pump electricity from heat demand and seasonal COP from Fraunhofer field data, heat demand from the building when unknown: IWU typology by build year and floor area).
3. Sweep: every feasible (kWp on the best planes, battery kWh in the installer's package steps, heat pump yes or no, wallbox yes or no) through the hourly simulation; for each, capex from sourced 2026 prices, 20-year cash flows (tariff, feed-in, degradation, battery cycling and replacement, negative-price hours unpaid), NPV, autarky, self-consumption, payback.
4. Dynamic objective: the recommendation is the knee of this home's own cost-to-value frontier (the largest system whose marginal 20-year value per marginal euro still exceeds the discount rate; cite the knee-point and marginal-analysis sources), with physical caps (roof, DC/AC 1.1 to 1.3, HTW storage caps as a warning, not a hard cap) and the homeowner's stated preference moving the point along the frontier (independence, payback, upfront). No installer habit anywhere in the choice.
5. Explanation: each component's derivation is the equation and its sources; the installers' designs are shown only as the comparison line and the exam.
6. Exam: the lab scores the formula against the expert designs (match within tolerance) and the deviation quality (payback, autarky by the same simulation), formula vs black box vs textbook, on the same homes. Expect match to fall; the physics table is the proof.
Due: 23:00 Munich live behind RECOMMENDER=rules (it replaces the calibrated rules-1). Keep rules-1 as `rules-calibrated` for the comparison column if cheap.

## The spatial demonstration (REONIC SPATIAL owns web/components/spatial/ and web/app/spatial-demo for a standalone check; REONIC STAGE integrates with one import in the Plan step)
Six layers over the real house model (three.js, the glb and planes from GET /api/roof/model), each one tap, each with its equation and sources, building up to the design:
1. Roof: the LoD2 solid with the aerial photo, planes outlined, pitch and azimuth labels.
2. Sun: each plane tinted by yearly kWh per kWp (PVGIS, this orientation), with the number on the plane.
3. Panels: modules placed on the best planes, count and kWp, appearing with one smooth spring.
4. A day: one representative day animated hour by hour (sun, home, battery, grid flows as moving bands; the overnight gap), from POST /api/explain/layers.
5. Battery: the overnight curve with the chosen kWh filling it, the HTW cap marked.
6. Value: the cost-to-value frontier across sizes with the chosen knee point and the preference alternatives.
Motion per apple-motion (bounce 0, Reduce Motion = static frames), phone-safe at 390 px (the glb is about 1.2 MB, 600 triangles). Due 02:00 Munich. The line drawing stays as fallback when there is no model.

## Engine support (REONIC ENGINE)
GET /api/roof/model (merge roof-model, restart, pre-warm the hero), POST /api/explain/layers (v2.3 in docs/api.md), and `recommender` switch to the new first-principles rules when PHYSICS lands.
