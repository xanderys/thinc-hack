"""GET /roof?address=...&source=bayern_lod2|google_solar|osm (optional)."""
from fastapi import FastAPI, HTTPException

from roof import SOURCES, lookup

app = FastAPI(title="roof")


@app.get("/roof")
def roof(address: str, source: str | None = None) -> dict:
    if source and source not in SOURCES:
        raise HTTPException(400, f"source must be one of {', '.join(SOURCES)}")
    res = lookup(address, source)
    if res.source == "none":
        raise HTTPException(404, {"address": address, "reasons": res.notes})
    return res.dict()
