# Marquee

Marquee drafts a home's panels, battery, wallbox and heat pump with the rules it used, reports how often the experts agreed on homes it never saw, and hands the completed design to the homeowner to sign.

Team Marquee (Zi Yuan, Xander, Jamon), thinc! hack MUC, 7 to 8 Nov 2026, Reonic case. Deck: [deck/marquee-reonic.pdf](deck/marquee-reonic.pdf). Reonic's case brief, provided to participants.

- Planner: https://marquee-reonic.vercel.app
- Homeowner: https://marquee-home.vercel.app
- Engine: runs on one machine behind a Tailscale Funnel; the web apps reach it through `ENGINE_URL`.

## How it works

1. **Facts in.** A lead arrives by form, pasted email or a call with the voice agent. Claude reads pasted text and calls into typed facts; it sizes nothing.
2. **Roof and shade.** Bavarian LoD2 gives the roof planes from the address, and a DOM20 surface-model ray-cast gives the shade on each panel.
3. **Sizing.** Depth-3 decision trees, one per installer for PV and one for the battery, fitted on Reonic's 1,619 projects with half sealed before fitting. On the 633 sealed test homes the whole design (PV, battery, heat pump, wallbox) is within tolerance of the expert on 18.6% against 6.8% for the textbook rule. PV alone: 40.9% against 19.4%.
4. **Economics.** An 8,760-hour PVGIS simulation of the year gives autarky, bill and payback.
5. **Prices.** Rate-card prices, 2026 German averages, not the installer's prices.

## Features

- Board with a verdict per lead (Priority, Call first, Decline) and triage.
- Copilot: Claude with tools over the engine; writes are proposed, applied on Apply and undone with Undo.
- Autopilot: works through every open lead and asks for what is missing.
- Live call: the voice agent fills the lead as the call goes.
- Client card for each lead.
- Four system views: PV, battery, heat pump, wallbox.
- Homeowner sign flow: the approved design on the homeowner page, then Sign or Decline.

## Stack

Next.js and TypeScript (three.js for the 3D scene), FastAPI and Python (pandas, scikit-learn, pvlib), Claude, ElevenLabs, Vercel.

## Setup

Reonic's data pack is not in the repo; point `REONIC_DATA_DIR` at it.

```bash
# engine
cd engine && uv sync && REONIC_DATA_DIR="/path/to/Project Data" uv run uvicorn app.main:app --port 8000

# web (new terminal)
cd web && npm install && npm run dev   # http://localhost:3000
```

`web/.env.local` needs `ENGINE_URL` and `ANTHROPIC_API_KEY`. The voice intake also reads `ELEVENLABS_API_KEY`, `NEXT_PUBLIC_ELEVENLABS_AGENT_ID` and `INTAKE_SECRET`. Keys live in `.env.local`, which is gitignored. The first engine start trains (about 35 s); later starts load a cache. Roof lookups need no key; `GOOGLE_SOLAR_API_KEY` is optional. Deploy: `cd web && vercel`. The API contract between engine and web is `docs/api.md`.

## Approach

**Statistics plus physics, no LLM in the engine.** The Claude API is used only at the edges in `web/`: turning a planner's sentence or a pasted enquiry into input changes, and writing prose. Every size comes from the engine.

**The chain.** PV, then battery given PV, then heat pump, then wallbox, each snapped to what that installer actually sells. A planner override replaces a stage and the later stages re-size around it. A battery needs PV.

**Rules readout.** After a steer from Reonic staff, the recommendation moved to short named rules read out of each installer's own signed designs, such as PV sized to annual use at the installer's typical array, a battery pack above a use threshold, a heat pump only for an old gas or oil boiler, a wallbox when there is a car. Every constant is printed in the UI, so a planner can check and overrule it. The learned chained model stays in the engine as a comparison (`RECOMMENDER` switches between them). Details: `docs/rules-readout.md` and `engine/README.md`.

**Roof from open data.** Bavarian LoD2 gives roof planes from a street address, so there is a measured roof before any site visit. Sources: LoD2, Google Solar and OpenStreetMap, in `roof/`.

**Hourly economics.** Each design runs through an hourly year (pvlib with PVGIS weather, a BDEW H25 load profile, a greedy battery, heat pump and EV load, EEG feed-in, 20-year NPV) for autarky and payback. Plausibility checks flag oversized batteries and clipping. Method and sources: `docs/physics.md`.

**One computed question.** The engine re-sizes the home for each answer to each open question and asks only the one that moves the design most.

## How we measure against the experts

The expert design is the lowest-numbered option of each project. We sealed half of Reonic's data before fitting and scored once on that test half: 633 homes the rules never saw. A home counts as a whole-design match when PV, battery, heat pump and wallbox are all within tolerance of the expert's (PV 1 kWp or 15%, battery 2 kWh, heat pump and wallbox as decisions).

| Share within tolerance, 633 test homes | Marquee | Textbook rule |
|---|---|---|
| Whole design (all four) | 18.6% | 6.8% |
| PV | 40.9% | 19.4% |
| Battery | 50.1% | 43.6% |
| Heat pump | 99.5% | 99.5% |
| Wallbox | 78.8% | 78.7% |

The heat pump and wallbox rows are near ties because almost no home has a heat pump and most wallbox decisions follow the EV flag. On the 126 test homes a black box model could also be scored on, the readable rules and the black box are statistically tied (McNemar p 0.33 to 1.00), which is why the readable rules ship.

Excluded from this scoreboard: 26 of 1,619 projects have no parts at all, and a further 312 have parts but no PV in the expert design (battery or wallbox add-ons). Neither can be scored as a new system. `engine/README.md` has the full tables and the sources. Live figures are served at `GET /api/eval`.

## Known limits

- The records hold no roof and no budget. Inputs explain only part of PV size, and near-identical homes agree with each other on the whole design only about 39 to 43 percent of the time, so the match rate has a ceiling.
- When a home has no bill on record, the engine uses a default of 4,500 kWh a year. About one home in six in the pack carries such a default.
- The wallbox follows a prior: a quarter of wallboxes in the pack went to homes with no car on record.
- Heat pump decisions are too rare in the pack to score meaningfully (13 sold). We never headline that number.
- The synthetic suite (10,000 generated homes) tests plausibility and energy balance, not accuracy against real homes.
- Costs are 2026 German averages, not the installer's prices, which the pack lacks. The physics sits within 2 to 5 points of the HTW Berlin calculator for homes without a heat pump; heat pump and EV load are unchecked against a reference.
- The demo installer on the homeowner page, Isarwerk Solar, is fictional. Installers A and B in the slides are the two anonymised installers in the data pack.
- The WhatsApp copilot reaches WhatsApp through a local bridge on one machine, so it works only while that machine is up.
- The voice agent was tested in a few calls and some text-only simulations.
- The engine runs on one machine; if it is offline the apps show the engine's own error.

## Repo map

| Folder | Content |
|---|---|
| `engine/` | Python (uv): parsing, rules, learned chain, hourly physics, evaluation, FastAPI |
| `web/` | Next.js (TypeScript) planner and homeowner apps; talk only to the engine |
| `roof/` | Address to roof area and planes |
| `voice/` | ElevenLabs intake agent: script, prompt, tests |
| `docs/` | API contract (`api.md`), sizing rules, physics, synthetic suite, data insights, pitch notes |
| `deck/` | Slides (`marquee-reonic.pdf`) |

Stack: Python 3.12, FastAPI, scikit-learn, pvlib, demandlib; Next.js, TypeScript; an ElevenLabs agent for the call.

## Data use

Reonic's project data was used only for this hackathon and is not in this repository. No rows, derived tables with rows or model files containing rows are committed; only aggregates. Two lists of opaque project id hashes used for the train and test split appeared briefly in the repository history; they carry no project attributes.
