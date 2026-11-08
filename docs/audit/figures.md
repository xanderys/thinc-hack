# Figure audit (thinc! hack, Marquee)

Audited 8 Nov 2026, 12:38 to 12:50 Munich, against `origin/main` 1947d76 (web, engine, docs) and the live engine (`/health`: rules-4-readout, model chain-hgb-knn-7-mono+hourly).
Hero lead `db67b84935` (Katrin Huber, Katharinenstraße 5, 82008 Unterhaching, installer 2a8ba8e2, version 69) and test lead `9dcedce634`, read with GETs through `https://marquee-reonic.vercel.app/api/...` only.
Reproduce any row with:

```
P=https://marquee-reonic.vercel.app/api
A="Katharinenstra%C3%9Fe%205%2C%2082008%20Unterhaching"
curl -s $P/leads/db67b84935            # draft, economics, variants, envelope
curl -s "$P/roof?address=$A"           # roof lookup (57 modules, 21.02 kWp, 282.6 m2)
curl -s "$P/roof/model?address=$A&build_year=1985&kwp=10.35"   # planes, layout (23 modules), envelope elements
curl -s "$P/roof/shading?address=$A&kwp=10.35"                  # 0.6 %, 59 kWh
curl -s $P/eval ; curl -s "$P/inbox?limit=20"
```

Verdicts: **OK** (reproduced and plausible), **SUSPECT** (reproduces, but the logic, label or source is weak), **WRONG** (a different value is correct, given).

## Hero inputs and their sources

| Input | Value | Source |
|---|---|---|
| Annual use | 5,000 kWh | not in the lead text (`web/lib/demo.ts` HERO_LEAD); `HERO_INPUTS` says "answered as 5,000 kWh" but `history` is empty and `questions_asked` 0, so no recorded answer |
| People, floor area, build year, heating, heating bill, price | 4, 140 m², 1985, gas, €2,400, 37 ct | stated in the lead text |
| EV, solar, storage | none | stated ("No electric car yet, no solar and no battery") |
| Roof | 2 planes, 94° and 274°, 25.1°, 72.2 + 72.3 m² | LoD2 (`/api/roof`) |
| Shade | DOM20 ray-cast | `/api/roof/shading` |
| Envelope | IWU EFH_H 1984 to 1994, LoD2 areas | `roof/model/envelope.py` via `/api/roof/model` |
| Prices, rates | PV €2,333 + €883/kWp, battery €315/kWh, wallbox €1,200, HP €33,500 gross | `engine/app/hourly/sim.py` constants, `engine/app/rules.py` (reduco 2026 midpoints, BSW via reduco) |

## 1. Board cards (`web/components/board/Board.tsx`, `web/lib/qualify.ts`)

| Figure | Rule (file, function) | Hero value, by hand | Verdict |
|---|---|---|---|
| Verdict "Priority" | `qualify()` rules 1 to 7, first match wins | street given, LoD2 measured, max_kwp 21.02 ≥ 3, payback 10.3 ≤ 20, use ≠ 4,500, heating known: rule 7 "Priority" | OK |
| Reason "Worth a visit: the roof fits 10.35 kWp and pays back in 10 years. Expected offer about €14,620." | `qualify()` rule 7: `Math.round(payback_years)` and `Math.round(capex)` | round(10.3) = 10; €14,620 | SUSPECT: "pays back" uses simple payback (capex / year-1 saving = 10.3) while every tile shows break-even year (10). They agree here only by rounding; on the test lead payback 9.6 rounds to 10 and break-even is 10, on "Best payback" 9.4 vs 9. `docs/qualification.md` says the value is "rounded to 100 EUR" (€14,600) but code shows €14,620 |
| "€14,620, estimate" | `offerEur(expected_offer_eur)` = round(capex) | 2,333 + 883 × 10.35 + 315 × 10 = 14,622 → engine rounds to €10 → 14,620 | OK (value); doc mismatch above |
| "7 of 9 facts stated" (chip tooltip) | `qualify()` list of nine | address, use, people, floor, year, heating, bill stated; EV "estimated" (has_ev false, no `ev_annual_km`, no history); preference estimated | WRONG: the lead states "No electric car yet" and the facts chip shows Electric car "No" as stated, and the engine's wallbox reason says "no electric car now or planned". Expected **8 of 9**. Also annual use counts as stated with no recorded source (see inputs) |
| Card line "10.35 kWp + 10 kWh" | `lineOf()` | matches draft | OK |
| Card design source | `standing()`: approved design else stored draft; redesign with `/api/design` when `model_version` differs | hero not approved; test lead approved 9.9 / 5 → €13,850 on board | OK (board and detail both read the approved/override design) |
| "This installer's past projects: about 8 days to an offer, then about 29 days to a signature" (`PAST_LINE`, signed cards and homeowner page) | `web/components/proposal/Proposal.tsx` constants from `docs/data-insights.md` line 203 | figures are **Installer B (23c108b7)** medians; the hero is Installer A (2a8ba8e2): 0.7 days (n 18) and 20.0 days (n 1,276), `docs/data-insights.md` line 204 | WRONG for every Installer A lead: say "about 20 days from offer to signature" for A, or drop "This installer's" and name the installer the figures come from |

## 2. Facts chips (`web/components/stage/Facts.tsx`)

| Chip | Rule | Hero | Verdict |
|---|---|---|---|
| Built "estimated, 1979 to 1990" | `builtEstimated()`: estimated when the stated year equals the Zensus `build_year_estimate` within 0.5 | lead states 1985 (text and `envelope.build_year_source: "lead"`); Zensus estimate is also 1985, so the chip shows a stated fact as an estimate | WRONG: a stated value is labelled estimated because it coincides with the census. Use provenance (`_given` / `build_year_source`), not value equality. Expected "1985" |
| Floor area "140 m²" | `near(house_size_sqm, roof.floor_area_m2)` | 140 stated; roof estimate 282.6 | OK for the hero. Same heuristic flaw as Built (a stated value near the estimate would show "estimated") |
| Floor area estimate (test lead "282.6 m², estimated from the building") | `roofs.py`: footprint 130.8 m² × 3 storeys (8.9 m / 3 m) × 0.72 | for the **same house** the owner states 140 m²; 8.9 m is ridge height on a 25° gable, so 2 storeys plus attic, ≈ 130.8 × 2 × 0.72 ≈ 188 m² (the envelope's own heated area) | WRONG estimator: storeys from ridge height double-counts the roof. Expected ≈ 190 m² (use eave height, or the envelope's 188 m²) |
| Price "37 ct/kWh" (stated) / "37 ct/kWh, assumed" | engine default `PRICE_CT = 37` | BDEW Aug 2026: 37.0 ct at 3,500 kWh ([BDEW Strompreisanalyse 08/2026](https://www.bdew.de/media/documents/BDEW_Strompreisanalyse_082026.pdf)) | OK; `docs/api.md` still says "default 32" (doc stale) |
| Household use "5,000 kWh" | always `state: "stated"` | no source recorded for 5,000 (see inputs); a 4,500 default would also show as stated | SUSPECT: the chip never marks the default as estimated, while `qualify()` does |
| Electric car "No" | always stated | consistent with the lead | OK (but see board count) |

## 3. Panels card and roof labels (`web/components/chain/Chain.tsx` sysBody.panels, `engine/app/layers.py`, `engine/app/layout.py`)

| Figure | Rule | Hero, by hand | Verdict |
|---|---|---|---|
| Head "23 panels, 10.35 kWp" | placed modules on target planes | 20 on p2 (94°) + 3 on p1 (274°) = 23; 23 × 0.45 = 10.35 | OK |
| Roof bar "9,580 kWh a year" | `economics.annual.pv_yield_kwh` from the layout | 20 × 0.45 × 934.8 + 3 × 0.45 × 864.5 = 8,413 + 1,167 = 9,580 | OK. 926 kWh/kWp for an east-heavy array in Munich; Reonic table: east 81 % of the 980 DE mean (794), Munich south is ≈ 1,100 ([Reonic, PV berechnen](https://reonic.com/de-de/blog/pv-anlage-berechnen-formeln/)); 939/1,109 = 85 % east here |
| Home bar "Household 5,000" (+ "Car" when EV) | `inputs.annual_demand_kwh` + `layers.ev.annual_kwh` | 5,000; test lead 5,000 + 2,700 = 7,700 = `load_kwh` | OK |
| "76 % from the roof" | `economics.autarky_share` = (direct + discharge) / load | (5,000 − 1,197) / 5,000 = 76.1 % | OK (autarky, includes battery; load includes car and heat pump, so no double count). Self-consumption 4,033 / 9,580 = 42.1 % is a different quantity and is shown only in the classic Offer stage |
| Kit row per face (roof bar segments) "East face 9 kWp, West face 1.35 kWp" | `layers.bars`: n × 0.45 per target plane | 20 × 0.45 = 9.0; 3 × 0.45 = 1.35 | OK |
| Plausibility "The roof fits 57 modules, about 116 m²" | `roofs.py` line 429: `max_panels` = usable 115.6 m² / 2.03 | layout says `max_panels` 25 + 25 and `fits_panels` **20 + 20 = 40**; the same roof object says `max_kwp` 21.02 (= 115.6 / 5.5), which is 46.7 modules, not 57 (25.65 kWp) | WRONG: three capacities for one roof (57 modules, 21.02 kWp, 40 modules). The layout's 40 (18 kWp) is the one the variants obey ("Most independence" stops at 18 kWp). Expected "The roof fits 40 modules (18 kWp)" |
| Plausibility "10.35 kWp needs about 57 m²; usable roof 116 m²" | 5.5 m² per kWp | 10.35 × 5.5 = 56.9; 23 modules × ≈ 1.95 m² = 45 m² of module | SUSPECT: 5.5 m²/kWp is Reonic's gross-roof rule (4.5 to 6.0, [Reonic](https://reonic.com/de-de/blog/photovoltaik-dachflaeche-kwp-berechnen/)); fine, but "57" next to "57 modules" reads as the same number |
| Roof bar sentence "The roof holds up to 21.02 kWp" | `bars()` with `roof.max_kwp` | 21.02 vs layout 18 | WRONG (same root as the 57) |
| Residential cap "inside the 30 kWp residential cap" | `rule("cap")` else 30 | 10.35 < 30 | OK |
| Shading chip "0.6 %, 59 kWh a year" | `shading.result()` weighted over chosen modules | unshaded 20 × 0.45 × 939.2 + 3 × 0.45 × 876 = 9,636; 9,636 − 9,580 = 56 ≈ 59 (rounding of per-plane yields); (3 × 1.3 % + 20 × 0.5 %) / 23 = 0.6 % | OK |
| Per-module shading (annual share 98.7 to 99.9 %) | `shading.py` DOM20 ray-cast per module | 23 modules listed, min 0.987 | OK |
| Month/hour readout "15 Jun, 11:30, X % in sun" | `ShadingScrubber.tsx` from module `hourly[m][h]` | lit share of modules at that hour | OK (read-out only); readout uses :30 of the hour bucket |
| Shading class "excellent" (info) | `layers.py`: < 5 % excellent (Reonic band) | 0.6 % | OK |
| Orientation factor (info, Panels "i") | `layers.py` `ofac()`: Reonic table, east 0.81, west 0.79 | (20 × 0.81 + 3 × 0.79) / 23 = 0.807 → "81 %" | SUSPECT: a label only; the engine's own yield gives 85 % east / 79 % west of the best plane. Two orientation figures for one roof |
| Roof edge lengths (p2: 0.39, 0.5, 5.53, 6.99, 5.54, 13.03, 5.16 m) | `shading.planes[].edges_m` | 13.03 × 5.54 ≈ 72.2 m² matches the plane area | SUSPECT: 0.39 m and 0.5 m are polygon slivers; hide edges under 1 m |

## 4. Battery card (`Chain.tsx` sysBody.battery, `engine/app/planner_rules/bars.py`, `layers.py` checks)

| Figure | Rule | Hero | Verdict |
|---|---|---|---|
| Head "10 kWh, 0.97 kWh per kWp" | `battery_kwh / pv_kwp` | 10 / 10.35 = 0.966 | OK |
| "inside the usual 0.7 to 1.0 kWh per kWp" | `Chain.tsx` literal band; `bars.py` cites "HTW rule of thumb" for it | HTW's rule is ≤ 1.5 kWh per MWh of use: 7.5 kWh cap for 5,000 kWh ([HTW Unabhängigkeitsrechner](https://solar.htw-berlin.de/rechner/unabhaengigkeitsrechner/)); Reonic: 1.0 to 1.5 kWh per MWh (5 to 7.5 kWh) and 0.2 to 0.6 kWh per kWh of daily use (2.7 to 8.2 kWh); only Reonic's "storage about the array's kWp" supports 10 kWh ([Reonic Faustregel](https://reonic.com/de-de/blog/eigenverbrauch-autarkiegrad-pv-berechnen/), [Reonic AI validation](https://reonic.com/en-gb/ai-validation/)) | SUSPECT: the 0.7 to 1.0 band has no source and is misattributed to HTW; the hero fails two of Reonic's three rules and HTW's |
| Battery check behind "i" "Battery 0.73 kWh per kWh of daily use" | `layers.py`: 10 / (5,000 / 365) = 0.73; message "above Reonic's 0.6 guide, like 63 % of your planners' signed designs" | `checkLine()` → `scrub()` drops every clause with "Reonic … guide", so the planner sees the ratio with no band and no flag | WRONG (hidden failure): show "above the 0.2 to 0.6 band". The "63 %" has no source in code |
| Spring weekday split "Roof / Battery / Grid" | `layers._day()`: 70th-percentile PV April/May weekday; roof = Σ direct, battery = Σ discharge, grid = Σ import | the three parts sum to the day's load by construction (load = direct + discharge + import) | OK |
| "Battery does 224 full cycles a year (9.0 kWh usable)" | discharged / (kWh × 0.9) | 2,017 / 9 = 224 | OK; test lead 2,673 / 9 = 297 OK |
| Battery choice "10 kWh … nearest on sale to 9.2" | rules-4 leaf 9.2 kWh snapped to Installer A packages | leaf "use 4,100 to 10,850 kWh → 9.2", 130 of 274 | OK (matches `docs/rules-readout.md`) |

## 5. Wallbox card (`Chain.tsx` sysBody.wallbox, `layers.ev_block`, `bars.charging_bar`)

| Figure | Rule | Test lead (15,000 km) | Verdict |
|---|---|---|---|
| "15,000 km a year → 2,700 kWh a year → 5.9 kWh a night" | km × 18 / 100; night = annual × **0.8** / 365 | 2,700 × 0.8 / 365 = 5.92 | SUSPECT: the chain shows kWh a year then a night figure that is not kWh a year / 365 (7.4); the hidden 80 % home share breaks the arithmetic on screen. And the hourly simulation charges **100 %** at home (`ev_charge_kwh` 2,700), so the economics and the card disagree on how much is charged at home |
| 18 kWh/100 km | `sim.EV_KWH_PER_100KM` | mid-size EV; ADAC test averages ≈ 17 to 21 kWh/100 km | OK |
| 80 % charged at home | Fraunhofer ISI PR 21/2025 | cited | OK as a source; inconsistent with the simulation (above) |
| "11 kW refills that in about 32 minutes" | night / 11 × 60 | 5.9 / 11 × 60 = 32 | OK |
| Wallbox 11 kW, €1,200 | `calibrated.wallbox_rule`, `rules.WALLBOX_COST` | | OK (installed 11 kW wallboxes run ≈ €1,000 to 2,500) |

## 6. Heat pump card (`Chain.tsx` sysBody.heatpump, `envelope_view.enrich`, `calibrated.heatpump_rule`)

| Figure | Rule | Hero, by hand | Verdict |
|---|---|---|---|
| "21.2 kW heat loss at -16 °C" | DIN EN 12831 simplified: Σ U × A × 36 K (floor × 0.5) + thermal bridges + 0.34 × 0.5 ach × 0.8 × 1,005.6 m³ × 36 | roof 2,081 + walls 4,149 + windows 6,638 + floor 1,414 + bridges 2,029 + ventilation 4,923 = 21,234 W | Arithmetic OK. Magnitude SUSPECT: 21.2 kW on the stated 140 m² is 151 W/m²; tables for a 1984 to 1994 detached house give 75 to 99 W/m² (10.5 to 13.9 kW) ([enter.de](https://www.enter.de/blog/heizlastberechnung), [klimaworld](https://www.klimaworld.com/blog/heizleistung_berechnen)); the gas bill gives €2,400 / 12 ct = 20,000 kWh / 2,300 h = 8.7 kW. Reonic's own table for an unrenovated old building is 120 to 150 W/m² ([Reonic](https://reonic.com/de-de/blog/waermepumpe-dimensionierung/)), which a 1985 house is not. Labelled "upper bound", but a planner will read it as the load |
| Annual heat demand 48,900 kWh (envelope, behind "i") | (H_T + H_V) × 89 kKh − gains | 590 W/K × 89,000 Kh ≈ 52.5 MWh − gains | SUSPECT: 2.4 × the 20,000 kWh the stated gas bill implies (260 kWh/m² on 188 m²) |
| Shares bar "Windows 31 %, Outer walls 20 %, Roof 10 %, Floor 7 %" | `SplitBar` over roof, wall, window, floor `share` of the **total incl. ventilation and bridges** | 6,638 / 21,234 = 31.3 %; the four shown sum to **68 %** while the bar is drawn full width | WRONG: either add Ventilation 23 % and Thermal bridges 10 % to the bar, or rescale the four to 100 % of transmission |
| Heated area 188 m² (envelope) vs 140 m² stated vs 282.6 m² estimate | three sources | | WRONG (three floor areas for one house; see Facts) |
| "No heat pump: the boiler's age is not known." | `heatpump_rule`: gas/oil and boiler ≥ 20 years | boiler age absent | SUSPECT: the next-question logic never asks boiler age (`leads.CANDIDATES` has no `boiler_age_years`), so this "not known" can never be resolved by Rina or WhatsApp |
| "Sized from the heating bill." (shown whenever a heat pump is in) | literal in `Chain.tsx` | `heatpump_rule` sizes from heat demand if given, else the bill, else `heat_demand_kwh()` (m² × kWh/m²) | WRONG when the bill is absent: print the derivation's actual source |
| Bivalence -6 °C, hot water 0.5 kW per person | `envelope_view.CONSTANTS` | Reonic docs: bivalence default -6 °C; blog 0.5 kW per person | OK |
| Heat pump capex (when included) | €33,500 − 30 % × min(33,500, 28,000) − €10,000 avoided boiler = €15,100 | KfW 458 base 30 %, eligible cap €28,000 first dwelling ([leospardo, KfW 458](https://leospardo.de/ratgeber/kfw-foerderung-waermepumpe/)) | SUSPECT: the €10,000 avoided boiler is subtracted inside "Investment", so the Total is not what the homeowner pays; show it as a separate saving line |

## 7. Proposed Design: tiles, kit, variants (`web/components/offer/*`)

| Figure | Rule | Hero, by hand | Verdict |
|---|---|---|---|
| Solar "10.35 kWp", Battery "10 kWh" | design | | OK |
| Investment "€14,620" | `sim._capex`: 2,333 + 883 × kWp + 315 × kWh (+ 1,200 wallbox, + HP net) | 14,622 → 14,620 | OK arithmetic. Plausibility: €1,108/kWp PV incl. inverter vs Fraunhofer ISE ≈ 1,015 €/kWp (970 to 1,200) for 10 to 100 kWp, March 2026 ([42watt summary](https://42watt.de/magazin/photovoltaik-kosten)); battery €315/kWh is the bottom of Verbraucherzentrale's 300 to 700 €/kWh installed ([reduco 2026](https://reduco.ai/blog/stromspeicher-kosten-vergleich-2026)). SUSPECT: low for a battery, so payback reads optimistic |
| Yield "9,580 kWh" | as Panels | | OK |
| Autarky "76 %" | as Panels | | OK |
| Break-even "10 years" | `sim.break_even_year`: first year cumulative undiscounted flows ≥ capex | cumulative year 9 −1,139, year 10 +467 (reproduced) → 10 | OK; crossing is at ≈ 9.7 years |
| Payback (behind the Break-even "i", plausibility "about 10 years") | capex / year-1 saving | 14,620 / 1,420 = 10.3 | SUSPECT: two "when it pays back" numbers (10.3 simple vs 10 break-even); see top 10 |
| Annual saving €1,420 | bill before − bill after − upkeep | 1,850 − 215 − 0.015 × 14,622 = 1,416 → 1,420 | OK |
| Bill after €215 | import × 37 ct − feed-in income | 1,197 × 0.37 − 228 = 215 | OK |
| Feed-in income €228 | 7.70 ct to 10 kWp, 6.66 above, none in the 573 sunniest TMY hours | blended 7.66 ct × 5,548 kWh = €425 if all paid; €228 means 2,573 kWh (46 % of export) unpaid | Rates OK: 7.70 / 6.66 ct from 1 Aug 2026 ([enter.de](https://www.enter.de/blog/einspeiseverguetung), [lexware](https://www.lexware.de/wissen/buchhaltung-finanzen/photovoltaik-einspeiseverguetung/)); 573 negative hours in 2025 OK ([Berliner Zeitung/SMARD](https://www.berliner-zeitung.de/article/573-stunden-minus-deutschlands-strompreise-erreichen-neuen-rekord-10012800)). SUSPECT magnitude: the real 2025 replay of the same design loses 2,012 kWh, not 2,573; and the extended-term compensation (EEG §51a) is ignored. Conservative, not wrong |
| NPV €8,330 | 20 years, 3 %, 2 % price rise, 0.5 % degradation, minus battery replacement PV | reproduced: 9,199 − 859 (€3,150 at year 15, less residual) = 8,340 → 8,330 | OK |
| IRR 8.66 % | bisection on the same flows | reproduced 0.0866 | OK |
| DC/AC "129 %" | 10.35 / 8 | 1.294; Reonic gauge 70 to 130 %, blog 1.1 to 1.3 for east-west | OK (edge of band; 0.0 % clipping is plausible east-west) |
| Inverter "8 kW, nearest 0.85 × 10.35" | explanation text; `rules.inverter_kw()` targets pv / 1.15 | 0.85 × 10.35 = 8.80 → 8; pv / 1.15 = 9.0 → tie 8/10, argmin takes 8 | SUSPECT: explanation and code use different ratios (0.85 vs 0.87); same result here |
| Kit "23 × Solar module 450 Wp" | `KitSheet`: round(kWp × 1000 / modules / 5) × 5 | 10,350 / 23 = 450 | OK |
| Kit "Installation and services" (no price) and rate card line "Installation and services €2,333, fixed per system" (branch `complete`) | intercept of the cost line through 5 kWp at €1,350/kWp and 20 kWp at €1,000/kWp | 2,333 | WRONG label: the intercept of a fitted price line is not an installation cost (installation is inside the per-kWp rate too). Call it "Fixed cost per system" |
| Rate card "Wallbox 11 kW €1,198, effective rate" (test lead) | total − parts | 15,820 − (9,139 + 2,333 + 3,150) = 1,198 | SUSPECT: the engine's €1,200 is known; the remainder carries the €10 rounding of the total. Use `WALLBOX_COST` and a separate rounding line |
| Total "€14,620 estimate" | capex | | OK |
| Variant "Best payback 3.6 kWp + 5 kWh, €7,090, break-even 9" | min simple payback over the frontier | 2,333 + 3,179 + 1,575 = 7,087 | OK |
| "Most independence 18 kWp + 15 kWh, €22,950" | min capex within 0.5 pt of top autarky | 2,333 + 15,894 + 4,725 = 22,952 | OK; 18 kWp = the layout's 40 modules (contradicts "57") |
| "Lowest upfront 1.8 kWp, no battery, €3,920" | cheapest with NPV > 0 | 2,333 + 1,589 = 3,922 | OK |
| Engine notes "€7,530 less upfront, 30 points less independence, pays back 1.2 years sooner" | differences vs expert | 14,620 − 7,090; 76.1 − 46.3; 10.3 − 9.1 | OK arithmetic; uses simple payback while the tiles beside it show break-even (10 vs 9 = 1 year) |
| "Change" line "15 fewer modules, 5 kWh less battery" | `differs()`: modules = round(kWp / 0.45) | 23 − 8 = 15; 10 − 5 = 5 | OK |
| "Best value" variant | engine returns it; `VariantTabs` maps names to keys and has no "Best value" | identical to expert here | OK for hero; on the test lead "Best value" (14.4 / 15, NPV higher) is dropped from the tabs. SUSPECT |

## 8. Homeowner page (`web/components/proposal/Proposal.tsx`)

| Figure | Rule | Hero | Verdict |
|---|---|---|---|
| Yield a year "9,580 kWh" | `annual.pv_yield_kwh` | | OK, same as planner |
| "Supplied by your system 76 %"; details "3,803 of the 5,000 kWh … 1,197 kWh from the grid" | autarky; own = load − import | 5,000 − 1,197 = 3,803 | OK |
| Investment estimate "€14,620" | capex | | OK, same as board and planner |
| Break-even "10 years" | `break_even_year`, else ceil(payback) | 10 | OK |
| 20-year cash line "€17,846 after 20 years" (classic chain Offer stage, `Chain.tsx` `Offer`) | `cashflow.add()`: undiscounted, **battery replacement not counted** | reproduced 17,847; the NPV beside it subtracts the €3,150 replacement at year 15 | WRONG: the cash line omits a cost the assumptions list says happens ("battery replaced after 15 years"). Expected ≈ €14,700 (17,846 − 3,150) |
| Tracker timing (PAST_LINE) | see Board | | WRONG (Installer B figures on an Installer A lead) |

## 9. Check page (`web/app/check/page.tsx`, `/api/eval`)

| Figure | Source | Value | Verdict |
|---|---|---|---|
| "18.6 % whole design within tolerance on 633 sealed held-out homes" | `eval.final_test`, rules-4, test half, lowest option, our bands | 0.186, n 633 | OK as reported. Note: rules-3-band scores 20.9 % and rules-5 19.6 % on the same sealed half; differences not significant (McNemar p 0.33 to 1.00) |
| "Textbook rule 6.8 %" | `eval.final_test` row "textbook" = **1.3 kWp per MWh + 2.5 kWp with an EV (docs/domain.md)** | 0.068 | SUSPECT: the Rules table on the same page calls **1.0 kWp per MWh at 980 kWh/kWp** "Reonic textbook"; "Reonic rule of thumb" (1 kWp and 1.25 kWh per MWh) scores **4.3 %**. Three different rules wear the word textbook |
| Per-part table (PV 40.9 %, battery 50.1 %, wallbox 78.8 %, HP 99.5 %) | final_test rules-4 | | OK |
| Tolerances "±1 kWp or ±15 %", "±2 kWh", decisions exact | `eval.components` | | OK. The next-question spread (`/api/ask`) uses a flat 1 kWp, not the 15 % arm (minor) |
| "Held-out replay: 7 of 20 drafts match the senior planner" | `/api/inbox` (80/20 board, seed 42) | recomputed with `planner_rules.split.halves()`: **10 of the 20 are in the rules-4 fit half**, and **5 of the 7 matches** are fit-half homes; test-half rows match 2 of 10 | WRONG: rules-4-readout was fitted on these homes, so "held-out" is false for half the rows. Fix: serve the inbox from the sealed test half |
| `/api/eval` overall 17.1 % on 258 vs 18.6 % on 633 | two splits (80/20 board vs 50/50 halves) | | SUSPECT: two headline numbers for one engine; the 258 board overlaps the fit half (only "clean 126" is unseen) |
| Qualification backtest "82 / 17 / 1" (branch `check`, `engine/lab/qualification_backtest.md`) | 258 board: Visit 211 (81.8 %), Call first 45 (17.4 %), Decline 2 (0.8 %) | | SUSPECT: the report says "the board is held out of the engine's training, so no home is scored by a model that saw it", false for rules-4 (132 of 258 in the fit half); the clean 126 gives 80 / 18 / 2. It also only tests the payback and 4,500 kWh clauses; with the address clause 0 % would be Visit |
| deviation_quality "ours better NPV on 327 of 514" | lab, sealed half | | OK as reported |

## 10. Rina / WhatsApp next question (`engine/app/main.py _question`, `leads.CANDIDATES`)

| Rule | Check | Verdict |
|---|---|---|
| Ask the candidate with the largest design spread ≥ 1 tolerance unit; candidates: use, heating type, EV, heat demand, existing solar | hero: none left above 1 → `next_question: null` | OK |
| Boiler age decides the heat pump but is never a candidate | hero's heat pump reason is "boiler's age is not known" | SUSPECT (see Heat pump) |
| Spread tolerance 1 kWp flat | scoreboard uses ±1 kWp or ±15 % | SUSPECT (minor) |

## 11. Rules readout (`docs/rules-readout.md`) and qualification doc

| Claim | Check | Verdict |
|---|---|---|
| A: 3,550 to 9,100 kWh → 10.35 kWp, 132 of 315, out of fold 38 % | matches the live PV reason | OK |
| rules-5 shows "179 of 488" for the same 10.35 kWp array | rules-4 says 491 A jobs in the fit half | SUSPECT: 488 vs 491, two counts of the same half in one payload (`rules_applied_rules5`) |
| "An extra kWp exported at 7.7 ct for 20 years is worth about 1,000 to 1,200 EUR discounted after upkeep" | engine's own model: ≈ 935 kWh/kWp, 46 % unpaid in the 573 hours → ≈ 505 kWh × 7.7 ct = €39 a year; × 14.9 (20-year annuity at 3 %) ≈ €580, less upkeep €13 a year ≈ €390 | WRONG vs its own feed-in model; the 1,000 to 1,200 holds only if every kWh is paid (≈ €820 after upkeep even then) |
| "Inverter: nearest 0.85 × PV" | code uses pv / 1.15 | SUSPECT (see Kit) |
| qualification.md "Expected offer rounded to 100 EUR" | code rounds to €1 | WRONG (doc or code) |

## Same quantity, different values

| Quantity | Place A | Place B | Place C |
|---|---|---|---|
| Roof capacity | plausibility: 57 modules | roof bar: 21.02 kWp (46.7 modules) | layout and variants: 40 modules, 18 kWp |
| Floor area (same house) | lead and chip: 140 m² | envelope heated area: 188 m² | roof estimate (test lead chip): 282.6 m² |
| Heat for the house | envelope: 48,900 kWh, 21.2 kW | bill rule: 20,000 kWh, 8.7 kW | tables (75 to 99 W/m²): 10.5 to 13.9 kW |
| When it pays back | tiles, homeowner: break-even 10 years | "i", plausibility, verdict, variant notes: payback 10.3 years | |
| 20-year value | NPV €8,330 (replacement counted) | cash line €17,846 (replacement not counted) | |
| EV charged at home (test lead) | simulation: 2,700 kWh (100 %) | wallbox card: 2,160 kWh, 5.9 kWh a night (80 %) | |
| Built year (hero) | lead text, envelope source: 1985 stated | Built chip: "estimated, 1979 to 1990" | |
| EV fact (hero) | chip: "No", stated | verdict tooltip: counted as not stated | |
| "Textbook" | Check headline: 1.3 kWp/MWh + 2.5 kWp EV (6.8 %) | Rules table: 1.0 kWp/MWh | Reonic rule of thumb: 1 kWp + 1.25 kWh per MWh (4.3 %) |
| Battery band | card: inside 0.7 to 1.0 kWh/kWp | Reonic: 0.2 to 0.6 kWh per daily kWh (fails at 0.73) | HTW: ≤ 7.5 kWh (fails) |
| Installer timing | PAST_LINE: 8 and 29 days (Installer B) | data for hero's Installer A: 0.7 and 20 days | |
| Whole-design match | Check: 18.6 % on 633 | `/api/eval` overall: 17.1 % on 258 | Inbox: 7 of 20 (half not held out) |

Rounding between surfaces: board, planner tiles, homeowner page and verdict all show €14,620, 10.35 kWp, 10 kWh, 76 %, 10 years for the hero; no rounding mismatch found. No percentage over 100, no Wh/kWh or ct/€ slip found in the hero payload (`energy_demand_wh` is converted in the engine; prices are applied as ct / 100 in `sim._price` and `_feedin_eur_kwh`).

## Top 10 issues, ranked, with the exact fix

1. **"Held-out replay" is not held out** (Check page, `/api/inbox`): 10 of 20 replay homes are in the rules-4 fit half and give 5 of the 7 matches. Fix: in `engine/app/main.py warm_inbox`, draw from `planner_rules.split.test_ids()` (the sealed half), and say "from the 633 sealed homes" in the lede; rerun the qualification backtest on the clean 126 or the test half and quote 80 / 18 / 2.
2. **Roof capacity has three values** (57 modules, 21.02 kWp, 40 modules): Fix: in `roof/roof.py` and `engine/app/roofs.py` derive `max_panels` and `max_kwp` from the layout (`layout.py` Σ `fits_panels` = 40, × 0.45 = 18 kWp) and use that one number in the plausibility line (`roofs.py:429`), the roof bar sentence (`layers.bars`) and `model.py:557`.
3. **Installer timing line shows Installer B on Installer A leads** (`Proposal.tsx PAST_LINE`, also on signed board cards): Fix: key the figures by `installer_id`: A "about 20 days from offer to signature" (n 1,276; drop the 0.7-day offer figure, n 18), B "8 days to an offer, 29 to a signature".
4. **Hero "Built" chip shows the stated 1985 as "estimated, 1979 to 1990"**: Fix: in `Facts.tsx` mark estimated only when the field is not in the lead's `_given` (or `envelope.build_year_source !== "lead"`); same for floor area (`near()`).
5. **Facts count says 7 of 9; the lead states 8** (EV "No electric car yet" counted as estimated): Fix: in `qualify.ts` count `ev` as stated when `has_ev` is in the lead's given fields (or `has_ev === false` was parsed from the text); count `annual_use` as stated only when it has a recorded source.
6. **Heat-loss shares do not add up** (four labels sum to 68 % on a full-width bar): Fix: in `Chain.tsx` heat pump body pass all six elements to `SplitBar` (add Ventilation 23 %, Thermal bridges 10 %), or label the four as shares of transmission (6,638 / 14,282 = 46 % windows etc.).
7. **Heat loss 21.2 kW and 48,900 kWh are about 2× the bill and the tables**: Fix: show the bill-based figure first when a heating bill exists ("€2,400 ≈ 20,000 kWh ≈ 9 kW"), and cap the envelope at the IWU typology's specific transmission loss; at minimum label the 21.2 kW "unrenovated upper bound" on the card itself, not only behind "i". Also fix the floor-area estimator (storeys from eave height, not ridge: 282.6 → ≈ 190 m²).
8. **Battery check failure is scrubbed from the planner card**: Fix: in `offer/facts.ts checkLine()` keep the band for `level === "reference"` ("0.73 kWh per kWh of daily use, above the 0.2 to 0.6 band"); replace the unsourced "usual 0.7 to 1.0 kWh per kWp" in `Chain.tsx` and `bars.py` with Reonic's "storage about the array's kWp" and its URL, and drop the HTW attribution or show HTW's 7.5 kWh cap.
9. **20-year cash line omits the battery replacement it assumes** (€17,846 vs NPV €8,330): Fix: in `engine/app/cashflow.py` subtract `kwh × BAT_EUR_KWH` in the year `battery_life_years()` returns (year 15 for the hero), giving ≈ €14,700 after 20 years; or state "battery replacement not counted" under the line.
10. **Two payback numbers on one screen** (break-even 10 vs payback 10.3; variant notes in payback, tiles in break-even): Fix: pick break-even year everywhere a homeowner or planner reads "pays back": `qualify.ts` reason (use `break_even_year`), `model.py` variant notes, plausibility "Payback about N years"; keep simple payback only behind the "i" with its own name.

Also fix, lower priority: EV home share (simulation 100 % vs card 80 %; pick one and show the arithmetic); "Installation and services" on the rate card is a price-line intercept (rename "Fixed cost per system"); boiler age is the heat pump trigger but never asked (add `boiler_age_years` to `leads.CANDIDATES`); "Sized from the heating bill" printed regardless of the actual source; "textbook" names three different rules on the Check page; doc drift (`docs/api.md` default price 32 ct, `docs/qualification.md` rounding to €100, `docs/rules-readout.md` 1,000 to 1,200 EUR per extra kWp).
