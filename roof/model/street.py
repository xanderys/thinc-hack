"""Street proof: roofs around the house that already carry PV. Currently returns street = None, with the reason.

Tried on 7 Nov 2026 for the hero (Katharinenstraße 5, Unterhaching):
- MaStR (Marktstammdatenregister) public JSON works without registration, but it withholds street and house
  number for units of private persons, so it cannot count a street. We report the postcode count instead.
- A colour heuristic on the DOP20 photo (dark blue-grey rectangles of 6 m2 or more on LoD2 roofs within
  150 m) flagged 2 of 84 roofs, both shadows, and missed every array clearly visible in the photo. Shadows in
  DOP20 are as blue as modules, so a colour rule cannot tell them apart. Not used; we do not guess.
"""
from __future__ import annotations

import json

import httpx

import roof as R

MASTR = "https://www.marktstammdatenregister.de/MaStR/Einheit/EinheitJson/GetErweiterteOeffentlicheEinheitStromerzeugung"
PV = "2495"   # MaStR Energieträger id: Solare Strahlungsenergie


def mastr_postcode(plz: str) -> int | None:
    """PV units registered in a postcode (all operating states), cached; None when MaStR cannot be reached."""
    path = R.CACHE / "model" / "street" / f"mastr_{plz}.json"
    if path.exists():
        return json.loads(path.read_text())["total"]
    try:
        r = httpx.get(MASTR, params={"sort": "", "page": 1, "pageSize": 1, "group": "",
                                     "filter": f"Postleitzahl~eq~'{plz}'~and~Energieträger~eq~'{PV}'"},
                      headers={"User-Agent": R.UA}, timeout=30)
        total = int(r.json()["Total"])
    except (httpx.HTTPError, ValueError, KeyError):
        return None
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"total": total}))
    return total


def street(address: str) -> tuple[None, str]:
    plz = next((t for t in address.replace(",", " ").split() if t.isdigit() and len(t) == 5), None)
    n = mastr_postcode(plz) if plz else None
    why = ("No street count: MaStR does not publish street addresses for private PV units, and a colour test on "
           "the aerial photo cannot tell modules from shadows.")
    if n is not None:
        why += f" MaStR lists {n:,} PV units in postcode {plz} (Marktstammdatenregister, Bundesnetzagentur)."
    return None, why
