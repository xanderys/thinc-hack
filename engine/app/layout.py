"""One pipeline for every design with an address: size -> lay out exactly round(pv_kwp / 0.45) modules on the real planes by
shaded yield (roof/model lay_out) -> simulate the hourly year on those planes with their shaded yields. Economics, the day,
the night and the 3D panels all read this one layout, so they cannot disagree."""
import hashlib
import json
import logging

from . import hourly, roofs

log = logging.getLogger("engine")
MODULE_KWP = 0.45
FLAT_TILT = 15.0  # flat roofs carry modules on 15 degree south racks (same assumption as planner_rules)
_MEMO: dict = {}


def modules_for(pv_kwp) -> int:
    return int(round((pv_kwp or 0) / MODULE_KWP))


def layout(inp: dict, pv_kwp: float):
    """{"planes": model JSON with chosen_panels for this kWp, "pv_planes": [(tilt, az, share, scale)], "modules": n,
    "kwh_per_year": layout yield} or None without an address or a built model."""
    addr = inp.get("address")
    if not addr or not pv_kwp or not roofs.model_available():
        return None
    year = inp.get("house_built_year")
    key = (addr.strip().lower(), int(year) if year else None, round(float(pv_kwp), 2))
    if key in _MEMO:
        return _MEMO[key]
    try:
        res = roofs._roof().model(addr, kwp=float(pv_kwp), build_year=int(year) if year else None)
    except Exception as e:
        log.warning("layout failed for %s: %s", addr, e)
        return None
    m = res.get("model") if isinstance(res, dict) else None
    if not m:
        try:
            m = json.loads(open(res["planes_json_path"]).read())
        except Exception:
            return None
    rows, total = [], 0
    for p in m.get("planes", []):
        n = len(p.get("chosen_panels") or [])
        if not n or not p.get("is_target"):
            continue
        flat = p.get("azimuth") is None
        tilt, az = (FLAT_TILT, 180.0) if flat else (float(p.get("pitch") or 0), float(p["azimuth"]))
        y = float(p.get("yield_shaded_kwh_per_kwp") or p.get("yield_kwh_per_kwp") or 0)
        base = float(hourly.sim.pv_per_kwp("Munich", tilt, az).sum())  # the simulation's own unshaded yield there
        rows.append((tilt, az, n, y / base if base else 1.0, p.get("id")))
        total += n
    if not total:
        return None
    out = {"planes": m, "modules": total, "kwh_per_year": (m.get("layout") or {}).get("kwh_per_year"),
           "pv_planes": [(t, a, n / total, s) for t, a, n, s, _ in rows],
           "plane_ids": [i for *_, i in rows], "shaded": any(m_.get("yield_shaded_kwh_per_kwp") is not None for m_ in m.get("planes", []))}
    if len(_MEMO) > 256:
        _MEMO.clear()
    _MEMO[key] = out
    return out


def sim_inputs(inp: dict, design: dict) -> dict:
    """The inputs the hourly simulation runs on for this design: the laid-out planes when there is a house model."""
    lo = layout(inp, design.get("pv_kwp"))
    return {**inp, "pv_planes": lo["pv_planes"]} if lo else inp


def run_id(inp: dict, design: dict, pv_planes) -> str:
    clean = {k: v for k, v in inp.items() if not k.startswith("_") and k not in ("roof", "roof_model", "envelope")}
    return hashlib.sha256(json.dumps([clean, design, pv_planes], sort_keys=True, default=str).encode()).hexdigest()[:12]
