# Product plan: Marquee for Reonic

## Context
Xander rejected the current UI (form plus spreadsheet, stats strings, no story) and set the direction: an agentic product with Apple-level intentionality, mission "repeated mechanical work to machines, creative and strategic judgement to humans", one flow with three moments plus one tap to check against reality, Clase Labs visual system kept (paper, ink, one blue, Instrument Serif and Sans, Plex Mono, radius 0). ICP: Reonic's product team, so this is a feature inside Reonic's planning tool. The engine (v1.2: learned chain, 15-neighbour evidence, hourly pvlib physics, optimum, validate, held-out eval with ceiling and two baselines) is frozen and stays LLM-free. Build window: Sat 16:00 to 23:00, Sun 08:00 to 10:00. Submission Sun 14:00, final 15:30.

## Thesis (two sentences)
A planner pastes a lead; the agent reads it, asks the one question that would change the design most, writes the offer a senior planner would have written, proves it, and flags the one thing a human must check. The planner changes it in a sentence and approves; then the curtain lifts: the home was real, the expert's design appears beside the draft, and an inbox of 20 real held-out projects the agent drafted scores itself live.

## The flow (one stage at `/`, three moments; `/check` becomes "Reality")

**Moment 1, Paste the lead.** Serif line "Paste the lead." Textarea pre-loaded with the hero lead: a fictional homeowner email (Xander's choice), written to leave one high-value fact out (heating type) so the question fires. Button "Read it". Returns "Found in the lead": each fact with its quote from the lead beneath. Installer toggle stays. Then one serif line: "Not in the lead: what heats the house. It changes the design most." with three buttons. Silence if nothing would move the design. Uses `HomeInputs`, `/api/ask` questions[0], `/api/read`.

**Moment 2, What I would offer.** Two or three sentences of serif prose from the LLM edge (fallback: engine `explanation[]`). Design strip: four mono numbers in a row, "none" in ink-3. Under each, one plain line from `neighbours` ("most homes like this get 9 to 11"). Proof on tap, three text tabs: "Homes like this one" (`neighbours`, `alternatives`, `confidence`), "The year, hour by hour" (`economics.annual`, autarky, self-consumption, assumptions in a details), "The cheapest version" (`optimum.design`, `delta_vs_proposal`, `optimum.note`). Exactly one flag, chosen deterministically in web: first `plausibility` warn, else the lowest-confidence included component, else the optimum note. "Change by hand" disclosure keeps today's Fix controls.

**Moment 3, Change it in a sentence.** Input, placeholder "The family buys an EV next year", "Apply". Chips for input changes, diff as lines not a table ("Wallbox: none → 11 kW. PV: 9.9 → 10.8 kWp, re-sized around the car."). "Approve" (becomes "Approved 18:42") and "Undo". Approve stores `{inputs, draft, approved}` in sessionStorage and reveals "See what really happened".

**Reality (`/check`).** Section 1 "Now a home that was real.": the hero lead is fictional, so this section picks a held-out project (the hero project in `web/lib/demo.ts`, chosen tonight for a PV and battery hit and a non-trivial question; a second, deliberate miss project rehearsed for Q&A) and shows two columns, the agent's draft and the senior planner's actual offer; within-tolerance marks in ink, misses in blue, one serif line per miss from the component reason. If the planner approved a design on the stage, a third column "You approved" appears for comparison of habits, not scoring. Section 2 "The agent drafted 20 more.": inbox rows from `/api/inbox`, label, draft in mono, confidence as words (sure, likely, unsure at 0.7 and 0.5), "matches the expert" or "review", unsure first, a running tally as rows land ("14 of 20 within tolerance on PV"). Header reads "258 held-out signed projects, replayed through the engine". Section 3: one serif paragraph with the scoreboard as proof (ours, textbook, near-identical-homes agreement, PV MAE); today's tables inside a details "All the numbers".

Tone: plain sentences, British English, no "Confidence 62%" or "n=15, p25 to p75"; a number appears only inside a sentence that makes a claim. Old pages kept at `/classic` and `/classic/check` as the fallback (judge's advice: never regress the EV sentence that already works).

## New engine endpoints (contract v1.3, additive, LLM-free, built by REONIC ENGINE in `engine/app/main.py`)
1. `POST /api/ask` `{ inputs }` → `{ questions: [{ field, current, options: [{ value, design }], spread }] }` top 3 by spread. Candidates: heating_type Unknown → Gas | Heatpump; has_ev false → true at 12,000 km; annual_demand_kwh absent or the 4,500 default → 3,000 | 6,500; heating_demand_kwh missing on a fossil home → 12,000 | 20,000; has_solar false → true at 6 kWp. spread = Σ |Δsize| / tolerance (1 kWp, 2 kWh) plus 1 per decision flip, max over options. About 12 predict calls, under 50 ms. Empty list when nothing moves.
2. `GET /api/inbox?limit=20` → rows `{ project_id, installer_id, label, inputs, draft, confidence, expert, within: { pv, battery, heatpump, wallbox, all } }` from the test split in demo order. Web falls back to `/api/projects` plus per-row detail on 404 so the demo works before the merge.

## LLM edge (web only, claude-sonnet-5-5, structured output like `/api/interpret`)
- `POST /api/read` `{ lead }` → `{ inputs, found: [{ field, value, quote }] }`. Every field carries a quote that must be a substring of the lead (server check, else dropped). Nothing unquoted is set; no sizes ever come from this call.
- `POST /api/write` `{ facts: string[], mode: "planner" | "homeowner" }` → `{ text, grounded }`. Facts built from engine fields only. Two or three sentences; every number in the text must appear in `facts` (server regex check; on failure `grounded: false` and the UI shows `explanation[]`); no quality adjectives; first person as the agent.
- `/api/interpret` unchanged.

## Motion
Two springs only. `--spring-smooth-500` (exists) for arrivals: 8 px translateY fades, 40 ms stagger, inbox rows one per 120 ms capped at 2.5 s. `--spring-snappy-350` (add, no visible overshoot) for in-place feedback: chips, diff lines, Approve to Approved, number re-marks. Only transform and opacity animate; hover colour only behind `(hover: hover)`. Reduce Motion: 200 ms opacity, no stagger, tally jumps. Nothing waits on motion.

## Phone width (under 640 px)
Single column, moments stacked; design strip 2x2; proof tabs become one details each; sentence input sticky at the bottom; Reality columns collapse to one row per component with three mono values; inbox rows as two-line cards; 44 px targets. Test at 390 px before each merge.

## Build order (one Opus web agent on branch `web`; engine endpoints by REONIC ENGINE in parallel; MARQUEE SHIP merges and smokes; web freeze lifts on Xander's approval of this plan)
1. 16:00 to 16:40: types for ask, inbox, read, write in `web/lib/api.ts`; `web/lib/demo.ts` with the fictional hero lead (heating type omitted on purpose), the hero held-out project id for Reality (chosen from `/api/projects?split=test`: installer A, fossil heating or EV, PV and battery within tolerance) plus one deliberate miss project for the Q&A story; mock routes. Move today's pages to `/classic` and `/classic/check`, hidden from the masthead. Merge, nothing visible changes.
2. 16:40 to 18:00: `/api/read`, `/api/write`; `components/Lead.tsx`, `components/Recommendation.tsx`; `page.tsx` becomes the stage with Moments 1 and 2. Merge, deploy.
3. 18:00 to 19:30: `components/Refine.tsx` (chips, diff lines, Approve, Undo, sessionStorage); `globals.css` compositions and the second spring. Merge. **20:00 cut line: Moments 1 to 3 on stage with the LLM; `/classic/check` still works.**
4. 19:30 to 21:00: `/check` rewrite: reveal, inbox with live tally, scoreboard paragraph, old tables in a details. Merge.
5. 21:00 to 22:00: `/api/ask` wired (hidden on 404); phone pass at 390 px; Reduce Motion pass.
6. 22:00 to 23:00: full stage run twice on production; fixtures recorded. **23:00 cut line.** Sunday 08:00 to 10:00: homeowner mode of `/api/write` as a toggle under the prose, copy polish, deck screenshots. Never: anything touching the engine's model.

## Stage risks
1. Claude API slow or down: `web/lib/demo.ts` holds recorded real outputs of read and write for the hero lead, returned only on API failure (`cached: true`); engine `explanation[]` as second fallback; shortcut `d` loads the hero lead.
2. Engine over the Funnel restarting: keep the restart countdown and retry; `docs/smoke.sh` before going on stage; rehearse `ENGINE_URL` switch to a MacBook engine once tonight; `ENGINE_URL=mock` last resort with the masthead saying so.
3. Reveal shows a miss on the hero, or the question is dull: pick the hero tonight from the inbox; rehearse the miss story (inputs explain 15% of PV, the rest is not recorded, that is the planner's job), which is the thesis anyway.

## Judge findings to honour (from the stress test)
- Cite `engine/README.md` and live `/api/eval` (PV 36.8% vs 17.8% textbook vs 31.7% near-identical homes; all four 17.4% vs 6.6% vs 16.1%). Reconcile `docs/data-insights.md` (39%, 17.9%) before Q&A: it used last-option ground truth, the engine uses lowest option.
- Must be true: ceiling next to score; every miss names its reason; the on-stage reveal includes a miss somewhere; the VOI question is computed and silent when nothing moves; prose numerically guarded; inbox labelled as held-out replay with real engine calls.
- Never claim: beats experts, heat pump accuracy (n = 12), battery lift (noise), learns from corrections, real leads, hours or euros saved (no time or price data in the pack), "the roof decides" (not in the data), physics validated beyond "within 2 to 5 points of HTW Berlin on homes without heat pump or EV", installer prices.
- Feature per jury: Reonic finalist = exception inbox with reasons and ceiling; VC = the single computed question after a pasted lead.
- Pitch beats (240 s): open 20 s (two planners at the same installer agree 16%); home described 50 s (inputs explain 15% of PV, so the question is worth asking); system appears 60 s (planners install 2.0 kWp per MWh, textbook under-sizes 82%); refined 40 s (91% of wallboxes went to homes with no EV on record); checked 60 s (17.4 vs 6.6 vs 16.1); close 10 s (planners sign off exceptions, the machine drafts the rest, every number has a source).

## Verification
- After each merge: `docs/smoke.sh` on https://marquee-reonic.vercel.app plus the new checks: `/api/read` returns quoted facts for the hero lead; `/api/write` returns `grounded: true`; `/api/ask` returns a question for a lead without heating type and an empty list for a complete home; `/check` shows the reveal after Approve and 20 inbox rows with a tally.
- Phone pass at 390 px with the browser skill; Reduce Motion pass.
- Two full stage runs on production at 22:00; a recorded fallback video Sunday 10:00.

## Domain context (research, pending: Reonic and installer ICP, sizing science, frontier products)
To be appended when the three research agents return; feeds copy, Q&A and the deck, not the build order.

## Canonical hero home (all surfaces use these exact inputs; live engine outputs on 7 Nov 15:50)
Inputs: installer 2a8ba8e2, 5,000 kWh a year, FamilyOfFour, 4 inhabitants, 140 m2, built 1985, gas heating costing about 2,400 EUR a year, no EV, no wallbox, no solar, no storage, 37 ct/kWh. The hero lead email states all of these, including gas heating and "no electric car yet", except the annual electricity use; the one question asks for annual use (engine options about 3,000, 5,000, 6,500 kWh), the answer is 5,000. The web passes `unknown` fields to /api/ask so stated facts are never asked.
- Base design: 7.65 kWp, 6 kW inverter, 10 kWh battery, no heat pump, no wallbox. Capex 14,150 EUR, saves 1,330 a year, payback 10.6 years, autarky 75%.
- After "The family buys an EV next year" (15,000 km): 10.35 kWp, 8 kW inverter, 10 kWh, 11 kW wallbox.
- After "and replace the gas boiler with a heat pump": heat pump 10.5 kW added; all four present (used by the video x-ray). With the heat pump: 29,630 EUR, saves 1,900 a year, payback 15.6 years (30% subsidy and a 10,000 EUR boiler replacement avoided, stated as assumptions).
Reality section uses a real held-out project (pick from /api/inbox; first row is a PV and battery hit).
