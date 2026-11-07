"""Fixed calibration split for the rules engine.

    cd engine && uv run python -m lab.split.make_split

Population: projects with parts (data.load), minus the engine's own outlier drop (PV over 40 kWp, battery over 40 kWh,
demand outside 500 to 30,000 kWh), i.e. the frame Engine.fit splits. Per installer: ids sorted, shuffled with
numpy default_rng(42), first half fit, second half test (odd one out goes to fit). Writes ids only.
"""
import os

for _v in ("OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS"):
    os.environ[_v] = "1"

from pathlib import Path

import numpy as np

HERE = Path(__file__).parent


def engine_population():
    from app import data
    df = data.load()[0]
    out = (df.pv_kwp > 40) | (df.battery_kwh > 40) | (df.annual_demand_kwh < 500) | (df.annual_demand_kwh > 30000)
    return df[~out].reset_index(drop=True), df


def build():
    d, _ = engine_population()
    fit, test = [], []
    for inst in sorted(d.installer_id.unique()):
        ids = np.array(sorted(d[d.installer_id == inst].project_id.astype(str)))
        rng = np.random.default_rng(42)
        p = rng.permutation(len(ids))
        h = (len(ids) + 1) // 2
        fit += list(ids[p[:h]])
        test += list(ids[p[h:]])
    return sorted(fit), sorted(test)


if __name__ == "__main__":
    fit, test = build()
    (HERE / "fit_ids.txt").write_text("\n".join(fit) + "\n")
    (HERE / "test_ids.txt").write_text("\n".join(test) + "\n")
    print(len(fit), len(test))
