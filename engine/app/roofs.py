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
            "heating_class": d.get("heating_class"), "zensus_confidence": d.get("zensus_confidence")}


def lookup(address: str) -> dict:
    key = hashlib.sha256(address.strip().lower().encode()).hexdigest()[:16]
    path = CACHE / f"{key}.json"
    if path.exists():
        return json.loads(path.read_text())
    res = to_contract(_roof().lookup(address).dict())
    if res["source"] != "none":  # do not cache misses: a source may be down for a moment
        CACHE.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(res, ensure_ascii=False))
    return res


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
