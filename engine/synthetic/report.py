"""report.json (engine/.cache/synthetic, gitignored) and docs/synthetic.md (aggregates only); load_report() for /api/eval.synthetic."""
import json
from pathlib import Path

from .common import ENGINE, OUT

REPORT = OUT / "report.json"
DOC = ENGINE.parent / "docs" / "synthetic.md"


def headline(r: dict) -> str:
    return (f"Tested on {r['n']:,} synthetic homes built from the real inputs and checked against the hourly physics: "
            f"{r['plausible_share'] * 100:.1f} percent plausible, {r['monotonicity_violations']:,} monotonicity violations.")


def short(r: dict) -> str:
    m = next(i for i in r["invariants"] if i["name"] == "Raising demand never lowers PV")["pass_share"]
    return (f"Tested on {r['n']:,} synthetic homes against the hourly physics: {r['plausible_share'] * 100:.0f} percent plausible, "
            f"monotonic in demand {m * 100:.0f} percent of the time.")


BASELINE = Path(__file__).parent / "baseline.json"  # pass shares before the engine's fixes, aggregates only
EXAMPLES = ["Raising demand never lowers PV", "A higher tariff never shrinks the battery", "Adversarial inputs get an error or a flag"]


def _home(i: dict) -> str:
    """A synthetic home in words: no ids or dates."""
    s = f"{i.get('_split', '').replace('_', ' ')} home ({i.get('_kind', '').replace('_', ' ')}), {i.get('annual_demand_kwh', 0):,.0f} kWh"
    if i.get("has_ev"):
        s += f", EV {i.get('ev_annual_km') or 12000:,.0f} km"
    if i.get("heating_type") not in (None, "Unknown"):
        s += f", {i['heating_type']} heating"
    if i.get("has_solar"):
        s += f", existing {i.get('existing_solar_kwp') or 0:g} kWp"
    return s


def _design(d):
    if not d:
        return "no design"
    return ", ".join(f"{k.split('_')[0]} {d[k]:g}" for k in ("pv_kwp", "battery_kwh", "wallbox_kw", "heatpump_kw") if d.get(k))


def examples(r: dict) -> str:
    out = []
    for n in EXAMPLES:
        inv = next(i for i in r["invariants"] if i["name"] == n)
        if not inv["worst"]:
            continue
        c = inv["worst"][0]
        out.append(f"- {n}: synthetic {_home(c['inputs'])}; design {_design(c['design'])}. {c['note']}")
    return "\n".join(out)


def write(r: dict):
    OUT.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(r, indent=1, default=float))
    DOC.write_text(doc(r))


def load_report() -> dict | None:
    """The /api/eval.synthetic shape plus extras (split, runtime, coverage); None when the suite has not run."""
    if not REPORT.exists():
        return None
    r = json.loads(REPORT.read_text())
    return {"n": r["n"], "generated_at": r["generated_at"], "plausible_share": r["plausible_share"],
            "monotonicity_violations": r["monotonicity_violations"], "headline": headline(r), "headline_short": short(r),
            "invariants": [{k: i[k] for k in ("name", "group", "pass_share", "n_checked", "worst")} for i in r["invariants"]],
            "split": r["split"], "runtime_s": r["runtime_s"], "coverage": r["coverage"]}


def _pct(x):
    return "n/a" if x is None else f"{x * 100:.1f}%"


def doc(r: dict) -> str:
    base = json.loads(BASELINE.read_text()) if BASELINE.exists() else None
    if base and base["generated_at"] == r["generated_at"]:
        base = None
    if base:
        head = "| Invariant | Group | Checked | Before fixes | Now |\n|---|---|---|---|---|"
        rows = "\n".join(f"| {i['name']} | {i['group']} | {i['n_checked']:,} | {_pct(base['pass_share'].get(i['name']))} | {_pct(i['pass_share'])} |" for i in r["invariants"])
    else:
        head = "| Invariant | Group | Checked | Pass |\n|---|---|---|---|"
        rows = "\n".join(f"| {i['name']} | {i['group']} | {i['n_checked']:,} | {_pct(i['pass_share'])} |" for i in r["invariants"])
    gap = next(i for i in r["invariants"] if i["name"].startswith("Proposal NPV within"))
    d = gap["distribution_eur"]
    bal = next(i for i in r["invariants"] if i["group"] == "energy balance")
    hon = next(i for i in r["invariants"] if i["group"] == "honesty")
    cov = r["coverage"]
    s = r["split"]
    kinds = ", ".join(f"{k.replace('_', ' ')} {v * 100:.0f}%" for k, v in hon["by_kind"].items())
    return f"""# Synthetic test suite

Metamorphic and simulation-verified testing of the frozen engine, with the hourly simulator (`engine/app/hourly/`) as the oracle. Nothing is trained. Run: `cd engine && uv run python -m synthetic.run` (about {r['runtime_s'] / 60:.0f} minutes on 10 workers).

For /check:

> {headline(r)}

Short:

> {short(r)}

## Method

- Homes: {r['n']:,} from the engine's {r['train_rows']:,} training rows (seed {r['seed']}). In-distribution {s['in_distribution']:.0%}: a real row with demand, mileage, price, heat and size scattered (lognormal, 8 to 15%), so the joint structure of installer, load profile, EV, heating and existing kit is kept. Edge {s['edge']:.0%}: demand 1,500 to 2,500 or 10,000 to 20,000 kWh, EV at 30,000 km, heat pump plus EV, existing PV of 3 to 15 kWp. Adversarial {s['adversarial']:.0%}: demand 0, negative or 50,000 kWh, price 0, 40 m2 with 10,000 kWh, existing kWp with `has_solar` false, mileage with no EV, storage with no PV.
- Oracle: the API's input check, then `Engine.sizes_batch` (as `/api/inbox`) in one batch with every metamorphic variant, then `Engine._physics` (simulate, validate_physics, optimum) per home in-process. Every simulation, including the optimum's grid, is checked for energy balance. Honesty passes on an input error, a hard rule, a physics warning or a warning about the inputs; routine sizing bands (payback, kWp per MWh, kWh per kWp) do not count.
- Coverage: {cov['real_cells_covered_share'] * 100:.0f}% of the {cov['real_cells']} cells seen in the real inputs (installer x load profile x EV x heating x existing PV x demand band) are covered, plus {cov['new_cells']} cells the real data never has.
- Runtime: {r['runtime_s']:.0f} s, {bal['simulations']:,} simulations.

## Results

Plausibility, monotonicity, stability and optimum gap are over the {r['n_normal']:,} in-distribution and edge homes; energy balance over every simulated home; honesty over the {r['n_adversarial']:,} adversarial homes.

{head}
{rows}

Optimum gap (optimum NPV minus proposal NPV, EUR): median {d['p50']:,.0f}, p90 {d['p90']:,.0f}, p99 {d['p99']:,.0f}, max {d['max']:,.0f}; {gap['at_optimum_share'] * 100:.0f}% of proposals are the optimum. Largest energy residual {bal['max_residual_kwh']:.2g} kWh. Real expert batteries within the HTW cap: {r['real_htw_share'] * 100:.0f}%. Honesty by kind: {kinds}.

Worst cases (synthetic homes):

{examples(r)}

The worst five cases per invariant are in `engine/.cache/synthetic/report.json` and `/api/eval` (`synthetic`); the model is not changed on them.

## Limits

- Synthetic homes share the real inputs' distribution and the simulator's own limits: one Munich year, south roof unless given, greedy dispatch, 2026 average prices.
- Household load is the BDEW H25 standard profile with seeded scatter, not metered load.
- Metamorphic relations prove consistency and plausibility, not accuracy on real homes; accuracy is the scoreboard against held-out expert designs.
"""
