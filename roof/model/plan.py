"""Dimensioned plan of the LoD2 footprint with typical equipment placement. No rooms: they are not surveyed.

base(site) runs once per address at build time (needs OSM for the road); finish(meta) runs per request.
"""
from __future__ import annotations

import hashlib, json, math

import httpx
import numpy as np
from shapely.geometry import LineString, Point, Polygon
from shapely.geometry.polygon import orient
from shapely.ops import nearest_points

import roof as R
from . import geometry

COMPASS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"]
ROADS = {"residential", "living_street", "service", "unclassified", "tertiary", "secondary", "primary", "road"}
FLOOR_NET = 0.72
HP_CLEAR_M = 3.0
HP_SOURCE = ("3 m keep-clear radius around the outdoor unit (service access and airflow). Noise: TA Lärm "
             "(6. AVwV zum BImSchG, 1998), Nr. 6.1 night immission values at neighbours' windows; the minimum "
             "distance follows the LAI Leitfaden für die Verbesserung des Schutzes gegen Lärm beim Betrieb von "
             "stationären Geräten (23.08.2023), which depends on the unit's sound power, e.g. about 4 m for 55 dB(A) "
             "free-standing in an allgemeines Wohngebiet")


def _compass(az: float) -> str:
    return COMPASS[int((az % 360 + 22.5) // 45) % 8]


def _roads(lat: float, lon: float) -> list[list[tuple[float, float]]]:
    """OSM highway lines near the house in UTM32, cached."""
    d = 0.0012
    bbox = f"{lon - d:.5f},{lat - d / 1.5:.5f},{lon + d:.5f},{lat + d / 1.5:.5f}"
    path = R.CACHE / "model" / "osm" / (hashlib.sha1(bbox.encode()).hexdigest()[:16] + ".json")
    if path.exists():
        return json.loads(path.read_text())
    r = httpx.get(f"https://api.openstreetmap.org/api/0.6/map.json?bbox={bbox}", headers={"User-Agent": R.UA}, timeout=10)
    r.raise_for_status()
    els = r.json()["elements"]
    nodes = {e["id"]: (e["lon"], e["lat"]) for e in els if e["type"] == "node"}
    out = [[R.TO_UTM.transform(*nodes[n]) for n in e["nodes"] if n in nodes] for e in els
           if e["type"] == "way" and e.get("tags", {}).get("highway") in ROADS]
    out = [w for w in out if len(w) >= 2]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(out))
    return out


def base(site: dict, lat: float, lon: float) -> dict:
    org = np.array(site["origin"][:2])
    fp = orient(geometry.footprint(site["target"]).simplify(0.1), 1.0)   # counter-clockwise
    if fp.geom_type != "Polygon":
        fp = max(fp.geoms, key=lambda g: g.area)
    others = [geometry.footprint(o) for o in site["near"] if o["id"] != site["target"]["id"]]
    ring = [(x - org[0], y - org[1]) for x, y in list(fp.exterior.coords)[:-1]]
    party = []
    for i, a in enumerate(ring):
        b = ring[(i + 1) % len(ring)]
        dx, dy = b[0] - a[0], b[1] - a[1]
        L = math.hypot(dx, dy) or 1
        nx, ny = dy / L, -dx / L                       # outward for a counter-clockwise ring
        mid = Point((a[0] + b[0]) / 2 + nx * 0.6 + org[0], (a[1] + b[1]) / 2 + ny * 0.6 + org[1])
        party.append(any(o.contains(mid) for o in others))
    road, road_note = None, None
    try:
        lines = [LineString([(x - org[0], y - org[1]) for x, y in w]) for w in _roads(lat, lon)]
        if lines:
            poly = Polygon(ring)
            best = min(lines, key=lambda l: l.distance(poly))
            p = nearest_points(poly, best)[1]
            road = [round(p.x, 2), round(p.y, 2)]
            road_note = f"nearest OSM road {best.distance(poly):.0f} m away"
    except (httpx.HTTPError, ValueError, KeyError) as e:
        road_note = f"OSM road lookup failed: {e}"
    near = [[[round(x - org[0], 2), round(y - org[1], 2)] for x, y in list(o.exterior.coords)[:-1]]
            for o in others if o.geom_type == "Polygon" and o.distance(fp) < 30]
    return {"outline": [[round(x, 2), round(y, 2)] for x, y in ring], "party": party, "road": road,
            "road_note": road_note, "neighbours": near}


def _edges(ring, party):
    out = []
    for i, a in enumerate(ring):
        b = ring[(i + 1) % len(ring)]
        dx, dy = b[0] - a[0], b[1] - a[1]
        L = math.hypot(dx, dy)
        n = (dy / L, -dx / L) if L else (0.0, 0.0)
        out.append({"from": i, "to": (i + 1) % len(ring), "length_m": round(L, 2),
                    "orientation": _compass(math.degrees(math.atan2(n[0], n[1]))), "party_wall": party[i],
                    "_n": n, "_mid": ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2), "_az": math.degrees(math.atan2(n[0], n[1])) % 360})
    return out


def _score(az: float, target: float) -> float:
    return math.cos(math.radians(az - target))


def finish(meta: dict) -> dict:
    pb, env = meta["plan_base"], meta["envelope_geom"]
    ring = pb["outline"]
    poly = Polygon(ring)
    edges = _edges(ring, pb["party"])
    free = [e for e in edges if not e["party_wall"] and e["length_m"] >= 1.5] or edges
    storeys = max(1, min(3, round((env.get("eaves_m") or env.get("height_m") or 6.0) / 3.0)))

    # road side: the free edge facing the road (nearest OSM highway point), else south
    if pb["road"]:
        rx, ry = pb["road"]
        road_edge = max(free, key=lambda e: (e["_n"][0] * (rx - e["_mid"][0]) + e["_n"][1] * (ry - e["_mid"][1]))
                        / (math.hypot(rx - e["_mid"][0], ry - e["_mid"][1]) or 1) + 0.01 * e["length_m"])
    else:
        road_edge = max(free, key=lambda e: _score(e["_az"], 180) + 0.01 * e["length_m"])
    rest = [e for e in free if e is not road_edge] or free

    def inside(e, d):
        p = (e["_mid"][0] - e["_n"][0] * d, e["_mid"][1] - e["_n"][1] * d)
        if not poly.contains(Point(p)):
            c = poly.representative_point()
            p = (c.x, c.y)
        return [round(p[0], 2), round(p[1], 2)]

    def outside(e, d, along=None):
        m = e["_mid"] if along is None else along
        return [round(m[0] + e["_n"][0] * d, 2), round(m[1] + e["_n"][1] * d, 2)]

    util_edge = max(edges, key=lambda e: max(_score(e["_az"], 0), _score(e["_az"], 90)) + 0.02 * e["length_m"])
    util = inside(util_edge, 1.0)
    hp_edge = max(rest, key=lambda e: max(_score(e["_az"], 0), 0.6 * _score(e["_az"], 90), 0.6 * _score(e["_az"], 270))
                  + 0.01 * e["length_m"])
    hp = outside(hp_edge, 0.6)
    if pb["road"]:
        a, b = ring[road_edge["from"]], ring[road_edge["to"]]
        q = nearest_points(LineString([a, b]), Point(pb["road"]))[0]
        wb = outside(road_edge, 0.4, (q.x, q.y))
    else:
        wb = outside(road_edge, 0.4)
    near = [Polygon(n) for n in pb["neighbours"] if len(n) >= 3]
    hp_gap = min((p.distance(Point(hp)) for p in near), default=None)

    # cable run: utility marker, up the nearest wall, across to the middle of the chosen modules
    mods = [c for p in meta["planes"] if p["is_target"] for r in p.get("chosen_panels", []) for c in r]
    cable = []
    if mods:
        m = np.array(mods)[:, :2].mean(0)
        w = nearest_points(poly.exterior, Point(util))[0]
        cable = [util, [round(w.x, 2), round(w.y, 2)], [round(float(m[0]), 2), round(float(m[1]), 2)]]

    equipment = [
        {"kind": "inverter", "x": util[0] + 0.0, "y": util[1], "label": "Inverter",
         "note": f"utility room or basement, typical placement, inside the {util_edge['orientation']} wall"},
        {"kind": "battery", "x": round(util[0] - 0.8 * util_edge["_n"][1], 2), "y": round(util[1] + 0.8 * util_edge["_n"][0], 2),
         "label": "Battery", "note": "next to the inverter, typical placement"},
        {"kind": "heat_pump_outdoor", "x": hp[0], "y": hp[1], "label": "Heat pump outdoor unit",
         "note": f"on the {hp_edge['orientation']} wall, away from the street side"
                 + (f"; nearest neighbouring building {hp_gap:.1f} m away" if hp_gap is not None else "")},
        {"kind": "wallbox", "x": wb[0], "y": wb[1], "label": "Wallbox",
         "note": f"on the {road_edge['orientation']} wall, the side nearest the road ({pb['road_note'] or 'road not found, south side assumed'})"},
    ]
    for e in edges:
        for k in ("_n", "_mid", "_az"):
            e.pop(k)
    return {"outline": ring, "edges": edges, "floor_area_m2": round(poly.area, 1),
            "net_floor_area_m2": round(poly.area * storeys * FLOOR_NET, 1), "storeys": storeys,
            "north": [0.0, 1.0], "equipment": equipment,
            "clearances": [{"kind": "heat_pump", "x": hp[0], "y": hp[1], "radius_m": HP_CLEAR_M, "source": HP_SOURCE}],
            "cable_run": cable, "neighbours": pb["neighbours"], "rooms": None,
            "note": ("footprint, rooms not surveyed. Local metres, x east, y north (north arrow +y). floor_area_m2 is the "
                     f"gross footprint per storey; net_floor_area_m2 is footprint x {storeys} storeys x {FLOOR_NET}. "
                     "Equipment positions are typical placements to check on site.")}
