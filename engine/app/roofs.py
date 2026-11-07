"""Roof lookup (v1.6) via the repo's roof/ package: address in, RoofResult out, cached under engine/.cache/roof."""
import hashlib
import importlib.util
import json
import logging
import sys
from pathlib import Path

log = logging.getLogger("engine")
ROOT = Path(__file__).resolve().parents[2]
CACHE = Path(__file__).resolve().parent.parent / ".cache" / "roof2"  # v2: with floor area and Zensus fields
SOURCE = {"bayern_lod2": "lod2", "google_solar": "google-solar", "osm": "osm", "none": "none"}
WHERE = {"lod2": "measured from Bavarian LoD2 data (Bayerische Vermessungsverwaltung, CC BY 4.0)",
         "google-solar": "measured by the Google Solar API", "osm": "estimated from the OpenStreetMap footprint"}
M2_PER_KWP = 5.5
HERO_ADDRESS = "Katharinenstraße 5, 82008 Unterhaching"
_mod = None


def _roof():
    global _mod
    if _mod is None:
        if str(ROOT / "roof") not in sys.path:
            sys.path.append(str(ROOT / "roof"))  # roof.py imports its sibling zensus.py
        spec = importlib.util.spec_from_file_location("roof_lookup", ROOT / "roof" / "roof.py")
        mod = importlib.util.module_from_spec(spec)
        sys.modules["roof_lookup"] = mod  # dataclasses look their module up here
        spec.loader.exec_module(mod)
        _mod = mod
    return _mod


def to_contract(d: dict) -> dict:
    src = SOURCE.get(d.get("source"), d.get("source") or "none")
    usable = d.get("usable_area_m2")
    notes = d.get("notes") or []
    return {"source": src, "matched_address": notes[0] if notes else "", "lat": d.get("lat"), "lon": d.get("lon"),
            "footprint_m2": d.get("footprint_m2"), "roof_area_m2": d.get("roof_area_m2"), "usable_area_m2": usable,
            "segments": [{"azimuth": s.get("azimuth"), "pitch": s.get("pitch"), "area_m2": s.get("area_m2")} for s in d.get("segments") or []],
            "max_panels": d.get("max_panels"), "max_kwp": round(usable / M2_PER_KWP, 2) if usable else None,
            "confidence": d.get("confidence", "none") if src != "none" else "none", "notes": notes,
            # v1.6.1 / v1.7.1 estimates: floor area from LoD2 footprint x storeys; build year and heating system from Zensus 2022
            "floor_area_m2": d.get("floor_area_m2"), "storeys": d.get("storeys"),
            "floor_area_confidence": "estimate" if d.get("floor_area_m2") else None,
            "build_year_class": d.get("build_year_class"), "build_year_estimate": d.get("build_year_estimate"),
            "heating_class": d.get("heating_class"), "avg_flat_m2": d.get("avg_flat_m2"), "dwellings_class": d.get("dwellings_class"),
            "zensus_confidence": d.get("zensus_confidence")}


def lookup(address: str) -> dict:
    res = _lookup(address)
    if res.get("source") not in ("none", "postcode") and model_available():
        res = {**res, "model_url": model_url(address)}  # v2.1: the 3D house, built on first request
    return res


def _lookup(address: str) -> dict:
    key = hashlib.sha256(address.strip().lower().encode()).hexdigest()[:16]
    path = CACHE / f"{key}.json"
    if path.exists():
        return json.loads(path.read_text())
    res = to_contract(_roof().lookup(address).dict())
    if res["source"] != "none":  # do not cache misses: a source may be down for a moment
        CACHE.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(res, ensure_ascii=False))
    return res


_warming: set = set()


def cached(address: str):
    """The cached lookup, or None; never blocks. Starts a background lookup on a miss."""
    key = hashlib.sha256(address.strip().lower().encode()).hexdigest()[:16]
    path = CACHE / f"{key}.json"
    if path.exists():
        r = json.loads(path.read_text())
        return {**r, "model_url": model_url(address)} if r.get("source") not in ("none", "postcode") and model_available() else r
    if key not in _warming:
        _warming.add(key)
        import threading
        threading.Thread(target=lambda: (lookup(address), _warming.discard(key)), daemon=True).start()
    return None


def cached_postcode(pc: str):
    import re as _re
    m = _re.search(r"\b\d{5}\b", pc or "")
    if not m:
        return None
    path = CACHE / f"pc-{m.group()}.json"
    if path.exists():
        return json.loads(path.read_text())
    key = "pc" + m.group()
    if key not in _warming:
        _warming.add(key)
        import threading
        threading.Thread(target=lambda: (postcode_lookup(pc), _warming.discard(key)), daemon=True).start()
    return None


def postcode_lookup(postcode: str) -> dict:
    """Postcode alone: Nominatim centroid (cached), no building; Zensus 2022 estimates for the 100 m cell there."""
    import re
    pc = (re.search(r"\b\d{5}\b", postcode or "") or [None])[0]
    empty = {"source": "none", "matched_address": "", "lat": None, "lon": None, "footprint_m2": None, "roof_area_m2": None,
             "usable_area_m2": None, "segments": [], "max_panels": None, "max_kwp": None, "confidence": "none", "notes": []}
    if not pc:
        return {**empty, "notes": [f"'{postcode}' is not a five-digit German postcode."]}
    path = CACHE / f"pc-{pc}.json"
    if path.exists():
        return json.loads(path.read_text())
    m = _roof()

    def fetch():
        import time as _t
        with m._lock:
            wait = 1.0 - (_t.time() - m._last_nominatim)
            if wait > 0:
                _t.sleep(wait)
            r = m.httpx.get("https://nominatim.openstreetmap.org/search",
                            params={"postalcode": pc, "country": "de", "format": "jsonv2", "limit": 1},
                            headers={"User-Agent": m.UA}, timeout=10)
            m._last_nominatim = _t.time()
        r.raise_for_status()
        return {"results": r.json()}
    hits = m._cached_json("nominatim-postcode", pc, fetch)["results"]
    if not hits:
        return {**empty, "notes": [f"Nominatim: no results for postcode {pc}"]}
    h = hits[0]
    lat, lon = float(h["lat"]), float(h["lon"])
    import zensus
    z = zensus.lookup(lat, lon) or {}
    res = {**empty, "source": "postcode", "matched_address": h.get("display_name", pc), "lat": lat, "lon": lon,
           "confidence": "estimated from postcode",
           "floor_area_m2": None, "storeys": None, "floor_area_confidence": None,
           "build_year_class": z.get("build_year_class"), "build_year_estimate": z.get("build_year_estimate"),
           "heating_class": z.get("heating_class"), "avg_flat_m2": z.get("avg_flat_m2"), "dwellings_class": z.get("dwellings_class"),
           "zensus_confidence": "estimated from postcode (Zensus 2022, 100 m cell at its centre)" if z else None,
           "notes": [h.get("display_name", pc), "Postcode centre only: no building, so no roof area or panel count."]
                    + ([] if z else ["Zensus cell not available here (outside the Munich index)."])}
    CACHE.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(res, ensure_ascii=False))
    return res


MODEL_CACHE = Path(__file__).resolve().parent.parent / ".cache" / "roofmodel"
CHECK_ADDRESSES = [HERO_ADDRESS, "Wilhelm-Keim-Straße 4a, 82031 Grünwald", "Neufeldstraße 6, 81243 München",
                   "Evereststraße 68, 81825 München", "Fliederstraße 81, 82110 Germering"]


def model_available() -> bool:
    try:
        return hasattr(_roof(), "model")
    except Exception:
        return False


def model_url(address: str) -> str:
    from urllib.parse import quote
    return f"/api/roof/model/file?address={quote(address)}"


def model_info(address: str) -> dict:
    """v2.1: roof.model(address) from roof/model (REONIC MODEL): {glb_path, planes_json_path, textured, licence, source},
    cached by address so a model is built once."""
    key = hashlib.sha256(address.strip().lower().encode()).hexdigest()[:16]
    path = MODEL_CACHE / f"{key}.json"
    if path.exists():
        info = json.loads(path.read_text())
        if Path(info.get("glb_path", "")).exists():
            return info
    m = _roof()
    if not hasattr(m, "model"):
        raise RuntimeError("The 3D roof model is not installed yet (roof/model).")
    res = m.model(address)
    info = res if isinstance(res, dict) else getattr(res, "__dict__", {})
    info = {k: (str(v) if k.endswith("_path") else v) for k, v in info.items()}
    MODEL_CACHE.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(info, ensure_ascii=False))
    return info


def warm_models():
    if not model_available():
        return
    for a in CHECK_ADDRESSES:
        try:
            model_info(a)
        except Exception as e:
            log.warning("roof model warm-up failed for %s: %s", a, e)


def facing(segs: list) -> str:
    good = [s for s in segs if s.get("azimuth") is not None and 60 <= s["azimuth"] <= 300]
    if not good:
        return "flat" if segs else "unknown"
    names = []
    for s in sorted(good, key=lambda s: -s["area_m2"]):
        a = s["azimuth"]
        n = "east" if a < 135 else "south" if a <= 225 else "west"
        if n not in names:
            names.append(n)
    if set(names[:2]) == {"east", "west"}:
        return "east-west"
    return names[0] if len(names) == 1 else "-".join(names[:2])


def describe(r: dict) -> str | None:
    if not r or r.get("source") == "none" or not r.get("usable_area_m2"):
        return None
    segs = r.get("segments") or []
    pitch = max(segs, key=lambda s: s["area_m2"])["pitch"] if segs else None
    at = f" at {pitch:.0f} degrees" if pitch is not None else ""
    return (f"The roof fits {r['max_panels']} modules, about {r['usable_area_m2']:.0f} m2{at} facing {facing(segs)}, "
            f"{WHERE.get(r['source'], r['source'])}.")


def warm():
    try:
        lookup(HERO_ADDRESS)
        log.warning("roof tile for the hero address indexed")
    except Exception:
        log.exception("roof warm-up failed")
