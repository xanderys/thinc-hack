# Brief: REONIC PHYSICS

You own `engine/app/physics/` and `docs/physics.md` on branch `physics` in this worktree. Never edit anything else in `engine/` (REONIC ENGINE owns it and will wire your module in), nor `web/`, `docs/api.md`, `PLAN.md`, `CLAUDE.md`. Read `CLAUDE.md`, `PLAN.md`, `docs/api.md` (v1.2: `Economics.annual`, `Optimum`), `docs/domain.md`, `docs/data-insights.md`, `engine/README.md` and `engine/app/` (read only) first. Report to the Claude session `THINC HACK MASTER` with `mcp__sill__sill_message` (mode note) at each milestone; ask it (mode ask) if the interface is unclear. Xander's decision: full pvlib with real weather data, the physics validates and explains, the learned model still proposes.

## Research pass first (45 minutes, write `docs/physics.md`, sources with links and years)
Use WebSearch and WebFetch, do not answer from memory: pvlib ModelChain with PVGIS TMY (`pvlib.iotools.get_pvgis_tmy`) for German locations; BDEW standard load profiles H0 and the `demandlib` package (also its VDI 4655 heat pump profiles); typical German PV yield by orientation and tilt (kWh per kWp); heat pump electricity from heating demand and seasonal COP (JAZ 3 to 4 for air source); EV home charging profiles (evening, 11 kW); battery dispatch (greedy self-consumption, round-trip efficiency about 90 percent, usable depth about 90 percent); 2026 economics from `docs/domain.md` (feed-in 7.70 ct under 10 kWp, grid price about 37 ct, capex per kWp and per kWh). Cite the HTW Berlin Unabhängigkeitsrechner method and compare your outputs with its published curves for sanity.

## Build (`engine/app/physics/`)
- `simulate(inputs: HomeInputs, design: Design, location="Munich") -> SimResult`: 8,760-hour balance. PV from pvlib ModelChain (PVGIS TMY cached under `engine/.cache/pvgis/`, bundled fallback CSV for Munich so it works offline), orientation and tilt from inputs when present else south 35 degrees. Load = BDEW H0 (or the profile in `load_profile`) scaled to `annual_demand_kwh`, plus EV charging from `ev_annual_km` at about 18 kWh per 100 km in the evening, plus heat pump electricity from `heating_demand_kwh` or `heating_cost_per_year_eur` divided by a seasonal COP, with a VDI 4655 style seasonal shape. Battery greedy dispatch with efficiency and depth limits. Returns the `Economics` block from `docs/api.md` with `method: "hourly-simulation"` and every `annual` field, plus hourly series kept out of the API.
- `optimum(inputs, catalogue: list of allowed kWp, kWh sizes) -> Optimum`: grid search over the installer's catalogue sizes (the engine passes them) maximising 20-year NPV at the given tariff, with a one-sentence `note` comparing it to a given proposal.
- `validate_physics(inputs, design) -> list[Plausibility]`: inverter DC/AC ratio, battery kWh vs daily load, PV vs roof area when known, heat pump kW vs heating demand, autarky above 95 percent flagged as over-sized.
- Keep a single call under 200 ms after the TMY is cached (precompute the PV per-kWp hourly profile once per orientation and scale it).
- One check script `engine/app/physics/check.py` printing, for three sample homes, kWh yield per kWp, self-consumption and autarky with and without a battery, against the HTW Berlin curves (30 percent self-consumption without battery at about 1 kWp per MWh; 50 to 70 percent autarky with 1 kWh per kWp). Say in `docs/physics.md` how close you land.
- `uv add pvlib demandlib` inside `engine/` is allowed (pyproject is shared; coordinate by keeping the change to the dependency lines only).

## Milestones (Munich time)
- 16:30: `docs/physics.md` research pushed.
- 18:30: `simulate` and `validate_physics` working with the check script, pushed; note to THINC HACK MASTER with the check output.
- 20:00: `optimum` done; note with a sample home's proposal vs optimum. REONIC ENGINE wires it into `/api/design` economics and `optimum`.

Rules: check `uptime` before installs or PVGIS fetches and wait while the 1-minute load is above 20. No test suites, one check script. Aggregates only in docs. Include only absolutely essential text: in code, comments, docs and your report. No filler, no explanations nobody asked for.
