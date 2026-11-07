"""Child process for lab.score_rules: imports app.planner_rules from ONE git worktree's engine/ and designs every request.

    python lab/_rules_worker.py <request.pkl>

Request: {"engine": <worktree engine dir>, "items": [(project_id, inputs)], "fit_df": DataFrame | None, "constants": dict | None,
"out": <json path>}. fit_df given and no constants: calibrate(fit_df) first. Neither: constants=None (formula as committed).
Merges into the cache file at "out" after every 25 designs so an interrupted run resumes. Aggregates only; the cache is gitignored.
"""
import json
import os
import pickle
import sys
import time

req = pickle.load(open(sys.argv[1], "rb"))
sys.path.insert(0, req["engine"])
os.chdir(req["engine"])
from app.planner_rules import recommend  # noqa: E402  (this worktree's, never the lab's)

KEYS = ("pv_kwp", "battery_kwh", "heatpump_kw", "wallbox_kw", "inverter_kw")
out = req["out"]
cache = json.load(open(out)) if os.path.exists(out) else {"designs": {}, "seconds": {}, "constants": None, "calibrate_seconds": None}
consts = req["constants"] or cache.get("constants")
if consts is None and req["fit_df"] is not None:
    from app.planner_rules.calibrate import calibrate  # noqa: E402
    t = time.time()
    consts = calibrate(req["fit_df"])
    cache["calibrate_seconds"] = time.time() - t
    print(f"  calibrated in {cache['calibrate_seconds']:.0f} s", flush=True)
cache["constants"] = consts


def save():
    tmp = out + ".tmp"
    json.dump(cache, open(tmp, "w"), default=str)
    os.replace(tmp, out)


todo = [(p, i) for p, i in req["items"] if p not in cache["designs"]]
t0 = time.time()
for n, (pid, inp) in enumerate(todo, 1):
    t = time.time()
    d = recommend(inp, constants=consts)["design"]
    cache["seconds"][pid] = time.time() - t
    cache["designs"][pid] = {k: d.get(k) for k in KEYS}
    if n % 25 == 0 or n == len(todo):
        el = time.time() - t0
        print(f"  {n}/{len(todo)} designs, {el:.0f} s, {el / n * 1000:.0f} ms each, about {el / n * (len(todo) - n):.0f} s left", flush=True)
        save()
save()
