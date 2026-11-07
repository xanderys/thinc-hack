"""Address to roof: area, segments, panel count.

Sources, best first: Bavarian LoD2 (measured roof planes), Google Solar API
(measured, needs GOOGLE_SOLAR_API_KEY), OpenStreetMap footprint (estimate).
Every external response is cached under .cache/.
"""
from __future__ import annotations

import hashlib, json, math, os, re, threading, time
from dataclasses import asdict, dataclass, field
from pathlib import Path

import httpx
from lxml import etree
from pyproj import Transformer
from shapely.geometry import Point, Polygon, mapping, shape

HERE = Path(__file__).parent
CACHE = HERE / ".cache"
UA = "marquee-roof/0.1 (Reonic hackathon Munich; contact via github.com/xanderys)"
PANEL_M2, PANEL_W = 2.0, 450
FOOTPRINT_USABLE = 0.70   # share of good roof faces usable when only a footprint is known
MEASURED_USABLE = 0.80    # setbacks, chimneys, windows on measured faces
OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.private.coffee/api/interpreter"]
TO_UTM = Transformer.from_crs(4326, 25832, always_xy=True)
TO_WGS = Transformer.from_crs(25832, 4326, always_xy=True)


def _env(name: str) -> str | None:
    if os.environ.get(name):
        return os.environ[name]
    env = HERE / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            k, _, v = line.partition("=")
            if k.strip() == name and v.strip():
                return v.strip().strip('"')
    return None


@dataclass
class Segment:
    azimuth: float | None  # degrees clockwise from north, direction the face looks
    pitch: float           # degrees from horizontal
    area_m2: float


@dataclass
class RoofResult:
    source: str
    lat: float | None = None
    lon: float | None = None
    footprint_m2: float | None = None
    roof_area_m2: float | None = None
    usable_area_m2: float | None = None
    segments: list[Segment] = field(default_factory=list)
    max_panels: int | None = None
    confidence: str = "estimate"   # measured | footprint | estimate
    storeys: int | None = None
    floor_area_m2: float | None = None
    floor_area_confidence: str | None = None   # "estimate" when derived from the footprint and height
    build_year_class: str | None = None        # Zensus 2022 100 m cell, modal class e.g. "1979 to 1990"
    build_year_estimate: int | None = None     # class midpoint
    heating_class: str | None = None           # dominant heating type in the cell
    zensus_confidence: str | None = None       # "estimated from address (Zensus 2022, 100 m cell)"
    notes: list[str] = field(default_factory=list)

    def dict(self) -> dict:
        return asdict(self)


class NotFound(Exception):
    """A source answered but had nothing for this address; message is the source's words."""


# ---------- cached HTTP ----------

_last_nominatim = 0.0
_lock = threading.Lock()


def _cached_json(kind: str, key: str, fetch) -> dict:
    path = CACHE / kind / (hashlib.sha1(key.encode()).hexdigest()[:16] + ".json")
    if path.exists():
        return json.loads(path.read_text())
    data = fetch()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data))
    return data


def geocode(address: str) -> dict:
    def fetch():
        global _last_nominatim
        with _lock:
            wait = 1.0 - (time.time() - _last_nominatim)
            if wait > 0:
                time.sleep(wait)
            r = httpx.get("https://nominatim.openstreetmap.org/search",
                          params={"q": address, "format": "jsonv2", "limit": 1, "countrycodes": "de",
                                  "polygon_geojson": 1},
                          headers={"User-Agent": UA}, timeout=10)
            _last_nominatim = time.time()
        r.raise_for_status()
        return {"results": r.json()}
    hits = _cached_json("nominatim", address.strip().lower(), fetch)["results"]
    if not hits:
        raise NotFound(f"Nominatim: no results for '{address}'")
    h = hits[0]
    pc = re.search(r"\b\d{5}\b", address)
    if pc and pc.group() not in h.get("display_name", ""):
        raise NotFound(f"Nominatim: best match '{h.get('display_name')}' is not in postcode {pc.group()}")
    if h.get("place_rank", 30) < 26:
        raise NotFound(f"Nominatim: only matched '{h.get('display_name')}', not a house")
    return h


def _osm_tags(way_id: int) -> dict:
    def fetch():
        r = httpx.get(f"https://api.openstreetmap.org/api/0.6/way/{way_id}.json",
                      headers={"User-Agent": UA}, timeout=5)
        r.raise_for_status()
        return r.json()["elements"][0].get("tags", {})
    return _cached_json("osmapi", str(way_id), fetch)


# ---------- geometry helpers ----------

def _utm_poly(coords_lonlat) -> Polygon:
    return Polygon([TO_UTM.transform(x, y) for x, y in coords_lonlat])


def _panels(usable: float) -> int:
    return int(usable // PANEL_M2)


def _good(seg: Segment) -> bool:
    """Flat or not north facing (north = 300..60 degrees)."""
    if seg.pitch < 10 or seg.azimuth is None:
        return True
    a = seg.azimuth % 360
    return 60 < a < 300


def _finish(res: RoofResult, share: float) -> RoofResult:
    good = sum(s.area_m2 for s in res.segments if _good(s))
    res.usable_area_m2 = round(good * share, 1)
    res.max_panels = _panels(res.usable_area_m2)
    for s in res.segments:
        s.area_m2 = round(s.area_m2, 1)
        s.pitch = round(s.pitch, 1)
        s.azimuth = None if s.azimuth is None else round(s.azimuth % 360)
    return res


# ---------- 1. OpenStreetMap footprint ----------

PITCH_BY_SHAPE = {"flat": 0, "skillion": 15, "gabled": 35, "hipped": 30, "half-hipped": 35,
                  "pyramidal": 30, "mansard": 45, "gambrel": 40, "saltbox": 35}


def _osm_buildings(lat: float, lon: float) -> list[dict]:
    """Buildings near a point as [{id, tags, coords}]: OSM API map call first, Overpass if it fails."""
    d = 0.0005  # about 55 m by 37 m each way
    bbox = f"{lon - d},{lat - d / 1.5},{lon + d},{lat + d / 1.5}"
    def fetch():
        try:
            r = httpx.get(f"https://api.openstreetmap.org/api/0.6/map.json?bbox={bbox}",
                          headers={"User-Agent": UA}, timeout=5)
            r.raise_for_status()
            els = r.json()["elements"]
            nodes = {e["id"]: (e["lon"], e["lat"]) for e in els if e["type"] == "node"}
            return {"ways": [{"id": e["id"], "tags": e["tags"], "coords": [nodes[n] for n in e["nodes"] if n in nodes]}
                             for e in els if e["type"] == "way" and "building" in e.get("tags", {})]}
        except httpx.HTTPError as api_err:
            q = f"[out:json][timeout:5];way(around:40,{lat},{lon})[building];out tags geom;"
            for url in OVERPASS:
                try:
                    r = httpx.post(url, data={"data": q}, headers={"User-Agent": UA}, timeout=5)
                    if r.status_code == 200:
                        return {"ways": [{"id": e["id"], "tags": e.get("tags", {}),
                                          "coords": [(g["lon"], g["lat"]) for g in e.get("geometry", [])]}
                                         for e in r.json()["elements"]]}
                except httpx.HTTPError:
                    pass
            raise RuntimeError(f"OSM API and Overpass unavailable (OSM API: {api_err})")
    return _cached_json("osmmap", bbox, fetch)["ways"]


def from_osm(lat: float, lon: float, hit: dict | None = None) -> RoofResult:
    pt = Point(TO_UTM.transform(lon, lat))
    best, best_d = None, 1e9
    g = (hit or {}).get("geojson", {})
    if hit and hit.get("osm_type") == "way" and hit.get("category") == "building" and g.get("type") == "Polygon":
        # Nominatim matched the building itself: no Overpass round trip
        best, best_d = (_utm_poly(g["coordinates"][0]), _osm_tags(hit["osm_id"]), hit["osm_id"]), 0
    for w in ([] if best else _osm_buildings(lat, lon)):
        if len(w["coords"]) < 4:
            continue
        poly = _utm_poly(w["coords"])
        d = 0 if poly.contains(pt) else poly.distance(pt)
        if d < best_d:
            best, best_d = (poly, w["tags"], w["id"]), d
    if best is None:
        raise NotFound("OSM: no building mapped near the geocoded point")
    poly, tags, way_id = best
    shape_tag = tags.get("roof:shape")
    pitch = float(tags["roof:angle"]) if tags.get("roof:angle", "").replace(".", "").isdigit() \
        else PITCH_BY_SHAPE.get(shape_tag, 35)
    fp = poly.area
    roof = fp / math.cos(math.radians(pitch))
    res = RoofResult("osm", lat, lon, round(fp, 1), round(roof, 1), confidence="footprint")
    res.notes.append(f"OSM way {way_id}, roof:shape={shape_tag or 'missing'}, pitch {pitch} deg"
                     + ("" if shape_tag else " (gable default)"))
    if best_d > 0:
        res.notes.append(f"point not inside a building; nearest is {best_d:.0f} m away")
    res.segments = [Segment(None, pitch, roof)]
    res = _finish(res, FOOTPRINT_USABLE)
    if pitch > 0:
        # orientation unknown: a north/south ridge loses half the roof, east/west loses none
        res.usable_area_m2 = round(res.usable_area_m2 * 0.75, 1)
        res.max_panels = _panels(res.usable_area_m2)
        res.notes.append("orientation unknown; counted 75% of the roof as good faces")
    return res


# ---------- 2. Google Solar API ----------

def from_google(lat: float, lon: float, hit: dict | None = None) -> RoofResult:
    key = _env("GOOGLE_SOLAR_API_KEY")
    if not key:
        raise NotFound("Google Solar: GOOGLE_SOLAR_API_KEY not set")
    def fetch():
        r = httpx.get("https://solar.googleapis.com/v1/buildingInsights:findClosest",
                      params={"location.latitude": lat, "location.longitude": lon,
                              "requiredQuality": "MEDIUM", "key": key}, timeout=10)
        return {"status": r.status_code, "body": r.json()}
    d = _cached_json("google", f"{lat:.6f},{lon:.6f}", fetch)
    if d["status"] != 200:
        raise NotFound(f"Google Solar: {d['body'].get('error', {}).get('message', d['status'])}")
    sp = d["body"]["solarPotential"]
    segs = [Segment(s.get("azimuthDegrees"), s.get("pitchDegrees", 0), s["stats"]["areaMeters2"])
            for s in sp.get("roofSegmentStats", [])]
    res = RoofResult("google_solar", lat, lon, round(sp.get("buildingStats", {}).get("groundAreaMeters2", 0), 1),
                     round(sp["wholeRoofStats"]["areaMeters2"], 1), segments=segs, confidence="measured")
    res = _finish(res, MEASURED_USABLE)
    # Google's own layout is better than our share rule; rescale its panel area to 2 m2 modules
    res.usable_area_m2 = round(sp.get("maxArrayAreaMeters2", res.usable_area_m2), 1)
    res.max_panels = _panels(res.usable_area_m2)
    res.notes.append(f"imagery {d['body'].get('imageryQuality')} {d['body'].get('imageryDate', {})}; "
                     f"Google max {sp.get('maxArrayPanelsCount')} panels of {sp.get('panelCapacityWatts')} W")
    return res


# ---------- 3. Bavarian LoD2 (open data, CityGML tiles 2 km x 2 km, EPSG:25832) ----------

NS = {"gml": "http://www.opengis.net/gml", "bldg": "http://www.opengis.net/citygml/building/1.0"}
TILE_URL = "https://download1.bayernwolke.de/a/lod2/citygml/{e}_{n}.gml"


def _plane(pts: list[tuple[float, float, float]]) -> tuple[float, float, float]:
    """Area, pitch, azimuth of a 3D ring by Newell's normal."""
    nx = ny = nz = 0.0
    for (x1, y1, z1), (x2, y2, z2) in zip(pts, pts[1:] + pts[:1]):
        nx += (y1 - y2) * (z1 + z2); ny += (z1 - z2) * (x1 + x2); nz += (x1 - x2) * (y1 + y2)
    norm = math.sqrt(nx * nx + ny * ny + nz * nz)
    if norm == 0:
        return 0, 0, 0
    if nz < 0:
        nx, ny, nz = -nx, -ny, -nz
    pitch = math.degrees(math.acos(min(1, nz / norm)))
    return norm / 2, pitch, math.degrees(math.atan2(nx, ny)) % 360


def _rings(el) -> list[list[tuple[float, float, float]]]:
    out = []
    for pl in el.iterfind(".//gml:posList", NS):
        v = [float(t) for t in pl.text.split()]
        pts = list(zip(v[0::3], v[1::3], v[2::3]))
        out.append(pts[:-1] if pts and pts[0] == pts[-1] else pts)
    return out


def _tile_index(e: int, n: int) -> list[dict]:
    idx = CACHE / "lod2" / f"{e}_{n}.v2.json"   # v2 adds height and storeys
    if idx.exists():
        return json.loads(idx.read_text())
    gml = CACHE / "lod2" / f"{e}_{n}.gml"
    gml.parent.mkdir(parents=True, exist_ok=True)
    if not gml.exists():
        with httpx.stream("GET", TILE_URL.format(e=e, n=n), timeout=120) as r:
            if r.status_code != 200:
                raise NotFound(f"Bayern LoD2: tile {e}_{n} HTTP {r.status_code}")
            with open(gml.with_suffix(".part"), "wb") as f:
                for chunk in r.iter_bytes(1 << 20):
                    f.write(chunk)
        gml.with_suffix(".part").rename(gml)
    buildings = []
    for _, b in etree.iterparse(str(gml), tag=f"{{{NS['bldg']}}}Building"):
        roofs = [r for rs in b.iterfind(".//bldg:RoofSurface", NS) for r in _rings(rs)]
        grounds = [g for gs in b.iterfind(".//bldg:GroundSurface", NS) for g in _rings(gs)]
        foot = [Polygon([(x, y) for x, y, _ in g]).buffer(0) for g in grounds if len(g) >= 3]
        if not roofs or not foot:
            b.clear(); continue
        fp = foot[0]
        for f in foot[1:]:
            fp = fp.union(f)
        segs = [_plane(r) for r in roofs if len(r) >= 3]
        def _num(tag):
            t = b.findtext(f"bldg:{tag}", namespaces=NS)
            try:
                return float(t) if t else None
            except ValueError:
                return None
        buildings.append({"id": b.get(f"{{{NS['gml']}}}id"), "footprint": mapping(fp),
                          "height": _num("measuredHeight"), "storeys": _num("storeysAboveGround"),
                          "segments": [[round(a, 2), round(p, 1), round(z)] for a, p, z in segs if a > 0.5]})
        b.clear()
    idx.write_text(json.dumps(buildings))
    gml.unlink()  # the index is all we need; tiles run to 160 MB
    return buildings


FLOOR_NET = 0.8   # walls and stairs
STOREY_M = 3.0


def _floor_area(res: RoofResult, footprint: float, height: float | None, storeys: float | None) -> None:
    """Heated floor area estimate: footprint x storeys x 0.8, storeys 1 to 3 (single-family homes)."""
    if storeys:
        n, how = int(storeys), "storeys in LoD2"
    elif height:
        n, how = round(height / STOREY_M), f"measured height {height:.1f} m / {STOREY_M:g} m"
    else:
        return
    res.storeys = max(1, min(3, n))
    res.floor_area_m2 = round(footprint * res.storeys * FLOOR_NET, 1)
    res.floor_area_confidence = "estimate"
    res.notes.append(f"floor area estimated from address: footprint {footprint:.0f} m2 x {res.storeys} storeys ({how}) x {FLOOR_NET}")


def from_lod2(lat: float, lon: float, hit: dict | None = None) -> RoofResult:
    x, y = TO_UTM.transform(lon, lat)
    if not (47.2 < lat < 50.6 and 8.9 < lon < 13.9):
        raise NotFound("Bayern LoD2: address is outside Bavaria")
    e, n = int(x // 2000) * 2, int(y // 2000) * 2
    pt = Point(x, y)
    best, best_d = None, 1e9
    for b in _tile_index(e, n):
        poly = shape(b["footprint"])
        d = 0 if poly.contains(pt) else poly.distance(pt)
        if d < best_d:
            best, best_d = (b, poly), d
    if best is None or best_d > 25:
        raise NotFound(f"Bayern LoD2: no building within 25 m in tile {e}_{n}")
    b, poly = best
    segs = [Segment(z if p >= 5 else None, p, a) for a, p, z in b["segments"]]
    res = RoofResult("bayern_lod2", lat, lon, round(poly.area, 1),
                     round(sum(s.area_m2 for s in segs), 1), segments=segs, confidence="measured")
    _floor_area(res, poly.area, b.get("height"), b.get("storeys"))
    res.notes.append(f"LoD2 building {b['id']} (tile {e}_{n}), {len(segs)} roof planes")
    if best_d > 0:
        res.notes.append(f"point not inside a building; nearest is {best_d:.0f} m away")
    return _finish(res, MEASURED_USABLE)


# ---------- chain ----------

SOURCES = {"bayern_lod2": from_lod2, "google_solar": from_google, "osm": from_osm}


def _add_zensus(res: RoofResult) -> None:
    import zensus
    z = zensus.lookup(res.lat, res.lon) if res.lat is not None else None
    if z:
        for k, v in z.items():
            setattr(res, k, v)
    else:
        res.notes.append("Zensus 100 m cell: not available (run `python zensus.py build`, or address outside Munich region)")


def lookup(address: str, source: str | None = None) -> RoofResult:
    """Best available source, or one named source. Never raises for a missing roof."""
    try:
        hit = geocode(address)
        lat, lon, name = float(hit["lat"]), float(hit["lon"]), hit.get("display_name", "")
    except (NotFound, httpx.HTTPError) as e:
        return RoofResult("none", notes=[str(e)])
    tried = []
    for key in ([source] if source else SOURCES):
        try:
            res = SOURCES[key](lat, lon, hit)
            res.notes = [name] + tried + res.notes
            _add_zensus(res)
            return res
        except (NotFound, RuntimeError, httpx.HTTPError) as e:
            tried.append(str(e))
    return RoofResult("none", lat, lon, notes=[name] + tried)


if __name__ == "__main__":
    import sys
    print(json.dumps(lookup(" ".join(sys.argv[1:])).dict(), indent=2, ensure_ascii=False))
