"""python -m synthetic.run [--n 10000] [--workers 10]"""
import argparse
import json
import os
import time
from datetime import datetime, timezone

import numpy as np

from . import generate as gen, invariants as iv, oracle, report
from .common import OUT, load_engine

MAX_LOAD = 20


def wait_for_load():
    while os.getloadavg()[0] > MAX_LOAD:
        print(f"load {os.getloadavg()[0]:.0f} above {MAX_LOAD}, waiting", flush=True)
        time.sleep(30)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=10_000)
    ap.add_argument("--workers", type=int, default=10)
    a = ap.parse_args()
    wait_for_load()
    t0 = time.time()
    eng, path = load_engine()
    homes = gen.generate(eng.train, a.n)
    OUT.mkdir(parents=True, exist_ok=True)
    with open(OUT / "homes.jsonl", "w") as f:
        for h in homes:
            f.write(json.dumps(h) + "\n")

    errors, valid = {}, []
    for h in homes:
        e, h2 = oracle.input_check(h)
        if e:
            errors[h["_id"]] = e
        else:
            valid.append(h2)
    normal = [h for h in valid if h["_split"] != "adversarial"]
    batch, keys = [oracle.strip(h) for h in valid], []
    for name, applies, tf in iv.VARIANTS:
        for h in normal:
            if applies(h):
                batch.append(oracle.strip(tf(h)))
                keys.append((name, h))
    t1 = time.time()
    sizes = eng.sizes_batch(batch)
    print(f"sizes for {len(batch):,} homes and variants in {time.time() - t1:.1f}s", flush=True)
    designs = {h["_id"]: d for h, d in zip(valid, sizes[:len(valid)])}
    var = {name: {} for name, _, _ in iv.VARIANTS}
    for (name, h), d in zip(keys, sizes[len(valid):]):
        var[name][h["_id"]] = (iv.VARIANTS[[x[0] for x in iv.VARIANTS].index(name)][2](h), d)

    wait_for_load()
    t1 = time.time()
    phys = oracle.run_physics(valid, [designs[h["_id"]] for h in valid], path, workers=a.workers)
    print(f"physics for {len(valid):,} homes in {time.time() - t1:.1f}s", flush=True)

    base = [designs[h["_id"]] for h in normal]
    invs = iv.metamorphic(eng, normal, base, var)
    invs += iv.physics(normal, base, phys, valid, [designs[h["_id"]] for h in valid])
    invs.append(iv.honesty([h for h in homes if h["_split"] == "adversarial"], errors, designs, phys))

    real = [oracle.strip(r) for r in eng.train.to_dict("records")]
    real_cells = {gen.cell(h) for h in real}
    syn_cells = {gen.cell(h) for h in normal}
    tb = eng.train[eng.train.battery_kwh > 0]
    cap = iv.HTW_CAP * np.minimum(tb.pv_kwp + tb.existing_solar_kwp.fillna(0) * tb.has_solar, tb.annual_demand_kwh / 1000)
    by = lambda g: sum(i["n_failed"] for i in invs if i["group"] == g)
    plaus = next(i for i in invs if i["name"] == "No implausible flag")
    r = {
        "n": a.n, "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "seed": gen.SEED,
        "train_rows": len(eng.train), "split": gen.SPLIT,
        "n_normal": len(normal), "n_adversarial": sum(h["_split"] == "adversarial" for h in homes),
        "n_rejected": len(errors), "n_physics_errors": sum("error" in p for p in phys.values()),
        "plausible_share": plaus["pass_share"], "monotonicity_violations": by("monotonicity"),
        "invariants": invs,
        "coverage": {"real_cells": len(real_cells), "real_cells_covered_share": round(len(real_cells & syn_cells) / len(real_cells), 4),
                     "synthetic_cells": len(syn_cells), "new_cells": len(syn_cells - real_cells)},
        "real_htw_share": round(float((tb.battery_kwh * iv.BAT_USABLE <= cap + 1e-9).mean()), 4),
        "runtime_s": round(time.time() - t0, 1), "workers": a.workers,
    }
    report.write(r)
    for i in invs:
        print(f"{i['pass_share'] if i['pass_share'] is not None else 'n/a':>7}  {i['n_failed']:>5}/{i['n_checked']:<6} {i['name']}")
    print(report.headline(r))
    print(f"runtime {r['runtime_s']:.0f}s; rejected {len(errors)}; physics errors {r['n_physics_errors']}")


if __name__ == "__main__":
    main()
