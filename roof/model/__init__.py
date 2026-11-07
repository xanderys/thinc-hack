"""Address to a 3D model of the real house: LoD2 solids, DOP20 roof texture, sun per plane, module layout.

model(address, kwp) -> {glb_path, planes_json_path, textured, licence, source, ...}
Frames: planes JSON is local metres east, north, up from the target's footprint centroid at its lowest
ground point. The .glb is the same frame in glTF axes (x east, y up, z south).
"""
from __future__ import annotations

import hashlib, json
from pathlib import Path

import mapbox_earcut as earcut
import numpy as np
import trimesh
from trimesh.visual.material import PBRMaterial
from trimesh.visual.texture import TextureVisuals

import roof as R
from . import geometry, layout, sun, texture
from .layout import lay_out  # noqa: F401  (public)

OUT = R.CACHE / "model"
VERSION = 1
WALL = [222, 221, 216, 255]
ROOF_GREY = [150, 146, 140, 255]
GROUND_GREY = [196, 196, 190, 255]
ENU_TO_GLTF = np.array([[1, 0, 0], [0, 0, 1], [0, -1, 0]], float)


def key(address: str) -> str:
    return hashlib.sha1(f"v{VERSION}|{address.strip().lower()}".encode()).hexdigest()[:16]


def _triangulate(rings: list[np.ndarray]) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Vertices (local 3D), faces, unit normal of one planar polygon with holes."""
    ext = rings[0]
    o, u, v, n = layout.frame(ext)
    nw = geometry.newell(ext)
    want = nw / (np.linalg.norm(nw) or 1)          # ring's own orientation (outward for CityGML walls)
    pts = np.vstack(rings)
    uv = np.c_[(pts - o) @ u, (pts - o) @ v]
    ends = np.cumsum([len(r) for r in rings]).astype(np.uint32)
    f = earcut.triangulate_float64(uv, ends).reshape(-1, 3)
    if len(f):
        a, b, c = pts[f[:, 0]], pts[f[:, 1]], pts[f[:, 2]]
        flip = np.einsum("ij,j->i", np.cross(b - a, c - a), want) < 0
        f[flip] = f[flip][:, ::-1]
    return pts, f, want


class _Group:
    def __init__(self):
        self.v, self.f = [], []
        self.count = 0

    def add(self, pts, faces):
        self.v.append(pts)
        self.f.append(faces + self.count)
        self.count += len(pts)

    def mesh(self, uv_bounds=None, image=None, color=None) -> trimesh.Trimesh | None:
        if not self.v:
            return None
        v = np.vstack(self.v)
        f = np.vstack(self.f)
        if image is not None:
            minx, miny, maxx, maxy = uv_bounds
            uv = np.c_[(v[:, 0] - minx) / (maxx - minx), (v[:, 1] - miny) / (maxy - miny)]
            vis = TextureVisuals(uv=uv, material=PBRMaterial(baseColorTexture=image, metallicFactor=0.0,
                                                             roughnessFactor=0.9, doubleSided=True))
        else:
            vis = TextureVisuals(material=PBRMaterial(baseColorFactor=color, metallicFactor=0.0,
                                                      roughnessFactor=0.9, doubleSided=True))
        return trimesh.Trimesh(vertices=v @ ENU_TO_GLTF.T, faces=f, visual=vis, process=False)


def _build(address: str) -> dict:
    hit = R.geocode(address)
    lat, lon = float(hit["lat"]), float(hit["lon"])
    s = geometry.site(lat, lon)
    org = np.array(s["origin"])
    k = key(address)
    img, img_note = texture.ortho(k, s["origin"])
    wb = texture.bounds(s["origin"])
    lb = (wb[0] - org[0], wb[1] - org[1], wb[2] - org[0], wb[3] - org[1])   # local bounds of the image
    inside = lambda pts: (pts[:, 0] >= lb[0]).all() and (pts[:, 0] <= lb[2]).all() and \
        (pts[:, 1] >= lb[1]).all() and (pts[:, 1] <= lb[3]).all()

    walls, ctx_tex, ctx_grey = _Group(), _Group(), _Group()
    target_roofs, planes = [], []
    best = sun.best()
    for b, is_target in [(s["target"], True)] + [(c, False) for c in s["context"]]:
        for kind, rings in b["surfaces"]:
            if kind == "G":
                continue
            rr = [np.array(r, float) - org for r in rings if len(r) >= 3]
            pts, f, _ = _triangulate(rr)
            if not len(f):
                continue
            if kind == "W":
                walls.add(pts, f)
                continue
            area, pitch, az = geometry.plane_info(rr[0])
            if is_target:
                g = _Group(); g.add(pts, f)
                target_roofs.append((g, area))
            else:
                (ctx_tex if img is not None and inside(pts) else ctx_grey).add(pts, f)
            if area < 1.0:
                continue
            y = sun.yield_kwh_per_kwp(pitch, az)
            planes.append({"id": None, "is_target": is_target, "building": b["id"],
                           "polygon": [[round(float(t), 2) for t in p] for p in rr[0]],
                           "pitch": round(pitch, 1), "azimuth": None if az is None else round(az),
                           "area_m2": round(area, 1), "yield_kwh_per_kwp": y,
                           "sun": round(min(1.0, y / best), 3), "max_panels": layout.max_panels(area),
                           "_mesh": len(target_roofs) - 1 if is_target else None})
    # ids: target planes by area, then context
    planes.sort(key=lambda p: (not p["is_target"], -p["area_m2"]))
    for i, p in enumerate(planes):
        p["id"] = f"p{i + 1}" if p["is_target"] else f"c{i + 1}"

    scene = trimesh.Scene()
    named = {p["_mesh"]: p["id"] for p in planes if p["is_target"]}
    for i, (g, _) in enumerate(target_roofs):
        m = g.mesh(lb, img, ROOF_GREY) if img is not None else g.mesh(color=ROOF_GREY)
        scene.add_geometry(m, node_name=f"roof_{named.get(i, f'small{i}')}", geom_name=f"roof_{named.get(i, f'small{i}')}")
    for name, g, textured in (("context_roofs", ctx_tex, True), ("context_roofs_grey", ctx_grey, False)):
        m = g.mesh(lb, img) if textured else g.mesh(color=ROOF_GREY)
        if m is not None:
            scene.add_geometry(m, node_name=name, geom_name=name)
    m = walls.mesh(color=WALL)
    if m is not None:
        scene.add_geometry(m, node_name="walls", geom_name="walls")
    ground = _Group()
    ground.add(np.array([[lb[0], lb[1], -0.03], [lb[2], lb[1], -0.03], [lb[2], lb[3], -0.03], [lb[0], lb[3], -0.03]]),
               np.array([[0, 1, 2], [0, 2, 3]]))
    scene.add_geometry(ground.mesh(lb, img) if img is not None else ground.mesh(color=GROUND_GREY),
                       node_name="ground", geom_name="ground")
    tris = int(sum(len(g.faces) for g in scene.geometry.values()))

    OUT.mkdir(parents=True, exist_ok=True)
    glb = OUT / f"{k}.glb"
    glb.write_bytes(scene.export(file_type="glb"))
    for p in planes:
        p.pop("_mesh")
        if p["is_target"]:
            p["fits_panels"] = len(layout.slots(p))
    meta = {"address": address, "matched": hit.get("display_name"), "lat": lat, "lon": lon,
            "origin_utm32": [round(float(t), 2) for t in org], "frame": "local metres: x east, y north, z up; "
            "glb uses glTF axes x east, y up, z south", "building": s["target"]["id"], "tile": s["tile"],
            "footprint_m2": s["footprint_m2"], "height_m": s["target"]["height"],
            "context_buildings": len(s["context"]), "triangles": tris,
            "textured": img is not None, "texture_note": img_note,
            "ground_m": texture.SIZE_M, "image_px": texture.PX if img is not None else None,
            "image_bounds_local": [round(t, 2) for t in lb],
            "source": "Bayern LoD2 CityGML" + (" + DOP20 orthophoto (WMS by_dop20c)" if img is not None else ""),
            "licence": texture.ATTRIBUTION, "sun_source": sun.source(), "sun_best_kwh_per_kwp": best,
            "planes": planes}
    (OUT / f"{k}.base.json").write_text(json.dumps(meta, ensure_ascii=False))
    return meta


def model(address: str, kwp: float | None = None) -> dict:
    """Builds once per address (cached), lays out kwp of modules (None: every good plane, full).
    Raises roof.NotFound with the source's own words when there is no LoD2 building."""
    k = key(address)
    base = OUT / f"{k}.base.json"
    meta = json.loads(base.read_text()) if base.exists() and (OUT / f"{k}.glb").exists() else None
    if meta is None or not meta["textured"]:   # an untextured build retries the WMS next time
        meta = _build(address)
    meta["layout"] = lay_out(meta["planes"], kwp)
    path = OUT / f"{k}.json"
    path.write_text(json.dumps(meta, ensure_ascii=False))
    return {"glb_path": str(OUT / f"{k}.glb"), "planes_json_path": str(path), "textured": meta["textured"],
            "licence": meta["licence"], "source": meta["source"], "key": k, "model": meta}
