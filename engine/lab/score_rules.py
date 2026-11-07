"""Rules scoreboard: four lines side by side (formula-physics, formula-calibrated, black box, textbook) plus the deviation analysis.

    cd engine && uv run python -m lab.score_rules --physics-ref <ref> --calibrated-ref 1329cd2
    cd engine && uv run python -m lab.score_rules --physics-ref <ref> --limit 20     # timing check only, no report
    cd engine && uv run python -m lab.score_rules --stub                             # harness check, textbook wrapped; NOT a result

formula-physics: planner_rules at --physics-ref, no calibrate call, constants=None.
formula-calibrated: planner_rules at --calibrated-ref (rules-1), calibrate(fit half) then recommend(inputs, constants=...).
Each ref is checked out as a throwaway worktree under /private/tmp/claude-501 and imported in its own subprocess
(lab/_rules_worker.py; the module name app.planner_rules clashes), designs cached in engine/.cache/lab_rules/<sha>[-calibrated].json.
Default population is the fit half (new-system); --population test --final scores the test half, the 258 board and board and test half. Black box: Engine.fit() as live, on the test half only
on homes it did not train on. Textbook: Engine.baseline. Deviation analysis: hourly simulation of both designs where formula and
expert differ (inverter_kw of our design is not passed, as in the first scoreboard). Prints aggregates only.
"""
import os

for _v in ("OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS"):
    os.environ[_v] = "1"

import argparse
import json
import sys
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


REPO = Path(__file__).resolve().parents[2]
CACHE = Path(__file__).resolve().parents[1] / ".cache" / "lab_rules"
WT_ROOT = Path("/private/tmp/claude-501")
KEYS = ("pv_kwp", "battery_kwh", "heatpump_kw", "wallbox_kw", "inverter_kw")


def git(*args) -> str:
    import subprocess
    return subprocess.run(["git", "-C", str(REPO), *args], check=True, capture_output=True, text=True).stdout.strip()


class Worktrees:
    """Throwaway detached worktrees under /private/tmp/claude-501, one per distinct sha, removed on exit."""

    def __init__(self):
        self.made = {}

    def engine(self, sha: str) -> Path:
        if sha not in self.made:
            path = WT_ROOT / f"lab_rules_{sha[:12]}"
            if path.exists():
                git("worktree", "remove", "--force", str(path))
            git("worktree", "add", "--detach", str(path), sha)
            self.made[sha] = path
        return self.made[sha] / "engine"

    def close(self):
        for path in self.made.values():
            try:
                git("worktree", "remove", "--force", str(path))
            except Exception as e:  # noqa: BLE001
                print(f"could not remove worktree {path}: {e}")


def rules_designs(wts: Worktrees, ref: str, calibrated: bool, items, fit_df) -> dict:
    """Designs for items [(project_id, inputs)] from planner_rules at `ref`, run in its own subprocess; cached by sha.
    -> {"designs": {pid: design}, "seconds": {pid: s}, "constants": dict | None, "calibrate_seconds": float | None}"""
    import pickle
    import subprocess
    import tempfile
    sha = git("rev-parse", ref)
    CACHE.mkdir(parents=True, exist_ok=True)
    out = CACHE / (f"{sha}-calibrated.json" if calibrated else f"{sha}.json")
    have = json.load(open(out))["designs"] if out.exists() else {}
    if any(p not in have for p, _ in items) or (calibrated and not out.exists()):
        req = {"engine": str(wts.engine(sha)), "items": items, "fit_df": fit_df if calibrated else None, "constants": None, "out": str(out)}
        with tempfile.NamedTemporaryFile(suffix=".pkl", delete=False, dir=CACHE) as f:
            pickle.dump(req, f)
        print(f"{'calibrated' if calibrated else 'uncalibrated'} planner_rules at {sha[:7]}: {sum(p not in have for p, _ in items)} designs to compute", flush=True)
        try:
            subprocess.run([sys.executable, str(Path(__file__).with_name("_rules_worker.py")), f.name], check=True)
        finally:
            os.unlink(f.name)
    return json.load(open(out))


def frame_from(cache: dict, te: pd.DataFrame) -> pd.DataFrame:
    rows = [{k: (cache["designs"][str(p)].get(k) or 0.0) for k in TARGET.values()} for p in te.project_id.astype(str)]
    return pd.DataFrame(rows, index=te.index)


def timing_line(label: str, cache: dict, pids) -> str:
    s = np.array([cache["seconds"][str(p)] for p in pids if str(p) in cache["seconds"]]) * 1000
    cal = cache.get("calibrate_seconds")
    return (f"| {label} | {len(s)} | {np.median(s):.0f} | {s.mean():.0f} | {np.percentile(s, 95):.0f} | {s.max():.0f} | "
            f"{(f'{cal:.0f} s' if cal else 'none')} |") if len(s) else f"| {label} | 0 | | | | | |"


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


def sim_cache(wts: Worktrees, ref: str, frames: dict, preds: dict, names: tuple, max_sim: int) -> dict:
    """Run expert and formula designs through simulate() of `ref` (its own subprocess), cached by sha. -> {pid: {...}}"""
    import pickle
    import subprocess
    import tempfile
    sha = git("rev-parse", ref)
    out = CACHE / f"{sha}-dev.json"
    have = json.load(open(out)) if out.exists() else {}
    need = {}
    for key, frame in frames.items():
        rows = frame.to_dict("records")
        for ni, name in enumerate(names):
            for i in np.where(differs(frame, preds[(key, name)]))[0][:max_sim]:
                r = rows[i]
                pid = str(r["project_id"])
                it = need.setdefault(pid, {"pid": pid, "inp": row_inputs(r),
                                           "sim_inp": roof_to_sim({k: v for k, v in row_inputs(r).items() if not k.startswith("_")}),
                                           "expert": row_design(r), "phys": False, "cal": None})
                if ni == 0:
                    it["phys"] = True
                else:
                    it["cal"] = {k: (preds[(key, name)].iloc[i][k] or None) for k in TARGET.values()}
    todo = [it for it in need.values() if "expert" not in have.get(it["pid"], {}) or (it["phys"] and "physics" not in have.get(it["pid"], {}))
            or (it["cal"] is not None and "calibrated" not in have.get(it["pid"], {}))]
    if todo:
        print(f"deviation simulation at {sha[:7]}: {len(todo)} homes", flush=True)
        with tempfile.NamedTemporaryFile(suffix=".pkl", delete=False, dir=CACHE) as f:
            pickle.dump({"engine": str(wts.engine(sha)), "items": todo, "out": str(out)}, f)
        try:
            subprocess.run([sys.executable, str(Path(__file__).with_name("_rules_dev_worker.py")), f.name], check=True)
        finally:
            os.unlink(f.name)
    return json.load(open(out))


def deviation(te: pd.DataFrame, pred: pd.DataFrame, line: str, sims: dict, max_sim: int) -> dict:
    """line is "physics" or "calibrated": the key of the simulated result for that line. Results are [payback, autarky, npv, battery_kwh]."""
    dif = differs(te, pred)
    idx = np.where(dif)[0][:max_sim]
    t = {"differs": int(dif.sum()), "simulated": 0, "failed": 0, "payback_ours": 0, "payback_expert": 0, "payback_tie": 0,
         "autarky_ours": 0, "autarky_expert": 0, "autarky_tie": 0, "npv_ours": 0, "npv_expert": 0, "npv_tie": 0}
    pids = te.project_id.astype(str).values
    big = lambda p: p if p is not None else 1e9  # no payback at all is worse than any payback
    med = {k: [] for k in ("npv_delta", "pb_o", "pb_e", "au_o", "au_e", "bat_o", "bat_e")}
    for i in idx:
        row = sims.get(pids[i], {})
        ours, exp = row.get(line), row.get("expert")
        if not isinstance(ours, list) or not isinstance(exp, list):
            t["failed"] += 1
            continue
        (po, ao, no, bo), (pe, ae, ne, be) = ours, exp
        t["simulated"] += 1
        t["payback_ours" if big(po) < big(pe) else "payback_expert" if big(pe) < big(po) else "payback_tie"] += 1
        t["autarky_ours" if ao > ae + 1e-9 else "autarky_expert" if ae > ao + 1e-9 else "autarky_tie"] += 1
        if no is not None and ne is not None:
            t["npv_ours" if no > ne + 5 else "npv_expert" if ne > no + 5 else "npv_tie"] += 1
            med["npv_delta"].append(no - ne)
        for k, v in (("pb_o", po), ("pb_e", pe), ("au_o", ao), ("au_e", ae), ("bat_o", bo), ("bat_e", be)):
            if v is not None:
                med[k].append(v)
    t.update({k: (float(np.median(v)) if v else None) for k, v in med.items()})
    return t


def table(lines: list) -> str:
    p = lambda x: f"{x * 100:.1f}%"
    h = "| Line | Population | n | PV | Battery | Wallbox | All four | Heat pump |\n|---|---|---|---|---|---|---|---|\n"
    return h + "\n".join(f"| {l} | {pop} | {s['n']} | {p(s['pv'])} | {p(s['battery'])} | {p(s['wallbox'])} | {p(s['all_four'])} | {p(s['heatpump'])} |"
                         for l, pop, s in lines)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--physics-ref", default="origin/physics", help="git ref of the first-principles planner_rules (no calibration)")
    ap.add_argument("--calibrated-ref", default="1329cd2", help="git ref of the calibrated planner_rules (rules-1)")
    ap.add_argument("--limit", type=int, help="design only the first N homes (timing check), print timing, write no report")
    ap.add_argument("--stub", action="store_true", help="wrap the textbook rule as the formula; harness check only")
    ap.add_argument("--max-sim", type=int, default=100000, help="cap on hourly simulations per population")
    ap.add_argument("--no-sim", action="store_true")
    ap.add_argument("--quick", action="store_true", help="skip the deviation simulation (alias of --no-sim) and reuse the cached black box and textbook lines")
    ap.add_argument("--label", default="", help="text for the report title, e.g. SMOKE TEST")
    ap.add_argument("--population", choices=("fit", "test"), default="fit",
                    help="fit (default): new-system jobs of the fit half. test: the locked test half, board and overlap; needs --final")
    ap.add_argument("--final", action="store_true", help="required for --population test; set only once PHYSICS declares the rules final")
    a = ap.parse_args()
    if a.population == "test" and not a.final:
        raise SystemExit("refused: --population test needs --final (the test half is the exam, scored once PHYSICS declares final)")
    a.no_sim = a.no_sim or a.quick
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
    inter = board[board.project_id.isin(set(test_df.project_id))].reset_index(drop=True)
    union = pd.concat([test_df, board[~board.project_id.isin(set(test_df.project_id))]], ignore_index=True)
    fit_new = NEW_SYSTEM(fit_df)
    scored = fit_new if a.population == "fit" else union
    items = [(r["project_id"], row_inputs(r)) for r in scored.to_dict("records")]
    if a.limit:
        items = items[:a.limit]

    stub = a.stub
    eng = None
    wts = Worktrees()
    import atexit
    atexit.register(wts.close)                     # worktrees stay until the deviation simulation is done
    if not stub:
        phys = rules_designs(wts, a.physics_ref, False, items, None)
        if not a.limit:
            cal = rules_designs(wts, a.calibrated_ref, True, items, fit_df)
        else:
            print("limit run: calibrated line skipped")
            cal = None
    if a.limit:
        print(timing_header() + "\n" + timing_line(f"physics {git('rev-parse', '--short', a.physics_ref)} ({len(items)} homes)", phys, [p for p, _ in items]))
        return
    static = CACHE / "static_lines.json"           # black box and textbook do not depend on the physics ref
    static_have = json.load(open(static)) if static.exists() and a.population == "fit" and not stub else {}
    check_load("black box fit")
    eng = Engine(df, {}).fit()                     # as live
    if stub:
        phys = cal = {"designs": {p: eng.baseline(i) for p, i in items}, "seconds": {}, "constants": {}, "calibrate_seconds": None}
    consts = cal.get("constants") or {}
    psha, csha = git("rev-parse", "--short", a.physics_ref), git("rev-parse", "--short", a.calibrated_ref)
    PHYS, CAL = f"formula-physics ({psha}, no calibration)", f"formula-calibrated ({csha}, fit half)"
    if stub:
        PHYS, CAL = "formula-physics STUB", "formula-calibrated STUB"

    unseen = test_df[~test_df.project_id.isin(set(eng.train.project_id.astype(str)))].reset_index(drop=True)
    print("fitted constants (calibrated line):")
    for k, v in consts.items():
        if k != "_meta":
            print(" ", k, v)
    fit_unseen = fit_new[~fit_new.project_id.isin(set(eng.train.project_id.astype(str)))].reset_index(drop=True)
    if a.population == "fit":
        pops = (("fit half", fit_new, "fit half (new-system)"),)
    else:
        pops = (("test half", test_df, "test half (new-system)"), ("258 board", board, "258 board"), ("board and test half", inter, "board and test half"))
    lines, preds = [], {}
    for key, frame, plabel in pops:
        fitp = a.population == "fit"
        for name, c in ((PHYS, phys), (CAL, cal)):
            preds[(key, name)] = frame_from(c, frame)
            lines.append((name + (", in-sample, fitted on this half" if fitp and name == CAL else ""), plabel, key, 0 if name == PHYS else 1,
                          score(frame, preds[(key, name)])))
        if fitp:
            if "lines" not in static_have:
                static_have["lines"] = {"bb_in": score(frame, predict_frame(eng, frame)), "bb_out": score(fit_unseen, predict_frame(eng, fit_unseen)),
                                        "tb": score(frame, textbook_frame(eng, frame))}
                json.dump(static_have, open(static, "w"))
            lines.append(("black box (chain), in-sample, not comparable", plabel, key, 2, static_have["lines"]["bb_in"]))
            lines.append(("black box (chain), homes it did not train on", f"{len(fit_unseen)} of the fit half", key, 2, static_have["lines"]["bb_out"]))
            lines.append(("textbook", plabel, key, 3, static_have["lines"]["tb"]))
            continue
        else:
            bbf = unseen if key == "test half" else frame
            lines.append(("black box (chain)", "test half, homes the chain did not train on" if key == "test half" else plabel, key, 2,
                          score(bbf, predict_frame(eng, bbf))))
        lines.append(("textbook", plabel, key, 3, score(frame, textbook_frame(eng, frame))))
    lines = [(l, p, s_) for l, p, k, o, s_ in sorted(lines, key=lambda x: ([q[0] for q in pops].index(x[2]), x[3]))]

    title = a.label or ("STUB RUN, harness check, not a result" if stub else "")
    md = [f"# Rules scoreboard, {a.population} half{f' ({title})' if title else ''}", ""]
    if a.population == "fit":
        md += ["> Fit half only. The test half is not scored until PHYSICS declares final. Calibrated is fitted on this half, so its row is in-sample.", ""]
    if stub:
        md += ["> The formula lines below are the textbook rule wrapped. These numbers say nothing about the planner rules.", ""]
    md += [f"Split: fit {len(fit_ids)}, test {len(test_ids)} (seed 42 per installer, lab/split); new-system scope on the test half: {len(test_df)}; "
           f"board: {len(board)}; both: {len(inter)}. Tolerances as the engine scoreboard (PV max(1 kWp, 15%), battery 2 kWh, wallbox and heat pump on the decision).", "",
           table(lines), ""]
    if not a.no_sim:
        frames = {k: f for k, f, _ in pops}
        sims = sim_cache(wts, a.physics_ref, frames, preds, (PHYS, CAL), a.max_sim)
        md += ["## Deviation analysis (hourly simulation, formula vs expert)", "",
               "Homes where PV, battery or wallbox is outside tolerance. Both designs run through simulate() at the physics ref (formula-physics with its sim_inputs plane fill). Payback: lower is better, no payback is worst. Autarky: higher is better.", "",
               "NPV is the 20-year value from simulate(); a gap under EUR 5 counts as a tie. Medians are over the simulated homes.", "",
               "| Line | Population | Differ | Simulated | Payback ours | Payback expert | Payback tie | Autarky ours | Autarky expert | Autarky tie | NPV ours | NPV expert | NPV tie |",
               "|---|---|---|---|---|---|---|---|---|---|---|---|---|"]
        medrows = []
        for key, frame, _ in pops:
            for name in (PHYS, CAL):
                d = deviation(frame, preds[(key, name)], "physics" if name == PHYS else "calibrated", sims, a.max_sim)
                md.append(f"| {name} | {key} | {d['differs']} | {d['simulated']} | {d['payback_ours']} | {d['payback_expert']} | {d['payback_tie']} | "
                          f"{d['autarky_ours']} | {d['autarky_expert']} | {d['autarky_tie']} | {d['npv_ours']} | {d['npv_expert']} | {d['npv_tie']} |")
                f1 = lambda v, f="{:.1f}": "n/a" if v is None else f.format(v)
                medrows.append(f"| {name} | {f1(d['npv_delta'], '{:+,.0f}')} | {f1(d['pb_o'])} vs {f1(d['pb_e'])} | {f1(d['au_o'], '{:.0%}')} vs {f1(d['au_e'], '{:.0%}')} | "
                               f"{f1(d['bat_o'])} vs {f1(d['bat_e'])} | {d['failed']} |")
        md += ["", "Medians, ours vs expert:", "", "| Line | NPV gain, EUR | Payback, years | Autarky | Battery, kWh | Sim failures |", "|---|---|---|---|---|---|", *medrows]
        md.append("")
    md += ["## Runtime per design (ms, formula only)", "", timing_header(), timing_line(PHYS, phys, [p for p, _ in items]),
           timing_line(CAL, cal, [p for p, _ in items]), ""]
    md += ["", "Fitted constants (calibrated line, fit half only):", ""]
    for k, v in consts.items():
        if k != "_meta":
            md.append(f"- {k}: {v}")
    md.append("")
    md.append(f"Black box on the test half is scored only on {len(unseen)} homes it did not train on; the rest are in its train split." if a.population == "test"
              else f"Black box on the fit half: {len(fit_unseen)} of {len(fit_new)} homes were outside its train split (out-of-sample); the all-homes row is in-sample.")
    out = "\n".join(md)
    print(out)
    REPORTS.mkdir(exist_ok=True)
    (REPORTS / ("rules_scoreboard_stub.md" if stub else "rules_scoreboard_smoke.md" if a.label else "rules_scoreboard.md" if a.population == "test" else f"rules_scoreboard_fit_{psha}.md")).write_text(out + "\n")
    print(f"\n({time.time() - t0:.0f} s)")


def timing_header() -> str:
    return "| Line | Designs | Median ms | Mean ms | p95 ms | Max ms | Calibrate |\n|---|---|---|---|---|---|---|"


if __name__ == "__main__":
    main()
