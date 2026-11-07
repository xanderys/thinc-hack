"""Per-module shading: sunshine share of every module slot on the house's real roof, across a representative year.

For each target plane, every slot roof/model can lay a module on (the chosen layout is always a prefix of these slots, so
slot i is chosen_panels[i]) gets 4 sample points, one per module quarter. From each point a ray goes toward the sun at
288 positions (15th of each month, every local clock hour at half past, pvlib at the house's own lat/lon; below the
horizon is skipped) and is marched over the Bavarian DOM20 surface model (trees, neighbours; the window roof/model
already caches) and tested against the house's own LoD2 roof and wall triangles (dormers, other roof planes).

hourly[m][h] = share of the 4 points in sun (null at night or when the sun is behind the module's face).
annual_share = share of the module's plane-of-array irradiance kept (beam blocked by shade, diffuse kept), weighted by
the PVGIS typical year hour by hour; loss kWh a year = plane yield x module kWp x (1 - annual_share).

Lives in app/ rather than engine/roof/: a package called roof under engine/ would shadow roof/roof.py, which
roof/model imports as `roof`.
"""
from __future__ import annotations

import hashlib
import json
import logging
import threading
import time
import warnings
from pathlib import Path

import numpy as np
import pandas as pd

from . import roofs

log = logging.getLogger("engine")
VERSION = 1
CACHE = Path(__file__).resolve().parent.parent / ".cache" / "shading"
SOURCE = "estimated from the Bavarian surface model (DOM20) and LoD2"
MODULE_KWP = 0.45
LIFT = 0.05            # sample points sit this far above the module face
STEP = 0.4             # ray march step over DOM20, metres
SKIP = 0.8             # first metre of each DOM ray ignored (roof skin noise), as roof/model/shade.py
OWN_PLANE_M = 0.15     # LoD2 triangles this close to the module's plane are its own roof, not a blocker
QUARTERS = [(0.25, 0.25), (0.75, 0.25), (0.75, 0.75), (0.25, 0.75)]


def _mods():
    roofs._roof()  # puts roof/ on sys.path
    import roof as R
    import model as M
    from model import geometry, layout, shade
    return R, M, geometry, layout, shade


def key(address: str) -> str:
    return hashlib.sha256(f"v{VERSION}|{address.strip().lower()}".encode()).hexdigest()[:16]


def cache_path(address: str) -> Path:
    return CACHE / f"{key(address)}.json"


# ---------- sun ----------

def _sun(lat: float, lon: float):
    """Unit vectors (12, 24, 3) east, north, up and elevation degrees (12, 24) at the house, 15th of each month, hh:30."""
    import pvlib
    t = pd.DatetimeIndex([pd.Timestamp(2025, m, 15, hh, 30, tz="Europe/Berlin") for m in range(1, 13) for hh in range(24)])
    sp = pvlib.solarposition.get_solarposition(t, lat, lon, altitude=520)
    el = np.radians(sp["apparent_elevation"].to_numpy()).reshape(12, 24)
    az = np.radians(sp["azimuth"].to_numpy()).reshape(12, 24)
    v = np.stack([np.cos(el) * np.sin(az), np.cos(el) * np.cos(az), np.sin(el)], -1)
    return v, np.degrees(el)


def _poa_buckets(lat: float, lon: float, tilt: float, az: float):
    """Beam and diffuse plane-of-array irradiance of the typical year summed into (12, 24) local month and hour buckets."""
    import pvlib
    from model import sun
    w, _ = sun._weather()
    sp = pvlib.solarposition.get_solarposition(w.index + pd.Timedelta(minutes=30), lat, lon, altitude=520)
    local = w.index.tz_convert("Europe/Berlin")
    mi, hh = local.month.to_numpy() - 1, local.hour.to_numpy()
    poa = pvlib.irradiance.get_total_irradiance(tilt, az, sp["apparent_zenith"].to_numpy(), sp["azimuth"].to_numpy(),
                                                w["dni"].to_numpy(), w["ghi"].to_numpy(), w["dhi"].to_numpy())
    beam = np.nan_to_num(np.clip(np.asarray(poa["poa_direct"], float), 0, None))
    diff = np.nan_to_num(np.clip(np.asarray(poa["poa_diffuse"], float), 0, None))
    B, D = np.zeros((12, 24)), np.zeros((12, 24))
    np.add.at(B, (mi, hh), beam)
    np.add.at(D, (mi, hh), diff)
    return B, D


# ---------- blockers ----------

def _own_triangles(site: dict, org: np.ndarray, M) -> np.ndarray:
    """The target's own LoD2 roof and wall triangles, local metres, (T, 3, 3)."""
    tris = []
    for kind, rings in site["target"]["surfaces"]:
        if kind == "G":
            continue
        rr = [np.array(r, float) - org for r in rings if len(r) >= 3]
        if not rr:
            continue
        pts, f, _ = M._triangulate(rr)
        if len(f):
            tris.append(pts[f])
    return np.concatenate(tris) if tris else np.zeros((0, 3, 3))


def _hits_triangles(P: np.ndarray, D: np.ndarray, T: np.ndarray) -> np.ndarray:
    """(N, H) True where the ray from P[n] along D[h] meets any triangle in T (Moller-Trumbore)."""
    N, H = len(P), len(D)
    if not len(T):
        return np.zeros((N, H), bool)
    out = np.zeros((N, H), bool)
    v0, e1, e2 = T[:, 0], T[:, 1] - T[:, 0], T[:, 2] - T[:, 0]
    for h in range(H):
        d = D[h]
        pv = np.cross(d, e2)                          # (T, 3)
        det = np.einsum("tj,tj->t", e1, pv)
        ok = np.abs(det) > 1e-9
        inv = np.where(ok, 1.0 / np.where(ok, det, 1), 0)
        s = P[:, None, :] - v0[None]                  # (N, T, 3)
        u = np.einsum("ntj,tj->nt", s, pv) * inv
        q = np.cross(s, e1[None])                     # (N, T, 3)
        v = np.einsum("j,ntj->nt", d, q) * inv
        t = np.einsum("tj,ntj->nt", e2, q) * inv
        out[:, h] = (ok & (u >= 0) & (v >= 0) & (u + v <= 1) & (t > 0.05)).any(-1)
    return out


def _hits_dom(P: np.ndarray, D: np.ndarray, hgt: np.ndarray, cell: float, window: float) -> np.ndarray:
    """(N, H) True where the ray from P[n] along D[h] passes under the DOM20 surface within the window."""
    n = hgt.shape[0]
    half = n * cell / 2
    zmax = float(hgt.max())
    steps = np.arange(SKIP, window, STEP)
    pos = P[:, None, None, :] + D[None, :, None, :] * steps[None, None, :, None]
    col = np.floor((pos[..., 0] + half) / cell).astype(np.int32)
    row = np.floor((half - pos[..., 1]) / cell).astype(np.int32)
    inside = (col >= 0) & (col < n) & (row >= 0) & (row < n) & (pos[..., 2] <= zmax)
    hit = inside & (hgt[np.clip(row, 0, n - 1), np.clip(col, 0, n - 1)] > pos[..., 2])
    return hit.any(-1)


# ---------- compute ----------

def _edges(ring: list) -> list:
    r = np.array(ring, float)
    return [round(float(x), 2) for x in np.linalg.norm(np.roll(r, -1, axis=0) - r, axis=1)]


def compute(address: str, build_year=None) -> dict:
    """Every slot on every target plane, cached on disk. Raises with the source's words when there is no model."""
    R, M, geometry, layout, shade = _mods()
    roofs.model_info(address, build_year)                     # builds the house model once, as /api/roof/model does
    k = M.key(address)
    meta = json.loads((R.CACHE / "model" / f"{k}.base.json").read_text())
    lat, lon = float(meta["lat"]), float(meta["lon"])
    site = geometry.site(lat, lon)
    org = np.array(site["origin"], float)
    hgt, _bmask, src = shade.surface(k, site["origin"], site)
    tris = _own_triangles(site, org, M)
    vec, el = _sun(lat, lon)
    planes = []
    for p in meta["planes"]:
        if not p["is_target"]:
            continue
        ring = np.array(p["polygon"], float)
        _, _, _, nrm = layout.frame(ring)
        slots = layout.slots(p)
        tilt, az = (15.0, 180.0) if p["azimuth"] is None else (float(p["pitch"]), float(p["azimuth"]))
        B, Dif = _poa_buckets(lat, lon, tilt, az)
        mods = []
        if slots:
            C = np.array(slots, float)                         # (S, 4, 3)
            P = np.array([[c[0] + (c[1] - c[0]) * a + (c[3] - c[0]) * b + nrm * LIFT for a, b in QUARTERS] for c in C])
            P = P.reshape(-1, 3)                               # (S*4, 3)
            # blockers: everything of the house that is not this plane
            dist = np.abs((tris - ring[0]) @ nrm).max(-1) if len(tris) else np.zeros(0)
            T = tris[dist > OWN_PLANE_M] if len(tris) else tris
            lit = np.full((len(P), 12, 24), np.nan)
            for mi in range(12):
                hrs = np.nonzero((el[mi] > 0.5) & (vec[mi] @ nrm > 0.02))[0]
                if not len(hrs):
                    continue
                Dm = vec[mi, hrs]
                blocked = _hits_dom(P, Dm, hgt, shade.CELL, shade.WINDOW_M) | _hits_triangles(P, Dm, T)
                lit[:, mi, hrs] = ~blocked
            per = lit.reshape(len(C), 4, 12, 24)
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", RuntimeWarning)   # all-NaN hours are night
                share = np.nanmean(per, axis=1)                   # (S, 12, 24)
            total = B + Dif
            for i in range(len(C)):
                s = share[i]
                f = np.where(np.isnan(s), 1.0, s)              # no beam at night or behind the face anyway
                kept_m = (Dif + B * f).sum(1)
                tot_m = total.sum(1)
                monthly = np.where(tot_m > 0, kept_m / np.where(tot_m > 0, tot_m, 1), 1.0)
                annual = float(kept_m.sum() / total.sum()) if total.sum() > 0 else 1.0
                mods.append({"index": i, "annual_share": round(annual, 3),
                             "monthly_share": [round(float(x), 3) for x in monthly],
                             "hourly": [[None if np.isnan(x) else round(float(x), 2) for x in row] for row in s]})
        planes.append({"id": p["id"], "edges_m": _edges(p["polygon"]), "yield_kwh_per_kwp": p["yield_kwh_per_kwp"],
                       "slots": len(slots), "modules": mods})
    out = {"version": VERSION, "address": address, "lat": lat, "lon": lon, "surface": src, "planes": planes,
           "source": SOURCE}
    CACHE.mkdir(parents=True, exist_ok=True)
    cache_path(address).write_text(json.dumps(out, ensure_ascii=False))
    return out


def chosen_counts(address: str, kwp) -> dict:
    """Modules per plane in the layout for this kWp (the same lay_out /api/roof/model and the design use)."""
    R, M, *_ = _mods()
    meta = json.loads((R.CACHE / "model" / f"{M.key(address)}.base.json").read_text())
    from model.layout import lay_out
    planes = json.loads(json.dumps(meta["planes"]))
    lay_out(planes, float(kwp) if kwp else None)
    return {p["id"]: len(p.get("chosen_panels") or []) for p in planes if p["is_target"]}


def result(cached: dict, counts: dict) -> dict:
    """The route's ready body: modules of the chosen layout only, totals per plane and overall."""
    modules, planes = [], []
    lost = kept_kwh = 0.0
    for p in cached["planes"]:
        n = min(counts.get(p["id"], 0), len(p["modules"]))
        y = float(p["yield_kwh_per_kwp"] or 0)
        pl = 0.0
        for m in p["modules"][:n]:
            loss = y * MODULE_KWP * (1 - m["annual_share"])
            pl += loss
            modules.append({"plane_id": p["id"], "index": m["index"], "annual_share": m["annual_share"],
                            "monthly_share": m["monthly_share"], "hourly": m["hourly"], "loss_kwh_year": round(loss, 1)})
        full = y * MODULE_KWP * n
        planes.append({"id": p["id"], "edges_m": p["edges_m"], "modules": n,
                       "shade_share": round(pl / full, 3) if full else 0.0, "loss_kwh_year": round(pl)})
        lost += pl
        kept_kwh += full
    return {"status": "ready", "address": cached["address"], "modules": modules, "planes": planes,
            "total": {"shade_share": round(lost / kept_kwh, 3) if kept_kwh else 0.0, "loss_kwh_year": round(lost),
                      "modules": len(modules)},
            "source": cached["source"]}


# ---------- background ----------

_running: dict = {}
_failed: dict = {}
_lock = threading.Lock()


def cached(address: str):
    p = cache_path(address)
    if not p.exists():
        return None
    try:
        d = json.loads(p.read_text())
        return d if d.get("version") == VERSION else None
    except Exception:
        return None


def start(address: str, build_year=None) -> None:
    k = key(address)
    with _lock:
        t = _running.get(k)
        if t is not None and t.is_alive():
            return
        f = _failed.get(k)
        if f and time.time() - f[1] < 300:   # a miss is retried after five minutes, not on every poll
            return
        _failed.pop(k, None)

        def run():
            try:
                compute(address, build_year)
            except Exception as e:
                log.warning("shading failed for %s: %s", address, e)
                _failed[k] = (str(e) or e.__class__.__name__, time.time())
        t = threading.Thread(target=run, daemon=True)
        _running[k] = t
        t.start()


def failure(address: str):
    f = _failed.get(key(address))
    return f[0] if f else None


def running(address: str) -> bool:
    t = _running.get(key(address))
    return t is not None and t.is_alive()
