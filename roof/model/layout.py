"""Module rectangles on roof planes, best planes first."""
from __future__ import annotations

import math

import numpy as np
from shapely.geometry import Polygon, box

PANEL_W, PANEL_M2 = 450, 2.0
MOD_U, MOD_V = 1.134, 1.762      # portrait module, 2.0 m2
GAP, EDGE = 0.02, 0.30           # between modules; setback from every roof edge
USABLE = 0.70                    # share of a plane modules may cover
MIN_SUN = 0.6                    # planes below this (north faces) are never used
LIFT = 0.08                      # modules sit this far above the roof skin


def frame(ring: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Origin, u (along the ridge), v (up the slope), n (outward) for a planar 3D ring."""
    from .geometry import newell
    n = newell(ring)
    n = n / np.linalg.norm(n)
    if n[2] < 0:
        n = -n
    h = np.cross([0.0, 0.0, 1.0], n)
    if n[2] > 0.996:                       # flat (under 5 degrees): rows follow the longest edge
        e = np.roll(ring, -1, axis=0) - ring
        e[:, 2] = 0
        u = e[np.argmax(np.linalg.norm(e, axis=1))]
        u = u / np.linalg.norm(u)
        v = np.cross(n, u)
    else:
        u = h / np.linalg.norm(h)
        v = np.cross(n, u)
    return ring[0], u, v, n


def max_panels(area_m2: float) -> int:
    return int(area_m2 * USABLE // PANEL_M2)


def slots(plane: dict) -> list[list[list[float]]]:
    """Every module position on a plane, eaves row first, capped at max_panels; corners in local metres."""
    ring = np.array(plane["polygon"], float)
    o, u, v, n = frame(ring)
    uv = Polygon([((p - o) @ u, (p - o) @ v) for p in ring]).buffer(0).buffer(-EDGE)
    if uv.is_empty:
        return []
    minx, miny, maxx, maxy = uv.bounds
    fit = uv.buffer(0.06)   # LoD2 rectangles are a few cm out of square; do not lose a row to that
    out = []
    y = miny
    while y + MOD_V <= maxy + 1e-6:
        x = minx
        while x + MOD_U <= maxx + 1e-6:
            if fit.contains(box(x, y, x + MOD_U, y + MOD_V)):
                c = [o + u * a + v * b + n * LIFT for a, b in
                     ((x, y), (x + MOD_U, y), (x + MOD_U, y + MOD_V), (x, y + MOD_V))]
                out.append([[round(float(t), 2) for t in p] for p in c])
            x += MOD_U + GAP
        y += MOD_V + GAP
    return out[:plane["max_panels"]]


def lay_out(planes: list[dict], kwp: float | None) -> dict:
    """Fill planes in order of yield until kwp is reached (None: every plane at sun >= MIN_SUN, full).
    Sets plane["chosen_panels"]; returns the totals."""
    need = math.inf if kwp is None else math.ceil(kwp * 1000 / PANEL_W - 1e-9)
    placed = 0
    for p in planes:
        p["chosen_panels"] = []
    for p in sorted(planes, key=lambda p: -p["yield_kwh_per_kwp"]):
        if placed >= need or p["sun"] < MIN_SUN or not p["is_target"]:
            continue
        s = slots(p)[: int(min(need - placed, 10 ** 6))]
        p["chosen_panels"] = s
        placed += len(s)
    kwh = sum(len(p["chosen_panels"]) * PANEL_W / 1000 * p["yield_kwh_per_kwp"] for p in planes)
    return {"requested_kwp": kwp, "panels": placed, "kwp": round(placed * PANEL_W / 1000, 2),
            "kwh_per_year": round(kwh), "short_by_panels": 0 if kwp is None else max(0, need - placed)}
