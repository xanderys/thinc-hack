North star: speed up the installer's whole pipeline, enquiry to design to offer to signed deal to installation. Every change must save planner or sales time, win more deals or raise turnover; otherwise cut it.

# PLAN (team Marquee, Reonic case)

## Pitch
A planner types a few facts about a home and gets the system an experienced planner would have designed, with the reason, the confidence and the proof against 1,000 real expert designs.

## Demo path
1. Describe the home: demand, household, heating, EV, installer. Design appears: PV kWp, battery or none, heat pump or none, wallbox, with one-line reasons and "homes like this one" evidence.
2. Refine: move a slider or type "the family buys an EV next year". The design updates and shows what moved and why.
3. Check against reality: pick a held-out project, see our design next to the expert's, then the scoreboard across all held-out projects against a rule-of-thumb baseline.
4. (Sunday stretch) Homeowner view on the same engine: toggle battery, see the bill change in plain words, optional spoken explanation.

## Out of scope
- Roof geometry, shading, product catalogues, pricing engines, PDF offers.
- Dash0, Taktile, any infrastructure beyond one Python engine and one Next.js app.

## Units and owners
| Unit | Folder | Agent | Host |
|---|---|---|---|
| Engine: parse designs, chained model, eval, FastAPI | `engine/` | REONIC ENGINE (Opus) | mini |
| Planner UI: Next.js, calls the engine | `web/` | REONIC WEB (Opus) | MacBook |
| Domain research | `docs/domain.md` | Sonnet | MacBook |
| Deck, README, pitch | `deck/`, `README.md` | Sonnet, Sunday | MacBook |
| Judge pass every 2 h | report only | Opus | mini |

Contract between units: `docs/api.md`. Change it only through the orchestrator.

## Milestones
- Sat 16:00 engine `/api/design` live on the mini, web shell renders a design from it.
- Sat 18:00 demo path 1 and 2 work end to end on a Vercel preview.
- Sat 22:00 scoreboard and held-out comparison work (path 3).
- Sun 08:00 features frozen; homeowner view only if 1 to 3 are solid.
- Sun 10:00 video recorded, deck in repo. Sun 13:30 submitted (cut-off 14:00).

## Done
- 15:40 Munich Live on https://marquee-reonic.vercel.app: lead read with quotes, one computed question, Plan system panel (house, four numbers, power flow, components, variants), refine by sentence with Approve, Check (validation cards, real held-out home, inbox of 20, scoreboard). Old pages at /classic. Engine: roof from Bavarian LoD2, derivation per component, offer variants, monotonic model, synthetic suite (10,000 homes, violations 3,135 to 740).
- Repo, collaborators, dataset on both Macs (private), domain research in docs/domain.md.
- 14:00 Engine live on the mini behind Tailscale Funnel with the full contract; merged to main. First scoreboard: full-design match 19.7% vs 2.5% baseline; PV MAE 3.4 kWp (weak), battery within 2 kWh 52.9% vs 40.4%.
- Engine v1.2 to v1.6 (hourly economics, ask, inbox, roof, derivation) and web stage steps 1 to 3 merged; production smoke 13/13.
- Deploy: MARQUEE SHIP runs vercel deploy --prod from the repo root then vercel alias set; Git deploys are cancelled by the ignore step.

## Next
- 22:50 Munich Sat: production main 18230d1 makes the Google mesh the 3D view (toolbar 2D / 3D, modules draped onto the real roof, hero 23 of 23 at 3 cm, LoD2 silent fallback after 6 s). Engine 496200b: no battery under 2 kWp. Demo leads pinned: db67b84935 Visit, ed63af6035 Call first, a29fbf4fe5 Decline (tiny roof), 110a31f171 Decline (homeowner declined). In flight: web batch of eight fixes (labels, massing walls, multi-unit, variants source, shading strip in Panels, expected offer to the header), heat pump step (branch heatpump, rebased on web), white context (branch white).
- 22:20 Munich Sat: production main carries lead qualification (web/lib/qualify.ts, board grouped Visit / Call first / Decline, verdict in the card header, 'Confirm on site' above Approve; demo leads db67b84935 Visit, ed63af6035 Call first, a29fbf4fe5 Decline, all pinned); backtest on 258 held-out sales Visit 81.8 / Call first 17.4 / Decline 0.8 % (engine/lab/qualification_backtest.md). Engine 9acc4ca adds envelope elements, window share and named constants (docs/api.md v2.7). In flight: web six-fix batch, heat pump step x-ray (branch heatpump).
- 22:08 Munich Sat: FREEZE CANCELLED by Xander; green ships when green, only 13:30 submit and 15:30 pitch stand. Engine restarted on b7e0f9f with per-panel shading live (hero 0.6 %, 59 kWh a year on 23 modules), fast startup, one-pipeline lead drafts, created_at, reset and pin; hero db67b84935 pinned and reset-checked; no 07:29 batch left, 07:57 cleanup of Test/Smoke leads stays.
- 22:05 Munich Sat: production main 716fc08 carries the 4 + 1 chain (Panels, Battery storage, Wallbox, Heat pump, Offer; 8-step path behind NEXT_PUBLIC_CHAIN=8) and the shading web layer (hidden until the engine mounts /api/roof/shading at 07:29; engine side staged and warmed, hero 0.6 %, 59 kWh a year on the 23-module design). Browser check on the hero: 5-step strip, Draft chip, no shading chip. In flight: label collisions, massing-model walls, multi-unit logic (web); lead qualification verdicts (qualify), both about 01:30.
- 21:57 Munich Sat: production main d0d977f adds the Photo watchdog (button hides on a 6 s stall) and the server warm of Google's root tileset when a card opens. Safari and Chrome passes on the hero card: draft-first, 2D-pin fix and Photo all pass.
- 21:55 Munich Sat: production main c7c5099 adds draft-first (instant draft with Draft/Approved/Signed chip, chain plays once on first open, collapsed strip with Show reasoning after, in-place redraft with a stamp and lit steps) and the fix for 3D and Photo being ignored on the Sanity and Offer stages. In flight: 4 + 1 chain regroup (web, about 1.5 h, 8-step path behind NEXT_PUBLIC_CHAIN=8), Photo stall fallback and server warm (photo), per-panel shading (shading).
- 21:50 Munich Sat: production main df8a265 adds Xander's phone fixes (Approve and preferences in the Offer stage, X close, touch gestures, flat neighbours), the Street View front photo via web /api/photo (hidden when no pano within 50 m, so the hero keeps its drawing) and the Photo view (Google 3D Tiles behind /api/tiles, toggle hides on failure). In flight: draft-first hero card (web), per-panel shading (branch shading, engine route mounted at 07:29 only if green by 06:00).
- 20:48 Munich Sat: SHIPPED to production: board of house cards, hero chain in Reonic's grammar (8 stages, 4 bars, camera per stage, sanity ticks, offer variants), homeowner site with iPhone call, proposal and sign; engine frozen on rules-4 with the sealed scoreboard and the lab's second look; demo lead db67b84935 (do not touch before 07:29). Sunday: 07:29 engine restart (fast startup, one-pipeline leads, reset and pin routes, created_at), 07:57 lead cleanup, 08:00 freeze, 08:30 video, deck resumes on Xander's word, 13:30 submit, 15:30 pitch.
- 19:45 Munich: board of house cards live (open card, converging call, Listening), spatial 8 layers on the house, homeowner site with iPhone call, engine frozen on readable rules with the sealed scoreboard. Remaining: spatial layers 4 to 8 into production, Xander and Yuan's Listening rehearsal, deck (paused on Xander), video 08:30 Sunday, submission 13:30.
- 15:55 Munich (earlier stamps above were read off the mini clock, Singapore time; subtract 7 h) Live: full stage with why-reveal, facts panel with preference variants, bands, judge fixes; voice wired behind a flag (off on production). Remaining tonight: Reality hero pinned to a hit, inbox heading wording, engine inbox filter. 23:00 freeze except demo-path bugs. Sun 08:00: Xander tests the voice call on preview, decides the flag; 08:30 video recording; 10:00 deck and README final; 13:30 submit.
- Stage: step 5 and 6, then the why-this-number reveal, facts panel with preference control, synthetic line, voice behind a flag. Deck and video re-pinned to hero v2. Sun 08:00 freeze, 10:00 video and deck final, 13:30 submit.
- 15:45 Product plan approved (see docs/briefs/stage.md): agentic stage at /, Reality at /check, old pages at /classic. Engine adds /api/ask and /api/inbox (v1.3). Deck resumed.
- Engine: PV accuracy (no-PV retrofits as a first decision, catalogue snapping), wallbox, economics lookup, README.
- Web: mock-backed planner by 16:15, then real engine.
- Insights: docs/data-insights.md by 15:45.

## Risks
- PV size for installer 2a8ba8e2 is not in module rows; must be derived (mounting area, inverter, package names). Ask Reonic experts.
- Sparse inputs: most homes carry only demand, load profile, EV flag, heating type.
- Engine runs on the mini: if the mini is down, run it on the MacBook (`uv run` in `engine/`).
