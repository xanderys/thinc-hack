"""Child process for lab.cv_rules3: rules-3 and rules-1 calibrated on 4 folds, designed on the 5th, from ONE worktree's engine/.
Request: {"engine", "df", "inputs": {pid: inputs}, "folds": {seed: {pid: fold}}, "out"}. Writes {seed: {rule: {pid: design}}}."""
import json, os, pickle, sys
req = pickle.load(open(sys.argv[1], "rb"))
sys.path.insert(0, req["engine"]); os.chdir(req["engine"])
from app.planner_rules import rules3, calibrated  # noqa: E402
from app.planner_rules.calibrate import calibrate as cal1  # noqa: E402
df = req["df"]; df = df.assign(project_id=df.project_id.astype(str))
KEYS = ("pv_kwp", "battery_kwh", "heatpump_kw", "wallbox_kw", "inverter_kw")
res = {}
for seed, fold in req["folds"].items():
    res[seed] = {"rules3": {}, "rules1": {}}
    f = df.project_id.map(fold)
    for k in sorted(set(fold.values())):
        tr, te = df[f != k].reset_index(drop=True), df[f == k]
        c3, c1 = rules3.calibrate(tr), cal1(tr)
        for pid in te.project_id:
            inp = req["inputs"][pid]
            res[seed]["rules3"][pid] = {x: rules3.recommend(inp, constants=c3)["design"].get(x) for x in KEYS}
            res[seed]["rules1"][pid] = {x: calibrated.recommend(inp, constants=c1)["design"].get(x) for x in KEYS}
    print(f"seed {seed} done", flush=True)
json.dump(res, open(req["out"], "w"))
