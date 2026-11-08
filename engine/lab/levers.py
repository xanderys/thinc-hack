"""Levers table: fit-half 5-fold CV (seed 42), new-system jobs, engines x components, for ground truth {lowest option, any option} x band {ours, Reonic-style}.

    cd engine && uv run python -m lab.levers --rules4-ref 06c6052 --physics-ref c1bf388
Engines: rules-1, rules-3 (cached paired-CV designs), rules-4 (cached out-of-fold), physics (no fitting), black box (Engine.fit_on the same folds, out-of-fold),
textbook (Engine.baseline, no fitting). Test half not read. Aggregates only.
Bands: ours = PV max(1 kWp, 15%), battery 2 kWh. Reonic-style (pending the expert's answer) = PV as ours, battery within one installer package step
(the installer's sold battery sizes from the fit-half options; the design snaps to the nearest sold size, adjacent step counts), wallbox decision only.
Heat pump is the decision in both. Any option: a hit if within tolerance of at least one option the expert offered for the project; for all four the SAME option
must satisfy all four components; footnote gives per-component-any.
"""
import os
for _v in ("OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS"):
    os.environ[_v] = "1"
import argparse, json
from pathlib import Path
import numpy as np
import pandas as pd
from sklearn.model_selection import StratifiedKFold
from app import data, rules
from app.data import INSTALLERS, _design, data_dir
from app.model import TARGET, Engine, row_inputs
from lab.cv import predict_frame, split
from lab.score_rules import CACHE, NEW_SYSTEM, git
from lab.split import load_split

COMPS = ("pv", "battery", "wallbox", "heatpump")
K = {"pv": "pv_kwp", "battery": "battery_kwh", "wallbox": "wallbox_kw", "heatpump": "heatpump_kw"}


def options_by_project(pids: set) -> dict:
    out = {}
    for inst in INSTALLERS:
        parts = pd.read_csv(data_dir() / inst / "project_options_parts.csv")
        parts = parts[parts.project_id.astype(str).isin(pids)]
        for (pid, opt), g in parts.groupby(["project_id", "option_number"]):
            out.setdefault(str(pid), []).append(_design(g))
    return out


def band_hit(comp, band, o, e, sizes):
    """o, e arrays over the same homes (e one option's design); sizes: per-home sorted array of the installer's sold battery sizes."""
    if comp == "battery" and band == "reonic":
        h = np.zeros(len(o), bool)
        for i in range(len(o)):
            if (o[i] > 0) != (e[i] > 0):
                continue
            if e[i] == 0:
                h[i] = True
                continue
            S = sizes[i]
            snap = int(np.argmin(np.abs(S - o[i])))
            ei = int(np.argmin(np.abs(S - e[i])))
            h[i] = abs(snap - ei) <= 1
        return h
    return rules.within(comp, o, e)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--rules4-ref", default="06c6052")
    ap.add_argument("--rules3-ref", default="9837777")
    ap.add_argument("--physics-ref", default="c1bf388")
    ap.add_argument("--seed", type=int, default=42)
    a = ap.parse_args()
    df = data.load()[0]
    pop = df[~((df.pv_kwp > 40) | (df.battery_kwh > 40) | (df.annual_demand_kwh < 500) | (df.annual_demand_kwh > 30000))]
    pop = pop.assign(project_id=pop.project_id.astype(str)).reset_index(drop=True)
    fit_ids, _ = load_split()
    fit = NEW_SYSTEM(pop[pop.project_id.isin(set(fit_ids))].reset_index(drop=True))
    pids = list(fit.project_id)
    n = len(fit)
    opts = options_by_project(set(pids))
    multi = sum(len(opts[p]) > 1 for p in pids)
    distinct = sum(len({(round(d["pv_kwp"], 1), round(d["battery_kwh"], 1), d["wallbox_kw"] > 0, d["heatpump_kw"] > 0) for d in opts[p]}) > 1 for p in pids)
    inst_sizes = {}
    for p, ds in opts.items():
        i = fit.loc[fit.project_id == p, "installer_id"]
        if len(i):
            inst_sizes.setdefault(i.iloc[0], set()).update(round(d["battery_kwh"], 2) for d in ds if d["battery_kwh"] > 0)
    sizes = [np.array(sorted(inst_sizes[i])) for i in fit.installer_id]

    # folds as in cv_rules3 / cv_rules4
    f = np.zeros(n, int)
    for k, (_, te) in enumerate(StratifiedKFold(5, shuffle=True, random_state=a.seed).split(fit, fit.installer_id)):
        f[te] = k
    s = str(a.seed)
    r13 = json.load(open(CACHE / f"cv_{git('rev-parse', a.rules3_ref)}_42-1-2.json"))[s]
    r4 = json.load(open(CACHE / f"cv4_{git('rev-parse', a.rules4_ref)}_42-1-2.json"))["oof"][s]
    ph = json.load(open(CACHE / f"{git('rev-parse', a.physics_ref)}.json"))["designs"]
    fr = lambda dd: pd.DataFrame([{k: (dd[p].get(k) or 0.0) for k in TARGET.values()} for p in pids])
    engines = {"rules-1": fr(r13["rules1"]), "rules-3": fr(r13["rules3"]), "rules-4": fr(r4), "physics": fr(ph)}
    bb = pd.DataFrame(index=fit.index, columns=list(TARGET.values()), dtype=float)
    tb = None
    for k in range(5):
        eng = Engine(df, {}).fit_on(fit[f != k].reset_index(drop=True), fit[f == k].reset_index(drop=True))
        eng.excluded = {"outliers": 0, "rule": "cv"}
        bb.loc[f == k] = predict_frame(eng, fit[f == k]).values
        if tb is None:
            tb = eng
    engines["black box (out-of-fold)"] = bb.reset_index(drop=True)
    engines["textbook"] = pd.DataFrame([tb.baseline(row_inputs(r)) for r in fit.to_dict("records")])[list(TARGET.values())].fillna(0.0)

    # expert option arrays
    maxo = max(len(opts[p]) for p in pids)
    E = {c: np.full((n, maxo), np.nan) for c in COMPS}
    for i, p in enumerate(pids):
        for j, d in enumerate(opts[p]):
            for c in COMPS:
                E[c][i, j] = d[K[c]] or 0.0
    first = {c: fit[TARGET[c]].values.astype(float) for c in COMPS}  # lowest option, as the engine labels it

    pc = lambda x: f"{x * 100:.1f}%"
    md = ["# Levers: which definition of right moves the score", "",
          f"Fit half only, {n} new-system jobs, 5-fold CV (fold seed {a.seed}). Rules and black box are out-of-fold; physics {a.physics_ref} and textbook have no fitting. Test half not read.", "",
          f"Projects with more than one expert option: {multi} of {n} ({multi / n * 100:.1f}%); with options that differ in PV, battery, wallbox or heat pump: {distinct} of {n} ({distinct / n * 100:.1f}%).", "",
          "Bands. Ours: PV 1 kWp or 15%, battery 2 kWh, wallbox and heat pump on the decision. Reonic-style, pending the expert's answer: PV as ours, battery within one installer package step "
          "(the installer's sold battery sizes in the fit-half options; our size snaps to the nearest sold size and an adjacent step counts), wallbox decision only.",
          "Any option: a hit if within tolerance of at least one option the expert offered for that project. All four under any option needs the SAME option to satisfy all four components; the looser per-component-any version is in the footnote of each block.", ""]
    for gt in ("lowest option", "any option"):
        for band in ("ours", "reonic"):
            label = f"{gt}, {'ours' if band == 'ours' else 'Reonic-style (pending)'}"
            md += [f"## {label}", "", "| Engine | PV | Battery | Wallbox | All four | Heat pump |", "|---|---|---|---|---|---|"]
            loose_notes = []
            for name, d in engines.items():
                o = {c: d[TARGET[c]].values.astype(float) for c in COMPS}
                if gt == "lowest option":
                    h = {c: band_hit(c, band, o[c], first[c], sizes) for c in COMPS}
                    allf = h["pv"] & h["battery"] & h["wallbox"] & h["heatpump"]
                    loose = allf
                else:
                    per = {c: np.zeros((n, maxo), bool) for c in COMPS}
                    for j in range(maxo):
                        ok = ~np.isnan(E["pv"][:, j])
                        for c in COMPS:
                            e = np.nan_to_num(E[c][:, j])
                            per[c][:, j] = band_hit(c, band, o[c], e, sizes) & ok
                    h = {c: per[c].any(1) for c in COMPS}
                    allf = (per["pv"] & per["battery"] & per["wallbox"] & per["heatpump"]).any(1)
                    loose = h["pv"] & h["battery"] & h["wallbox"] & h["heatpump"]
                md.append(f"| {name} | {pc(h['pv'].mean())} | {pc(h['battery'].mean())} | {pc(h['wallbox'].mean())} | {pc(allf.mean())} | {pc(h['heatpump'].mean())} |")
                loose_notes.append(f"{name} {pc(loose.mean())}")
            if gt == "any option":
                md += ["", "Footnote, per-component-any (each component may match a different option), all four: " + "; ".join(loose_notes) + "."]
            md.append("")
    out = "\n".join(md)
    (Path(__file__).parent / "reports" / "levers.md").write_text(out + "\n")
    print(out)


if __name__ == "__main__":
    main()
