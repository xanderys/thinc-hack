"""Visit-verdict backtest: replays the web rule over the 258 board and the clean 126 with the production engine (RECOMMENDER=readout).

    cd engine && uv run python -m lab.qualification_backtest
Design and payback from Engine.predict(inputs) exactly as /api/design computes them; aggregates only, written to lab/reports/qualification_backtest.json
and the table is assembled into qualification_backtest.md by the same run.
"""
import os
for _v in ("OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS"):
    os.environ[_v] = "1"
import json, sys, time
from pathlib import Path
import numpy as np
import pandas as pd
from app import data, model as model_mod
from app.model import Engine, row_inputs
from lab.cv import split
from lab.score_rules import NEW_SYSTEM
from lab.split import load_split

OUT = Path(__file__).parent / "reports"
DEFAULT_KWH = 4500.0
CACHE_F = Path("/private/tmp/claude-501/qb/rows.json")


def compute():
    if CACHE_F.exists():
        return json.load(open(CACHE_F))
    model_mod.RECOMMENDER["mode"] = "readout"
    df = data.load()[0]
    _, board_src = split(df)
    board = NEW_SYSTEM(board_src).assign(project_id=lambda d: d.project_id.astype(str))
    _, test_ids = load_split()
    eng = Engine(df, {}).fit()
    rows, t0 = [], time.time()
    for i, r in enumerate(board.to_dict("records")):
        inp = row_inputs(r)
        inp["_given"] = sorted(k for k, v in inp.items() if v is not None and k != "offer_date")
        out = eng.predict(inp)
        e, d = out["economics"], out["design"]
        rows.append(dict(pid=r["project_id"], in_test=r["project_id"] in set(test_ids),
                         demand=float(r["annual_demand_kwh"]), heat=r["heating_type"], heat_cost=r.get("heating_cost_per_year_eur"),
                         payback=e.get("payback_years"), des_pv=d.get("pv_kwp"), des_batt=d.get("battery_kwh"),
                         sold_pv=float(r["pv_kwp"]), sold_batt=float(r["battery_kwh"]), mode=model_mod.RECOMMENDER["mode"], ver=out.get("model_version")))
        if i % 25 == 0:
            print(i, round(time.time() - t0), "s", flush=True)
    json.dump(rows, open(CACHE_F, "w"))
    return rows


def pct(n, d):
    return f"{100 * n / d:.1f}%" if d else "n/a"


def isna(x):
    return x is None or (isinstance(x, float) and np.isnan(x))


def verdicts(df, address_clause):
    f_demand = (df.demand - DEFAULT_KWH).abs() < 1e-6
    f_heat = (df.heat == "Unknown") & df.heat_cost.notna() & (df.heat_cost > 0)
    f_addr = pd.Series(True, index=df.index) if address_clause else pd.Series(False, index=df.index)
    pay_bad = df.payback.isna() | (df.payback > 20)
    decline = pay_bad
    call = (~decline) & (f_demand | f_heat | f_addr)
    v = np.where(decline, "Decline", np.where(call, "Call first", "Visit"))
    return pd.Series(v, index=df.index), f_demand, f_heat, f_addr, pay_bad


def main():
    rows = compute()
    df = pd.DataFrame(rows)
    sets = {"258 board": df, "clean 126 (board and test half)": df[df.in_test].reset_index(drop=True)}
    md = []
    res = {}
    for ac in (False, True):
        md.append(f"## Shares, {'WITH' if ac else 'WITHOUT'} the address clause" + ("" if ac else " (lead version)"))
        md += ["", "| Set | n | Visit | Call first | Decline |", "|---|---|---|---|---|"]
        for name, d in sets.items():
            v = verdicts(d, ac)[0]
            c = v.value_counts()
            md.append(f"| {name} | {len(d)} | {c.get('Visit', 0)} ({pct(c.get('Visit', 0), len(d))}) | {c.get('Call first', 0)} ({pct(c.get('Call first', 0), len(d))}) | {c.get('Decline', 0)} ({pct(c.get('Decline', 0), len(d))}) |")
        md.append("")
    md.append("## False declines (every project is a signed sale, so every Decline is a false decline)\n")
    md += ["| Set | n | Declined | False-decline rate | Median payback of declined (years) | Declined with no payback at all | Median PV sold (kWp) | Share sold with a battery |", "|---|---|---|---|---|---|---|---|"]
    for name, d in sets.items():
        v, fd, fh, fa, pb = verdicts(d, False)
        x = d[v == "Decline"]
        pay = x.payback.dropna()
        md.append(f"| {name} | {len(d)} | {len(x)} | {pct(len(x), len(d))} | {pay.median():.1f} | {int(x.payback.isna().sum())} | {x.sold_pv.median():.1f} | {pct(int((x.sold_batt > 0).sum()), len(x))} |" if len(x) else f"| {name} | {len(d)} | 0 | 0.0% | n/a | 0 | n/a | n/a |")
        res[name] = dict(n=len(d), declined=len(x))
    md.append("")
    md.append("Payback distribution of the whole set (our design, hourly economics), for context:\n")
    md += ["| Set | p10 | median | p90 | share over 20 years | share with no payback |", "|---|---|---|---|---|---|"]
    for name, d in sets.items():
        p = d.payback.dropna()
        md.append(f"| {name} | {p.quantile(.1):.1f} | {p.median():.1f} | {p.quantile(.9):.1f} | {pct(int((d.payback > 20).sum()), len(d))} | {pct(int(d.payback.isna().sum()), len(d))} |")
    md.append("")
    md.append("## Call first: which missing fact fires (before precedence, i.e. on all homes in the set)\n")
    md += ["| Set | n | Default 4,500 kWh demand | Heating unknown with a bill | No address |", "|---|---|---|---|---|"]
    for name, d in sets.items():
        _, fd, fh, fa, pb = verdicts(d, True)
        md.append(f"| {name} | {len(d)} | {int(fd.sum())} ({pct(int(fd.sum()), len(d))}) | {int(fh.sum())} ({pct(int(fh.sum()), len(d))}) | {len(d)} (100.0%) |")
    md.append("")
    md.append("Overlaps of the two facts the pack can actually test (address excluded), and Call first after Decline precedence, address clause off:\n")
    md += ["| Set | Demand only | Heating only | Both | Neither | Call first (after Decline) | of which demand | of which heating |", "|---|---|---|---|---|---|---|---|"]
    for name, d in sets.items():
        v, fd, fh, fa, pb = verdicts(d, False)
        cf = v == "Call first"
        md.append(f"| {name} | {int((fd & ~fh).sum())} | {int((fh & ~fd).sum())} | {int((fd & fh).sum())} | {int((~fd & ~fh).sum())} | {int(cf.sum())} | {int((cf & fd).sum())} | {int((cf & fh).sum())} |")
    md.append("")
    md.append("Decline overlap with the facts (declined homes that would also have been Call first):\n")
    for name, d in sets.items():
        v, fd, fh, fa, pb = verdicts(d, False)
        dec = v == "Decline"
        md.append(f"- {name}: {int((dec & (fd | fh)).sum())} of {int(dec.sum())} declined homes also carry a missing fact.")
    md.append("")
    print("\n".join(md))
    print("mode/version:", df["mode"].iloc[0], df["ver"].iloc[0])


if __name__ == "__main__":
    main()
