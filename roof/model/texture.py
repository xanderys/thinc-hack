"""Bavarian DOP20 orthophoto for a square around the house, fetched once and cached."""
from __future__ import annotations

import io

import httpx
from PIL import Image

import roof as R

WMS = "https://geoservices.bayern.de/od/wms/dop/v1/dop20"
LICENCE = "CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/)"
ATTRIBUTION = "Orthophoto DOP20 and LoD2: Bayerische Vermessungsverwaltung – www.geodaten.bayern.de, CC BY 4.0"
SIZE_M = 80.0   # ground square edge, metres
PX = 1024


def bounds(origin) -> tuple[float, float, float, float]:
    h = SIZE_M / 2
    return origin[0] - h, origin[1] - h, origin[0] + h, origin[1] + h


def ortho(key: str, origin) -> tuple[Image.Image | None, str]:
    """(image, note). image None when the WMS cannot be reached; never raises."""
    path = R.CACHE / "model" / "ortho" / f"{key}.jpg"
    if path.exists():
        return Image.open(path).convert("RGB"), "cached"
    minx, miny, maxx, maxy = bounds(origin)
    try:
        r = httpx.get(WMS, params={"SERVICE": "WMS", "VERSION": "1.1.1", "REQUEST": "GetMap",
                                   "LAYERS": "by_dop20c", "STYLES": "", "SRS": "EPSG:25832",
                                   "BBOX": f"{minx:.2f},{miny:.2f},{maxx:.2f},{maxy:.2f}",
                                   "WIDTH": PX, "HEIGHT": PX, "FORMAT": "image/jpeg"},
                      headers={"User-Agent": R.UA}, timeout=20)
        if r.status_code != 200 or not r.headers.get("content-type", "").startswith("image/"):
            return None, f"DOP20 WMS: HTTP {r.status_code} {r.text[:200]}"
        img = Image.open(io.BytesIO(r.content)).convert("RGB")
    except (httpx.HTTPError, OSError) as e:
        return None, f"DOP20 WMS unreachable: {e}"
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, quality=90)
    return img, "fetched"
