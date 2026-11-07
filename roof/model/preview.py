"""PNG preview of a model: a small numpy z-buffer rasteriser (no OpenGL needed), modules drawn on top."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import trimesh
from PIL import Image

W, H = 1280, 800
SUN = np.array([-0.35, 0.8, 0.5])            # glTF axes: from the south west, high
PANEL = np.array([28, 36, 52], float)
ENU_TO_GLTF = np.array([[1, 0, 0], [0, 0, 1], [0, -1, 0]], float)


def _camera(target, eye, fov=38.0):
    f = target - eye; f /= np.linalg.norm(f)
    r = np.cross(f, [0, 1, 0]); r /= np.linalg.norm(r)
    u = np.cross(r, f)
    fl = (H / 2) / np.tan(np.radians(fov / 2))
    def proj(p):
        d = p - eye
        x, y, z = d @ r, d @ u, d @ f
        return np.c_[W / 2 + fl * x / z, H / 2 - fl * y / z, z]
    return proj


def _raster(img, zbuf, tri2, shade_fn):
    """tri2: (3,3) screen x, y, depth. shade_fn(bary (k,3)) -> (k,3) colours."""
    xs, ys = tri2[:, 0], tri2[:, 1]
    x0, x1 = max(int(xs.min()), 0), min(int(xs.max()) + 1, W)
    y0, y1 = max(int(ys.min()), 0), min(int(ys.max()) + 1, H)
    if x0 >= x1 or y0 >= y1 or (tri2[:, 2] <= 0.1).any():
        return
    px, py = np.meshgrid(np.arange(x0, x1) + 0.5, np.arange(y0, y1) + 0.5)
    (ax, ay), (bx, by), (cx, cy) = tri2[:, :2]
    den = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
    if abs(den) < 1e-9:
        return
    l0 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / den
    l1 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / den
    l2 = 1 - l0 - l1
    m = (l0 >= -1e-6) & (l1 >= -1e-6) & (l2 >= -1e-6)
    if not m.any():
        return
    # perspective-correct barycentrics
    iz = np.array([1 / tri2[0, 2], 1 / tri2[1, 2], 1 / tri2[2, 2]])
    b = np.stack([l0[m], l1[m], l2[m]], 1) * iz
    zz = 1 / b.sum(1)
    b = b * zz[:, None]
    yy, xx = np.nonzero(m)
    yy += y0; xx += x0
    closer = zz < zbuf[yy, xx]
    if not closer.any():
        return
    yy, xx, b, zz = yy[closer], xx[closer], b[closer], zz[closer]
    zbuf[yy, xx] = zz
    img[yy, xx] = shade_fn(b)


def render(glb_path: str, planes_json: str | None, out_png: str) -> str:
    scene = trimesh.load(glb_path, force="scene")
    meta = json.loads(Path(planes_json).read_text()) if planes_json else None
    img = np.zeros((H, W, 3), float); img[:] = [236, 236, 232]
    zbuf = np.full((H, W), np.inf)
    pts = np.vstack([g.vertices for n, g in scene.geometry.items() if n != "ground"])
    centre = (pts.min(0) + pts.max(0)) / 2
    span = np.linalg.norm(pts.max(0) - pts.min(0))
    radius = max(22.0, min(span * 0.45, 40.0))
    eye = centre + np.array([-0.5, 0.95, 0.62]) * radius    # south west of the house, looking down
    proj = _camera(centre + np.array([0, -2, 0]), eye)
    sun = SUN / np.linalg.norm(SUN)
    for name, g in scene.geometry.items():
        v, f = g.vertices, g.faces
        s = proj(v)
        vis = g.visual
        tex = getattr(getattr(vis, "material", None), "baseColorTexture", None)
        uv = getattr(vis, "uv", None)
        base = getattr(getattr(vis, "material", None), "baseColorFactor", None)
        base = np.array(base[:3] if base is not None else [200, 200, 200], float)
        if tex is not None and uv is not None:
            t = np.asarray(tex.convert("RGB"), float); th, tw = t.shape[:2]
        fn = np.cross(v[f[:, 1]] - v[f[:, 0]], v[f[:, 2]] - v[f[:, 0]])
        fn /= np.linalg.norm(fn, axis=1, keepdims=True) + 1e-12
        for i, tri in enumerate(f):
            lam = 0.55 + 0.45 * abs(float(fn[i] @ sun)) if name != "ground" else 1.0
            if tex is not None and uv is not None:
                tuv = uv[tri]
                def shade(b, tuv=tuv, lam=lam):
                    q = b @ tuv
                    x = np.clip((q[:, 0] * (tw - 1)).astype(int), 0, tw - 1)
                    y = np.clip(((1 - q[:, 1]) * (th - 1)).astype(int), 0, th - 1)
                    return t[y, x] * lam
            else:
                c = base * lam
                shade = lambda b, c=c: np.broadcast_to(c, (len(b), 3))
            _raster(img, zbuf, s[tri], shade)
    if meta:
        for p in meta["planes"]:
            n = np.array(p["polygon"][:3], float)
            for rect in p.get("chosen_panels", []):
                q = np.array(rect, float) @ ENU_TO_GLTF.T
                sq = proj(q)
                c = PANEL * 1.0
                for tri in ((0, 1, 2), (0, 2, 3)):
                    _raster(img, zbuf, sq[list(tri)] - [0, 0, 0.05], lambda b, c=c: np.broadcast_to(c, (len(b), 3)))
                # module frame lines: shrink and redraw lighter edge by overdrawing a smaller dark quad
                inner = q.mean(0) + (q - q.mean(0)) * 0.9
                si = proj(inner)
                c2 = PANEL + 22
                for tri in ((0, 1, 2), (0, 2, 3)):
                    _raster(img, zbuf, si[list(tri)] - [0, 0, 0.1], lambda b, c=c2: np.broadcast_to(c, (len(b), 3)))
    Path(out_png).parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).save(out_png)
    return out_png
