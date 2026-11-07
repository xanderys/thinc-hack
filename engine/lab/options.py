"""Iteration 2: which offer option is the expert label? Lowest (engine today), last, or the installer's most common component set.

    cd engine && uv run python -m lab.options            # option structure, then CV for each rule
    cd engine && uv run python -m lab.options --describe # structure only, no fits

Labels are built here from data._design per option; app/data.py is untouched. The locked split is kept by
project id: a project whose label under a rule would change its outlier status keeps its lowest-option label
(counted). Prints aggregates only.
"""
import os

for _v in ("OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS"):
    os.environ[_v] = "1"

import argparse
import time

import numpy as np
import pandas as pd
from sklearn.model_selection import StratifiedKFold

from app import data
from app.model import Engine
from lab.cv import FOLDS, SEED, check_load, metrics, predict_frame, split

RULES = ["lowest", "last", "common_set"]
LABELS = ["pv_kwp", "pv_signal", "inverter_kw", "battery_kwh", "heatpump_kw", "wallbox_kw"]


def option_designs() -> pd.DataFrame:
    """One row per (project, option) with the sized design and its component set."""
    root, rows = data.data_dir(), []
    for inst in data.INSTALLERS:
        p = pd.read_csv(root / inst / "project_options_parts.csv")
        for (pid, o), g in p.groupby(["project_id", "option_number"]):
            rows.append(dict(installer_id=inst, project_id=pid, option=o, n_lines=len(g), **data._design(g)))
    d = pd.DataFrame(rows)
    d["cset"] = list(zip(d.pv_kwp > 0, d.battery_kwh > 0, d.heatpump_kw > 0, d.wallbox_kw > 0))
    return d.sort_values(["project_id", "option"]).reset_index(drop=True)


def pick(d: pd.DataFrame, rule: str, train_ids: set) -> pd.DataFrame:
    """One option per project under a rule."""
    g = d.groupby("project_id")
    if rule == "lowest":
        return g.head(1).set_index("project_id")
    if rule == "last":
        return g.tail(1).set_index("project_id")
    # common_set: rank component sets by frequency among train projects' lowest options at that installer;
    # take the option with the best-ranked set, lowest number on a tie. Sets never seen rank last.
    low = g.head(1)
    low = low[low.project_id.isin(train_ids)]
    rank = {inst: {s: i for i, s in enumerate(low[low.installer_id == inst].cset.value_counts().index)} for inst in data.INSTALLERS}
    r = d.assign(rank=[rank[i].get(s, 99) for i, s in zip(d.installer_id, d.cset)])
    return r.sort_values(["project_id", "rank", "option"]).groupby("project_id").head(1).set_index("project_id")


def describe(d: pd.DataFrame):
    for inst in data.INSTALLERS:
        x = d[d.installer_id == inst]
        n = x.groupby("project_id").option.nunique()
        multi = x[x.project_id.isin(n[n > 1].index)]
        f, l = multi.groupby("project_id").head(1).set_index("project_id"), multi.groupby("project_id").tail(1).set_index("project_id")
        same = (f.pv_kwp == l.pv_kwp) & (f.battery_kwh == l.battery_kwh) & (f.heatpump_kw == l.heatpump_kw) & (f.wallbox_kw == l.wallbox_kw)
        lo = x.groupby("project_id").option.min()
        print(f"{inst}: {len(n)} projects, {int((n > 1).sum())} with more than one option (counts {n.value_counts().sort_index().to_dict()}); "
              f"lowest option not 1: {int((lo != 1).sum())}")
        print(f"  first vs last option (multi): identical {int(same.sum())}, component set differs {int((f.cset != l.cset).sum())}; "
              f"last adds heat pump {int(((l.heatpump_kw > 0) & (f.heatpump_kw == 0)).sum())}, "
              f"adds battery {int(((l.battery_kwh > 0) & (f.battery_kwh == 0)).sum())}, drops battery {int(((l.battery_kwh == 0) & (f.battery_kwh > 0)).sum())}, "
              f"bigger battery {int((l.battery_kwh > f.battery_kwh).sum())}, smaller {int((l.battery_kwh < f.battery_kwh).sum())}; "
              f"adds PV {int(((l.pv_kwp > 0) & (f.pv_kwp == 0)).sum())}, drops PV {int(((l.pv_kwp == 0) & (f.pv_kwp > 0)).sum())}, "
              f"bigger PV {int((l.pv_kwp > f.pv_kwp).sum())}, smaller {int((l.pv_kwp < f.pv_kwp).sum())}; "
              f"adds wallbox {int(((l.wallbox_kw > 0) & (f.wallbox_kw == 0)).sum())}, drops wallbox {int(((l.wallbox_kw == 0) & (f.wallbox_kw > 0)).sum())}; "
              f"median line items first {f.n_lines.median():.0f}, last {l.n_lines.median():.0f}")


def frames(d: pd.DataFrame) -> tuple[dict, dict]:
    base, _ = data.load()
    tr0, _ = split(base)
    train_ids = set(tr0.project_id)
    out = (base.pv_kwp > 40) | (base.battery_kwh > 40) | (base.annual_demand_kwh < 500) | (base.annual_demand_kwh > 30000)
    fr, info = {}, {}
    for rule in RULES:
        p = pick(d, rule, train_ids)
        df = base.copy()
        new = p.loc[df.project_id, LABELS].reset_index(drop=True)
        new_out = (new.pv_kwp > 40) | (new.battery_kwh > 40) | (df.annual_demand_kwh < 500) | (df.annual_demand_kwh > 30000)
        keep_old = (new_out != out).values  # keep the locked split: outlier status must not move
        for k in LABELS:
            df[k] = [o if kp else n for o, n, kp in zip(base[k], new[k], keep_old)]
        tr = split(df)[0]
        assert (tr.project_id.values == tr0.project_id.values).all()
        ch = ~((tr.pv_kwp.values == tr0.pv_kwp.values) & (tr.battery_kwh.values == tr0.battery_kwh.values)
               & (tr.heatpump_kw.values == tr0.heatpump_kw.values) & (tr.wallbox_kw.values == tr0.wallbox_kw.values))
        cs = lambda t: list(zip(t.pv_kwp > 0, t.battery_kwh > 0, t.heatpump_kw > 0, t.wallbox_kw > 0))
        info[rule] = dict(train_changed=int(ch.sum()), set_changed=int(sum(a != b for a, b in zip(cs(tr), cs(tr0)))),
                          kept_for_split=int(keep_old.sum()), bat_no_pv_labels=int(((tr.battery_kwh > 0) & (tr.pv_kwp <= 0)).sum()))
        fr[rule] = df
    return fr, info


def cv_preds(df: pd.DataFrame) -> pd.DataFrame:
    tr, _ = split(df)
    skf = StratifiedKFold(n_splits=FOLDS, shuffle=True, random_state=SEED)
    preds = []
    for i, (a, b) in enumerate(skf.split(tr, tr.installer_id)):
        check_load(f"CV fold {i + 1}")
        eng = Engine(df, {}).fit_on(tr.iloc[a], tr.iloc[b])
        preds.append(predict_frame(eng, tr.iloc[b]))
    return pd.concat(preds).loc[tr.index]


def boards(ev_df: pd.DataFrame, pred: pd.DataFrame) -> dict:
    ev = split(ev_df)[0]
    scope = ((ev.pv_kwp > 0) | ev.has_solar).values
    return {"new_system": metrics(ev[scope].reset_index(drop=True), pred[scope].reset_index(drop=True)), "all": metrics(ev, pred)}


def line(m: dict) -> str:
    return (f"n {m['n']}: all four {m['all_four'] * 100:.1f}%, PV {m['pv_within'] * 100:.1f}% (MAE {m['pv_mae']:.2f}), "
            f"battery {m['battery_within'] * 100:.1f}%, battery with no PV {m['battery_with_no_pv']}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--describe", action="store_true")
    a = ap.parse_args()
    t = time.time()
    d = option_designs()
    describe(d)
    if a.describe:
        return
    fr, info = frames(d)
    for r in RULES:
        print(f"labels {r:10s} {info[r]}")
    for fit in RULES:
        check_load(f"fit {fit}")
        pred = cv_preds(fr[fit])
        for ev in sorted({fit, "lowest"}, key=RULES.index):
            b = boards(fr[ev], pred)
            for k in ("new_system", "all"):
                print(f"CV fit {fit:10s} score {ev:10s} {k:10s} {line(b[k])}")
        print(f"({time.time() - t:.0f} s)", flush=True)


if __name__ == "__main__":
    main()
