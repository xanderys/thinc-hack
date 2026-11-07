"""Full LoD2 building geometry per tile, and the target plus its neighbours in a local metre frame."""
from __future__ import annotations

import gzip, json, math

import httpx
import numpy as np
from lxml import etree
from shapely.geometry import Point, Polygon

import roof as R

TILES = R.CACHE / "model" / "tiles"
KIND = {"RoofSurface": "R", "WallSurface": "W", "GroundSurface": "G"}
CONTEXT_M = 30.0
NEAR_M = 80.0


def _ring(lr) -> list[list[float]]:
    v = [float(t) for t in lr.findtext("gml:posList", namespaces=R.NS).split()]
    pts = [[round(x, 2), round(y, 2), round(z, 2)] for x, y, z in zip(v[0::3], v[1::3], v[2::3])]
    return pts[:-1] if len(pts) > 1 and pts[0] == pts[-1] else pts


def tile(e: int, n: int) -> list[dict]:
    """Every building in a 2 km tile with all its surfaces (exterior and interior rings), cached gzipped."""
    idx = TILES / f"{e}_{n}.geom.json.gz"
    if idx.exists():
        return json.loads(gzip.decompress(idx.read_bytes()))
    TILES.mkdir(parents=True, exist_ok=True)
    gml = TILES / f"{e}_{n}.gml"
    if not gml.exists():
        with httpx.stream("GET", R.TILE_URL.format(e=e, n=n), timeout=180) as r:
            if r.status_code != 200:
                raise R.NotFound(f"Bayern LoD2: tile {e}_{n} HTTP {r.status_code}")
            with open(gml.with_suffix(".part"), "wb") as f:
                for chunk in r.iter_bytes(1 << 20):
                    f.write(chunk)
        gml.with_suffix(".part").rename(gml)
    out = []
    bns = R.NS["bldg"]
    for _, b in etree.iterparse(str(gml), tag=f"{{{bns}}}Building"):
        surfaces = []
        for el in b.iter(*(f"{{{bns}}}{k}" for k in KIND)):
            kind = KIND[etree.QName(el).localname]
            for poly in el.iterfind(".//gml:Polygon", R.NS):
                ext = poly.find("gml:exterior/gml:LinearRing", R.NS)
                if ext is None:
                    continue
                rings = [_ring(ext)] + [_ring(i) for i in poly.iterfind("gml:interior/gml:LinearRing", R.NS)]
                if len(rings[0]) >= 3:
                    surfaces.append([kind, rings])
        grounds = [s[1][0] for s in surfaces if s[0] == "G"]
        if surfaces and grounds:
            xs = [p[0] for g in grounds for p in g]
            ys = [p[1] for g in grounds for p in g]
            h = b.findtext("bldg:measuredHeight", namespaces=R.NS)
            out.append({"id": b.get(f"{{{R.NS['gml']}}}id"), "bbox": [min(xs), min(ys), max(xs), max(ys)],
                        "height": float(h) if h else None, "surfaces": surfaces})
        b.clear()
    idx.write_bytes(gzip.compress(json.dumps(out, separators=(",", ":")).encode(), 6))
    gml.unlink()  # tiles run to 160 MB; the gzipped index is all we need
    return out


def footprint(b: dict) -> Polygon:
    polys = [Polygon([(p[0], p[1]) for p in s[1][0]]).buffer(0) for s in b["surfaces"] if s[0] == "G"]
    fp = polys[0]
    for p in polys[1:]:
        fp = fp.union(p)
    return fp


def _near(bs: list[dict], x: float, y: float) -> list[dict]:
    return [b for b in bs if b["bbox"][0] - NEAR_M < x < b["bbox"][2] + NEAR_M
            and b["bbox"][1] - NEAR_M < y < b["bbox"][3] + NEAR_M]


def site(lat: float, lon: float) -> dict:
    """Target building (same choice as roof.from_lod2) and neighbours within CONTEXT_M, in UTM32."""
    if not (47.2 < lat < 50.6 and 8.9 < lon < 13.9):
        raise R.NotFound("Bayern LoD2: address is outside Bavaria")
    x, y = R.TO_UTM.transform(lon, lat)
    e, n = int(x // 2000) * 2, int(y // 2000) * 2
    near = _near(tile(e, n), x, y)
    for de, dn in ((-2, 0), (2, 0), (0, -2), (0, 2)):  # neighbours across a tile edge
        edge = {(-2, 0): x - e * 1000, (2, 0): (e + 2) * 1000 - x,
                (0, -2): y - n * 1000, (0, 2): (n + 2) * 1000 - y}[(de, dn)]
        if edge < NEAR_M:
            try:
                near += _near(tile(e + de, n + dn), x, y)
            except (R.NotFound, httpx.HTTPError):
                pass
    pt = Point(x, y)
    best, best_d = None, 1e9
    for b in near:
        fp = footprint(b)
        d = 0 if fp.contains(pt) else fp.distance(pt)
        if d < best_d:
            best, best_d = (b, fp), d
    if best is None or best_d > 25:
        raise R.NotFound(f"Bayern LoD2: no building within 25 m in tile {e}_{n}")
    target, tfp = best
    ctx = [b for b in near if b is not target and footprint(b).distance(tfp) <= CONTEXT_M]
    c = tfp.centroid
    z0 = min(p[2] for s in target["surfaces"] if s[0] == "G" for p in s[1][0])
    return {"target": target, "context": ctx, "origin": [c.x, c.y, z0], "tile": f"{e}_{n}",
            "distance_m": round(best_d, 1), "footprint_m2": round(tfp.area, 1)}


# ---------- planes ----------

def newell(pts: np.ndarray) -> np.ndarray:
    nxt = np.roll(pts, -1, axis=0)
    return np.array([np.sum((pts[:, 1] - nxt[:, 1]) * (pts[:, 2] + nxt[:, 2])),
                     np.sum((pts[:, 2] - nxt[:, 2]) * (pts[:, 0] + nxt[:, 0])),
                     np.sum((pts[:, 0] - nxt[:, 0]) * (pts[:, 1] + nxt[:, 1]))])


def plane_info(ext: np.ndarray) -> tuple[float, float, float | None]:
    """Area m2, pitch deg, azimuth deg clockwise from north (None when flat) of a 3D ring."""
    n = newell(ext)
    norm = float(np.linalg.norm(n))
    if norm == 0:
        return 0.0, 0.0, None
    if n[2] < 0:
        n = -n
    pitch = math.degrees(math.acos(min(1.0, n[2] / norm)))
    az = math.degrees(math.atan2(n[0], n[1])) % 360
    return norm / 2, pitch, (None if pitch < 5 else az)
