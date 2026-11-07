"""Oracle: the engine's batched design, then simulate, validate_physics and optimum in-process, with every simulation's
energy balance checked."""
import os
import pickle
import sys
from concurrent.futures import ProcessPoolExecutor

import numpy as np

_ENG = None
_BAL = None


def strip(h: dict) -> dict:
    return {k: v for k, v in h.items() if not k.startswith("_")}


def input_error(h: dict) -> str | None:
    """The API's own range check (app.main.check_inputs); its words, or None."""
    from app.main import InputError, check_inputs
    try:
        check_inputs(strip(h))
    except InputError as e:
        return str(e)
    return None


def balance(r, design) -> float:
    """Largest residual in kWh over the year: yield = self-consumed + fed in; load = direct + battery + grid;
    battery energy in = out + stored, stored within capacity; no negative flow."""
    from app.hourly.sim import BAT_RTE, BAT_USABLE
    h = r.hourly
    e = BAT_RTE ** 0.5
    res = [abs(h["pv"].sum() - (h["direct"] + h["charge"] + h["feed_in"]).sum()),
           abs(h["load"].sum() - (h["direct"] + h["discharge"] + h["grid_import"]).sum())]
    soc = np.cumsum(h["charge"] * e - h["discharge"] / e)
    cap = h["bat"] * BAT_USABLE
    res.append(max(0.0, -soc.min(initial=0.0), soc.max(initial=0.0) - cap))
    res.append(max(0.0, -min(float(h[k].min()) for k in ("pv", "load", "direct", "charge", "discharge", "grid_import", "feed_in"))))
    return float(max(res))


def _init(path):
    global _ENG, _BAL
    from app import hourly
    _ENG = pickle.loads(open(path, "rb").read())
    sim_mod = sys.modules["app.hourly.sim"]
    opt_mod = sys.modules["app.hourly.optimum"]
    raw = sim_mod.simulate
    _BAL = []

    def checked(inputs, design, location="Munich"):
        r = raw(inputs, design, location)
        _BAL.append((balance(r, design), {k: design.get(k) for k in ("pv_kwp", "inverter_kw", "battery_kwh", "heatpump_kw", "wallbox_kw")}))
        return r

    hourly.simulate = checked  # used by Engine._physics
    opt_mod.simulate = checked  # used by optimum's grid search


def _physics(job):
    from app import rules
    from app.model import base_features
    out = []
    for h, design in job:
        _BAL.clear()
        inp = strip(h)
        r = {"_id": h["_id"]}
        try:
            t = base_features(inp, inp["installer_id"])["t"]
            econ, plaus, opt = _ENG._physics(inp, design, inp["installer_id"], t, True)
            n_rules = len([p for p in rules.plausibility(inp, design, econ) if not p["message"].startswith("DC/AC")])
            r.update(method=econ.get("method"), npv=econ.get("annual", {}).get("npv_20y_eur"),
                     annual={k: econ.get("annual", {}).get(k) for k in ("pv_yield_kwh", "self_consumed_kwh", "fed_in_kwh")},
                     hard=rules.hard_rules(inp, design), phys_warn=[p["message"] for p in plaus[n_rules:] if p["level"] != "ok"],
                     opt_design=opt["design"] if opt else None,
                     opt_npv=opt["economics"]["annual"]["npv_20y_eur"] if opt else None)
        except Exception as e:  # recorded, never hidden
            r["error"] = f"{type(e).__name__}: {e}"
        r["sims"] = len(_BAL)
        r["bal_worst"] = max(_BAL, key=lambda x: x[0]) if _BAL else (0.0, None)
        r["bal_fail"] = sum(1 for b, _ in _BAL if b > 1.0)
        out.append(r)
    return out


def run_physics(homes, designs, engine_path, workers=None, chunk=50) -> dict:
    """{_id: physics result} for every home given; parallel worker processes, one engine copy each."""
    workers = workers or max(1, min(10, (os.cpu_count() or 4) - 2))
    pairs = list(zip(homes, designs))
    jobs = [pairs[i:i + chunk] for i in range(0, len(pairs), chunk)]
    res = {}
    with ProcessPoolExecutor(max_workers=workers, initializer=_init, initargs=(str(engine_path),)) as ex:
        for part in ex.map(_physics, jobs):
            for r in part:
                res[r["_id"]] = r
    return res
