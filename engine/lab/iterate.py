"""Per-push scorer for the rules-5 iterations: fit half, new-system jobs, 5-fold CV (fold seed 42), one process, --quick by default (no hourly simulation).

    cd engine && uv run python -m lab.iterate --ref <sha> [--module rules5] [--textbook rules5:reonic_textbook]
Columns: rules-5 (the push), rules-4 (6c3b46b), black box (out-of-fold), pure Reonic textbook (only when --textbook names a function that the push exposes),
rule of thumb (Engine.baseline: 1.3 kWp per MWh + 2.5 with an EV). Blocks: ground truth {lowest option, any offered option, same option for all four} x
band {ours, package step (each design snapped to its OWN installer's sold sizes)}. A gain under 2.5 points over rules-4 is marked noise.
Per-rule support for rules_fired ids: homes covered and out-of-fold within-tolerance share -> reports/rule_support_<sha>.md. Test half never read.
"""
import os
for _v in ("OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS"):
    os.environ[_v] = "1"
import argparse, json, pickle, subprocess, sys, tempfile, time
from collections import defaultdict
from pathlib import Path
import numpy as np
import pandas as pd
from sklearn.model_selection import StratifiedKFold
from app import data, rules
from app.model import TARGET, Engine, row_inputs
from lab.cv import check_load, predict_frame
from lab.final_test import hit_arrays
from lab.levers import COMPS, options_by_project
from lab.score_rules import CACHE, NEW_SYSTEM, Worktrees, git
from lab.split import load_split

REPORTS = Path(__file__).parent / "reports"


def run_module(wts, sha, module, fit, fold, inputs, textbook=None):
    out = CACHE / f"iter_{module}_{sha}{'_tb' if textbook else ''}.json"
    if not out.exists():
        req = {"engine": str(wts.engine(sha)), "module": module, "df": fit, "inputs": inputs, "fold": fold, "textbook": textbook, "out": str(out)}
        with tempfile.NamedTemporaryFile(suffix=".pkl", delete=False, dir=CACHE) as f:
            pickle.dump(req, f)
        try:
            subprocess.run([sys.executable, str(Path(__file__).with_name("_iter_worker.py")), f.name], check=True)
        finally:
            os.unlink(f.name)
    return json.load(open(out))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ref", required=True, help="the rules-5 push")
    ap.add_argument("--module", default="rules5")
    ap.add_argument("--textbook", help="module:function in the push that returns the pure Reonic textbook design")
    ap.add_argument("--rules4-ref", default="6c3b46b")
    ap.add_argument("--seed", type=int, default=42)
    a = ap.parse_args()
    t0 = time.time()
    check_load("start")
    df = data.load()[0]
    pop = df[~((df.pv_kwp > 40) | (df.battery_kwh > 40) | (df.annual_demand_kwh < 500) | (df.annual_demand_kwh > 30000))]
    pop = pop.assign(project_id=pop.project_id.astype(str)).reset_index(drop=True)
    fit_ids, _ = load_split()
    fit = NEW_SYSTEM(pop[pop.project_id.isin(set(fit_ids))].reset_index(drop=True))
    n = len(fit)
    f = np.zeros(n, int)
    for k, (_, te) in enumerate(StratifiedKFold(5, shuffle=True, random_state=a.seed).split(fit, fit.installer_id)):
        f[te] = k
    fold = dict(zip(fit.project_id, f.tolist()))
    inputs = {r["project_id"]: row_inputs(r) for r in fit.to_dict("records")}
    wts = Worktrees()
    import atexit
    atexit.register(wts.close)
    sha5, sha4 = git("rev-parse", a.ref), git("rev-parse", a.rules4_ref)
    r5 = run_module(wts, sha5, a.module, fit, fold, inputs, a.textbook)
    r4 = run_module(wts, sha4, "rules4", fit, fold, inputs)
    fr = lambda dd: pd.DataFrame([{k: (dd[p].get(k) or 0.0) for k in TARGET.values()} for p in fit.project_id])
    engines = {f"rules-5 ({sha5[:7]})": fr(r5["oof"]), f"rules-4 ({sha4[:7]})": fr(r4["oof"])}
    static = CACHE / f"iter_static_{a.seed}.json"
    if static.exists():
        s = json.load(open(static))
        bb, thumb = pd.DataFrame(s["bb"]), pd.DataFrame(s["thumb"])
    else:
        bb = pd.DataFrame(index=fit.index, columns=list(TARGET.values()), dtype=float)
        tb_eng = None
        for k in range(5):
            eng = Engine(df, {}).fit_on(fit[f != k].reset_index(drop=True), fit[f == k].reset_index(drop=True))
            eng.excluded = {"outliers": 0, "rule": "cv"}
            bb.loc[f == k] = predict_frame(eng, fit[f == k]).values
            tb_eng = tb_eng or eng
        thumb = pd.DataFrame([tb_eng.baseline(row_inputs(r)) for r in fit.to_dict("records")])[list(TARGET.values())].fillna(0.0)
        json.dump({"bb": bb.reset_index(drop=True).to_dict("list"), "thumb": thumb.to_dict("list")}, open(static, "w"))
    engines["black box (out-of-fold)"] = bb.reset_index(drop=True)
    if r5.get("reonic"):
        engines["pure Reonic textbook"] = fr(r5["reonic"])
    engines["rule of thumb (1.3 kWp/MWh + 2.5 EV)"] = thumb.reset_index(drop=True)

    opts = options_by_project(set(fit.project_id) | set(fit_ids))
    inst_sizes = {}
    for p in fit_ids:
        if p in opts:
            i = pop.loc[pop.project_id == p, "installer_id"]
            if len(i):
                inst_sizes.setdefault(i.iloc[0], set()).update(round(d["battery_kwh"], 2) for d in opts[p] if d["battery_kwh"] > 0)
    sizes = [np.array(sorted(inst_sizes[i])) for i in fit.installer_id]
    multi = sum(len(opts[p]) > 1 for p in fit.project_id)
    pc = lambda x: f"{x * 100:.1f}%"
    md = [f"# Iteration score, rules-5 {sha5[:7]} (fit half only)", "",
          f"{n} new-system fit-half jobs, 5-fold CV (fold seed {a.seed}); rules and black box out-of-fold, rule of thumb has no fitting. Test half not read. "
          f"{multi} of {n} projects have more than one expert option. A gain under 2.5 points over rules-4 is marked noise.", ""]
    if not r5.get("reonic"):
        md += ["No pure Reonic textbook column: the push exposes no textbook function (pass `--textbook module:function`).", ""]
    ref_col = f"rules-4 ({sha4[:7]})"
    for gt in ("lowest option", "any offered option"):
        for band in ("ours", "package step"):
            md += [f"## {gt}, {band} band" + (" (pending the expert's answer)" if band != "ours" else ""), "",
                   "| Engine | PV | Battery | Wallbox | All four | vs rules-4, all four | Heat pump |", "|---|---|---|---|---|---|---|"]
            res = {}
            for name, d in engines.items():
                h, allf = hit_arrays(fit, d, opts, sizes, gt, "ours" if band == "ours" else "reonic")
                res[name] = (h, allf)
            base = res[ref_col][1].mean()
            for name, (h, allf) in res.items():
                dlt = (allf.mean() - base) * 100
                tag = "" if name == ref_col else f"{dlt:+.1f} pp" + (" (noise)" if abs(dlt) < 2.5 else "")
                md.append(f"| {name} | {pc(h['pv'].mean())} | {pc(h['battery'].mean())} | {pc(h['wallbox'].mean())} | {pc(allf.mean())} | {tag} | {pc(h['heatpump'].mean())} |")
            md.append("")
    # per-rule support
    fired = [r5["full"][p]["fired"] for p in fit.project_id]
    sm = [f"# Rule support, rules-5 {sha5[:7]}", ""]
    if not any(fired):
        sm += ["The push exposes no rules_fired; ask PHYSICS for a hook."]
    else:
        full_d = fr({p: r5["full"][p]["design"] for p in fit.project_id})
        oof_d = engines[f"rules-5 ({sha5[:7]})"]
        sup = defaultdict(lambda: {"n": 0, "ins": 0, "oof": 0})
        for comp in COMPS:
            k = TARGET[comp]
            wi = rules.within(comp, full_d[k].values.astype(float), fit[k].values.astype(float))
            wo = rules.within(comp, oof_d[k].values.astype(float), fit[k].values.astype(float))
            for i, fd in enumerate(fired):
                rid = (fd or {}).get(comp)
                sup[(comp, rid)]["n"] += 1; sup[(comp, rid)]["ins"] += int(wi[i]); sup[(comp, rid)]["oof"] += int(wo[i])
        sm += ["Homes assigned to each rule under the shipped rules; in-sample share = shipped rules on their own homes; out-of-fold share = the same homes' 5-fold prediction.", "",
               "| Component | Rule id | Homes | In-sample | Out-of-fold |", "|---|---|---|---|---|"]
        for (comp, rid), v in sorted(sup.items(), key=lambda kv: (kv[0][0], -kv[1]["n"])):
            sm.append(f"| {comp} | {rid} | {v['n']} | {pc(v['ins'] / v['n'])} | {pc(v['oof'] / v['n'])} |")
    (REPORTS / f"rule_support_{sha5[:7]}.md").write_text("\n".join(sm) + "\n")
    md += ["", f"Run {time.time() - t0:.0f} s. Per-rule support: `rule_support_{sha5[:7]}.md`."]
    (REPORTS / f"iteration_{sha5[:7]}.md").write_text("\n".join(md) + "\n")
    print("\n".join(md + [""] + sm))


if __name__ == "__main__":
    main()
