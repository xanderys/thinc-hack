"""Child process for lab.score_rules deviation analysis: runs designs through simulate() of ONE git worktree's engine/.

    python lab/_rules_dev_worker.py <request.pkl>

Request: {"engine": dir, "items": [{"pid", "inp", "sim_inp", "expert", "phys": bool, "cal": design | None}], "out": json path}.
Per home: expert design through simulate(sim_inp, expert); physics formula = recommend(inp) then
simulate({**sim_inp, **rec["sim_inputs"]}, rec["design"]); calibrated design (cached, from another ref) through the same simulate.
Result per line: [payback, autarky, npv_20y_eur, battery_kwh]. Per pid: {"expert": [payback, autarky], "physics": [...], "calibrated": [...]} (error dict on failure). Aggregates only; cache gitignored.
"""
import json
import os
import pickle
import sys
import time

req = pickle.load(open(sys.argv[1], "rb"))
sys.path.insert(0, req["engine"])
os.chdir(req["engine"])
from app import hourly  # noqa: E402  (this worktree's)
from app.planner_rules import recommend  # noqa: E402

out = req["out"]
cache = json.load(open(out)) if os.path.exists(out) else {}


def sim(inp, d):
    e = hourly.simulate(inp, {k: (d.get(k) or None) for k in ("pv_kwp", "battery_kwh", "heatpump_kw", "wallbox_kw", "inverter_kw")}).economics
    return [e["payback_years"], e["autarky_share"], e.get("npv_20y_eur", (e.get("annual") or {}).get("npv_20y_eur")), (d.get("battery_kwh") or 0.0)]


def attempt(f):
    try:
        return f()
    except Exception as ex:  # noqa: BLE001
        return {"error": f"{type(ex).__name__}: {ex}"[:120]}


t0 = time.time()
todo = list(req["items"])
for n, it in enumerate(todo, 1):
    row = cache.setdefault(it["pid"], {})
    if "expert" not in row:
        row["expert"] = attempt(lambda: sim(it["sim_inp"], it["expert"]))
    if it["phys"] and "physics" not in row:
        def p():
            rec = recommend(it["inp"])
            return sim({**it["sim_inp"], **(rec.get("sim_inputs") or {})}, rec["design"])
        row["physics"] = attempt(p)
    if it["cal"] is not None and "calibrated" not in row:
        row["calibrated"] = attempt(lambda: sim(it["sim_inp"], it["cal"]))
    if n % 10 == 0 or n == len(todo):
        el = time.time() - t0
        print(f"  {n}/{len(todo)} simulated, {el:.0f} s, about {el / n * (len(todo) - n):.0f} s left", flush=True)
        json.dump(cache, open(out + ".tmp", "w")); os.replace(out + ".tmp", out)
json.dump(cache, open(out + ".tmp", "w")); os.replace(out + ".tmp", out)
