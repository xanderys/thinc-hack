"""FINAL test-half scoring, run once (declared by THINC HACK MASTER). Needs --final.

    cd engine && uv run python -m lab.final_test --final
Engines: rules-4 (445656e), rules-3-band (9837777), rules-1 calibrated (1329cd2, fit half), physics (c1bf388, no calibration),
black box (as live; only test homes it never trained on), textbook. Populations: test half (new-system) and the clean 126 (258 board and test half).
Blocks: ground truth {lowest option, any offered option with the SAME option for all four} x band {ours, Reonic-style package step, pending the expert's answer}.
Package-step band snaps each design to its OWN installer's sold battery sizes (fit-half options), never pooled. Deviation via the hourly simulation at 445656e
for rules-4 and physics. Paired exact McNemar for rules-4 vs rules-1 and vs black box. Aggregates only.
"""
import os
for _v in ("OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS"):
    os.environ[_v] = "1"
import argparse, json, pickle, subprocess, sys, tempfile, time
from pathlib import Path
import numpy as np
import pandas as pd
from app import data
from app.model import TARGET, Engine, row_inputs, roof_to_sim, row_design
from lab.cv import predict_frame, split
from lab.cv_rules3 import mcnemar_exact
from lab.levers import COMPS, K, band_hit, options_by_project
from lab.score_rules import CACHE, NEW_SYSTEM, Worktrees, git, rules_designs, frame_from, deviation, sim_cache, differs
from lab.split import load_split


def worker_designs(wts, sha, module, fit_df, items, fn=None):
    out = CACHE / f"final_{module}{'_' + fn if fn else ''}_{sha}.json"
    if not out.exists():
        req = {"engine": str(wts.engine(sha)), "module": module, "fit_df": fit_df, "items": items, "out": str(out), "fn": fn}
        with tempfile.NamedTemporaryFile(suffix=".pkl", delete=False, dir=CACHE) as f:
            pickle.dump(req, f)
        try:
            subprocess.run([sys.executable, str(Path(__file__).with_name("_final_worker.py")), f.name], check=True)
        finally:
            os.unlink(f.name)
    return json.load(open(out))


def hit_arrays(frame, design, opts, sizes, gt, band):
    """-> (per-component hit dict, all-four hit) for one engine on `frame` (design: DataFrame aligned to frame)."""
    n = len(frame)
    o = {c: design[TARGET[c]].values.astype(float) for c in COMPS}
    if gt == "lowest option":
        h = {c: band_hit(c, band, o[c], frame[TARGET[c]].values.astype(float), sizes) for c in COMPS}
        return h, h["pv"] & h["battery"] & h["wallbox"] & h["heatpump"]
    maxo = max(len(opts[p]) for p in frame.project_id)
    per = {c: np.zeros((n, maxo), bool) for c in COMPS}
    for j in range(maxo):
        ok = np.array([j < len(opts[p]) for p in frame.project_id])
        for c in COMPS:
            e = np.array([(opts[p][j][K[c]] or 0.0) if j < len(opts[p]) else 0.0 for p in frame.project_id])
            per[c][:, j] = band_hit(c, band, o[c], e, sizes) & ok
    return {c: per[c].any(1) for c in COMPS}, (per["pv"] & per["battery"] & per["wallbox"] & per["heatpump"]).any(1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--final", action="store_true")
    ap.add_argument("--extra-rules4-ref", default="445656e")
    ap.add_argument("--rules5-ref", help="final v2: add rules-5 and its textbook, write final_test_v2.md, no deviation simulation")
    ap.add_argument("--rules4-ref", default="6c3b46b")
    ap.add_argument("--rules3-ref", default="6c3b46b")
    ap.add_argument("--rules1-ref", default="6c3b46b")
    ap.add_argument("--physics-ref", default="6c3b46b")
    a = ap.parse_args()
    if not a.final:
        raise SystemExit("refused: the test half is scored once, with --final")
    t0 = time.time()
    df = data.load()[0]
    _, board_src = split(df)
    board = NEW_SYSTEM(board_src).assign(project_id=lambda d: d.project_id.astype(str))
    fit_ids, test_ids = load_split()
    pop = df[~((df.pv_kwp > 40) | (df.battery_kwh > 40) | (df.annual_demand_kwh < 500) | (df.annual_demand_kwh > 30000))]
    pop = pop.assign(project_id=pop.project_id.astype(str)).reset_index(drop=True)
    fit_df = pop[pop.project_id.isin(set(fit_ids))].reset_index(drop=True)
    test = NEW_SYSTEM(pop[pop.project_id.isin(set(test_ids))].reset_index(drop=True))
    clean = test[test.project_id.isin(set(board.project_id))].reset_index(drop=True)
    items = [(r["project_id"], row_inputs(r)) for r in test.to_dict("records")]
    wts = Worktrees()
    import atexit
    atexit.register(wts.close)

    r4 = worker_designs(wts, git("rev-parse", a.rules4_ref), "rules4", fit_df, items)
    r3 = worker_designs(wts, git("rev-parse", a.rules3_ref), "rules3", fit_df, items)
    ph = rules_designs(wts, a.physics_ref, False, items, None)
    r1 = {"designs": worker_designs(wts, git("rev-parse", a.rules1_ref), "calibrated", fit_df, items)}
    eng = Engine(df, {}).fit()
    seen = set(eng.train.project_id.astype(str))
    fr = lambda dd, fm: pd.DataFrame([{k: (dd[p].get(k) or 0.0) for k in TARGET.values()} for p in fm.project_id], index=fm.index)
    r4x = worker_designs(wts, git("rev-parse", a.extra_rules4_ref), "rules4", fit_df, items)
    designs = {"rules-4": fr(r4, test), "rules-4 leaf default (" + a.extra_rules4_ref + ")": fr(r4x, test), "rules-3-band": fr(r3, test), "rules-1": fr(r1["designs"], test), "physics": frame_from(ph, test)}
    bb_mask = ~test.project_id.isin(seen)
    designs["black box"] = pd.DataFrame(index=test.index, columns=list(TARGET.values()), dtype=float)
    designs["black box"].loc[bb_mask] = predict_frame(eng, test[bb_mask]).values
    designs["textbook"] = pd.DataFrame([eng.baseline(row_inputs(r)) for r in test.to_dict("records")], index=test.index)[list(TARGET.values())].fillna(0.0)

    if a.rules5_ref:
        sha5 = git("rev-parse", a.rules5_ref)
        designs = {"rules-5 (" + sha5[:7] + ")": fr(worker_designs(wts, sha5, "rules5", fit_df, items), test),
                   "rules-5 textbook (no corrections)": fr(worker_designs(wts, sha5, "rules5", fit_df, items, fn="textbook"), test),
                   "rules-4 (" + git("rev-parse", "--short", a.rules4_ref) + ")": designs["rules-4"], **{k: v for k, v in designs.items() if k not in ("rules-4", "rules-4 leaf default (" + a.extra_rules4_ref + ")", "physics")}}
    opts = options_by_project(set(test.project_id) | set(fit_ids))
    inst_sizes = {}
    for p in fit_ids:
        if p in opts:
            i = pop.loc[pop.project_id == p, "installer_id"]
            if len(i):
                inst_sizes.setdefault(i.iloc[0], set()).update(round(d["battery_kwh"], 2) for d in opts[p] if d["battery_kwh"] > 0)
    sizes_for = lambda fm: [np.array(sorted(inst_sizes[i])) for i in fm.installer_id]
    multi = lambda fm: sum(len(opts[p]) > 1 for p in fm.project_id)
    pc = lambda x: f"{x * 100:.1f}%"

    md = ["# FINAL test-half score (run once)", "",
          f"Engines: rules-4 {a.rules4_ref}, rules-3-band {a.rules3_ref}, rules-1 calibrated {a.rules1_ref} (all calibrated on the full fit half, {len(fit_df)} homes), physics {a.physics_ref} (no calibration), "
          f"black box as live, textbook. Populations: test half new-system ({len(test)} homes) and the clean 126 ({len(clean)} homes: 258 board and test half). "
          f"Black box is scored only on homes it never trained on: {int(bb_mask.sum())} of {len(test)} on the test half and {int(clean.project_id.isin(set(test.project_id[bb_mask])).sum())} of {len(clean)} on the clean 126. "
          f"Projects with more than one expert option: {multi(test)} of {len(test)} (test half), {multi(clean)} of {len(clean)} (clean 126).", "",
          "Bands. Ours: PV 1 kWp or 15%, battery 2 kWh. Reonic-style, **pending the expert's answer**: PV as ours, battery within one package step of the installer's own sold sizes "
          "(each design snapped to its own installer's sizes, never pooled), wallbox decision only. Heat pump is the decision in both. Any offered option: the same option must satisfy all four.", ""]
    hits_cache = {}
    R4 = next(k for k in designs if k.startswith("rules-4 (") and "leaf default" not in k) if a.rules5_ref else "rules-4"
    R5 = next((k for k in designs if k.startswith("rules-5 (")), None)
    for popname, fm in (("test half", test), ("clean 126", clean)):
        sub = test.project_id.isin(set(fm.project_id)).values
        for gt in ("lowest option", "any offered option"):
            for band in ("ours", "reonic"):
                md += [f"## {popname}: {gt}, {'ours' if band == 'ours' else 'Reonic-style (pending the expert answer)'}", "",
                       "| Engine | n | PV | Battery | Wallbox | All four | Heat pump |", "|---|---|---|---|---|---|---|"]
                for name, d in designs.items():
                    m = sub & (bb_mask.values if name == "black box" else np.ones(len(test), bool))
                    f2 = test[m].reset_index(drop=True)
                    h, allf = hit_arrays(f2, d[m].reset_index(drop=True), opts, sizes_for(f2), gt, band)
                    hits_cache[(popname, gt, band, name)] = (f2.project_id.values, allf)
                    md.append(f"| {name} | {len(f2)} | {pc(h['pv'].mean())} | {pc(h['battery'].mean())} | {pc(h['wallbox'].mean())} | {pc(allf.mean())} | {pc(h['heatpump'].mean())} |")
                md.append("")

    # paired McNemar, rules-4 vs rules-1 and vs black box, lowest option ours (the headline definition) and any option ours
    F = R5 if a.rules5_ref else R4
    md += [f"## Paired McNemar, {F} against the others, all four, ours band", "",
           "| Population | Ground truth | Against | Homes | Only " + F.split(" (")[0] + " | Only other | Exact p |", "|---|---|---|---|---|---|---|"]
    for popname in ("test half", "clean 126"):
        for gt in ("lowest option", "any offered option"):
            p4, h4 = hits_cache[(popname, gt, "ours", F)]
            for other in ([R4, "rules-1", "black box"] if a.rules5_ref else ["rules-1", "black box"]):
                po, ho = hits_cache[(popname, gt, "ours", other)]
                common = sorted(set(p4) & set(po))
                i4 = {p: x for p, x in zip(p4, h4)}; io = {p: x for p, x in zip(po, ho)}
                b = int(sum(i4[p] and not io[p] for p in common)); c = int(sum(io[p] and not i4[p] for p in common))
                md.append(f"| {popname} | {gt} | {other.split(' (')[0]} | {len(common)} | {b} | {c} | {mcnemar_exact(b, c):.3f} |")
    md.append("")

    if a.rules5_ref:
        text = "\n".join(md)
        text = text.replace("# FINAL test-half score (run once)", "# FINAL v2: second look at the test half (first look was rules-4)")
        (Path(__file__).parent / "reports" / "final_test_v2.md").write_text(text + "\n")
        print(text)
        return
    # deviation quality, one process: expert, rules-4 and physics designs through simulate() at the rules-4 ref
    sha4 = git("rev-parse", a.rules4_ref)
    need = {}
    for name, key in (("rules-4", "r4"), ("physics", "ph")):
        for i in np.where(differs(test, designs[name]))[0]:
            r = test.iloc[i].to_dict(); pid = r["project_id"]
            it = need.setdefault(pid, {"pid": pid, "inp": row_inputs(r), "sim_inp": roof_to_sim({k: v for k, v in row_inputs(r).items() if not k.startswith("_")}),
                                       "expert": row_design(r), "phys": False, "cal": None, "extra": {}})
            it["extra"]["rules-4"] = {k: (designs["rules-4"].loc[test.index[i], k] or None) for k in TARGET.values()}
            it["extra"]["physics"] = {k: (designs["physics"].loc[test.index[i], k] or None) for k in TARGET.values()}
    out = CACHE / f"{sha4}-final-dev.json"
    if not out.exists():
        with tempfile.NamedTemporaryFile(suffix=".pkl", delete=False, dir=CACHE) as f:
            pickle.dump({"engine": str(wts.engine(sha4)), "items": list(need.values()), "out": str(out)}, f)
        print(f"deviation simulation at {sha4[:7]}: {len(need)} homes", flush=True)
        try:
            subprocess.run([sys.executable, str(Path(__file__).with_name("_rules_dev_worker.py")), f.name], check=True)
        finally:
            os.unlink(f.name)
    sims = json.load(open(out))
    md += ["## Deviation quality (hourly simulation at " + sha4[:7] + ", money NPV)", "",
           "Homes where the engine's PV, battery or wallbox is outside tolerance of the lowest-option expert design. Both designs run through the same simulate().", "",
           "| Engine | Population | Differ | NPV ours / expert | Payback ours / expert | Autarky ours / expert |", "|---|---|---|---|---|---|"]
    med = ["", "Medians over the simulated homes, ours vs expert:", "", "| Engine | Population | NPV gain, EUR | Payback, years | Autarky | Battery, kWh |", "|---|---|---|---|---|---|"]
    f1 = lambda v, f="{:.1f}": "n/a" if v is None else f.format(v)
    for name in ("rules-4", "physics"):
        for popname, fm in (("test half", test), ("clean 126", clean)):
            m = test.project_id.isin(set(fm.project_id)).values
            d = deviation(test[m].reset_index(drop=True), designs[name][m].reset_index(drop=True), name, sims, 10**9)
            md.append(f"| {name} | {popname} | {d['differs']} ({d['simulated']} simulated) | {d['npv_ours']} / {d['npv_expert']} | {d['payback_ours']} / {d['payback_expert']} | {d['autarky_ours']} / {d['autarky_expert']} |")
            med.append(f"| {name} | {popname} | {f1(d['npv_delta'], '{:+,.0f}')} | {f1(d['pb_o'])} vs {f1(d['pb_e'])} | {f1(d['au_o'], '{:.0%}')} vs {f1(d['au_e'], '{:.0%}')} | {f1(d['bat_o'])} vs {f1(d['bat_e'])} |")
    md += med + ["", f"Run once, {time.time() - t0:.0f} s."]
    text = "\n".join(md)
    (Path(__file__).parent / "reports" / "final_test.md").write_text(text + "\n")
    print(text)


if __name__ == "__main__":
    main()
