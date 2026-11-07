"""Envelope heat loss from the LoD2 solid: faces, IWU/TABULA U-values by build year, simplified DIN EN 12831.

geom(site) runs once per address at build time; compute(geom, build_year) is pure arithmetic (well under 50 ms).
"""
from __future__ import annotations

import math
from functools import lru_cache

import numpy as np
from shapely.geometry import Point

from . import geometry, sun

T_IN, T_DESIGN = 20.0, -16.0        # DIN EN 12831 inside; Munich design outdoor temperature
ACH = 0.5                           # air changes per hour
NET_VOLUME = 0.8                    # net air volume over gross LoD2 volume (DIN EN 12831 simplified)
AIR = 0.34                          # Wh/(m3 K), volumetric heat capacity of air
FLOOR_B = 0.5                       # temperature reduction factor for the floor to ground or unheated cellar (TABULA b_tr)
WINDOW_SHARE = 0.20                 # of each wall, assumed (no window data in LoD2)
HEAT_LIMIT = 15.0                   # heating degree hours counted below 15 degrees C
INTERNAL_W_M2 = 3.0                 # internal gains, TABULA standard value
FLOOR_NET = 0.72                    # roof.py: net floor area over footprint x storeys
DEFAULT_YEAR = 1975

IWU = "IWU, Deutsche Wohngebäudetypologie (Loga et al. 2015), Anhang C.1, Einfamilienhaus, Ist-Zustand Variante 1"
# TABULA code, years, U roof, wall, floor, window, door, thermal bridge supplement (W/m2K)
TYPOLOGY = [
    ("EFH_A DE.N.SFH.01.Gen", 0, 1859, 2.60, 2.00, 2.90, 2.80, 3.00, 0.10),
    ("EFH_B DE.N.SFH.02.Gen", 1860, 1918, 1.30, 1.70, 1.20, 2.80, 3.00, 0.10),
    ("EFH_C DE.N.SFH.03.Gen", 1919, 1948, 1.40, 1.70, 1.00, 2.80, 3.00, 0.10),
    ("EFH_D DE.N.SFH.04.Gen", 1949, 1957, 1.40, 1.40, 1.01, 2.80, 3.00, 0.10),
    ("EFH_E DE.N.SFH.05.Gen", 1958, 1968, 0.80, 1.20, 1.60, 2.80, 3.00, 0.10),
    ("EFH_F DE.N.SFH.06.Gen", 1969, 1978, 0.50, 1.00, 1.00, 2.80, 3.00, 0.10),
    ("EFH_G DE.N.SFH.07.Gen", 1979, 1983, 0.50, 0.80, 0.80, 4.30, 3.00, 0.10),
    ("EFH_H DE.N.SFH.08.Gen", 1984, 1994, 0.40, 0.50, 0.60, 3.20, 3.00, 0.10),
    ("EFH_I DE.N.SFH.09.Gen", 1995, 2001, 0.35, 0.30, 0.45, 1.90, 2.00, 0.10),
    ("EFH_J DE.N.SFH.10.Gen", 2002, 2009, 0.25, 0.30, 0.30, 1.40, 2.00, 0.05),
    ("EFH_K DE.N.SFH.11.Gen", 2010, 2015, 0.20, 0.28, 0.35, 1.30, 1.80, 0.05),
    ("EFH_L DE.N.SFH.12.Gen", 2016, 9999, 0.15, 0.17, 0.17, 1.10, 1.30, 0.05),
]
COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]


def geom(site: dict) -> dict:
    """Target faces in m2 (walls by orientation with party walls flagged, roof planes, ground slab) and volume."""
    b, org = site["target"], np.array(site["origin"])
    others = [geometry.footprint(o) for o in site["near"] if o["id"] != b["id"]]
    faces, vol = [], 0.0
    for kind, rings in b["surfaces"]:
        ext = np.array(rings[0], float) - org
        area, tilt, az = geometry.plane_info(ext)
        for h in rings[1:]:
            area -= geometry.plane_info(np.array(h, float) - org)[0]
        if area < 0.2:
            continue
        n = geometry.newell(ext)
        n = n / (np.linalg.norm(n) or 1)
        c = ext.mean(0)
        vol += float(c @ n) * area / 3          # divergence theorem; CityGML rings face outward
        f = {"kind": {"W": "wall", "R": "roof", "G": "floor"}[kind], "area_m2": round(area, 1)}
        if kind == "W":
            wa = math.degrees(math.atan2(n[0], n[1])) % 360
            probe = Point(c[0] + org[0] + n[0] * 0.6, c[1] + org[1] + n[1] * 0.6)
            f |= {"azimuth": round(wa), "party": any(o.contains(probe) for o in others)}
        elif kind == "R":
            f |= {"azimuth": None if az is None else round(az), "tilt": round(tilt, 1)}
        faces.append(f)
    fp = geometry.footprint(b).area
    h = b.get("height")
    if not (0.3 * fp * (h or 1) < abs(vol) < 3 * fp * (h or 99)):
        vol = fp * (h or 6.0) * 0.85            # fall back to footprint x height when the solid is not closed
    eaves = min((p[2] for s in b["surfaces"] if s[0] == "R" for p in s[1][0]), default=org[2] + (h or 6.0)) - org[2]
    return {"faces": faces, "volume_m3": round(abs(vol), 1), "footprint_m2": round(fp, 1), "height_m": h,
            "eaves_m": round(eaves, 1)}


def typology(year: int) -> tuple:
    return next(t for t in TYPOLOGY if t[1] <= year <= t[2])


@lru_cache(maxsize=1)
def degree_hours() -> tuple[float, int, str]:
    """Kh below the heating limit against 20 degrees inside, and heating hours, from the PVGIS typical year."""
    w, name = sun._weather()
    t = w["temp_air"].to_numpy()
    m = t < HEAT_LIMIT
    return float(((T_IN - t) * m).sum()), int(m.sum()), name


def compute(g: dict, build_year: int | None, year_source: str) -> dict:
    if build_year is None:
        build_year, year_source = DEFAULT_YEAR, "default"
    code, y0, y1, u_roof, u_wall, u_floor, u_win, _u_door, d_tb = typology(int(build_year))
    src = f"{IWU}, {code} ({y0 if y0 else '...'} to {y1 if y1 < 9999 else '...'})"
    dt = T_IN - T_DESIGN
    faces, i = [], 0
    by_dir: dict[str, float] = {}
    for f in g["faces"]:
        if f["kind"] == "wall":
            if f["party"]:
                continue                       # shared with a heated neighbour: no loss
            d = COMPASS[int((f["azimuth"] + 22.5) // 45) % 8]
            by_dir[d] = by_dir.get(d, 0.0) + f["area_m2"]
        elif f["kind"] == "roof":
            i += 1
            faces.append({"id": f"roof{i}", "kind": "roof", "azimuth": f["azimuth"], "area_m2": f["area_m2"],
                          "u_value": u_roof, "source": src, "loss_w": round(f["area_m2"] * u_roof * dt)})
    for d, a in sorted(by_dir.items(), key=lambda kv: COMPASS.index(kv[0])):
        az = COMPASS.index(d) * 45
        win = a * WINDOW_SHARE
        faces.append({"id": f"wall_{d}", "kind": "wall", "azimuth": az, "area_m2": round(a - win, 1), "u_value": u_wall,
                      "source": src, "loss_w": round((a - win) * u_wall * dt)})
        faces.append({"id": f"window_{d}", "kind": "window", "azimuth": az, "area_m2": round(win, 1), "u_value": u_win,
                      "source": src + f"; window area assumed {WINDOW_SHARE:.0%} of wall", "loss_w": round(win * u_win * dt)})
    floor = sum(f["area_m2"] for f in g["faces"] if f["kind"] == "floor")
    faces.append({"id": "floor", "kind": "floor", "azimuth": None, "area_m2": round(floor, 1), "u_value": u_floor,
                  "source": src + f"; times {FLOOR_B} for ground or unheated cellar (TABULA b_tr)",
                  "loss_w": round(floor * u_floor * FLOOR_B * dt)})
    area = sum(f["area_m2"] for f in faces)
    tb_w = round(area * d_tb * dt)
    h_tr = sum(f["loss_w"] for f in faces) / dt + area * d_tb
    h_ve = AIR * ACH * NET_VOLUME * g["volume_m3"]
    vent_w = round(h_ve * dt)
    load_w = sum(f["loss_w"] for f in faces) + tb_w + vent_w
    kh, hours, tmy = degree_hours()
    storeys = max(1, min(3, round((g.get("eaves_m") or g["height_m"] or 6.0) / 3.0)))   # full storeys below the eaves
    floor_area = g["footprint_m2"] * storeys * FLOOR_NET
    demand = max(0.0, (h_tr + h_ve) * kh / 1000 - INTERNAL_W_M2 * floor_area * hours / 1000)
    return {
        "faces": faces, "thermal_bridges_w": tb_w, "ventilation_w": vent_w,
        "design_heat_load_kw": round(load_w / 1000, 1), "annual_heat_demand_kwh": round(demand, -2),
        "annual_heat_demand_source": f"(H_T + H_V) x {kh / 1000:,.0f} kKh heating degree hours (outdoor under {HEAT_LIMIT:g} C, "
                                     f"{tmy} PVGIS typical year) minus {INTERNAL_W_M2:g} W/m2 internal gains on "
                                     f"{floor_area:.0f} m2; solar gains not counted",
        "build_year": int(build_year), "build_year_source": year_source, "typology": code,
        "design": {"inside_c": T_IN, "outside_c": T_DESIGN, "air_changes_per_h": ACH, "volume_m3": g["volume_m3"]},
        "sources": [src, "DIN EN 12831-1 simplified method: transmission plus ventilation, design outdoor -16 C (Munich)",
                    "LoD2 solid (Bayerische Vermessungsverwaltung, CC BY 4.0): face areas, volume; party walls excluded"],
    }
