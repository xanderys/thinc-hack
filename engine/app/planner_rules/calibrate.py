"""uv run python -m app.planner_rules.calibrate : fit the constants on the calibration half, score on the test half."""
import json
import sys

import numpy as np
import pandas as pd

from .. import rules as R
from . import core
from .split import halves

INSTALLERS = ["2a8ba8e2", "23c108b7"]


def scope(df):
    return df[(df.pv_kwp > 0) | df.has_solar].reset_index(drop=True)  # new-system jobs, as the engine's board


def inputs(r):
    from ..data import INPUT_KEYS
    return {**{k: (None if isinstance(r[k], float) and np.isnan(r[k]) else r[k]) for k in INPUT_KEYS}, "installer_id": r["installer_id"]}


def predict(df):
    return pd.DataFrame([core.recommend(inputs(r))["design"] for r in df.to_dict("records")], index=df.index).fillna(0.0)


def score(df):
    p = predict(df)
    m = {c: R.within(c, p[k], df[k]) for c, k in [("pv", "pv_kwp"), ("battery", "battery_kwh"), ("heatpump", "heatpump_kw"), ("wallbox", "wallbox_kw")]}
    out = {c: round(float(v.mean()), 3) for c, v in m.items()}
    out["all_four"] = round(float(np.logical_and.reduce(list(m.values())).mean()), 3)
    out["n"] = len(df)
    return out


def calibrate(fit_df):
    """Constants from the fit rows only (new-system jobs among them). Returns the constants dict."""
    return fit(scope(fit_df))


def fit(cal):
    """Four fitted constants per installer: oversize_ratio and pv_base_kwp (jointly, PV within tolerance),
    battery_packages (sizes sold at least 3 times), battery_per_kwp (battery within tolerance given the rule's PV)."""
    f = {"_meta": {"fitted_on": f"fit half (seed 42 per installer, same ids as engine/lab/split), {len(cal)} new-system jobs",
                   "oversize_ratio": {"unit": "", "source": "fitted with pv_base_kwp: most PV designs within tolerance on the fit half"},
                   "pv_base_kwp": {"unit": "kWp", "source": "fitted with oversize_ratio: the array this installer fits before sizing to use, most PV designs within tolerance on the fit half"},
                   "battery_per_kwp": {"unit": "kWh/kWp", "source": "fitted: most battery sizes within tolerance on the fit half, given rule 1's PV"},
                   "battery_packages": {"unit": "kWh", "source": "fitted: battery sizes this installer sold at least 3 times in the fit half"}}}
    for inst in INSTALLERS:
        c = cal[cal.installer_id == inst]
        vc = c[c.battery_kwh > 0].battery_kwh.value_counts()
        f[inst] = {"oversize_ratio": 1.0, "pv_base_kwp": 0.0, "battery_per_kwp": 1.0,
                   "battery_packages": sorted(float(x) for x in vc[vc >= 3].index)}
    for inst in INSTALLERS:
        c = cal[(cal.installer_id == inst) & (cal.pv_kwp > 0)]
        need = np.array([u / y for u, y in (core.pv_need(inputs(r)) for r in c.to_dict("records"))])
        best = (-1, None, None)
        for ratio in np.arange(0.0, 3.001, 0.05):
            for base in np.arange(0, 14.01, core.MODULE_KWP):
                pv = np.maximum(1, np.round((base + need * ratio) / core.MODULE_KWP)) * core.MODULE_KWP
                s = float(R.within("pv", pv, c.pv_kwp).mean())
                if s > best[0] + 1e-9:
                    best = (s, round(float(ratio), 2), round(float(base), 2))
        f[inst]["oversize_ratio"], f[inst]["pv_base_kwp"] = best[1], best[2]
    for inst in INSTALLERS:
        c = cal[(cal.installer_id == inst) & (cal.battery_kwh > 0)]
        best = (-1, None)
        for k in np.arange(0.3, 1.501, 0.05):
            f[inst]["battery_per_kwp"] = round(float(k), 2)
            core.FITTED_OVERRIDE = f
            s = float(R.within("battery", predict(c).battery_kwh, c.battery_kwh).mean())
            if s > best[0] + 1e-9:
                best = (s, round(float(k), 2))
        f[inst]["battery_per_kwp"] = best[1]
    core.FITTED_OVERRIDE = None
    return f


def main():
    cal, te = halves()
    cal, te = scope(cal), scope(te)
    f = fit(cal)
    core.FITTED_OVERRIDE = None
    core.FITTED.write_text(json.dumps(f, indent=1))
    core.fitted.cache_clear()
    print("constants (fitted on", f["_meta"]["fitted_on"] + ")")
    for inst in INSTALLERS:
        for k, v in f[inst].items():
            print(f"  {inst} {k} = {v}   [{f['_meta'][k]['source']}]")
    print(f"  evening_share = {core.evening_share():.3f}   [{core.TEXTBOOK['evening_share'][2]}]")
    for k, v in core.TEXTBOOK.items():
        if k != "evening_share":
            print(f"  {k} = {v[0]} {v[1]}   [{v[2]}]")
    print("\nmatch within tolerance (pv, battery, heatpump, wallbox, all four)")
    print("  calibration half", score(cal))
    print("  test half       ", score(te))
    for inst in INSTALLERS:
        print(f"  test half {inst}", score(te[te.installer_id == inst]))


if __name__ == "__main__":
    sys.exit(main())
