"""Iteration 3: grey-box sizing. Base = physics optimum (20-year NPV over the installer's catalogue, app/hourly),
gradient boosting learns the expert's deviation (residual) or sees the optimum as a feature.

    cd engine && uv run python -m lab.greybox                 # grids (cached), CV for each mode, physics sample
    cd engine && uv run python -m lab.greybox --test residual:argmax   # also score the locked test split for one mode

Grids are computed once per home under the full-train catalogue and cached in engine/.cache/greybox/ (gitignored,
per-project). Prints aggregates only.
"""
import os

for _v in ("OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS"):
    os.environ[_v] = "1"

import argparse
import pickle
import time
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.model_selection import StratifiedKFold

from app import data, model, rules
from app.data import date_t
from app.hourly import validate_physics
from app.model import COMPONENTS, GREYBOX, TARGET, Engine, opt_base, row_inputs
from lab.cv import FOLDS, SEED, check_load, fmt, metrics, predict_frame, split, test_score

CACHE = Path(__file__).resolve().parent.parent / ".cache" / "greybox" / "grids.pkl"
MODES = [(None, "argmax"), ("residual", "argmax"), ("residual", "cheap"), ("feature", "argmax")]


def grids(df, tr, te):
    GREYBOX.update(mode=None, grid=None)
    check_load("catalogue fit")
    eng = Engine(df, {}).fit()  # full-train catalogue, as the live engine has it
    if CACHE.exists():
        model._GRID.update(pickle.loads(CACHE.read_bytes()))
    rows = pd.concat([tr, te]).to_dict("records")
    t0, n0 = time.time(), len(model._GRID)
    for i, r in enumerate(rows):
        if i % 200 == 0:
            check_load(f"grid {i}")
        eng.opt_grid(row_inputs(r), r["installer_id"], date_t(r["offer_date"]))
        if i == 19 and len(model._GRID) - n0 == 20:
            per = (time.time() - t0) / 20
            print(f"grid: {per:.2f} s per home, {per * len(rows) / 60:.1f} min for {len(rows)}")
            if per * len(rows) > 25 * 60:
                raise SystemExit("full grid would exceed 25 minutes: use a coarser grid")
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    CACHE.write_bytes(pickle.dumps(dict(model._GRID)))
    print(f"grids: {len(model._GRID)} cached ({time.time() - t0:.0f} s)")
    return eng


def describe(eng, tr):
    """How the raw optimum compares with the expert (aggregates)."""
    for base in ("argmax", "cheap"):
        GREYBOX["base"] = base
        o = np.array([opt_base(eng.opt_grid(row_inputs(r), r["installer_id"], date_t(r["offer_date"])))
                      for r in tr.to_dict("records")])
        e_pv, e_b = tr.pv_kwp.values, tr.battery_kwh.values
        inc = e_pv > 0
        print(f"optimum {base}: PV median {np.median(o[:, 0]):.1f} kWp (expert {np.median(e_pv[inc]):.1f}), "
              f"PV none {np.mean(o[:, 0] == 0):.1%} (expert {np.mean(~inc):.1%}), battery share {np.mean(o[:, 1] > 0):.1%} "
              f"(expert {np.mean(e_b > 0):.1%}), PV within tol {rules.within('pv', o[:, 0], e_pv).mean():.1%}, "
              f"PV MAE {np.abs(o[inc, 0] - e_pv[inc]).mean():.2f}, corr {np.corrcoef(o[inc, 0], e_pv[inc])[0, 1]:.2f}, "
              f"battery within {rules.within('battery', o[:, 1], e_b).mean():.1%}")


def cv_preds(df, tr):
    skf = StratifiedKFold(n_splits=FOLDS, shuffle=True, random_state=SEED)
    preds = []
    for i, (a, b) in enumerate(skf.split(tr, tr.installer_id)):
        check_load(f"CV fold {i + 1}")
        eng = Engine(df, {}).fit_on(tr.iloc[a], tr.iloc[b])
        eng.excluded = {"outliers": 0, "rule": "cv"}
        preds.append(predict_frame(eng, tr.iloc[b]))
    return pd.concat(preds).loc[tr.index]


def boards(tr, pred):
    scope = ((tr.pv_kwp > 0) | tr.has_solar).values
    out = {"new_system": metrics(tr[scope].reset_index(drop=True), pred[scope].reset_index(drop=True)), "all": metrics(tr, pred)}
    for inst in data.INSTALLERS:
        m = scope & (tr.installer_id == inst).values
        out[f"new_system_{inst}"] = metrics(tr[m].reset_index(drop=True), pred[m].reset_index(drop=True))
    return out


def physics_sample(tr, pred, n=50):
    """validate_physics on n CV designs (same homes for every mode): designs with any warning, total warnings."""
    scope = np.flatnonzero(((tr.pv_kwp > 0) | tr.has_solar).values)
    idx = np.random.default_rng(SEED).choice(scope, n, replace=False)
    flagged = warns = 0
    for i in idx:
        p = pred.iloc[i]
        d = {"pv_kwp": p.pv_kwp or None, "inverter_kw": rules.inverter_kw(p.pv_kwp) if p.pv_kwp else None,
             "battery_kwh": p.battery_kwh or None, "heatpump_kw": p.heatpump_kw or None, "wallbox_kw": p.wallbox_kw or None}
        w = [x for x in validate_physics(row_inputs(tr.iloc[i].to_dict()), d) if x["level"] != "ok"]
        flagged += bool(w)
        warns += len(w)
    return flagged, warns


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--test", help="mode:base to score on the locked test split, e.g. residual:argmax")
    ap.add_argument("--modes", default=",".join(f"{m}:{b}" for m, b in MODES))
    a = ap.parse_args()
    check_load("start")
    df = data.load()[0]
    tr, te = split(df)
    eng = grids(df, tr, te)
    describe(eng, tr)
    for spec in a.modes.split(","):
        m, b = spec.split(":")
        GREYBOX.update(mode=None if m == "None" else m, base=b, grid=eng)
        t = time.time()
        pred = cv_preds(df, tr)
        res = boards(tr, pred)
        fl, nw = physics_sample(tr, pred)
        print(f"== {spec} ({time.time() - t:.0f} s); physics sample: {fl} of 50 designs flagged, {nw} warnings")
        for k, v in res.items():
            print(f"CV {k:22s} {fmt(v)}")
    if a.test:
        m, b = a.test.split(":")
        for mode in (None, m):  # before, after
            GREYBOX.update(mode=mode, base=b, grid=None)
            r = test_score(df)
            ap_ = r["all_projects"]
            print(f"TEST {mode or 'baseline'}: new_system {fmt(r)}; all n {ap_['test']}: all four "
                  f"{ap_['design_match_share'] * 100:.1f}%, PV {ap_['components']['pv'] * 100:.1f}%, "
                  f"battery {ap_['components']['battery'] * 100:.1f}%")


if __name__ == "__main__":
    main()
