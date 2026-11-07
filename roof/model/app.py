"""GET /model?address=...&kwp=...&build_year=... (planes JSON plus glb URL) and GET /model/file?address=... (the .glb).
Run from roof/: uv run uvicorn model.app:app --port 8766
"""
from __future__ import annotations

from urllib.parse import quote

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse

import roof as R
from model import model

app = FastAPI(title="roof model")


def _model(address: str, kwp: float | None, build_year: int | None = None) -> dict:
    try:
        return model(address, kwp, build_year)
    except R.NotFound as e:
        raise HTTPException(404, {"address": address, "reason": str(e)})
    except httpx.HTTPError as e:
        raise HTTPException(502, {"address": address, "reason": f"upstream: {e}"})


@app.get("/model")
def get_model(address: str, kwp: float | None = None, build_year: int | None = None) -> dict:
    r = _model(address, kwp, build_year)
    m = r["model"]
    m["glb_url"] = f"/model/file?address={quote(address)}"
    return m


@app.get("/model/file")
def get_file(address: str) -> FileResponse:
    r = _model(address, None)
    return FileResponse(r["glb_path"], media_type="model/gltf-binary", filename=f"{r['key']}.glb")
