"""Child process for lab.iterate: one planner_rules module from ONE worktree's engine/, 5-fold out-of-fold designs plus the shipped (full fit half) designs and rules_fired.
Request: {"engine", "module", "df", "inputs", "fold", "textbook", "out"}. A module without calibrate() is run as is (no fitting).
Writes {"oof": {pid: design}, "full": {pid: {"design", "fired"}}, "reonic": {pid: design} | None}."""
import json, os, pickle, sys
req = pickle.load(open(sys.argv[1], "rb"))
sys.path.insert(0, req["engine"]); os.chdir(req["engine"])
import importlib  # noqa: E402
m = importlib.import_module("app.planner_rules." + req["module"])
df = req["df"]; df = df.assign(project_id=df.project_id.astype(str))
KEYS = ("pv_kwp", "battery_kwh", "heatpump_kw", "wallbox_kw", "inverter_kw")


def cal(d, oof=False):
    if not hasattr(m, "calibrate"):
        return None
    try:
        return m.calibrate(d, oof=oof)
    except TypeError:
        return m.calibrate(d)


def design(inp, c):
    r = m.recommend(inp, constants=c) if c is not None else m.recommend(inp)
    return r, {x: r["design"].get(x) for x in KEYS}


res = {"oof": {}, "full": {}, "reonic": None}
f = df.project_id.map(req["fold"])
for k in sorted(set(req["fold"].values())):
    c = cal(df[f != k].reset_index(drop=True))
    for pid in df[f == k].project_id:
        res["oof"][pid] = design(req["inputs"][pid], c)[1]
c = cal(df, oof=True)
for pid in df.project_id:
    r, d = design(req["inputs"][pid], c)
    res["full"][pid] = {"design": d, "fired": r.get("rules_fired")}
if req.get("textbook"):  # "module:function" in the same worktree, called with inputs, returns a design dict
    mod, fn = req["textbook"].split(":")
    tb = getattr(importlib.import_module("app.planner_rules." + mod.split(".")[-1]), fn)
    def _tb(inp):
        r = tb(inp) or {}
        return r.get("design", r)
    res["reonic"] = {pid: {x: _tb(req["inputs"][pid]).get(x) for x in KEYS} for pid in df.project_id}
json.dump(res, open(req["out"], "w"), default=str)
