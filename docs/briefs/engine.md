# Brief: REONIC ENGINE

You own `engine/` (and `engine/README.md`) on branch `engine`. Never edit `web/`, `docs/api.md`, `PLAN.md` or `CLAUDE.md`. Read `CLAUDE.md`, `PLAN.md`, `docs/api.md` and, when it exists, `docs/domain.md` first.

Data: `REONIC_DATA_DIR=/Users/xanderlim/Projects/thinc-hack/.handoff/data/Project Data` (two installer folders, each with `projects_status_quo.csv` and `project_options_parts.csv`). Never copy rows into the repo. Python 3.12 via `uv`; use pandas, scikit-learn, fastapi, uvicorn. No LLM anywhere in the engine.

## Deadline and milestones (Munich time)
- 16:00: `GET /health` and `POST /api/design` live on the mini on port 8000 with a crude but real model. Push `engine`. Send the Sill note (below).
- 18:00: `/api/refine`, `/api/validate`, `/api/projects`, `/api/eval` live per `docs/api.md`. Funnel URL verified from outside.
- 22:00: model improved, scoreboard beats the baseline on every component where it can, README written.

## Steps
1. Parse. One row per project that has parts (option 1). Targets: `pv_kwp`, `inverter_kw`, `battery_kwh` (0 = none), `heatpump_kw` (0 = none), `wallbox_kw` (0 = none). Sizes mostly live in `component_name` text: "Battery 7kWh", "Hybrid Inverter 6kW", "Complete Package 2 Sigenergy 10.8kWp + 9kWh", "PV Module 463W ..." with `quantity`. Installer `2a8ba8e2` has almost no module rows: derive PV from the best available signal (ModuleFrameConstruction rows in SquareMeter, "Power Optimizer 600W" counts, inverter kW, package names) and report coverage per signal in `engine/README.md` as aggregates. Exclude projects without parts and say how many. Inputs from `projects_status_quo.csv`: demand (Wh to kWh), load profile, EV and km, heating type and cost, existing solar/storage/wallbox, inhabitants, size, year where present; mark missing.
2. Split 80/20 stratified by installer, fixed seed. The test split is never used for fitting, catalogue snapping or neighbour lookup.
3. Chained model. PV size first (HistGradientBoosting or similar on installer, demand, profile, EV, heating, existing kit), then battery decision and size conditional on predicted PV, then heat pump, then wallbox. Snap sizes to the catalogue sizes that installer actually sold (learned from train). kNN (k about 15, scaled features, same installer) supplies `neighbours`, `confidence` (agreement share) and `alternatives` (neighbour size distribution). `reason` strings cite data ("11 of 15 similar homes got a battery, median 8 kWh") or physics ("4.5 kWp covers 4,500 kWh at a 1 kWp per 1,000 kWh ratio").
4. Plausibility rules from `docs/domain.md` when present, else standard German rules of thumb: about 1 kWp per 1,000 kWh plus EV and heat pump uplift, battery about 1 kWh per kWp and no more than about 1.5 x daily demand, inverter 0.8 to 1.2 x kWp, roof about 5 m2 per kWp, wallbox 11 kW if EV. Economics rough and labelled: capex per kWp, per kWh, per heat pump; self-consumption and autarky via a simple lookup; feed-in and price defaults. Put every assumption in `economics.assumptions`.
5. Baseline for `/api/eval`: 1 kWp per 1,000 kWh snapped to catalogue, battery = installer majority decision and median size, heat pump none, wallbox if EV. Tolerance bands: PV within 1 kWp or 15 percent, battery within 2 kWh, decisions exact. `overall.design_match_share` = all four components within tolerance.
6. FastAPI exactly per `docs/api.md`, CORS open, errors as `{ error }` in plain words. Model trained at startup or loaded from a gitignored artefact under `engine/.cache/`.
7. Run it on the mini: start the server in a new Sill tmux window named `REONIC ENGINE SERVER` (`tmux -S ~/.handoff/tmux.sock new-window -t sill -n "REONIC ENGINE SERVER" -c <worktree>/engine "REONIC_DATA_DIR='...' uv run uvicorn app.main:app --host 0.0.0.0 --port 8000; exec zsh"`), check `curl localhost:8000/health`, then expose it: `/Applications/Tailscale.app/Contents/MacOS/Tailscale funnel --bg --https=8443 8000` and verify `curl https://xanders-mac-mini.tail3f074b.ts.net:8443/health` returns ok. Restart the server after each merge-worthy change.
8. `engine/README.md`: setup, approach, how PV was derived, split, metrics table, known limits. Aggregates only.

## Rules
- Check `uptime` before training; wait while the 1-minute load is above 20. Keep training under 2 minutes; this is 1,000 rows.
- One quick check per endpoint with curl. No test suites.
- Commit and push `engine` at every milestone. At each milestone send a Sill note to `THINC HACK MASTER` with the `mcp__sill__sill_message` tool (mode note): endpoints live, funnel URL, scoreboard numbers, PV derivation coverage, blockers. If Sill is unavailable, write the same to `engine/STATUS.md` and push.
- Include only absolutely essential text: in code, comments, UI copy and your report. No filler, no explanations nobody asked for.
