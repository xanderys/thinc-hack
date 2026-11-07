"""Child process for lab.final_test: rules-3 or rules-4 calibrated on the FULL fit half, designing the test items, from ONE worktree's engine/.
Request: {"engine", "module": "rules3"|"rules4", "fit_df", "items": [(pid, inputs)], "out"}."""
import json, os, pickle, sys
req = pickle.load(open(sys.argv[1], "rb"))
sys.path.insert(0, req["engine"]); os.chdir(req["engine"])
import importlib  # noqa: E402
if req.get("fn"):  # uncorrected function of the module, e.g. rules5.textbook
    m = importlib.import_module("app.planner_rules." + req["module"])
    KEYS = ("pv_kwp", "battery_kwh", "heatpump_kw", "wallbox_kw", "inverter_kw")
    out = {pid: {k: (getattr(m, req["fn"])(inp).get("design") or {}).get(k) for k in KEYS} for pid, inp in req["items"]}
    json.dump(out, open(req["out"], "w")); sys.exit(0)
if req["module"] == "calibrated":  # rules-1: calibrate.calibrate then calibrated.recommend
    from app.planner_rules import calibrated as m  # noqa: E402
    from app.planner_rules.calibrate import calibrate as _cal  # noqa: E402
    c = _cal(req["fit_df"])
else:
    m = importlib.import_module("app.planner_rules." + req["module"])
    c = m.calibrate(req["fit_df"])
KEYS = ("pv_kwp", "battery_kwh", "heatpump_kw", "wallbox_kw", "inverter_kw")
out = {pid: {k: m.recommend(inp, constants=c)["design"].get(k) for k in KEYS} for pid, inp in req["items"]}
json.dump(out, open(req["out"], "w"))
