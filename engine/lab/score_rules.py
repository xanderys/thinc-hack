"""Rules scoreboard: formula (planner_rules) vs black box (learned chain) vs textbook, plus the deviation analysis.

    cd engine && uv run python -m lab.score_rules --stub      # harness check with the textbook rule wrapped; NOT a result
    cd engine && uv run python -m lab.score_rules             # real run once app/planner_rules exists

Formula: calibrate(fit_rows) on the fit half only (lab/split), recommend(inputs[, constants]) scored on the test half
and on the 258-home new-system held-out board (the engine's own locked 20% test split, new-system jobs).
Black box: Engine.fit() as live (80/20 stratified, seed 42). On the test half it is scored only on homes it did not
train on (the rest are in its train set); on the board it is fully held out. Textbook: Engine.baseline.
Deviation analysis: hourly simulation of both designs where formula and expert differ. Prints aggregates only.

planner_rules contract assumed (REONIC PHYSICS): `calibrate(fit_df) -> constants` and `recommend(inputs, constants=None)
-> {pv_kwp, battery_kwh, heatpump_kw, wallbox_kw[, inverter_kw]}`; if recommend takes no constants argument, calibrate is
expected to set module state itself. Adjust `load_rules` if the real signatures differ.
"""
import os

for _v in ("OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS"):
    os.environ[_v] = "1"

import argparse
import inspect
import time
from pathlib import Path

import numpy as np
import pandas as pd

from app import data, rules
from app.model import COMPONENTS, TARGET, Engine, roof_to_sim, row_design, row_inputs
from lab.cv import check_load, predict_frame, split
from lab.split import counts, load_split

REPORTS = Path(__file__).parent / "reports"
SCORED = ["pv", "battery", "wallbox", "heatpump"]  # heat pump last, never a headline
NEW_SYSTEM = lambda d: d[(d.pv_kwp > 0) | d.has_solar].reset_index(drop=True)


def load_rules(stub_eng=None):
    """-> (calibrate, recommend, is_stub). Real rules import lazily; a missing module fails with a clear message."""
    if stub_eng is not None:
        def calibrate(fit_df):
            return {}

        def recommend(inp, constants=None):
            return stub_eng.baseline(inp)
        return calibrate, recommend, True
    try:
        import app
        extra = os.environ.get("PLANNER_RULES_ENGINE")  # engine/ dir of a checkout holding app/planner_rules (not committed here)
        if extra:
            app.__path__.append(str(Path(extra) / "app"))
        from app.planner_rules import recommend as _rec  # type: ignore
        from app.planner_rules.calibrate import calibrate  # type: ignore
    except ImportError as e:
        raise SystemExit(f"app.planner_rules is not available ({e}). Set PLANNER_RULES_ENGINE to an engine/ dir that has it "
                         f"(origin/physics), or run with --stub to check the harness.")

    def recommend(inp, constants=None):
        return _rec(inp, constants=constants)["design"]
    return calibrate, recommend, False


def formula_frame(recommend, constants, te: pd.DataFrame) -> pd.DataFrame:
    takes = len(inspect.signature(recommend).parameters) > 1
    rows = []
    for r in te.to_dict("records"):
        inp = row_inputs(r)
        d = recommend(inp, constants) if takes else recommend(inp)
        rows.append({k: (d.get(k) or 0.0) for k in TARGET.values()})
    return pd.DataFrame(rows, index=te.index)


def textbook_frame(eng: Engine, te: pd.DataFrame) -> pd.DataFrame:
    return pd.DataFrame([eng.baseline(row_inputs(r)) for r in te.to_dict("records")], index=te.index)


def score(te: pd.DataFrame, pred: pd.DataFrame) -> dict:
    out, allc = {"n": len(te)}, np.ones(len(te), bool)
    for c in COMPONENTS:
        w = rules.within(c, pred[TARGET[c]].values.astype(float), te[TARGET[c]].values.astype(float))
        allc &= w
        out[c] = float(w.mean())
    out["all_four"] = float(allc.mean())
    return out


def differs(te, pred) -> np.ndarray:
    """Formula and expert differ: PV, battery or wallbox outside tolerance (heat pump not a trigger)."""
    d = np.zeros(len(te), bool)
    for c in ("pv", "battery", "wallbox"):
        d |= ~rules.within(c, pred[TARGET[c]].values.astype(float), te[TARGET[c]].values.astype(float))
    return d


def sim_pair(r: dict, ours: dict):
    """(payback, autarky) for our design and the expert's, hourly simulation, same inputs."""
    inp = roof_to_sim({k: v for k, v in row_inputs(r).items() if not k.startswith("_")})
    from app import hourly
    res = []
    for d in ({"pv_kwp": ours["pv_kwp"] or None, "battery_kwh": ours["battery_kwh"] or None,
               "heatpump_kw": ours["heatpump_kw"] or None, "wallbox_kw": ours["wallbox_kw"] or None,
               "inverter_kw": ours.get("inverter_kw")}, row_design(r)):
        e = hourly.simulate(inp, d).economics
        res.append((e["payback_years"], e["autarky_share"]))
    return res


def deviation(te: pd.DataFrame, pred: pd.DataFrame, max_sim: int) -> dict:
    idx = np.where(differs(te, pred))[0][:max_sim]
    t = {"differs": int(differs(te, pred).sum()), "simulated": 0, "failed": 0,
         "payback_ours": 0, "payback_expert": 0, "payback_tie": 0, "autarky_ours": 0, "autarky_expert": 0, "autarky_tie": 0}
    rows = te.to_dict("records")
    for i in idx:
        check_load("deviation simulation")
        try:
            (po, ao), (pe, ae) = sim_pair(rows[i], pred.iloc[i].to_dict())
        except Exception:
            t["failed"] += 1
            continue
        t["simulated"] += 1
        big = lambda p: p if p is not None else 1e9  # no payback at all is worse than any payback
        t["payback_ours" if big(po) < big(pe) else "payback_expert" if big(pe) < big(po) else "payback_tie"] += 1
        t["autarky_ours" if ao > ae + 1e-9 else "autarky_expert" if ae > ao + 1e-9 else "autarky_tie"] += 1
    return t


def table(lines: list) -> str:
    p = lambda x: f"{x * 100:.1f}%"
    h = "| Line | Population | n | PV | Battery | Wallbox | All four | Heat pump |\n|---|---|---|---|---|---|---|---|\n"
    return h + "\n".join(f"| {l} | {pop} | {s['n']} | {p(s['pv'])} | {p(s['battery'])} | {p(s['wallbox'])} | {p(s['all_four'])} | {p(s['heatpump'])} |"
                         for l, pop, s in lines)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--stub", action="store_true", help="wrap the textbook rule as recommend(); harness check only")
    ap.add_argument("--max-sim", type=int, default=100000, help="cap on hourly simulations per population")
    ap.add_argument("--no-sim", action="store_true")
    a = ap.parse_args()
    check_load("start")
    t0 = time.time()
    df = data.load()[0]
    _, board_src = split(df)                       # engine's locked 20% test split (frame after outlier drop)
    board = NEW_SYSTEM(board_src)
    fit_ids, test_ids = load_split()
    pop = df[~((df.pv_kwp > 40) | (df.battery_kwh > 40) | (df.annual_demand_kwh < 500) | (df.annual_demand_kwh > 30000))]
    pop = pop.assign(project_id=pop.project_id.astype(str)).reset_index(drop=True)
    fit_df = pop[pop.project_id.isin(set(fit_ids))].reset_index(drop=True)
    test_df = NEW_SYSTEM(pop[pop.project_id.isin(set(test_ids))].reset_index(drop=True))
    board = board.assign(project_id=board.project_id.astype(str))

    check_load("black box fit")
    eng = Engine(df, {}).fit()                     # as live
    calibrate, recommend, stub = load_rules(eng if a.stub else None)
    consts = calibrate(fit_df)                     # fit half only

    unseen = test_df[~test_df.project_id.isin(set(eng.train.project_id.astype(str)))].reset_index(drop=True)
    inter = board[board.project_id.isin(set(test_df.project_id))].reset_index(drop=True)
    print("fitted constants:")
    for k, v in consts.items():
        if k != "_meta":
            print(" ", k, v)
    lines, preds = [], {}
    for label, frame in (("test half", test_df), ("258 board", board)):
        preds[(label, "formula")] = formula_frame(recommend, consts, frame)
        preds[(label, "textbook")] = textbook_frame(eng, frame)
        lines.append(("formula (rules)" + (" STUB" if stub else ""), f"{label} (new-system)", score(frame, preds[(label, "formula")])))
    bb_test = predict_frame(eng, unseen)
    lines.append(("black box (chain)", "test half, homes the chain did not train on", score(unseen, bb_test)))
    lines.append(("black box (chain)", "258 board", score(board, predict_frame(eng, board))))
    for label, frame in (("test half", test_df), ("258 board", board)):
        lines.append(("textbook", f"{label} (new-system)", score(frame, preds[(label, "textbook")])))
    lines.append(("formula (rules)", "board and test half", score(inter, formula_frame(recommend, consts, inter))))
    lines.append(("black box (chain)", "board and test half", score(inter, predict_frame(eng, inter))))
    lines.append(("textbook", "board and test half", score(inter, textbook_frame(eng, inter))))
    order = {"formula": 0, "black": 1, "textbook": 2}
    lines.sort(key=lambda x: (x[1].startswith("258") + 2 * x[1].startswith("board"), order[x[0].split()[0]]))

    md = [f"# Rules scoreboard{' (STUB RUN, harness check, not a result)' if stub else ''}", ""]
    if stub:
        md += ["> The formula line below is the textbook rule wrapped as recommend(). These numbers say nothing about the planner rules.", ""]
    md += [f"Split: fit {len(fit_ids)}, test {len(test_ids)} (seed 42 per installer, lab/split); new-system scope on the test half: {len(test_df)}; "
           f"board: {len(board)}. Tolerances as the engine scoreboard (PV max(1 kWp, 15%), battery 2 kWh, wallbox and heat pump on the decision).", "",
           table(lines), ""]
    if not a.no_sim:
        md += ["## Deviation analysis (hourly simulation, formula vs expert)", "",
               "Homes where PV, battery or wallbox is outside tolerance. Payback: lower is better, no payback is worst. Autarky: higher is better.", "",
               "| Population | Differ | Simulated | Payback ours | Payback expert | Payback tie | Autarky ours | Autarky expert | Autarky tie |", "|---|---|---|---|---|---|---|---|---|"]
        for label, frame in (("test half", test_df), ("258 board", board)):
            d = deviation(frame, preds[(label, "formula")], a.max_sim)
            md.append(f"| {label} | {d['differs']} | {d['simulated']} | {d['payback_ours']} | {d['payback_expert']} | {d['payback_tie']} | "
                      f"{d['autarky_ours']} | {d['autarky_expert']} | {d['autarky_tie']} |")
        md.append("")
    md += ["", "Fitted constants (fit half only):", ""]
    for k, v in consts.items():
        if k != "_meta":
            md.append(f"- {k}: {v}")
    md.append("")
    md.append(f"Black box on the test half is scored only on {len(unseen)} homes it did not train on; the rest are in its train split.")
    out = "\n".join(md)
    print(out)
    REPORTS.mkdir(exist_ok=True)
    (REPORTS / ("rules_scoreboard_stub.md" if stub else "rules_scoreboard.md")).write_text(out + "\n")
    print(f"\n({time.time() - t0:.0f} s)")


if __name__ == "__main__":
    main()
