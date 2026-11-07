"""rules-4-readout: paired 5-fold CV vs rules-1 and rules-3 (same folds as lab.cv_rules3) and per-rule support.

    cd engine && uv run python -m lab.cv_rules4 --ref 06c6052 --rules3-ref 9837777
Support: every fit-half home is assigned its rule id under the shipped rules4.json (full fit half). Per rule: homes covered, in-sample
within-tolerance share (shipped rules on their own homes), out-of-fold share (that home's 5-fold prediction, seed 42). Aggregates only.
"""
import os
for _v in ("OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS"):
    os.environ[_v] = "1"
import argparse, json, pickle, subprocess, sys, tempfile
from collections import defaultdict
from pathlib import Path
import numpy as np
import pandas as pd
from sklearn.model_selection import StratifiedKFold
from app import data, rules
from app.model import TARGET, row_inputs
from lab.score_rules import CACHE, NEW_SYSTEM, Worktrees, git
from lab.split import load_split
from lab.cv_rules3 import hits, mcnemar_exact

COMP = {"pv": "pv_kwp", "battery": "battery_kwh", "heatpump": "heatpump_kw", "wallbox": "wallbox_kw"}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ref", default="origin/physics")
    ap.add_argument("--rules3-ref", default="9837777")
    ap.add_argument("--seeds", type=int, nargs="+", default=[42, 1, 2])
    a = ap.parse_args()
    df = data.load()[0]
    pop = df[~((df.pv_kwp > 40) | (df.battery_kwh > 40) | (df.annual_demand_kwh < 500) | (df.annual_demand_kwh > 30000))]
    pop = pop.assign(project_id=pop.project_id.astype(str)).reset_index(drop=True)
    fit_ids, _ = load_split()
    fit = NEW_SYSTEM(pop[pop.project_id.isin(set(fit_ids))].reset_index(drop=True))
    folds = {}
    for s in a.seeds:
        f = np.zeros(len(fit), int)
        for k, (_, te) in enumerate(StratifiedKFold(5, shuffle=True, random_state=s).split(fit, fit.installer_id)):
            f[te] = k
        folds[s] = dict(zip(fit.project_id, f.tolist()))
    sha = git("rev-parse", a.ref)
    out = CACHE / f"cv4_{sha}_{'-'.join(map(str, a.seeds))}.json"
    wts = Worktrees()
    try:
        if not out.exists():
            req = {"engine": str(wts.engine(sha)), "df": fit, "inputs": {r["project_id"]: row_inputs(r) for r in fit.to_dict("records")},
                   "folds": folds, "out": str(out)}
            with tempfile.NamedTemporaryFile(suffix=".pkl", delete=False, dir=CACHE) as f:
                pickle.dump(req, f)
            try:
                subprocess.run([sys.executable, str(Path(__file__).with_name("_cv_rules4_worker.py")), f.name], check=True)
            finally:
                os.unlink(f.name)
    finally:
        wts.close()
    r4 = json.load(open(out))
    r13 = json.load(open(CACHE / f"cv_{git('rev-parse', a.rules3_ref)}_{'-'.join(map(str, a.seeds))}.json"))
    rng = np.random.default_rng(0)
    p = lambda x: f"{x * 100:.1f}%"
    md = [f"## Paired 5-fold CV inside the fit half, rules-4-readout ({sha[:7]}) vs rules-1 and rules-3", "",
          f"{len(fit)} new-system fit-half jobs; same folds as the rules-3 check. Test half not read.", "",
          "| Fold seed | Rule | PV | Battery | Wallbox | All four | Only rules-4 | Only other | McNemar p | Diff 95% CI (pp) |", "|---|---|---|---|---|---|---|---|---|---|"]
    h = {}
    for s in a.seeds:
        w4, h4 = hits(fit, r4["oof"][str(s)])
        w1, h1 = hits(fit, r13[str(s)]["rules1"]); w3, h3 = hits(fit, r13[str(s)]["rules3"])
        h[s] = (w4, h4)
        md.append(f"| {s} | rules-4 | {p(w4['pv'].mean())} | {p(w4['battery'].mean())} | {p(w4['wallbox'].mean())} | {p(h4.mean())} | | | | |")
        for name, w, hh in (("rules-1", w1, h1), ("rules-3", w3, h3)):
            b, c = int((h4 & ~hh).sum()), int((~h4 & hh).sum())
            d = h4.astype(int) - hh.astype(int)
            lo, hi = np.percentile([d[rng.integers(0, len(d), len(d))].mean() * 100 for _ in range(2000)], [2.5, 97.5])
            md.append(f"| {s} | {name} | {p(w['pv'].mean())} | {p(w['battery'].mean())} | {p(w['wallbox'].mean())} | {p(hh.mean())} | {b} | {c} | {mcnemar_exact(b, c):.3f} | {lo:+.1f} to {hi:+.1f} |")
    (Path(__file__).parent / "reports" / f"cv_rules4_{sha[:7]}.md").write_text("\n".join(md) + "\n")
    print("\n".join(md))

    # per-rule support
    seed = str(a.seeds[0])
    full_d = pd.DataFrame([{k: (r4["full"][pid]["design"].get(k) or 0.0) for k in TARGET.values()} for pid in fit.project_id], index=fit.index)
    oof_d = pd.DataFrame([{k: (r4["oof"][seed][pid].get(k) or 0.0) for k in TARGET.values()} for pid in fit.project_id], index=fit.index)
    sup = defaultdict(lambda: {"n": 0, "ins": 0, "oof": 0})
    for comp in COMP:
        wi = rules.within(comp, full_d[TARGET[comp]].values.astype(float), fit[TARGET[comp]].values.astype(float))
        wo = rules.within(comp, oof_d[TARGET[comp]].values.astype(float), fit[TARGET[comp]].values.astype(float))
        for i, pid in enumerate(fit.project_id):
            rid = r4["full"][pid]["fired"].get(comp)
            sup[(comp, rid)]["n"] += 1; sup[(comp, rid)]["ins"] += int(wi[i]); sup[(comp, rid)]["oof"] += int(wo[i])
    sm = ["# Rule support, rules-4-readout (" + sha[:7] + ")", "",
          f"Every one of the {len(fit)} fit-half new-system homes is assigned its rule under the shipped rules4.json. In-sample share: the shipped rules "
          f"on their own homes, within tolerance for that component. Out-of-fold share: the same homes' 5-fold prediction (fold seed {seed}), where the trees differ per fold.", "",
          "| Component | Rule id | Homes | In-sample within tolerance | Out-of-fold within tolerance |", "|---|---|---|---|---|"]
    for (comp, rid), v in sorted(sup.items(), key=lambda kv: (kv[0][0], -kv[1]["n"])):
        sm.append(f"| {comp} | {rid} | {v['n']} | {p(v['ins'] / v['n'])} | {p(v['oof'] / v['n'])} |")
    (Path(__file__).parent / "reports" / "rule_support.md").write_text("\n".join(sm) + "\n")
    print("\n".join(sm))


if __name__ == "__main__":
    main()
