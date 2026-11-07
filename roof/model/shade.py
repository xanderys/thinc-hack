"""True shade per roof plane: rays toward the sun over the Bavarian DOM20 surface model (trees and buildings).

One representative day per month (the 15th), 24 local clock hours. Fallback when DOM20 cannot be read:
LoD2 neighbours only (buildings cast shade, trees do not).
"""
from __future__ import annotations

import math
from functools import lru_cache

import numpy as np
import pandas as pd

import roof as R
from . import layout, sun

DOM_URL = "https://download1.bayernwolke.de/a/dom20/DOM/32{e}_{n}_20_DOM.tif"
WINDOW_M = 150.0        # square around the house
CELL = 0.4              # DOM20 max-pooled 2 x 2
STEP = 0.4              # ray march step, metres
LIFT = 0.3              # sample points sit this far above the roof skin
SKIP = 0.8              # ignore the first metre of each ray (roof skin noise)
DOM_SOURCE = "DOM20 surface model (LDBV, 20 cm, trees and buildings)"
LOD2_SOURCE = "LoD2 neighbours only (buildings cast shade, trees not modelled)"
MONTHS = list(range(1, 13))
COMPASS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"]


def _dom_window(minx, miny, maxx, maxy) -> np.ndarray | None:
    """DOM20 heights over the bounds at CELL metres (max-pooled), north row first; None if unreachable."""
    import rasterio
    from rasterio.windows import from_bounds
    n = int(round((maxx - minx) / 0.2))
    out = np.full((n, n), np.nan, np.float32)
    try:
        for e in range(int(minx // 1000), int((maxx - 1e-6) // 1000) + 1):
            for nn in range(int(miny // 1000), int((maxy - 1e-6) // 1000) + 1):
                bx0, by0 = max(minx, e * 1000), max(miny, nn * 1000)
                bx1, by1 = min(maxx, (e + 1) * 1000), min(maxy, (nn + 1) * 1000)
                with rasterio.Env(GDAL_HTTP_TIMEOUT="30", GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR"):
                    with rasterio.open("/vsicurl/" + DOM_URL.format(e=e, n=nn)) as d:
                        a = d.read(1, window=from_bounds(bx0, by0, bx1, by1, d.transform))
                c0, r0 = int(round((bx0 - minx) / 0.2)), int(round((maxy - by1) / 0.2))
                a = a[: n - r0, : n - c0]
                out[r0:r0 + a.shape[0], c0:c0 + a.shape[1]] = np.where(a < -1000, np.nan, a)
    except Exception:
        return None
    if np.isnan(out).mean() > 0.2:
        return None
    k = int(round(CELL / 0.2))
    m = n // k * k
    pooled = np.nanmax(out[:m, :m].reshape(m // k, k, m // k, k), axis=(1, 3))
    return np.nan_to_num(pooled, nan=float(np.nanmin(pooled)))


def surface(key: str, origin, site: dict) -> tuple[np.ndarray, np.ndarray, str]:
    """(heights relative to origin z, building mask, source), local grid centred on the house, cached."""
    from rasterio.features import rasterize
    from rasterio.transform import from_origin
    from . import geometry
    path = R.CACHE / "model" / "dom" / f"{key}.npz"
    h = WINDOW_M / 2
    minx, miny, maxx, maxy = origin[0] - h, origin[1] - h, origin[0] + h, origin[1] + h
    n = int(round(WINDOW_M / CELL))
    tr = from_origin(minx, maxy, CELL, CELL)
    others = [b for b in site["near"] if b["id"] != site["target"]["id"]]
    tops = [(geometry.footprint(b), max(p[2] for s in b["surfaces"] if s[0] == "R" for p in s[1][0])
             if any(s[0] == "R" for s in b["surfaces"]) else origin[2]) for b in others]
    bmask = rasterize([(fp, 1) for fp, _ in tops if not fp.is_empty], out_shape=(n, n), transform=tr, dtype="uint8")
    if path.exists():
        z = np.load(path)
        return z["h"], bmask, str(z["src"])
    dom = _dom_window(minx, miny, maxx, maxy)
    if dom is not None and dom.shape == (n, n):
        hgt, src = dom - origin[2], DOM_SOURCE
        # the target itself is modelled by its LoD2 planes; drop it so a plane never shades itself on DOM noise
        tmask = rasterize([(geometry.footprint(site["target"]).buffer(0.6), 1)], out_shape=(n, n), transform=tr, dtype="uint8")
        hgt = np.where(tmask == 1, np.nan, hgt)
        hgt = np.nan_to_num(hgt, nan=float(np.nanpercentile(hgt, 2)))
    else:
        hgt = np.zeros((n, n), np.float32)
        for fp, top in sorted(tops, key=lambda t: t[1]):
            if not fp.is_empty:
                m = rasterize([(fp, 1)], out_shape=(n, n), transform=tr, dtype="uint8")
                hgt = np.where(m == 1, np.maximum(hgt, top - origin[2]), hgt)
        src = LOD2_SOURCE
    path.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(path, h=hgt.astype(np.float32), src=src)
    return hgt.astype(np.float32), bmask, src


@lru_cache(maxsize=1)
def _sun_days() -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Unit sun vectors (12, 24, 3) in east, north, up for the 15th of each month at local mid-hour, plus
    elevation and azimuth in degrees."""
    import pvlib
    t = pd.DatetimeIndex([pd.Timestamp(2025, m, 15, hh, 30, tz="Europe/Berlin") for m in MONTHS for hh in range(24)])
    sp = pvlib.solarposition.get_solarposition(t, *sun.MUNICH, altitude=520)
    el = np.radians(sp["apparent_elevation"].to_numpy()).reshape(12, 24)
    az = np.radians(sp["azimuth"].to_numpy()).reshape(12, 24)
    v = np.stack([np.cos(el) * np.sin(az), np.cos(el) * np.cos(az), np.sin(el)], -1)
    return v, np.degrees(el), np.degrees(az)


def _points(plane: dict, step=1.0, cap=48) -> np.ndarray:
    from shapely.geometry import Point, Polygon
    ring = np.array(plane["polygon"], float)
    o, u, v, n = layout.frame(ring)
    poly = Polygon([((p - o) @ u, (p - o) @ v) for p in ring]).buffer(0)
    inner = poly.buffer(-0.3) if not poly.buffer(-0.3).is_empty else poly
    minx, miny, maxx, maxy = inner.bounds
    pts = [(a, b) for a in np.arange(minx + step / 2, maxx, step) for b in np.arange(miny + step / 2, maxy, step)
           if inner.contains(Point(a, b))]
    if not pts:
        c = inner.representative_point()
        pts = [(c.x, c.y)]
    if len(pts) > cap:
        pts = [pts[i] for i in np.linspace(0, len(pts) - 1, cap).astype(int)]
    return np.array([o + u * a + v * b + n * LIFT for a, b in pts])


def plane_shade(plane: dict, hgt: np.ndarray, bmask: np.ndarray) -> tuple[list, np.ndarray]:
    """shade[12][24] fraction of the plane in shadow (None at night), and building share of the hits (12, 24)."""
    vec, el, _ = _sun_days()
    P = _points(plane)
    n = hgt.shape[0]
    half = n * CELL / 2
    zmax = float(hgt.max())
    steps = np.arange(SKIP, WINDOW_M, STEP)
    shade = [[None] * 24 for _ in MONTHS]
    bshare = np.zeros((12, 24))
    day = el > 0.5
    for mi in range(12):
        hrs = np.nonzero(day[mi])[0]
        if not len(hrs):
            continue
        D = vec[mi, hrs]                                              # (H, 3)
        pos = P[:, None, None, :] + D[None, :, None, :] * steps[None, None, :, None]   # (N, H, S, 3)
        col = np.floor((pos[..., 0] + half) / CELL).astype(int)
        row = np.floor((half - pos[..., 1]) / CELL).astype(int)
        inside = (col >= 0) & (col < n) & (row >= 0) & (row < n) & (pos[..., 2] <= zmax)
        colc, rowc = np.clip(col, 0, n - 1), np.clip(row, 0, n - 1)
        hit = inside & (hgt[rowc, colc] > pos[..., 2])
        any_hit = hit.any(-1)                                         # (N, H)
        first = hit.argmax(-1)
        fr = np.take_along_axis(rowc, first[..., None], -1)[..., 0]
        fc = np.take_along_axis(colc, first[..., None], -1)[..., 0]
        is_b = (bmask[fr, fc] == 1) & any_hit
        frac = any_hit.mean(0)
        for j, hh in enumerate(hrs):
            shade[mi][hh] = round(float(frac[j]), 2)
            bshare[mi, hh] = is_b[:, j].sum() / max(1, any_hit[:, j].sum())
    return shade, bshare


@lru_cache(maxsize=1)
def _tmy_sun():
    import pvlib
    w, _ = sun._weather()
    sp = pvlib.solarposition.get_solarposition(w.index + pd.Timedelta(minutes=30), *sun.MUNICH, altitude=520)
    local = w.index.tz_convert("Europe/Berlin")
    return w, sp, local.month.to_numpy() - 1, local.hour.to_numpy()


def loss_share(plane: dict, shade: list) -> float:
    """Share of the plane's yearly plane-of-array irradiance lost to shade (beam blocked, diffuse kept)."""
    import pvlib
    w, sp, mi, hh = _tmy_sun()
    tilt, az = (sun.FLAT_TILT, 180.0) if plane["azimuth"] is None else (plane["pitch"], plane["azimuth"])
    poa = pvlib.irradiance.get_total_irradiance(tilt, az, sp["apparent_zenith"].to_numpy(), sp["azimuth"].to_numpy(),
                                                w["dni"].to_numpy(), w["ghi"].to_numpy(), w["dhi"].to_numpy())
    f = np.array([[0.0 if x is None else x for x in row] for row in shade])[mi, hh]
    beam = np.nan_to_num(np.clip(np.asarray(poa["poa_direct"], float), 0, None))
    diff = np.nan_to_num(np.clip(np.asarray(poa["poa_diffuse"], float), 0, None))
    total = (beam + diff).sum()
    return 0.0 if total <= 0 else float((beam * f).sum() / total)


def reason(shade: list, bshare: np.ndarray) -> str | None:
    """'shaded by trees to the south-west after 15:00 in winter', from the hours that lose most."""
    _, el, az = _sun_days()
    f = np.array([[0.0 if x is None else x for x in row] for row in shade])
    weight = f * np.clip(np.sin(np.radians(el)), 0, None)
    if weight.sum() < 1e-6:
        return None
    w = weight * (el >= 8)                               # dawn and dusk lose little; ignore them
    if w.sum() < 1e-6:
        w = weight
    a = math.degrees(math.atan2((w * np.sin(np.radians(az))).sum(), (w * np.cos(np.radians(az))).sum())) % 360
    side = COMPASS[int((a + 22.5) // 45) % 8]
    what = "buildings" if (bshare * w).sum() / max(w.sum(), 1e-9) > 0.5 else "trees"
    per_m, per_h = w.sum(1), w.sum(0)
    months = set((np.nonzero(per_m >= 0.3 * per_m.max())[0] + 1).tolist())
    season = ("all year" if len(months) >= 10 else
              "in winter" if months <= {10, 11, 12, 1, 2, 3} else
              "in summer" if months <= {4, 5, 6, 7, 8, 9} else
              "in spring and autumn" if months <= {2, 3, 4, 8, 9, 10} else "most of the year")
    hrs = np.nonzero(per_h >= 0.3 * per_h.max())[0]
    if hrs.min() >= 12:
        when = f"after {hrs.min()}:00"
    elif hrs.max() < 12:
        when = f"before {hrs.max() + 1}:00"
    else:
        when = f"from {hrs.min()}:00 to {hrs.max() + 1}:00"
    return f"shaded by {what} to the {side} {when} {season}"


def annotate(meta: dict, site: dict, key: str) -> None:
    """Adds shade, shade_loss_share, yield_shaded_kwh_per_kwp, sun_shaded and shade_reason to target planes."""
    hgt, bmask, src = surface(key, site["origin"], site)
    meta["shade_source"] = src
    best = meta["sun_best_kwh_per_kwp"]
    for p in meta["planes"]:
        if not p["is_target"]:
            continue
        s, bs = plane_shade(p, hgt, bmask)
        loss = loss_share(p, s)
        p["shade"] = {str(m): s[m - 1] for m in MONTHS}
        p["shade_loss_share"] = round(loss, 3)
        p["yield_shaded_kwh_per_kwp"] = round(p["yield_kwh_per_kwp"] * (1 - loss), 1)
        p["sun_shaded"] = round(min(1.0, p["yield_shaded_kwh_per_kwp"] / best), 3)
        p["shade_reason"] = reason(s, bs) if loss >= 0.03 else None
