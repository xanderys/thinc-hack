"""Paired 5-fold CV inside the fit half: rules-3-band vs rules-1-calibrated, same folds, new-system jobs.

    cd engine && uv run python -m lab.cv_rules3 --ref 9837777 --seeds 42 1 2
Folds: StratifiedKFold(5, shuffle, seed) stratified by installer; calibrate on 4 folds, design the 5th. Test half never read.
Reports within-tolerance per component and all four, the paired split of all-four hits, exact McNemar p, paired bootstrap 95% CI (2,000 resamples).
Aggregates only.
"""
import os
for _v in ("OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS"):
    os.environ[_v] = "1"
import argparse, json, pickle, subprocess, sys, tempfile
from math import comb
from pathlib import Path
import numpy as np
import pandas as pd
from sklearn.model_selection import StratifiedKFold
from app import data, rules
from app.model import COMPONENTS, TARGET, row_inputs
from lab.score_rules import CACHE, NEW_SYSTEM, Worktrees, git
from lab.split import load_split


def hits(te, designs):
    d = pd.DataFrame([{k: (designs[p].get(k) or 0.0) for k in TARGET.values()} for p in te.project_id], index=te.index)
    w = {c: rules.within(c, d[TARGET[c]].values.astype(float), te[TARGET[c]].values.astype(float)) for c in COMPONENTS}
    return w, np.logical_and.reduce(list(w.values()))


def mcnemar_exact(b, c):
    n = b + c
    if n == 0:
        return 1.0
    k = min(b, c)
    return min(1.0, 2 * sum(comb(n, i) for i in range(k + 1)) / 2 ** n)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ref", default="origin/physics")
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
    out = CACHE / f"cv_{sha}_{'-'.join(map(str, a.seeds))}.json"
    wts = Worktrees()
    try:
        if not out.exists():
            req = {"engine": str(wts.engine(sha)), "df": fit, "inputs": {r["project_id"]: row_inputs(r) for r in fit.to_dict("records")},
                   "folds": folds, "out": str(out)}
            with tempfile.NamedTemporaryFile(suffix=".pkl", delete=False, dir=CACHE) as f:
                pickle.dump(req, f)
            try:
                subprocess.run([sys.executable, str(Path(__file__).with_name("_cv_rules3_worker.py")), f.name], check=True)
            finally:
                os.unlink(f.name)
    finally:
        wts.close()
    res = json.load(open(out))
    rng = np.random.default_rng(0)
    md = [f"## Paired 5-fold CV inside the fit half, rules-3-band ({sha[:7]}) vs rules-1-calibrated", "",
          f"{len(fit)} new-system fit-half jobs; StratifiedKFold by installer, calibrate on 4 folds, score the 5th; same folds for both. Test half not read.", "",
          "| Fold seed | Rule | PV | Battery | Wallbox | All four | Only rules-3 | Only rules-1 | McNemar p | Diff 95% CI (pp) |", "|---|---|---|---|---|---|---|---|---|---|"]
    p = lambda x: f"{x * 100:.1f}%"
    for s in a.seeds:
        r = res[str(s)]
        w3, h3 = hits(fit, r["rules3"]); w1, h1 = hits(fit, r["rules1"])
        b, c = int((h3 & ~h1).sum()), int((~h3 & h1).sum())
        d = (h3.astype(int) - h1.astype(int))
        boot = [d[rng.integers(0, len(d), len(d))].mean() * 100 for _ in range(2000)]
        lo, hi = np.percentile(boot, [2.5, 97.5])
        for name, w, h, extra in (("rules-3", w3, h3, f"{b} | {c} | {mcnemar_exact(b, c):.3f} | {lo:+.1f} to {hi:+.1f}"), ("rules-1", w1, h1, "| | | ")):
            md.append(f"| {s} | {name} | {p(w['pv'].mean())} | {p(w['battery'].mean())} | {p(w['wallbox'].mean())} | {p(h.mean())} | {extra} |")
    out_md = "\n".join(md)
    print(out_md)
    (Path(__file__).parent / "reports" / f"cv_rules3_{sha[:7]}.md").write_text(out_md + "\n")


if __name__ == "__main__":
    main()
