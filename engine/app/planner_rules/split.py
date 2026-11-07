"""Fixed calibration / test halves (seed 42, per installer), the same method as engine/lab/split/make_split.py.
Computed from the data pack at run time; no ids in this folder."""
from functools import lru_cache

import numpy as np


@lru_cache(1)
def halves():
    from ..data import load
    df, _ = load()
    out = (df.pv_kwp > 40) | (df.battery_kwh > 40) | (df.annual_demand_kwh < 500) | (df.annual_demand_kwh > 30000)
    df = df[~out].reset_index(drop=True)  # the engine's own exclusion
    fit = []
    for inst in sorted(df.installer_id.unique()):
        ids = np.array(sorted(df[df.installer_id == inst].project_id.astype(str)))
        p = np.random.default_rng(42).permutation(len(ids))
        fit += list(ids[p[:(len(ids) + 1) // 2]])
    m = df.project_id.astype(str).isin(set(fit))
    return df[m].reset_index(drop=True), df[~m].reset_index(drop=True)


def test_ids() -> set:
    return set(halves()[1].project_id.astype(str))
