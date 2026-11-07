"""How old the pictures are: the DOP20 flight date (LDBV WMS GetFeatureInfo, layer by_dop20_info, field ua) and the LoD2
building's creationDate (Bavarian LoD2 CityGML). Never invents a date: null with the reason in source_note."""
import json
import re
import tempfile
import threading
import xml.etree.ElementTree as ET
from datetime import datetime
from pathlib import Path

import requests
from pyproj import Transformer

DIR = Path(__file__).resolve().parent.parent / ".cache" / "imagery"
WMS = "https://geoservices.bayern.de/od/wms/dop/v1/dop20"
GML = "https://download1.bayernwolke.de/a/lod2/citygml/{tile}.gml"
TO_UTM = Transformer.from_crs("EPSG:4326", "EPSG:25832", always_xy=True)
_running: set = set()
_lock = threading.Lock()


def _read(name):
    p = DIR / name
    try:
        return json.loads(p.read_text()) if p.exists() else None
    except Exception:
        return None


def _write(name, obj):
    DIR.mkdir(parents=True, exist_ok=True)
    tmp = DIR / (name + ".tmp")
    tmp.write_text(json.dumps(obj))
    tmp.replace(DIR / name)


def dop20_flown(lat: float, lon: float) -> tuple[str | None, str]:
    x, y = TO_UTM.transform(lon, lat)
    cell = f"dop-{int(x // 100)}_{int(y // 100)}.json"
    hit = _read(cell)
    if hit is not None:
        return hit.get("date"), hit.get("note", "")
    try:
        r = requests.get(WMS, timeout=4, params={
            "SERVICE": "WMS", "VERSION": "1.3.0", "REQUEST": "GetFeatureInfo", "LAYERS": "DOP20", "QUERY_LAYERS": "DOP20",
            "CRS": "EPSG:25832", "BBOX": f"{x - 5},{y - 5},{x + 5},{y + 5}", "WIDTH": 10, "HEIGHT": 10, "I": 5, "J": 5,
            "INFO_FORMAT": "text/plain"})
        m = re.search(r"ua\s*=\s*'(\d{2})\.(\d{2})\.(\d{4})'", r.text)
    except Exception as e:
        return None, f"DOP20 flight date unavailable: {e}"
    if not m:
        out = {"date": None, "note": "the LDBV DOP20 info layer gave no flight date here"}
    else:
        out = {"date": f"{m.group(3)}-{m.group(2)}-{m.group(1)}",
               "note": "DOP20 flight date from the LDBV WMS info layer (by_dop20_info, field ua)"}
    _write(cell, out)
    return out["date"], out["note"]


def _index_tile(tile: str):
    """Downloads one LoD2 tile once, keeps only building id and creationDate, deletes the GML."""
    try:
        with tempfile.NamedTemporaryFile(suffix=".gml", delete=True) as f:
            with requests.get(GML.format(tile=tile), stream=True, timeout=120) as r:
                r.raise_for_status()
                for chunk in r.iter_content(1 << 20):
                    f.write(chunk)
            f.flush()
            dates, cur = {}, None
            for ev, el in ET.iterparse(f.name, events=("start", "end")):
                tag = el.tag.rsplit("}", 1)[-1]
                if ev == "start" and tag == "Building":
                    cur = el.get("{http://www.opengis.net/gml}id")
                elif ev == "end" and tag == "creationDate" and cur and cur not in dates and el.text:
                    dates[cur] = el.text.strip()[:10]
                elif ev == "end" and tag == "Building":
                    cur = None
                    el.clear()
        _write(f"lod2-{tile}.json", dates)
    except Exception as e:
        _write(f"lod2-{tile}.json", {"_error": str(e)[:200]})
    finally:
        with _lock:
            _running.discard(tile)


def lod2_stand(building: str | None, tile: str | None, wait: float = 0.0) -> tuple[str | None, str]:
    if not building or not tile:
        return None, "no LoD2 building matched"
    idx = _read(f"lod2-{tile}.json")
    if idx is None:
        with _lock:
            start = tile not in _running
            _running.add(tile)
        t = threading.Thread(target=_index_tile, args=(tile,), daemon=True)
        if start:
            t.start()
            if wait:
                t.join(wait)
        idx = _read(f"lod2-{tile}.json")
        if idx is None:
            return None, f"LoD2 tile {tile} date index is being read; ask again in a minute"
    if idx.get("_error"):
        return None, f"LoD2 creationDate unavailable: {idx['_error']}"
    d = idx.get(building)
    if not d or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", d):
        return None, f"LoD2 building {building} carries no creationDate"
    return d, f"LoD2 creationDate of building {building} (Bavarian LoD2 CityGML, tile {tile})"


def block(lat, lon, building=None, tile=None) -> dict:
    if lat is None or lon is None:
        return {"dop20_flown": None, "lod2_stand": None, "source_note": "no location, so no imagery dates"}
    flown, n1 = dop20_flown(lat, lon)
    stand, n2 = lod2_stand(building, tile)
    return {"dop20_flown": flown, "lod2_stand": stand, "source_note": f"{n1}. {n2}."}


def from_notes(notes) -> tuple[str | None, str | None]:
    """The LoD2 building and tile from a RoofResult's notes ("LoD2 building DEBY_LOD2_... (tile 694_5326)")."""
    for n in notes or []:
        m = re.search(r"LoD2 building (\S+) \(tile (\d+_\d+)\)", n)
        if m:
            return m.group(1), m.group(2)
    return None, None
