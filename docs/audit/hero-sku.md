# Hero figure audit after the SKU snap (thinc! hack, Marquee)

Run 8 Nov 2026 about 10:05 Munich, read-only. Sources: `GET https://marquee-reonic.vercel.app/api/leads/db67b84935` (version 139, design_hash 6d5f3efb, model rules-4-readout), `/api/leads`, `/api/roof?address=…`, `/api/roof/model?lead_id=db67b84935`, `/api/eval`, engine `/health` (rules-4-readout). Code read at origin/main e849555 and origin/sku 8bbbc15 (sku web is not yet in main). Formulas as in `docs/audit/figures.md` and `verification.md` (branch audit-figures). The Checks payload (`POST /api/explain/layers`) was not called (GETs only); its DC/AC rule is read from code.

## Hero chain

| Figure | Engine | By hand | Verdict |
|---|---|---|---|
| PV size | 10.65 kWp | 23 × 463 W = 10,649 W | OK |
| Inverter | 10 kW Sigenergy | ladder 5 / 10 / 20 kW; only 10 kW puts 10.65 kWp inside 70 to 130 % | OK |
| Battery | 10 kWh EcoFlow | rule leaf 9.2 kWh → package 10 | OK |
| Price | €14,890 | 2,333 + 883 × 10.65 + 315 × 10 = 14,886.95 → €14,890; `rates.total_eur` 14,887 | OK |
| Yield | 9,858 kWh | 9,580 × 10.65 / 10.35 = 9,857.7 (925.6 kWh/kWp unchanged); layout 9,857 | OK |
| Autarky | 76.5 % | (5,000 − 1,173) / 5,000 = 0.765 | OK |
| Self-consumption | 41.2 % | 4,058 / 9,858 = 0.412; 4,058 + 5,800 = 9,858 | OK |
| Bill after | €195 | 1,173 × 0.37 − 239 = 195 | OK |
| Saving | €1,430 | 1,850 − 195 − 0.015 × 14,887 = 1,432 | OK |
| Payback | 10.4 years | 14,890 / 1,430 = 10.41 | OK |
| Break-even | year 10 | cumulative year 9 −1,261, year 10 +362 | OK |
| IRR | 8.1 % | bisection on `cashflow_yearly_eur` (replacement and residual in): 0.0810 | OK |
| NPV | €8,320 | same flows at 3 %: 8,319.6 | OK |
| 20-year cash | €16,864 | Σ flows = 16,864; year 15 = 1,741 − 3,150 = −1,409; year 20 = 1,869 + 2,100 = 3,969 | OK (now on the NPV's basis, audit-figures fix 9 landed) |
| Battery replacement | €3,150 in year 15, residual €2,100 credited in year 20 | 10 kWh × €315; straight-line 10/15 × 3,150 = 2,100 (`economics.battery_replacement`) | OK |
| DC/AC | 1.065 (107 %) | 10.65 / 10 | OK in every live band: Checks gauge `planner_rules/bars.py:145` is **70 to 130 % (Reonic)**, engine fallback `layers.py:401` passes 1.0 to 1.35, `rules.py` 0.7 to 1.3 and 0.8 to 1.3. No 110 to 150 % band exists in code. Only the descriptive "1.1 to 1.3 usual" label and `physics.py` (1.1 to 1.3, nearest 1.2, not the production rule) would place 1.065 just below. The plausibility line prints "1.06" (Python rounds 1.065 down); the Checks gauge shows 106 or 107 %. SUSPECT label only |
| Roof capacity | 40 modules, 18.52 kWp | 40 × 0.463 = 18.52 (`/api/roof` max_panels 40, max_kwp 18.52, capacity_source layout; "Most independence" variant is the full roof, 18.52 kWp) | OK |
| Sealed score | 18.6 % on 633 | `/api/eval final_test` rules-4 test half all_four 0.186, n 633 | OK, unchanged |

## Catalogue ladder and kit rows

| Check | Payload | Verdict |
|---|---|---|
| Module 463 W exists | `skus.module` Sunpro PV Module 463W TOPCon Glass-Glass Promo, modules 23, share 1.0 | OK |
| Inverter 10 kW is a Sigenergy SKU | Sigenergy Hybrid Inverter 10kW, share 0.812 | OK |
| Battery 10 kWh is an EcoFlow SKU | EcoFlow Battery LFP 10kWh, share 0.639 | OK |
| Variants on the ladder | 10.19 (22 mod), 3.7 (8), 18.52 (40), 0.93 (2) kWp; inverters 5 / 10 / 20; batteries 5 / 10 / 18 | OK; all capex reproduce (14,480, 7,180, 24,360, 3,150) |
| Rate card | "PV 10.65 kWp: fixed cost per system €2,333 plus €883 per kWp" €11,737, SKU Sunpro × 23; battery €3,150 EcoFlow | OK |
| Kit sheet module row | origin/sku: `skus.module.size` → "23 × … 463 Wp". origin/main: `round(10,650 / 23 / 5) × 5` = **465 Wp** | WRONG on main until sku merges (expected 463 Wp) |
| Kit rows inverter / battery / installation | Sigenergy 10 kW, EcoFlow 10 kWh, "Installation and services" (no price) | OK on sku branch; generic names on main |

## Same numbers on board, planner, homeowner

Board `/api/leads` title "10.65 kWp + 10 kWh" OK. Board reason, planner tiles and homeowner page all read the same `draft.economics` (one payload, one design_hash), so €14,890, 9,858 kWh, 76.5 %, year 10, €16,864 match by construction. Not checked on rendered pages (no browser by brief).

## Stale figures in the payloads

| Where | Text | Verdict |
|---|---|---|
| `draft.explanation[4]` | "Inverter 8 kW, nearest 0.85 x 10.35 kWp." | WRONG: expected "Inverter 10 kW (Sigenergy), DC/AC 1.07" |
| `draft.explanation[0]`, `components.pv.derivation.equation`, `.final` 10.35 | rule leaf 10.35 kWp with no catalogue step (`rules[0].rule.text` has "Catalogue size: 10.65 kWp (23 x 463 W modules)", the explanation does not) | WRONG: `final` should be 10.65 and explanation[0] should carry the catalogue sentence |
| `rules_applied[0].sentence` | "capped by the roof in whole 450 W modules" | WRONG: 463 W |
| `draft.plausibility[1]` | "The roof fits 57 modules, about 116 m2" | WRONG: `/api/roof` says 40 modules, 18.52 kWp |
| `explanation`, `rules`, `rules_applied` | "Installer A" 28 times | WRONG against the brief ("no Installer A/B wording anywhere") |
| `/api/eval` | 10.35 kWp, 8 kW in replay and synthetic rows | OK: exam path is unsnapped by design |
| `web/lib/demo.ts` CACHED_WRITE | keys and texts quote 10.35 kWp, 8 kW, €14,620, 9,580 kWh | SUSPECT: the cache keys no longer match the new prompt, so it falls through to a live write; stale text in repo |
| `web/components/offer/facts.ts` modulesOf, rate-card fallback, `qualify.ts` | 0.45 kWp per module: 10.65 / 0.45 = 24 modules, variant delta 24 − 8 = 16 instead of 15 | WRONG wherever the layout count is absent |

No €14,620 survives in any lead payload; no 8 kW survives outside explanation[4] and the eval exam rows.

## Fix list

1. Engine: rebuild `draft.explanation` after the snap: inverter line "Inverter 10 kW, DC/AC 1.07"; PV line with the catalogue step; `components.pv.derivation.final` = 10.65.
2. Engine: `rules_applied` PV sentence "whole 463 W modules"; `plausibility[1]` from the layout capacity (40 modules, 18.52 kWp), not the area count 57.
3. Engine: replace "Installer A/B" in explanation, rules and rules_applied with the installer name.
4. Engine: print DC/AC as `round(pv / inv * 100)` % or 2 dp with half-up, so 1.065 shows 107 % / 1.07 everywhere.
5. Web: merge origin/sku (kit row reads 463 Wp from `skus.module`); until then main shows 465 Wp.
6. Web: take module watts from `skus.module.size` in `facts.ts` (modulesOf, rate-card fallback) and `qualify.ts`, not 0.45 kWp.
7. Web: refresh or delete the stale `CACHED_WRITE` entries in `web/lib/demo.ts`.
8. No action: no 110 to 150 % DC/AC band exists; 107 % passes the Checks gauge (70 to 130 %).
