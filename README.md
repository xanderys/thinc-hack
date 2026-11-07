# Marquee

Marquee drafts the system an experienced planner would design from a few facts about a home, shows the proof next to every number, and runs the homeowner's intake call, so the installer's pipeline from enquiry to signed deal moves faster.

Team Marquee, thinc! hack MUC, 7 to 8 Nov 2026, Reonic case.

- Planner: https://marquee-reonic.vercel.app
- Homeowner: https://marquee-home.vercel.app
- Engine: runs on one machine behind a Tailscale Funnel; the web apps reach it through `ENGINE_URL`.

## What it does

For the installer's planner inside Reonic, Marquee turns a lead into a complete design (PV, battery, heat pump, wallbox, each possibly "none"), with a reason per component, alternatives, and a check against what experts actually designed. The planner changes a sentence ("the family buys an EV next year") and the design re-sizes around it. The homeowner gets the same engine as a short form plus a voice call.

What is different:

- One computed question. The engine re-sizes the home for every answer to each open question and asks only the one that moves the design most.
- Proof on every number. Each component carries a derivation (one physical axiom with this home's numbers), the physics checks, and the most similar past homes.
- Rules a planner can read. A short list of named rules with printed constants is measured against 1,619 real expert designs, next to the learned model as a black box.
- Hourly physics. Every design is simulated hour by hour (weather, load, battery, tariff, feed-in) for autarky, payback and the economic optimum.
- Roof from open data. Bavarian LoD2 gives roof planes from a street address, with no sketch before the first offer.
- The engine runs the homeowner call. The intake agent asks only what the form missed, and the lead arrives with a design ready.

## How it was built

| Folder | Content |
|---|---|
| `engine/` | Python parsing, rules, learned chain, hourly physics, evaluation, FastAPI |
| `web/` | Next.js planner and homeowner apps; talks only to the engine |
| `roof/` | Address to roof area and planes (LoD2, Google Solar, OpenStreetMap) |
| `voice/` | ElevenLabs intake agent, script, prompt, tests |
| `docs/` | API contract (`api.md`), sizing rules, physics, synthetic suite, data insights |
| `deck/` | Slides (PDF) |

Stack: Python 3.12, FastAPI, scikit-learn, pvlib, demandlib; Next.js 15, TypeScript; an ElevenLabs agent for the call. The Claude API is used only at the edges in `web/` (turning a sentence into input changes, writing prose). There is no LLM inside the engine.

Setup (Reonic's data pack is not in the repo; point `REONIC_DATA_DIR` at it):

```bash
# engine
cd engine && uv sync
REONIC_DATA_DIR="/path/to/Project Data" RECOMMENDER=rules \
  uv run uvicorn app.main:app --port 8000   # RECOMMENDER=rules|ml, default ml
# web (new terminal)
cd web && npm install
# web/.env.local: ENGINE_URL, ANTHROPIC_API_KEY, ELEVENLABS_API_KEY,
#   NEXT_PUBLIC_ELEVENLABS_AGENT_ID, INTAKE_SECRET (names only)
npm run dev   # http://localhost:3000
```

The first engine start trains (about 35 s); later starts load a cache. Roof lookups need no key; `GOOGLE_SOLAR_API_KEY` is optional.

## Approach

**The chain.** PV, then battery given PV, then heat pump, then wallbox, each snapped to what that installer actually sells. A planner override replaces a stage and the later stages re-size around it. A battery needs PV.

**The physics.** An hourly year with pvlib (PVGIS weather), a BDEW H25 load profile, a greedy battery, heat pump and EV load, EEG feed-in and 20-year NPV. Plausibility checks flag oversized batteries, clipping and odd heat pump hours. Method and sources: `docs/physics.md`.

**The rules engine and the switch.** After a steer from Reonic staff we moved the recommendation to named planner rules: PV sized to annual use at the roof's yield with an installer oversize ratio, a battery for one evening's use, a heat pump for an old gas or oil boiler, 11 kW wallbox for an EV, inverter at 0.85 of PV. At most five constants are fitted, on one half of each installer's projects, and every constant is printed in the UI. `RECOMMENDER=rules|ml` switches between rules and the learned chain; both are scored side by side.

**The evaluation.**
- Held-out board: the expert design is the lowest-numbered option of each project, scored within tolerance (PV 1 kWp or 15%, battery 2 kWh, heat pump and wallbox decisions) on homes never used for fitting.
- Near-identical homes: how often the most similar past homes agree with the expert, as the ceiling for what the inputs allow.
- Two baselines: a textbook rule (1.3 kWp per MWh, plus 2.5 kWp with an EV) and a floor-slope fit.
- Synthetic suite: 10,000 generated homes checked against the hourly physics for plausibility, monotonicity and energy balance (`docs/synthetic.md`).
- Live numbers: `GET /api/eval`. The deviation analysis counts where ours or the expert's design is better on payback and autarky.

**Data rules.** The Reonic pack lives outside the repo and is read through `REONIC_DATA_DIR`. No rows, derived tables with rows or model files containing rows are committed; only aggregates.

## Known limits

- Inputs explain about 15 percent of PV size. The roof and the budget are not recorded, so near-identical homes agree with each other only 39 to 43 percent of the time.
- Heat pump decisions are too rare to score: 13 sold in the whole pack. We never headline that number.
- Neighbour agreement only weakly predicts where we miss, so the confidence figure is a guide, not a guarantee.
- The physics sits within 2 to 5 points of the HTW Berlin calculator for homes without a heat pump. Heat pump and EV load are unchecked against a reference.
- Costs are 2026 German averages, not the installer's prices, which the pack lacks.
- The "8 days" on the homeowner summary is the installer 23c108b7 figure and is calendar time including waiting, not planner hours.
- The voice agent was tested in a few calls and some text-only simulations.
- The engine runs on one machine; if it is offline the apps show the engine's own error.

## Slides, video, data use

Slides are in `deck/` and the demo video in `video/`.

Reonic's project data was used only for this hackathon and is not in this repository.
