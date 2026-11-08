# Adversarial verification of `figures.md`

Verified 8 Nov 2026 against the same worktree (branch `audit-figures`, code at 1947d76) and production reads (`https://marquee-reonic.vercel.app/api`, GETs only: `/leads/db67b84935`, `/leads/9dcedce634`, `/inbox?limit=20`, `/eval`, `/roof`, `/roof/model`, `/roof/shading`, `/health` = rules-4-readout). The split was recomputed locally with `engine/app/planner_rules/split.py halves()` on the data pack. No code was edited.

Verdicts: **CONFIRMED** (reproduced independently), **REFUTED** (the auditor is wrong, reason given), **CORRECTED** (finding stands, but a number or mechanism in it is wrong), **UNDECIDED** (evidence missing).

## Top 10

### 1. "Held-out replay" is not held out: CONFIRMED, and worse than stated
Claim: 10 of 20 replay homes are in the rules-4 fit half and give 5 of the 7 matches.

Reproduction: `engine/app/main.py warm_inbox` calls `Engine.inbox()` (`model.py:746`), which draws from `self.test`, the 80/20 board (seed 42) used to train the HGB/KNN model. Production recommends with rules-4 (`/health`: `rules_version rules-4-readout`), and `rules4.py` header says it is "fitted on the fit half" (`split.halves()[0]`, 786 ids; test half 784). The 20 production replay ids against `split.test_ids()`:

| id | inst | half | match |
|---|---|---|---|
| 438826d0ecb6c5ea | A | test | no |
| 4aa979ba09d0a395 | B | fit | yes |
| db66b27e168d6316 | B | test | no |
| 8a974a820a732eb1 | A | fit | no |
| 57785a43504a3fe5 | A | fit | no |
| 386e8798b6b65316 | A | test | no |
| 6be8d0e66775db0f | A | fit | yes |
| 53f021d4a28aec67 | A | fit | yes |
| 4fbe7582885fafbb | B | fit | yes |
| b48e921f43cfc8f1 | A | test | no |
| 050b8d6bb5dd0099 | B | test | no |
| 7036f47f1baa2ecd | A | fit | no |
| 5e78ef302b1c760c | A | fit | no |
| 59e0810ea90f5553 | B | test | no |
| 35481b50f5da367a | B | test | no |
| 91557300b8d8708f | A | test | yes |
| a5035032136862f1 | B | test | no |
| 2cbf52bb312b990e | B | fit | yes |
| e30867309c7505a6 | A | fit | no |
| 42116e503ac08075 | B | test | yes |

10 fit, 10 test; 7 matches, 5 on fit-half homes, 2 on test-half homes (2 of 10 = 20 %, in line with the sealed 18.6 %). Exactly as claimed.

Missed by the auditor: a second, independent bias. `Engine.inbox()` sorts buckets with `not k[2]`, so all-match buckets are drawn first in each round, and the first row is chosen because it matched. 7 of 20 (35 %) is inflated by selection as well as leakage. Serving from the test half alone does not fix the ordering.

### 2. Roof capacity has three values: CONFIRMED (four, in fact). One detail CORRECTED
- 57 modules: `roof/roof.py _panels()` = `int(usable // PANEL_M2)` with `PANEL_M2 = 2.0`: 115.6 // 2.0 = 57. The auditor's divisor "2.03" is wrong; the number stands.
- 21.02 kWp: `engine/app/roofs.py:40` `usable / M2_PER_KWP` = 115.6 / 5.5 (46.7 modules).
- 50 modules: plane `max_panels` 25 + 25 (70 % of area / 2 m², `roof/model/README.md`), a fourth figure.
- 40 modules (18 kWp): `roof/model/__init__.py:148` `fits_panels = len(layout.slots(p))`, 20 + 20, independent of the requested kWp.

Do the variants obey 40? Yes, but not through the cap the auditor implies. `model.py opt_grid/roof_cap` and the old `variants()` cap at `max_kwp` 21.02, but production uses `variants_physics` → `layout.value_frontier`, which drops any size whose layout places fewer modules than needed (`layout.py:107`). So 18 kWp is the true ceiling, and the 21.02 / 57 shown to the planner (`roofs.py:429`, `layers.py:297`, `model.py:555-557`) overstate it by 17 % / 43 %. `roof_cap()` would let the ML path propose up to 20.7 kWp, which does not fit.

### 3. Installer timing shows Installer B on Installer A leads: CONFIRMED
`Proposal.tsx:17-21` hardcodes 8 and 29 days, commented "installer 23c108b7 medians", and `PAST_LINE` is rendered on every signed board card (`Board.tsx:347`), on the homeowner page and in `Start.tsx:368`. Recomputed from `projects_status_quo.csv`: A (2a8ba8e2) enquiry to offer median 0.7 days (n 18), offer to signature 20.0 days (n 1,259); B 8.2 days (n 260), 29.0 days (n 302). The hero is installer A.

### 4. Built chip shows the stated 1985 as "estimated, 1979 to 1990": CONFIRMED
`Facts.tsx:46 builtEstimated()` returns true when `|stated − build_year_estimate| < 0.5`. Hero: stated 1985 (lead text, `envelope.build_year_source: "lead"`, `sources.house_built_year: "stated"`), Zensus estimate 1985, so the chip flips to "estimated". Missed: the decade picker (`Facts.tsx:104`) writes `decade + 5`, so any planner who taps "1980s" in this cell gets 1985 and the chip relabels the planner's own input as estimated. Use `lead.sources[field]`, which the engine already returns.

### 5. Facts count 7 of 9, should be 8: CONFIRMED
`qualify.ts:57`: EV counts as stated only if `has_ev` is true, `ev_annual_km` is set or history asked it. Hero: `has_ev false`, `ev_annual_km null`, `history []` → estimated; preference null → estimated. 7 of 9. The engine's own `sources.has_ev` is `"stated"` and the lead says "No electric car yet". Fix in `qualify.ts`: use `lead.sources?.has_ev === "stated"`. The "annual use counted as stated with no recorded source" point also holds: `sources.annual_demand_kwh` is "stated" while the lead text (`demo.ts:4-11`) has no use figure and `history` is empty.

### 6. Heat-loss shares do not add up: CONFIRMED, mechanism sharpened
`Chain.tsx:451-461` passes roof, wall, window, floor (`share` of the 21,234 W total incl. ventilation and bridges: 9.8 + 19.5 + 31.3 + 6.7 = 67.3 %). `Figures.tsx SplitBar` sets `flexGrow = v / sum` over the four shown, so the bar is renormalised: windows are labelled 31 but drawn as 46 % of the bar. The labels and the widths disagree, not just the total.

### 7. Heat loss 21.2 kW and 48,900 kWh about 2× the bill and the tables: CONFIRMED
Arithmetic reproduced from `/roof/model` envelope: 2,081 + 4,149 + 6,638 + 1,414 + 2,029 + 4,923 = 21,234 W; (21,234 / 36) × 89 kKh ≈ 52.5 MWh less gains → 48,900. Sanity:
- Per stated area: 21.2 kW / 140 m² = 151 W/m²; on the envelope's own 188 m², 113 W/m².
- Tables for a detached house built 1984 to 1994: 75 W/m² ([haustechnikdialog](https://www.haustechnikdialog.de/SHKwissen/1410/Spezifische-Heizlast), [klimaworld](https://www.klimaworld.com/blog/heizleistung_berechnen)), 95 to 99 W/m² ([enter.de](https://www.enter.de/blog/heizlastberechnung)), 60 to 80 W/m² ([enpal](https://www.enpal.de/waermepumpe/heizlastberechnung)). 140 m² × 60 to 99 = 8.4 to 13.9 kW.
- Bill: the engine's own `calibrated.heatpump_rule` uses €2,400 / 12 ct = 20,000 kWh / 2,300 h = 8.7 kW. The heat pump card therefore shows a 21.2 kW heat loss above a pump sized for 8.7 kW.

Likely causes (from the payload): the whole LoD2 volume including the roof space is heated (`ceiling` 0 W, "heated roof space"), ventilation on 1,005.6 m³, windows assumed 20 % of every wall at U 3.2. The floor-area estimator is also CONFIRMED wrong: `roof/roof.py _floor_area()` uses `round(measuredHeight / 3)` = round(8.9 / 3) = 3 storeys; LoD2 `measuredHeight` is ground to ridge. Ridge rise = (65.4 m² horizontal per plane / 13.03 m) × tan 25.1° = 2.35 m, eave about 6.55 m → 2 storeys → 130.8 × 2 × 0.72 = 188 m², which is the envelope's heated area. Doc drift: the docstring says × 0.8, `FLOOR_NET` is 0.72.

### 8. Battery check failure scrubbed from the planner card: CORRECTED (failure confirmed, mechanism wrong)
The message `layers.py:429` builds is "Battery 0.73 kWh per kWh of daily use: above Reonic's 0.6 guide, like 63% of your planners' signed designs." Running `facts.ts scrub()` on it (node, same regex) gives:

`Battery 0.73 kWh per kWh of daily use, like 63% of your planners' signed designs`

So the planner does not see "the ratio with no band and no flag": they see a garbled line that keeps the "like 63 %" comparison and drops what it compares to. Still WRONG. The 63 % is a hardcoded literal with no computation or doc behind it (grep finds it only in `layers.py:429`): UNDECIDED whether it is true.

Battery band: CONFIRMED unsourced and misattributed. `Chain.tsx:349,424` and `bars.py:92-99` say "the usual 0.7 to 1.0 kWh per kWp", and `bars.py` lists `SOURCES["htw"]`, whose own text is "at most 1.5 kWh of storage per 1,000 kWh of use". HTW's rules, via [Finanztip](https://www.finanztip.de/daily/stromspeicher-zur-pv-anlage-so-gross-darf-er-hoechstens-sein/) and [Orth 2022, HTW](https://solar.htw-berlin.de/wp-content/uploads/ORTH-2022-Empfehlungen-zur-Auslegung-von-Solarstromspeichern.pdf): at most 1.5 kWh usable per 1,000 kWh a year and at most 1.5 kWh per kWp, take the lower. Hero: 5,000 kWh → 7.5 kWh cap; the design has 9.0 kWh usable, so it fails HTW's use rule (it passes the per-kWp rule at 0.97). The band is also contradicted by the engine's own data: `layout.py:120` says signed designs sit at a median 1.1 to 1.2 kWh per kWp, and `docs/rules-readout.md:80` gives A 1.075 from 2025. "Usual" is false on the team's own evidence.

### 9. 20-year cash line omits the battery replacement: CONFIRMED, expected value CORRECTED
`cashflow.py` states "battery replacement not counted"; the payload ends at 17,846, and the assumptions list says "battery replaced after 15 years". `sim.battery_replacement_pv` charges €3,150 at year 15 and credits the straight-line residual at year 20 (10/15 × 3,150 = €2,100). Reproduced: undiscounted flows at 3 % give NPV 9,199; with replacement and residual 8,339 (payload 8,330). The consistent cash line is **€16,796** (replacement and residual, the NPV's own treatment), not the auditor's €14,700 (which drops the residual). Missed: the IRR has the same gap, 8.66 % without the replacement vs **8.20 %** with it, beside an NPV that counts it. Note that the cash line only appears in the classic chain Offer stage (`Chain.tsx:655`), and no NPV is printed beside it there.

### 10. Two payback numbers: CONFIRMED, one figure CORRECTED
Hero payload: `payback_years` 10.3, `break_even_year` 10. The verdict reason (`qualify.ts`), the plausibility line and the variant notes use simple payback; the tiles use break-even. The auditor's "Best payback 9.4 vs 9" is wrong: the payload has 9.1 and 9. The note "pays back 1.2 years sooner" = 10.3 − 9.1, correct arithmetic in simple-payback units.

## WRONG and SUSPECT rows outside the top 10

| Row | Verdict | Evidence |
|---|---|---|
| Qualification backtest "82 / 17 / 1", "held out of the engine's training" | CONFIRMED | `e3763bb:engine/lab/qualification_backtest.md` line 9 says no home was scored by a model that saw it; it uses the readout engine, which was fitted on the fit half. Clean 126: 101 / 23 / 2 = 80.2 / 18.3 / 1.6 % → 80 / 18 / 2 |
| `/api/eval` 17.1 % on 258 vs 18.6 % on 633 | CONFIRMED | `eval.overall.design_match_share` 0.171, split 80/20 n 258; `final_test` rules-4 test half 0.186 n 633 |
| Inverter "explanation 0.85 vs code pv / 1.15" | REFUTED for the design | The design's inverter comes from `rules4.py:314 → calibrated.inverter_rule`, `min(sizes, |s − 0.85 × pv|)` = 8 for 10.35, which matches the explanation. `rules.inverter_kw` (pv / 1.15) is used only for variant and frontier sizes. Two inverter rules exist in the code, but the shown explanation matches the shown design |
| "Sized from the heating bill" printed regardless | CONFIRMED | `Chain.tsx:262,466` literal; `calibrated.heatpump_rule:146-153` prefers heat demand, then bill, then `heat_demand_kwh()` |
| Boiler age never asked | CONFIRMED (code read) | Heat pump reason for the hero is "boiler's age is not known"; `boiler_age_years` null, `sources` "estimated" |
| EV home share 80 % vs simulation 100 % | CONFIRMED, plus a unit error | Test lead `ev_charge_kwh` 2,700 = 15,000 × 0.18 (100 %); `bars.py:12 HOME_SHARE = 0.8`. Missed: the code's own citation (`layers.py:80`) is "about 80 percent of electric cars … are charged at home", a share of cars, used as a share of kWh |
| rules-readout "1,000 to 1,200 EUR per extra kWp" | CONFIRMED | Fully paid: 935 kWh × 7.7 ct = €72 a year × 14.88 (20-year annuity at 3 %) = €1,071, less upkeep 1.5 % × €883 × 14.88 = €197 → €874 before degradation. With the model's 46 % unpaid exports, about €380. The claim fails even with every kWh paid |
| `docs/qualification.md` "rounded to 100 EUR" | CONFIRMED | `qualify.ts:64` `Math.round(e.capex_eur)`; the engine already rounds to €10 (`sim.py round(capex, -1)`) |
| `docs/api.md` "default 32" | CONFIRMED | `docs/api.md:25`; payload uses 37 |
| "Best value" dropped from tabs | CONFIRMED | `VariantTabs.tsx:28` `if (name === "Best value") continue;` |
| Rate card "Installation and services €2,333" | CONFIRMED (label) | `sim.py` assumptions: "PV €2,333 plus €883 per kWp (€1,350 at 5 kWp, €1,000 at 20 kWp)": a line intercept |
| Orientation factor 81 % vs engine yields | CONFIRMED (cosmetic) | `layers.py:410` east 0.81, west 0.79 → (20 × 0.81 + 3 × 0.79) / 23 = 0.807; plane `sun` 0.847 east, 0.79 west |
| Shading 0.6 %, 59 kWh | CONFIRMED OK | `/roof/shading` total 0.006, 59 kWh; module sum 58.2; per plane p1 0.012 / 14, p2 0.005 / 45. The plane-yield difference gives 55 kWh, a 4 kWh rounding gap, not material |
| Per-face kWp, Change lines, variant notes | CONFIRMED OK | 20 × 0.45 = 9.0 on p2 (94°, east), 3 × 0.45 = 1.35 on p1; notes: 14,620 − 7,090 = 7,530; 76.1 − 46.3 = 30; 22,950 − 14,620 = 8,330; 89.2 − 76.1 = 13; 12.7 − 10.3 = 2.4; 14,620 − 3,920 = 10,700; 76.1 − 17.7 = 58; 12.8 − 10.3 = 2.5 |
| DC/AC 129 % | CONFIRMED OK | 10.35 / 8 = 1.294 |
| Shading edge slivers 0.39 / 0.5 m | not re-checked | cosmetic |
| Feed-in €228, 573 hours | not re-checked | the rates were cited by the auditor; not material to the ranking |

## Final ranked fix list (confirmed items only)

1. **Replay leakage and selection bias** (`engine/app/model.py Engine.inbox`, `engine/app/main.py warm_inbox`, `web/app/check/page.tsx:258-259`): draw from `planner_rules.split.test_ids()` ∩ board, drop the "first must match" pick and the `not k[2]` ordering (order by kind and installer only), and keep the "held-out" label only after that. Correct `engine/lab/qualification_backtest.md` line 9 and quote the clean 126: 80 / 18 / 2.
2. **One roof capacity** (`engine/app/roofs.py:40,429`, `engine/app/layers.py:295-297`, `engine/app/model.py:555-557,678-685`, `roof/roof.py _panels`): set `max_panels` = Σ plane `fits_panels` (40) and `max_kwp` = 40 × 0.45 = 18 whenever the built model exists; otherwise keep the area estimate, labelled as such.
3. **Installer timing** (`web/components/proposal/Proposal.tsx:17-21`, used by `Board.tsx:347`, `Start.tsx:368`): key by `installer_id`. A: "about 20 days from offer to signature" (n 1,259; omit the n 18 offer figure). B: 8 and 29 days.
4. **Heat card** (`web/components/chain/Chain.tsx:451-466`, `engine/app/envelope_view.py`, `roof/roof.py _floor_area`): pass all six elements to `SplitBar` (or label the four as shares of transmission); print the actual sizing source; show the bill-based 8.7 kW beside or above the envelope's 21.2 kW; count storeys from eave height (hero 188 m², not 282.6).
5. **Facts provenance** (`web/lib/qualify.ts:49-58`, `web/components/stage/Facts.tsx:30,46`): use `lead.sources[field] === "stated"` for every fact and every chip instead of value tests; the hero becomes 8 of 9 and "Built 1985".
6. **Battery band and check line** (`web/components/chain/Chain.tsx:349,424`, `engine/app/planner_rules/bars.py:18,92-99`, `engine/app/layers.py:425-429`, `web/components/offer/facts.ts checkLine`): replace "usual 0.7 to 1.0 kWh per kWp" with HTW's two caps (≤ 1.5 kWh per MWh and ≤ 1.5 kWh per kWp, the lower one; 7.5 kWh for the hero) or the team's measured 1.1 to 1.2 median; compute or delete the "63 %"; render the reference line unscrubbed.
7. **Cash line, IRR and NPV on one basis** (`engine/app/cashflow.py`, `engine/app/hourly/sim.py break_even_year/irr`): subtract €3,150 at the replacement year and add the €2,100 residual at year 20 → €16,796 after 20 years, IRR 8.2 %.
8. **One payback figure** (`web/lib/qualify.ts` reason, `engine/app/model.py variant_note`, `engine/app/roofs.py` plausibility): use `break_even_year` wherever "pays back" is read; keep simple payback only behind "i" under its own name.
9. **EV home charging** (`engine/app/planner_rules/bars.py:12`, `engine/app/layers.py:80-99`, `engine/app/hourly/sim.py`): one share in both card and simulation, and do not read Fraunhofer's share of cars as a share of kWh.
10. **Doc drift**: `docs/rules-readout.md:43` (€1,000 to 1,200 per extra kWp → about €380 on the model's own feed-in), `docs/qualification.md:24` (€10, not €100), `docs/api.md:25` (37 ct), `roof/roof.py:351` docstring (0.72).

## What a judge can trust

The hero's money and energy chain holds up end to end. €14,620 investment, 10.35 kWp from 23 modules, 9,580 kWh yield, 76 % autarky, €1,420 saving, €215 bill, break-even year 10, NPV €8,330, DC/AC 1.29, shading 0.6 % / 59 kWh and every variant figure and note all reproduce from the code and agree across board, planner and homeowner pages. The sealed scoreboard (18.6 % whole-design match on 633 test-half homes, rules-4) is clean: those homes were not used to fit the rules. Do not trust the replay's "7 of 20 held out" (leaked and cherry-ordered, 2 of 10 on truly unseen homes), the roof capacity figures 57 modules and 21.02 kWp (the roof fits 40, 18 kWp), the heat-loss card (21.2 kW, about 2× both the bill and standard tables, with a bar whose widths do not match its labels), the battery "usual 0.7 to 1.0" band and its HTW attribution, the installer timing line on Installer A leads, the 20-year cash line and IRR (no battery replacement), or the facts count and Built chip for the hero.
