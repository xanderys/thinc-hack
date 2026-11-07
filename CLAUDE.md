North star: speed up the installer's whole pipeline, enquiry to design to offer to signed deal to installation. Every change must save planner or sales time, win more deals or raise turnover; otherwise cut it.

# Reonic planner (thinc! hack MUC, 7 to 8 Nov 2026)

From a few facts about a home, propose PV, battery and heat pump the way an experienced planner would, let the planner refine it, and prove it against real expert designs. Judges: Reonic (technical depth, user fit, business impact, demo) then a VC jury (creativity, realisability, usability, pitch).

## North star (Xander, 7 Nov 2026)
Marquee exists to speed up the whole end-to-end pipeline for installers who use Reonic: from enquiry to design to offer to signed deal to installation. Faster, more efficient, more turnover for the installer. Test every piece of work against it: does this make a planner or salesperson faster, help them win more deals, or get more systems installed? If not, cut it or park it. Every screen, number, slide and line of the pitch shows time saved, deals won or turnover gained. (We have no time or price data in the pack: show the steps the agent removes and the decisions it makes consistent, never invented hours or euros.)

## Expected outcome (the goal, in Reonic's words)
"We expect a working slice with an end-to-end demo story, not a production system. Reach the minimum first, then aim higher."

**Minimum**
- For a given project, your system proposes a complete design, PV, battery and heat pump as appropriate, with a short explanation of why.
- You measure how close your designs come to the expert designs on projects your system has not seen.
- The planner changes at least one input or component and receives an updated design.

**Stretch goals**
- An analysis of where and why your designs deviate from the experts.
- Alternatives and confidence for every recommendation.
- A validation view for planners, or a view in which homeowners explore their offer, built on the same engine.

**The demo moment** ("a five-minute story like this")
1. **A home is described:** a planner enters a few basic facts about a project.
2. **A complete system appears:** PV, battery and heat pump as appropriate, with a short explanation of why.
3. **The design is refined:** for example, "the family is buying an electric car next year", and the design adapts sensibly.
4. **It is checked against reality:** the proposal is compared with the expert design for the same project, and you show how well your system does across many projects.

Before any change, ask which minimum, stretch goal or demo step it makes better or safer on stage. Minimum before stretch. If none, it waits.

## Run it
- Engine: `cd engine && uv sync && REONIC_DATA_DIR="/path/to/Project Data" uv run uvicorn app.main:app --port 8000`
- Web: `cd web && npm install && npm run dev` (http://localhost:3000, needs `ENGINE_URL` and `ANTHROPIC_API_KEY` in `web/.env.local`)
- Demo path: PLAN.md. Contract between engine and web: `docs/api.md`.
- Deploy: `cd web && vercel` (engine stays on the mini behind Tailscale Funnel).

## Map
- `engine/` : Python, uv. Parses the data pack, trains the chained model, evaluates on held-out projects, serves FastAPI.
- `web/` : Next.js App Router, TypeScript. Planner UI. Talks only to the engine via `ENGINE_URL`.
- `docs/` : `api.md` (contract), `domain.md` (sizing rules with sources), `briefs/` (agent briefs).
- `deck/` : pitch slides (PDF goes here before submission).
- Plan and status: `PLAN.md`.

## How we work
- The main session orchestrates and writes no code. Each agent owns one folder; never edit another agent's files. `docs/api.md` changes only via the orchestrator.
- Branch per unit (`engine`, `web`, `deck`). Push often. Merge to main every 30 to 45 minutes when the demo path still works.
- Verify by running it and looking at real output. One quick check per unit, no test suites unless a bug keeps coming back.
- Report as built, checked, deployed: say which, never claim more.

## Product rules
- Never fake state. Errors show the source's own words, with a way to retry.
- A button does what it says, or shows why it can't.
- No LLM inside the engine. The LLM only turns a planner's sentence into input changes (in `web/`). The engine is statistics plus physics.
- "None" is a valid answer for battery, heat pump and wallbox. Every design must be physically and economically plausible.
- Nothing sent in Xander's name, no money spent, no secrets in code or chat (keys in `.env.local`, gitignored).

## Data rules (hard)
- The Reonic data pack lives outside the repo (`.handoff/data/`, git-excluded) and is read via `REONIC_DATA_DIR`. Never copy rows, CSVs, derived tables with project rows, or model artefacts containing rows into the repo. Aggregates (counts, medians, metrics) are fine.
- Units in the pack: `energy_demand_wh` is Wh (4,500,000 = 4,500 kWh). Battery and heat pump sizes in the parts file mostly live in `component_name` text ("Battery 7kWh", "Hybrid Inverter 6kW", "Complete Package 2 Sigenergy 10.8kWp + 9kWh"); the numeric size columns are mostly empty.

## Look and copy
- No AI-look UI: no purple gradients, sparkle icons, three feature cards, emoji, Inter or Space Grotesk, drop shadows everywhere. Take the look from the installer's world: offer documents, data sheets, roof plans. One accent colour.
- Motion confirms an action or shows where something went; springs with no bounce; respect Reduce Motion.
- Copy: British English, no em dashes, no taglines, no filler. Include only absolutely essential text.

## Gotchas
- Installer `2a8ba8e2` has almost no `Module` rows; PV size must be derived (mounting area in SquareMeter rows, inverter kW, package names). Say how you derived it in `engine/README.md`.
- About a third of projects have no parts at all; exclude them from training and say so.
