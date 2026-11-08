"""GET /api/roof/shading: per-module sunshine share for the chosen layout. Mounted by main.py with
app.include_router(shading_routes.router). Never blocks: a cold address returns {status: "pending"} while it computes."""
from typing import Optional

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from . import leads, shading

router = APIRouter()


def _err(status, msg):
    return JSONResponse(status_code=status, content={"error": msg})


@router.get("/api/roof/shading")
def roof_shading(address: str = "", lead_id: str = "", kwp: Optional[float] = None, build_year: Optional[int] = None):
    if lead_id and not address.strip():
        lead = leads.LEADS.get(lead_id) or next((l for l in leads.LEADS.values() if lead_id in l.get("aliases", [])), None)
        if not lead:
            return _err(404, f"No lead with id {lead_id}")
        inp = lead.get("inputs") or {}
        address = inp.get("address") or ""
        build_year = build_year or inp.get("house_built_year")
        if kwp is None:
            kwp = ((lead.get("draft") or {}).get("design") or {}).get("pv_kwp")
        if not address:
            return _err(404, "This lead has no street address, so there is no roof to shade.")
    if not address.strip():
        return _err(422, "address or lead_id is missing.")
    hit = shading.cached(address)
    if hit is None:
        msg = shading.failure(address)
        if msg and not shading.running(address):
            return _err(404, msg)
        shading.start(address, build_year)
        return {"status": "pending", "address": address}
    try:
        counts = shading.chosen_counts(address, kwp)
    except Exception as e:
        return _err(404, str(e))
    return shading.result(hit, counts)
