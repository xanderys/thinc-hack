"""5-fold CV inside the locked train split, with the engine's own fit, predict and tolerance code.

    cd engine && uv run python -m lab.cv            # CV on train (new-system jobs and all jobs)
    cd engine && uv run python -m lab.cv --test     # also score the locked test split once (Engine.evaluate)

The test split (20%, stratified by installer, seed 42) is never touched by CV. Sizes only: no hourly simulation.
Prints aggregates only.
"""
import os

# the mini serves the live demo engine: one thread, one fit at a time (set before numpy/sklearn load)
for _v in ("OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS"):
    os.environ[_v] = "1"

import argparse
import json
import time

import numpy as np
import pandas as pd
from sklearn.model_selection import StratifiedKFold

from app import data, rules
from app.model import COMPONENTS, SEED, TARGET, Engine, row_inputs

FOLDS = 5
MAX_LOAD = 30  # 1-minute load average; above it the harness stops instead of waiting


def check_load(where: str):
    load = os.getloadavg()[0]
    if load > MAX_LOAD:
        raise SystemExit(f"stopped before {where}: load average {load:.0f} is above {MAX_LOAD}")


def metrics(te: pd.DataFrame, pred: pd.DataFrame) -> dict:
    """Same definitions as Engine._evaluate: tolerance hits per component, all four at once, size MAE where the expert included."""
    out, allc = {"n": int(len(te))}, np.ones(len(te), bool)
    for c in COMPONENTS:
        k = TARGET[c]
        e, o = te[k].values.astype(float), pred[k].values.astype(float)
        w = rules.within(c, o, e)
        allc &= w
        out[f"{c}_within"] = float(w.mean())
        if c in ("pv", "battery"):
            inc = e > 0
            out[f"{c}_mae"] = float(np.abs(o[inc] - e[inc]).mean()) if inc.any() else None
    out["all_four"] = float(allc.mean())
    out["battery_with_no_pv"] = int(((pred.battery_kwh > 0) & (pred.pv_kwp <= 0) & ~te.has_solar.values).sum())
    return out


def predict_frame(eng: Engine, te: pd.DataFrame) -> pd.DataFrame:
    rows = []
    for r in te.to_dict("records"):
        d = eng.predict(row_inputs(r), full=False)["design"]
        rows.append({k: (d[k] or 0.0) for k in TARGET.values()})
    return pd.DataFrame(rows, index=te.index)


def split(df: pd.DataFrame):
    """The engine's own outlier rule and locked split (via Engine.fit), returned without refitting."""
    # reproduce Engine.fit's filter and split exactly, then stop before fitting
    from sklearn.model_selection import train_test_split
    out = (df.pv_kwp > 40) | (df.battery_kwh > 40) | (df.annual_demand_kwh < 500) | (df.annual_demand_kwh > 30000)
    d = df[~out].reset_index(drop=True)
    tr, te = train_test_split(d, test_size=0.2, random_state=SEED, stratify=d.installer_id)
    return tr.reset_index(drop=True), te.reset_index(drop=True)


def cv(df: pd.DataFrame, df_eval: pd.DataFrame | None = None) -> dict:
    """Fit folds on df's labels; score against df_eval's labels (same projects, other label rule) when given."""
    tr, _ = split(df)
    ev = tr if df_eval is None else split(df_eval)[0]
    assert (ev.project_id.values == tr.project_id.values).all(), "label rules must keep the same projects and split"
    skf = StratifiedKFold(n_splits=FOLDS, shuffle=True, random_state=SEED)
    preds = []
    for i, (a, b) in enumerate(skf.split(tr, tr.installer_id)):
        check_load(f"CV fold {i + 1}")
        eng = Engine(df, {}).fit_on(tr.iloc[a], tr.iloc[b])
        eng.excluded = {"outliers": 0, "rule": "cv"}
        p = predict_frame(eng, tr.iloc[b])
        preds.append(p)
    pred = pd.concat(preds).loc[tr.index]
    scope = ((ev.pv_kwp > 0) | ev.has_solar).values
    res = {"train": len(tr), "folds": FOLDS,
           "new_system": metrics(ev[scope].reset_index(drop=True), pred[scope].reset_index(drop=True)),
           "all": metrics(ev, pred)}
    for inst in data.INSTALLERS:
        m = scope & (ev.installer_id == inst).values
        res[f"new_system_{inst}"] = metrics(ev[m].reset_index(drop=True), pred[m].reset_index(drop=True))
    return res


def test_score(df: pd.DataFrame) -> dict:
    check_load("test fit")
    eng = Engine(df, {}).fit()
    ev = eng.evaluate()
    c = ev["components"]
    return {"n": ev["split"]["test"], "all_four": ev["overall"]["design_match_share"],
            "pv_within": c["pv"]["within_tolerance_share"], "pv_mae": c["pv"]["size_mae"],
            "battery_within": c["battery"]["within_tolerance_share"], "battery_mae": c["battery"]["size_mae"],
            "heatpump_within": c["heatpump"]["within_tolerance_share"], "wallbox_within": c["wallbox"]["within_tolerance_share"],
            "all_projects": ev["all_projects"]}


def fmt(m: dict) -> str:
    p = lambda k: f"{m[k] * 100:.1f}%"
    return (f"n {m['n']}: all four {p('all_four')}, PV {p('pv_within')} (MAE {m['pv_mae']:.2f}), "
            f"battery {p('battery_within')} (MAE {m['battery_mae']:.2f}), HP {p('heatpump_within')}, WB {p('wallbox_within')}"
            + (f", battery with no PV {m['battery_with_no_pv']}" if "battery_with_no_pv" in m else ""))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--test", action="store_true", help="also score the locked test split (once per accepted change)")
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()
    check_load("start")
    t = time.time()
    # a label-rule iteration loads a second frame and passes it as df_eval (fit on one rule, score on the other)
    df = data.load()[0]
    res = {"cv": cv(df)}
    if a.test:
        res["test"] = test_score(df)
    if a.json:
        print(json.dumps(res, indent=1))
    else:
        for k in ("new_system", "all", *(f"new_system_{i}" for i in data.INSTALLERS)):
            print(f"CV {k:22s} {fmt(res['cv'][k])}")
        if a.test:
            print(f"TEST new_system          {fmt(res['test'])}")
            ap_ = res["test"]["all_projects"]
            print(f"TEST all                 n {ap_['test']}: all four {ap_['design_match_share'] * 100:.1f}%")
    if not a.json:
        print(f"({time.time() - t:.0f} s)")


if __name__ == "__main__":
    main()
