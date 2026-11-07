# PLAN

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
- Repo, collaborators, dataset on both Macs (private), domain research started.

## Next
- Engine and web agents launched 7 Nov 14:00.

## Risks
- PV size for installer 2a8ba8e2 is not in module rows; must be derived (mounting area, inverter, package names). Ask Reonic experts.
- Sparse inputs: most homes carry only demand, load profile, EV flag, heating type.
- Engine runs on the mini: if the mini is down, run it on the MacBook (`uv run` in `engine/`).
