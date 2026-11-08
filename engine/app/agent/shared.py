"""Shared buildings (v2.20): a flat in a multi-unit building cannot take the single-family kit. The roof belongs to the
owners together (WEG), so the draft shows what the whole roof could do, the balcony system a flat owner can fit alone, and
why battery and heat pump are not a flat's decision. Single-family drafts are returned untouched."""
import copy
import re

from ..hourly import sim as S

BALCONY_W = 800              # plug-in solar limit per household in Germany (Solarpaket I, 2024: 800 W inverter output)
BALCONY_KWP = 0.86           # two 430 W modules, the common balcony kit (assumption, stated in the payload)


def multi_unit(roof: dict) -> bool:
    """The measured building first: large_building, or a census class of 3 or more dwellings on a building big enough to
    hold them (footprint 150 m2 or more, or 3 or more storeys). The census class is an area figure, so an 80 m2 house in
    a "3 to 6 dwellings" area stays a house."""
    r = roof or {}
    m = re.match(r"\s*(\d+)", str(r.get("dwellings_class") or ""))
    big = (r.get("footprint_m2") or 0) >= 150 or (r.get("storeys") or 0) >= 3
    return bool((r.get("geometry") or {}).get("large_building")) or bool(m and int(m.group(1)) >= 3 and big)


def apply(lead: dict, draft: dict, roof: dict) -> dict:
    if not isinstance(draft, dict) or not multi_unit(roof):
        if isinstance(draft, dict) and "kind" not in draft:
            draft = {**draft, "kind": "single_family"}
        return draft
    d = copy.deepcopy(draft)
    d["kind"] = "shared_building"
    kwp = roof.get("max_kwp")
    yield_whole = None
    if kwp:
        yield_whole = round(float(S.pv_per_kwp("Munich", 35.0, 180.0).sum() * kwp))
    d["roof_potential"] = {"kwp": kwp, "modules": roof.get("max_panels"), "kwh_year": yield_whole,
                           "label": "Whole roof: needs the owners' association vote (WEG)",
                           "model": "Gemeinschaftliche Gebäudeversorgung, §42b EnWG",
                           "basis": "LoD2 roof, every sunny face filled; yield at 35 degrees south, PVGIS typical year"}
    bal = float(S.pv_per_kwp("Munich", 90.0, 180.0).sum() * BALCONY_KWP)
    bal = min(bal, BALCONY_W / 1000 * 8760)
    d["balcony"] = {"inverter_w": BALCONY_W, "kwp": BALCONY_KWP, "kwh_year": round(bal), "facade_azimuth_deg": 180,
                    "source": "Solarpaket I (2024): balcony systems up to 800 W inverter output; two 430 W modules assumed, "
                              "vertical, south (facade direction not known), PVGIS typical year"}
    comps = d.setdefault("components", {})
    for c, why in (("battery", "A home battery needs its own roof system behind the meter"),
                   ("heatpump", "Heating is shared: a heat pump is sized for the whole building with the owners")):
        comps.setdefault(c, {})
        comps[c].update(decision="none", size=None, none_reason=why)
    f = lead.get("inputs") or {}
    des = dict(d.get("design") or {})
    des.update(pv_kwp=None, inverter_kw=None, battery_kwh=None, heatpump_kw=None)
    if f.get("has_ev") or f.get("ev_planned"):
        des["wallbox_kw"] = 11.0
        comps.setdefault("wallbox", {}).update(decision="include", size=11.0, none_reason=None,
                                               note="Right to a wallbox at your own parking space: §20 WEG (2020)")
    else:
        des["wallbox_kw"] = None
    d["design"] = des
    d["verdict"] = {"label": "Shared building", "next_action": "Ask about parking and the owners' association"}
    # draft.economics stays the flat-level economics as drafted (the page reads it); the roof and balcony blocks carry the rest
    d["variants"] = []
    return d
