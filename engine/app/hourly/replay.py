"""2025 replay data: real Munich weather and German day-ahead prices for calendar 2025, hourly UTC.

Load order: engine/.cache/replay2025/munich_2025.csv, then the bundled app/hourly/munich_2025.csv. Never a network
call during a request; `uv run python -m app.hourly.replay --fetch` downloads both sources once and rewrites cache and bundle.

Sources (both CC BY 4.0):
- Prices: Energy-Charts API (Fraunhofer ISE), bzn=DE-LU, data from Bundesnetzagentur | SMARD.de. Hourly until
  30 Sep 2025, 15-minute from 1 Oct 2025 (day-ahead market moved to quarter-hours); quarter-hours averaged per hour,
  and the share of each hour's intervals with a negative price kept as neg_share.
- Weather: Open-Meteo historical weather API, ECMWF IFS analysis (9 km; the API's best match for 2025), Munich 48.137 N 11.575 E. Radiation is the mean of
  the preceding hour, so the value stamped T+1 is the sim's hour T (solar position taken at T+30 min in sim.py).
"""
from __future__ import annotations

import json
import sys
import urllib.request
from functools import lru_cache
from pathlib import Path

import numpy as np
import pandas as pd

HERE = Path(__file__).parent
CACHE = HERE.parent.parent / ".cache" / "replay2025"
BUNDLED = HERE / "munich_2025.csv"
LAT, LON = 48.137, 11.575
PRICE_URL = "https://api.energy-charts.info/price?bzn=DE-LU&start=2025-01-01T00:00Z&end=2026-01-01T00:00Z"
WEATHER_URL = ("https://archive-api.open-meteo.com/v1/archive?latitude={lat}&longitude={lon}&start_date=2025-01-01"
               "&end_date=2026-01-01&hourly=shortwave_radiation,direct_normal_irradiance,diffuse_radiation,temperature_2m,"
               "wind_speed_10m&timezone=UTC&wind_speed_unit=ms&models=ecmwf_ifs").format(lat=LAT, lon=LON)
COLS = ["ghi", "dni", "dhi", "temp_air", "wind_speed", "price_eur_mwh", "neg_share"]


def _get(url, raw):
    req = urllib.request.Request(url, headers={"User-Agent": "reonic-planner-engine"})
    body = urllib.request.urlopen(req, timeout=60).read()
    raw.write_bytes(body)
    return json.loads(body)


def build(price: dict, weather: dict) -> pd.DataFrame:
    hours = pd.date_range("2025-01-01", periods=8760, freq="h", tz="UTC")
    p = pd.Series(price["price"], index=pd.to_datetime(price["unix_seconds"], unit="s", utc=True), dtype=float)
    p = p[(p.index >= hours[0]) & (p.index <= hours[-1])].dropna()
    g = p.groupby(p.index.floor("h"))
    df = pd.DataFrame({"price_eur_mwh": g.mean(), "neg_share": g.apply(lambda s: float((s < 0).mean()))}).reindex(hours)
    if df.isna().any().any():
        raise ValueError(f"price series has {int(df['price_eur_mwh'].isna().sum())} missing hours")
    h = weather["hourly"]
    w = pd.DataFrame({"ghi": h["shortwave_radiation"], "dni": h["direct_normal_irradiance"], "dhi": h["diffuse_radiation"],
                      "temp_air": h["temperature_2m"], "wind_speed": h["wind_speed_10m"]},
                     index=pd.to_datetime(h["time"]).tz_localize("UTC"), dtype=float)
    w[["ghi", "dni", "dhi"]] = w[["ghi", "dni", "dhi"]].shift(-1)  # preceding-hour means: stamp T+1 covers hour T
    w = w.reindex(hours)
    if w.isna().any().any():
        raise ValueError(f"weather series has {int(w.isna().any(axis=1).sum())} missing hours")
    out = pd.concat([w, df], axis=1)[COLS]
    out.index.name = "time_utc"
    return out.round({"ghi": 1, "dni": 1, "dhi": 1, "temp_air": 1, "wind_speed": 1, "price_eur_mwh": 2, "neg_share": 2})


def fetch():
    CACHE.mkdir(parents=True, exist_ok=True)
    price = _get(PRICE_URL, CACHE / "energy_charts_price_DE-LU_2025.json")
    weather = _get(WEATHER_URL, CACHE / "open_meteo_munich_2025.json")
    df = build(price, weather)
    df.to_csv(CACHE / "munich_2025.csv")
    df.to_csv(BUNDLED)
    return df


@lru_cache(maxsize=1)
def load() -> pd.DataFrame:
    """8,760 rows, UTC 2025. attrs['source'] says which file was read."""
    for f, src in ((CACHE / "munich_2025.csv", "cache"), (BUNDLED, "bundled")):
        if f.exists():
            df = pd.read_csv(f, index_col=0, parse_dates=True)
            if len(df) != 8760 or df[COLS].isna().any().any():
                continue
            df.attrs["source"] = src
            return df
    raise FileNotFoundError("no 2025 replay data (cache and bundled file missing)")


def summary(df: pd.DataFrame | None = None) -> dict:
    df = load() if df is None else df
    p = df["price_eur_mwh"]
    return {"negative_hours": int((p < 0).sum()), "hours_with_negative_interval": int((df["neg_share"] > 0).sum()),
            "negative_interval_hours": round(float(df["neg_share"].sum()), 1), "mean_price_eur_mwh": round(float(p.mean()), 1),
            "ghi_kwh_m2": round(float(df["ghi"].sum()) / 1000), "mean_temp_c": round(float(df["temp_air"].mean()), 1)}


if __name__ == "__main__":
    if "--fetch" in sys.argv:
        fetch()
        load.cache_clear()
    print(summary(), load().attrs["source"])
