"""Yearly AC kWh per kWp for a roof plane: pvlib on the Munich PVGIS typical year, the engine's own chain."""
from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path

import pandas as pd

import roof as R

REPO = Path(R.__file__).resolve().parent.parent
TMY = [REPO / "engine" / ".cache" / "pvgis" / "48.137_11.575.csv", REPO / "engine" / "app" / "hourly" / "munich_tmy.csv"]
MUNICH = (48.137, 11.575)
INV_EFF = 0.96          # engine/app/hourly/sim.py
FLAT_TILT = 15.0        # modules on a flat roof: 15 degree south-facing racks
CACHE = R.CACHE / "model" / "yield.json"


@lru_cache(maxsize=1)
def _weather() -> tuple[pd.DataFrame, str]:
    for f in TMY:
        if f.exists():
            w = pd.read_csv(f, index_col=0, parse_dates=True)[["ghi", "dni", "dhi", "temp_air", "wind_speed"]]
            w.index = pd.date_range("2025-01-01", periods=len(w), freq="h", tz="UTC")
            return w, f.name
    raise FileNotFoundError("no PVGIS TMY found under engine/.cache/pvgis or engine/app/hourly")


def _run(tilt: float, az: float) -> float:
    from pvlib.location import Location
    from pvlib.modelchain import ModelChain
    from pvlib.pvsystem import PVSystem
    from pvlib.temperature import TEMPERATURE_MODEL_PARAMETERS
    w, _ = _weather()
    system = PVSystem(surface_tilt=tilt, surface_azimuth=az,
                      module_parameters={"pdc0": 1000.0, "gamma_pdc": -0.0035},
                      inverter_parameters={"pdc0": 1e6, "eta_inv_nom": INV_EFF},
                      temperature_model_parameters=TEMPERATURE_MODEL_PARAMETERS["sapm"]["open_rack_glass_polymer"])
    mc = ModelChain(system, Location(*MUNICH, tz="UTC", altitude=520), aoi_model="physical",
                    spectral_model="no_loss", losses_model="pvwatts")
    mc.run_model(w)
    return float(mc.results.dc.clip(lower=0).fillna(0).sum() / 1000.0 * INV_EFF)


_memo: dict | None = None


def yield_kwh_per_kwp(pitch: float, azimuth: float | None) -> float:
    """Pitch rounded to 1 degree, azimuth to 5 degrees; flat roofs get 15 degree south racks."""
    global _memo
    tilt, az = (FLAT_TILT, 180.0) if azimuth is None else (round(pitch), round(azimuth / 5) * 5 % 360)
    key = f"{tilt:g}_{az:g}"
    if _memo is None:
        _memo = json.loads(CACHE.read_text()) if CACHE.exists() else {}
    if key not in _memo:
        _memo[key] = round(_run(float(tilt), float(az)), 1)
        CACHE.parent.mkdir(parents=True, exist_ok=True)
        CACHE.write_text(json.dumps(_memo))
    return _memo[key]


def best() -> float:
    """Best plane in Munich, the 1.0 of the sun scale."""
    return max(yield_kwh_per_kwp(t, 180) for t in (30, 35, 40))


def source() -> str:
    return f"pvlib ModelChain (PVWatts, 14% losses) on PVGIS typical year {_weather()[1]}"
