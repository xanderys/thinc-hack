"""Child process for lab.cv_rules4: rules-4-readout out-of-fold designs per fold seed, plus the shipped rules4.json designs and rules_fired.
Request: {"engine", "df", "inputs", "folds": {seed: {pid: fold}}, "out"}. Writes {"oof": {seed: {pid: design}}, "full": {pid: {"design", "fired"}}}."""
import json, os, pickle, sys
req = pickle.load(open(sys.argv[1], "rb"))
sys.path.insert(0, req["engine"]); os.chdir(req["engine"])
from app.planner_rules import rules4  # noqa: E402
df = req["df"]; df = df.assign(project_id=df.project_id.astype(str))
KEYS = ("pv_kwp", "battery_kwh", "heatpump_kw", "wallbox_kw", "inverter_kw")
res = {"oof": {}, "full": {}}
for seed, fold in req["folds"].items():
    res["oof"][seed] = {}
    f = df.project_id.map(fold)
    for k in sorted(set(fold.values())):
        tr, te = df[f != k].reset_index(drop=True), df[f == k]
        c = rules4.calibrate(tr)
        for pid in te.project_id:
            d = rules4.recommend(req["inputs"][pid], constants=c)["design"]
            res["oof"][seed][pid] = {x: d.get(x) for x in KEYS}
    print(f"seed {seed} done", flush=True)
for pid in df.project_id:
    r = rules4.recommend(req["inputs"][pid])
    res["full"][pid] = {"design": {x: r["design"].get(x) for x in KEYS}, "fired": r["rules_fired"]}
json.dump(res, open(req["out"], "w"), default=str)
