import re
import hashlib
import json
import logging
import pickle
import threading
import time
from pathlib import Path
from typing import Literal, Optional, Union

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.encoders import jsonable_encoder
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

import os

from fastapi import Header

from . import data, leads, roofs
from . import imagery
from .whatsapp import conversation as wa
from . import model as model_mod


def _load_env():
    """INTAKE_SECRET from ~/.config/marquee/intake.env (shared with the voice builder; never in git)."""
    for p in (Path.home() / ".config" / "marquee" / "intake.env", Path.home() / ".config" / "marquee" / "google.env",
              Path(__file__).resolve().parent.parent / ".env"):
        if p.exists():
            for line in p.read_text().splitlines():
                k, _, v = line.partition("=")
                if k.strip() and v.strip() and k.strip() not in os.environ:
                    os.environ[k.strip()] = v.strip().strip('"')


_load_env()
from .model import MODEL_VERSION, Engine, row_design, row_inputs

log = logging.getLogger("engine")
app = FastAPI(title="Reonic planner engine")
from . import shading_routes  # noqa: E402  GET /api/roof/shading (branch shading)
app.include_router(shading_routes.router)
@app.middleware("http")
async def _who(request: Request, call_next):
    """Records who sent each write, so a write to a pinned lead is logged with its source (leads.PINNED_LOG)."""
    tok = None
    if request.method in ("POST", "PUT", "DELETE") and request.url.path.startswith(("/api/leads", "/api/intake")):
        h = request.headers
        tok = leads.REQUEST.set({"route": f"{request.method} {request.url.path}", "client": request.client.host if request.client else None,
                                 "forwarded_for": h.get("x-forwarded-for"), "user_agent": h.get("user-agent"),
                                 "origin": h.get("origin") or h.get("referer"), "with_secret": bool(h.get("x-intake-secret")),
                                 "client_route": h.get("x-client-route")})
    try:
        return await call_next(request)
    finally:
        if tok is not None:
            leads.REQUEST.reset(tok)


app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

STATE: dict = {"engine": None, "eval": None, "error": None}


@app.on_event("startup")
def startup():
    try:
        t = time.time()
        key = cache_key()
        path = CACHE / f"engine-{key}.pkl"
        if path.exists():
            loaded = pickle.loads(path.read_bytes())
            STATE["engine"], STATE["eval"] = loaded[0], loaded[1]
            STATE["engine"].restore_globals()
            STATE["inbox"] = loaded[2] if len(loaded) > 2 else None
            log.warning("loaded cached model %s in %.1fs", key, time.time() - t)
        else:
            df, stats = data.load()
            eng = Engine(df, stats).fit()
            STATE["engine"] = eng
            STATE["eval"] = eng.evaluate()
            warm_inbox()  # the overnight drafts: built once, stored with the model, served from memory
            CACHE.mkdir(exist_ok=True)
            for old in CACHE.glob("engine-*.pkl"):
                old.unlink()
            path.write_bytes(pickle.dumps((eng, STATE["eval"], STATE.get("inbox"))))
            log.warning("trained in %.1fs on %d projects", time.time() - t, len(eng.train))
    except Exception as e:  # keep serving /health with the reason
        STATE["error"] = str(e)
        log.exception("startup failed")
        return
    def warm_hourly():  # cold call about 1 s; after /health is up, so the Funnel answers within seconds of a restart
        try:
            from . import hourly
            hourly.simulate({"annual_demand_kwh": 4500, "installer_id": "2a8ba8e2"}, {"pv_kwp": 9, "inverter_kw": 8, "battery_kwh": 10})
            hourly.replay_2025({"annual_demand_kwh": 4500, "installer_id": "2a8ba8e2"}, {"pv_kwp": 9, "inverter_kw": 8, "battery_kwh": 10})
        except Exception:
            log.exception("hourly warm-up failed")
    threading.Thread(target=warm_hourly, daemon=True).start()
    if STATE.get("inbox") is None:
        threading.Thread(target=warm_inbox, daemon=True).start()
    leads.load_all()  # before anything can create or step a lead
    snapshot_untouched()
    for l in leads.LEADS.values():  # the pinned demo leads carry Xander's number for the WhatsApp copilot
        if l.get("pinned") and not l.get("phone"):
            l["phone"] = DEMO_PHONE
            leads.save(l)
    wa.configure(_wa_order, _wa_step)
    wa.start()
    leads.expire_stale()
    model_mod.PRIORS.update({o["field"]: o["mean_swing"] for o in leads.priors()["order"]})
    threading.Thread(target=lambda: (roofs.warm(), roofs.warm_google(), roofs.warm_models(), roofs.warm_venue(), refresh_all_leads()),
                     daemon=True).start()
    # the scoreboard is the lab's sealed table (final_test.json); the live recompute stays available via warm_rules_eval()
    threading.Thread(target=warm_reonic_eval, daemon=True).start()


def warm_reonic_eval():
    """Reonic's published rule of thumb on the lab's populations (lowest option, our bands); the old textbook is re-scored
    beside it to show this scoring reproduces the lab's harness."""
    try:
        import numpy as np
        import pandas as pd
        from .planner_rules import test_ids
        from . import rules as R
        eng = STATE["engine"]
        df, _ = data.load()
        tid = set(test_ids())
        th = df[df.project_id.isin(tid)]
        pops = {"test half": th[(th.pv_kwp > 0) | th.has_solar]}
        board = eng.test[(eng.test.pv_kwp > 0) | eng.test.has_solar]
        pops["clean 126"] = board[board.project_id.isin(tid)]
        blocks, check = {}, {}
        for name, rows in pops.items():
            res = {}
            fns = [("reonic_rule", eng.reonic_rule), ("textbook", eng.baseline)]
            try:
                from .planner_rules import rules5  # noqa: F401
                fns.append(("rules5", eng.predict_rules5))
            except ImportError:
                pass
            for key, fn in fns:
                D = pd.DataFrame([{k: (v or 0.0) for k, v in fn(model_mod.row_inputs(r)).items()} for r in rows.to_dict("records")])
                w = {c: R.within(c, D[model_mod.TARGET[c]].values, rows[model_mod.TARGET[c]].values) for c in model_mod.COMPONENTS}
                res[key] = {"design_match_share": round(float(np.logical_and.reduce(list(w.values())).mean()), 3),
                            "pv_within": round(float(w["pv"].mean()), 3), "battery_within": round(float(w["battery"].mean()), 3),
                            "wallbox_decision": round(float(w["wallbox"].mean()), 3), "n": len(rows)}
            blocks[f"{name} | lowest option | ours"] = {k: v for k, v in res.items() if k != "textbook"}
            check[name] = {"textbook_rescored": res["textbook"]["design_match_share"]}
        STATE["reonic_eval"] = {"blocks": blocks, "check": check, "labels": {
            "reonic_rule": "Reonic rule of thumb: 1 kWp and 1.25 kWh per 1,000 kWh annual use, no heat pump unless asked, 11 kW wallbox with an EV",
            "textbook": "1.3 kWp per MWh plus 2.5 kWp with an EV (docs/domain.md), installer's median battery"}}
    except Exception:
        log.exception("reonic rule eval failed")


def warm_rules_eval():
    """v2.0 side-by-side scoreboard; computed at startup (planner_rules is outside the model cache key)."""
    try:
        from . import planner_rules  # noqa: F401
    except Exception as e:
        STATE["rules_eval"] = {"error": f"planner_rules not available: {e}"}
        return
    try:
        t = time.time()
        h = hashlib.sha256(cache_key().encode())
        for f in sorted((Path(__file__).parent / "planner_rules").glob("*.py")) + [Path(__file__).parent / "planner_rules" / "constants.json"]:
            h.update(f.read_bytes() if f.exists() else b"")
        p = CACHE / f"rules_eval-{h.hexdigest()[:12]}.json"
        if p.exists():
            STATE["rules_eval"] = json.loads(p.read_text())
            return
        STATE["rules_eval"] = STATE["engine"].recommenders_eval()
        CACHE.mkdir(exist_ok=True)
        p.write_text(json.dumps(STATE["rules_eval"], default=float))
        log.warning("recommenders eval ready in %.1fs", time.time() - t)
    except Exception as e:
        log.exception("recommenders eval failed")
        STATE["rules_eval"] = {"error": str(e)}


INBOX_MAX = 60


def warm_inbox():
    try:
        rows = STATE["engine"].inbox(INBOX_MAX)
        for x in rows:
            x["label"] = label(x.pop("_row"))
        STATE["inbox"] = [{k: x[k] for k in ("project_id", "installer_id", "label", "inputs", "draft", "confidence", "expert", "within", "note")} for x in rows]
        log.warning("inbox ready: %d rows", len(rows))
    except Exception:
        log.exception("inbox warm-up failed")


CACHE = Path(__file__).resolve().parent.parent / ".cache"  # gitignored; holds project rows


def cache_key() -> str:
    """Changes when the data files or the engine code change."""
    h = hashlib.sha256()
    root = data.data_dir()
    for f in sorted(root.glob("*/*.csv")):
        st = f.stat()
        h.update(f"{f.relative_to(root)}:{st.st_size}:{st.st_mtime_ns}".encode())
    for f in sorted(Path(__file__).parent.glob("*.py")):
        h.update(f.read_bytes())
    return h.hexdigest()[:12]


class HomeInputs(BaseModel):
    installer_id: Literal["2a8ba8e2", "23c108b7"]
    annual_demand_kwh: float = 4500.0  # the pack default when the lead gives no use; /api/ask then asks for it first
    load_profile: Literal["H0", "FamilyOfFour", "HomeOfficeOnePerson", "FullTimeOnePerson", "SeniorOnePerson", "PartTimeOnePerson"] = "H0"
    num_inhabitants: Optional[float] = None
    house_size_sqm: Optional[float] = None
    house_built_year: Optional[float] = None
    has_ev: bool = False
    ev_planned: bool = False  # v2.14: the car is planned, not here yet; sized like has_ev
    ev_annual_km: Optional[float] = None
    has_wallbox: bool = False
    heating_type: Literal["Gas", "Oil", "Heatpump", "OtherNonRenewable", "OtherRenewable", "Unknown"] = "Unknown"
    heating_stated: Optional[str] = None  # v2.14: the heating as stated (District, Electric); heating_type is the kind sizing uses
    heating_cost_per_year_eur: Optional[float] = None
    heating_demand_kwh: Optional[float] = None
    electricity_price_ct_kwh: Optional[float] = None
    has_solar: bool = False
    existing_solar_kwp: Optional[float] = None
    has_storage: bool = False
    existing_storage_kwh: Optional[float] = None
    roof_area_sqm: Optional[float] = None       # read by the hourly simulation (v1.2)
    roof_azimuth_deg: Optional[float] = None
    roof_tilt_deg: Optional[float] = None
    roof_orientation: Optional[str] = None
    boiler_age_years: Optional[float] = None  # v2.0: rule 3 replaces a gas or oil boiler older than boiler_age (default 20)
    offer_date: Optional[str] = None
    preference: Optional[Literal["independence", "payback", "upfront"]] = None  # v1.7: reorders variants only
    address: Optional[str] = None   # v1.6: the engine looks the roof up
    postcode: Optional[str] = None  # postcode alone: Zensus estimates at its centre, no roof
    roof: Optional[dict] = None     # v1.6: or a prior /api/roof result  # ISO date; picks the installer catalogue of that time. Default: latest.


class Design(BaseModel):
    pv_kwp: Optional[float] = None
    inverter_kw: Optional[float] = None
    battery_kwh: Optional[float] = None
    heatpump_kw: Optional[float] = None
    wallbox_kw: Optional[float] = None


class DesignReq(BaseModel):
    inputs: HomeInputs


class RefineReq(BaseModel):
    inputs: HomeInputs
    overrides: Optional[dict] = None
    lead_id: Optional[str] = None       # refine never writes a lead; with base_version it only checks freshness
    base_version: Optional[int] = None


class ValidateReq(BaseModel):
    inputs: HomeInputs
    design: Design


def err(status, msg):
    return JSONResponse(status_code=status, content={"error": msg})


@app.exception_handler(RequestValidationError)
async def bad_request(_: Request, exc: RequestValidationError):
    parts = []
    for e in exc.errors():
        loc = [str(x) for x in e.get("loc", []) if x not in ("body", "query", "path")]
        name = loc[-1] if loc else "request"
        t = e.get("type", "")
        if t == "missing":
            parts.append(f"{name} is missing.")
        elif t in ("literal_error", "enum"):
            parts.append(f"{name} must be one of {e.get('ctx', {}).get('expected', 'the allowed values')}.")
        elif t.startswith(("float", "int")):
            parts.append(f"{name} must be a number.")
        elif t.startswith("bool"):
            parts.append(f"{name} must be true or false.")
        elif t == "json_invalid":
            parts.append("The request body is not valid JSON.")
        else:
            parts.append(f"{name}: {e.get('msg')}.")
    return err(422, " ".join(parts) or "Invalid request.")


RANGES = {"annual_demand_kwh": (500, 30_000, "kWh a year (single-family homes; the training data covers this range)"), "num_inhabitants": (1, 20, "people"),
          "house_size_sqm": (20, 1_000, "m2"), "house_built_year": (1800, 2027, ""), "ev_annual_km": (0, 100_000, "km a year"),
          "heating_cost_per_year_eur": (0, 20_000, "EUR a year"), "heating_demand_kwh": (0, 100_000, "kWh a year"),
          "electricity_price_ct_kwh": (5, 100, "ct/kWh"), "existing_solar_kwp": (0, 100, "kWp"), "existing_storage_kwh": (0, 100, "kWh")}
DESIGN_RANGES = {"pv_kwp": (0, 100), "inverter_kw": (0, 100), "battery_kwh": (0, 100), "heatpump_kw": (0, 50), "wallbox_kw": (0, 50)}


def check_inputs(inp: dict):
    """Range checks, then resolve the roof (v1.6) into inp['roof'] when an address is given."""
    if not inp.get("has_ev"):
        inp["ev_annual_km"] = None  # a mileage without an EV is stale; it must never move the design
    if inp.get("postcode") and not inp.get("address") and not inp.get("roof"):
        try:
            r = roofs.postcode_lookup(inp["postcode"])
            inp["roof"] = r if r.get("source") != "none" else None
        except Exception as e:
            log.warning("postcode lookup failed: %s", e)
    if inp.get("address") and not inp.get("roof"):
        try:
            r = roofs.lookup(inp["address"])
            inp["roof"] = r if r.get("source") != "none" else None
        except Exception as e:
            log.warning("roof lookup failed: %s", e)
    if inp.get("address") and inp.get("roof") and not inp.get("envelope"):
        env = roofs.envelope_cached(inp["address"], inp.get("house_built_year"))
        if env and env.get("design_heat_load_kw"):
            inp["envelope"] = env  # heat load from the house's own walls and roof (REONIC MODEL); rules read it too
    r = inp.get("roof") or {}
    est = []
    if not inp.get("house_built_year") and r.get("build_year_estimate"):
        inp["house_built_year"] = float(r["build_year_estimate"])
        est.append("build year")
    if not inp.get("house_size_sqm") and r.get("floor_area_m2") and r.get("source") != "postcode":
        inp["house_size_sqm"] = float(r["floor_area_m2"])
        est.append("floor area")
    if est:  # heating_type is never set from heating_class: the cell says the system, not the fuel
        inp["_estimated"] = est
    bad = []
    for k, (lo, hi, unit) in RANGES.items():
        v = inp.get(k)
        if v is not None and not (lo <= v <= hi):
            bad.append(f"{k} is {v:g}; it must be between {lo:,} and {hi:,}{' ' + unit if unit else ''}.")
    if inp.get("offer_date"):
        import pandas as pd
        if pd.isna(pd.to_datetime(inp["offer_date"], errors="coerce")):
            bad.append(f"offer_date {inp['offer_date']!r} is not a date; use YYYY-MM-DD.")
    if bad:
        raise InputError(" ".join(bad))


def check_design(d: dict, what="design"):
    bad = [f"{what}.{k} is {d[k]:g}; it must be between {lo} and {hi}." for k, (lo, hi) in DESIGN_RANGES.items()
           if d.get(k) is not None and not (lo <= d[k] <= hi)]
    if bad:
        raise InputError(" ".join(bad))


class InputError(ValueError):
    pass


@app.exception_handler(InputError)
async def input_error(_: Request, exc: InputError):
    return err(422, str(exc))


@app.exception_handler(Exception)
async def crash(_: Request, exc: Exception):
    log.exception("request failed")
    return err(500, str(exc))


def engine():
    if STATE["engine"] is None:
        raise RuntimeError(STATE["error"] or "Model is still training")
    return STATE["engine"]


@app.get("/health")
def health():
    e = STATE["engine"]
    try:
        from . import planner_rules
        rv = {"calibrated": "rules-1-calibrated", "band": "rules-3-band", "readout": "rules-4-readout", "rules5": "rules-5"}.get(model_mod.RECOMMENDER["mode"]) or getattr(planner_rules, "RULES_VERSION", None)
    except Exception:
        rv = None
    try:
        spatial = roofs.spatial_inputs()
    except Exception:
        spatial = []
    return {"ok": e is not None, "model_version": MODEL_VERSION, "recommender": model_mod.RECOMMENDER["mode"], "rules_version": rv,
            "spatial_inputs": spatial,
            "trained_on": {"projects": len(e.train) if e else 0, "installers": len(e.catalogue) if e else 0},
            "data_loaded": e is not None, **({"error": STATE["error"]} if STATE["error"] else {})}


@app.post("/api/design")
def design(req: DesignReq):
    inp = {**req.inputs.model_dump(), "_given": sorted(req.inputs.model_fields_set)}
    check_inputs(inp)
    return engine().predict(inp)


FIELDS = {"pv_kwp": "pv", "battery_kwh": "battery", "heatpump_kw": "heatpump", "wallbox_kw": "wallbox", "inverter_kw": "inverter"}


@app.post("/api/refine")
def refine(req: RefineReq):
    if req.lead_id and req.base_version is not None:
        lead = leads.LEADS.get(req.lead_id) or next((l for l in leads.LEADS.values() if req.lead_id in l.get("aliases", [])), None)
        stale = _stale(lead, req.base_version)
        if stale is not None:
            return stale
    eng = engine()
    inp = {**req.inputs.model_dump(), "_given": sorted(req.inputs.model_fields_set)}
    check_inputs(inp)
    if "layout_slots" in (req.overrides or {}):
        _slots(req.overrides["layout_slots"])  # stored on the lead by the intake step; the design itself is sized from pv_kwp
    bad = [k for k in (req.overrides or {}) if k not in FIELDS and k != "layout_slots"]
    if bad:
        return err(422, f"Unknown override field: {', '.join(bad)}. Allowed: {', '.join(FIELDS)}, layout_slots.")
    ov = {k: v for k, v in (req.overrides or {}).items() if k in FIELDS}
    nonnum = [k for k, v in ov.items() if v is not None and v != "include" and not (isinstance(v, (int, float)) and not isinstance(v, bool))]
    if nonnum:
        return err(422, f"Override {', '.join(nonnum)} must be a number, null or \"include\".")
    if ov.get("inverter_kw") == "include":
        ov.pop("inverter_kw")
    check_design({k: v for k, v in ov.items() if v != "include"}, "overrides")
    before = eng.predict(inp, full=False)  # only its sizes feed the diff
    after = eng.predict(inp, ov)
    diff = []
    for k, comp in FIELDS.items():
        a, b = before["design"][k], after["design"][k]
        if a != b:
            if ov.get(k) == "include":
                r = after["components"][comp]["reason"]
                why = r if r.startswith(("Included", "Replaces", "Replacement")) else f"Included by the planner; sized by the engine. {r}"
            elif k in ov:
                why = "Set by the planner."
            elif comp == "inverter":
                why = "Follows the PV size at a DC/AC ratio of about 1.15."
            else:
                why = f"Re-sized around the planner's choice: {after['components'][comp]['reason']}"
            diff.append({"component": comp, "from": a, "to": b, "why": why})
    return {**after, "diff": diff}


@app.post("/api/validate")
def validate(req: ValidateReq):
    inp, d = {**req.inputs.model_dump(), "_given": sorted(req.inputs.model_fields_set)}, req.design.model_dump()
    check_inputs(inp)
    check_design(d)
    return {"flags": engine().validate(inp, d)}


@app.get("/api/projects")
def projects(split: Literal["test", "train"] = "test", limit: int = 50, installer_id: Optional[str] = None):
    eng = engine()
    df = eng.test if split == "test" else eng.train
    if installer_id:
        df = df[df.installer_id == installer_id]
    rows = demo_order(df.to_dict("records"))[: max(1, min(limit, 1000))]
    return [{"project_id": r["project_id"], "installer_id": r["installer_id"], "label": label(r), "inputs": row_inputs(r),
             "expert": row_design(r)} for r in rows]


def label(r: dict) -> str:
    home = [f"{r['annual_demand_kwh']:,.0f} kWh"]
    if r["has_ev"]:
        home.append("EV")
    if r["heating_type"] != "Unknown":
        home.append(f"{r['heating_type'].lower()} heating" if r["heating_type"] != "Heatpump" else "has heat pump")
    if r["has_solar"]:
        home.append("existing PV")
    d = row_design(r)
    kit = []
    if d["pv_kwp"]:
        kit.append(f"{d['pv_kwp']:.1f} kWp")
    kit.append(f"{d['battery_kwh']:g} kWh battery" if d["battery_kwh"] else "no battery")
    if d["heatpump_kw"]:
        kit.append(f"{d['heatpump_kw']:g} kW heat pump")
    if d["wallbox_kw"]:
        kit.append(f"{d['wallbox_kw']:g} kW wallbox")
    return f"{', '.join(home)}; expert: {', '.join(kit)}"


def demo_order(rows: list) -> list:
    """Varied first: round-robin over installer x kind of job, then the rest in split order."""
    def kind(r):
        if r["heatpump_kw"] > 0:
            return "heatpump"
        if r["has_ev"]:
            return "ev"
        if r["pv_kwp"] == 0:
            return "no_pv"
        if r["wallbox_kw"] > 0:
            return "wallbox"
        return "battery" if r["battery_kwh"] > 0 else "pv_only"
    order = ["battery", "heatpump", "ev", "pv_only", "wallbox", "no_pv"]
    buckets = {}
    odd = [r for r in rows if 0 < r["pv_kwp"] < 2]
    rows = [r for r in rows if not 0 < r["pv_kwp"] < 2]
    for r in rows:
        buckets.setdefault((kind(r), r["installer_id"]), []).append(r)
    keys = [(k, i) for k in order for i in data.INSTALLERS if (k, i) in buckets]
    out = []
    while any(buckets[k] for k in keys):
        for k in keys:
            if buckets[k]:
                out.append(buckets[k].pop(0))
    return out + odd


@app.get("/api/projects/{project_id}")
def project(project_id: str):
    eng = engine()
    for split, df in (("test", eng.test), ("train", eng.train)):
        m = df[df.project_id == project_id]
        if len(m):
            r = m.iloc[0].to_dict()
            inp = row_inputs(r)
            return {"project_id": project_id, "installer_id": r["installer_id"], "split": split, "inputs": inp,
                    "expert": row_design(r), "ours": eng.predict(inp)}
    return err(404, f"No project with id {project_id}")


_TILE_IDX: dict = {}
LARGE_FOOTPRINT_M2, LARGE_STOREYS, LARGE_HEIGHT_M = 300.0, 4, 12.0


def _geometry(r: dict, building=None, tile=None) -> dict:
    """The measured building (LoD2) the web trusts over a census class on conflict: footprint, storeys, height, and
    large_building when the geometry alone says it is not a single-family house."""
    fp, st, h = r.get("footprint_m2"), r.get("storeys"), None
    if building and tile:
        try:
            if tile not in _TILE_IDX:
                p = roofs.ROOT / "roof" / ".cache" / "lod2" / f"{tile}.v2.json"
                _TILE_IDX[tile] = {x["id"]: x.get("height") for x in json.loads(p.read_text())} if p.exists() else {}
            h = _TILE_IDX[tile].get(building)
        except Exception:
            h = None
    if not fp:
        return {"footprint_m2": None, "storeys": None, "height_m": None, "large_building": None, "source": None,
                "note": "no measured building"}
    large = bool(fp >= LARGE_FOOTPRINT_M2 or (st or 0) >= LARGE_STOREYS or (h or 0) >= LARGE_HEIGHT_M)
    return {"footprint_m2": fp, "storeys": st, "height_m": round(h, 1) if h else None, "large_building": large,
            "source": f"LoD2 building {building}" if building else (r.get("source") or "roof lookup"),
            "note": (f"large_building when footprint >= {LARGE_FOOTPRINT_M2:g} m2, storeys >= {LARGE_STOREYS} or height >= "
                     f"{LARGE_HEIGHT_M:g} m; measured geometry, so it outranks a census dwellings class")}


def _imagery(lat, lon, building=None, tile=None) -> dict:
    try:
        return imagery.block(lat, lon, building, tile)
    except Exception as e:
        return {"dop20_flown": None, "lod2_stand": None, "source_note": f"imagery dates unavailable: {e}"}


@app.get("/api/roof")
def roof(address: str = "", postcode: str = ""):
    if address.strip():
        r = roofs.lookup_or_pending(address)  # pending: true while a new 2 km tile downloads; poll again
        if isinstance(r, dict) and not r.get("pending"):
            b, tile = imagery.from_notes(r.get("notes"))
            r = {**r, "imagery": _imagery(r.get("lat"), r.get("lon"), b, tile), "geometry": _geometry(r, b, tile)}
        return r
    if postcode.strip():
        r = roofs.postcode_lookup(postcode)
        if isinstance(r, dict):
            r = {**r, "imagery": {"dop20_flown": None, "lod2_stand": None,
                                  "source_note": "No street given, so no orthophoto or LoD2 building to date."}}
        return r
    return err(422, "address or postcode is missing.")


@app.get("/api/roof/photo")
def roof_photo(address: str = ""):
    """v2.2: Street View of the house; the Google key stays on the server; 404 with Google's words when no imagery."""
    if not address.strip():
        return err(422, "address is missing.")
    try:
        img, msg = roofs.photo(address)
    except Exception as e:
        return err(502, f"Street View request failed: {e}")
    if img is None:
        return err(404, msg)
    from fastapi.responses import Response
    return Response(img, media_type="image/jpeg", headers={"Cache-Control": "public, max-age=86400"})


@app.get("/api/roof/model")
def roof_model(address: str = "", build_year: Optional[int] = None, kwp: Optional[float] = None):
    """v2.1: the planes of the actual house (LoD2, per-plane sun yield, panel layout) and a URL to its 3D model."""
    if not address.strip():
        return err(422, "address is missing.")
    try:
        info = roofs.model_info(address, build_year)
    except RuntimeError as e:
        return err(503, str(e))
    except Exception as e:
        return err(404, str(e))
    planes = {}
    if kwp:  # the same layout the design's economics run on (app/layout.py)
        from . import layout as L
        lo = L.layout({"address": address, "house_built_year": build_year}, kwp)
        planes = lo["planes"] if lo else {}
    p = info.get("planes_json_path")
    if not planes and p and Path(p).exists():
        planes = json.loads(Path(p).read_text())
    if isinstance(planes, dict) and planes.get("lat") is not None:
        planes["imagery"] = _imagery(planes.get("lat"), planes.get("lon"), planes.get("building"), planes.get("tile"))
    if isinstance(planes, dict) and planes.get("envelope"):
        from . import envelope_view
        envelope_view.enrich(planes["envelope"])
    return {**(planes if isinstance(planes, dict) else {"planes": planes}), "glb_url": roofs.model_url(address),
            "textured": info.get("textured"), "licence": info.get("licence"), "source": info.get("source")}


@app.get("/api/roof/model/file")
def roof_model_file(address: str = "", build_year: Optional[int] = None):
    if not address.strip():
        return err(422, "address is missing.")
    try:
        info = roofs.model_info(address, build_year)
    except RuntimeError as e:
        return err(503, str(e))
    g = info.get("glb_path")
    if not g or not Path(g).exists():
        return err(404, f"No 3D model file for {address}.")
    return FileResponse(g, media_type="model/gltf-binary", headers={"Cache-Control": "public, max-age=86400"})


class LayersReq(BaseModel):
    inputs: HomeInputs
    design: Optional[Design] = None
    lead_id: Optional[str] = None  # v2.6: tags facts from call steps as Rina's in the bars


@app.post("/api/explain/layers")
def explain_layers(req: LayersReq):
    """v2.3: the data behind the spatial demonstration (planes, one day, the night, the cost-to-value frontier)."""
    from . import layers
    inp = {**req.inputs.model_dump(), "_given": sorted(req.inputs.model_fields_set)}
    check_inputs(inp)
    out = layers.explain(engine(), inp, req.design.model_dump() if req.design else None)
    if req.lead_id:
        lead = leads.LEADS.get(req.lead_id) or next((l for l in leads.LEADS.values() if req.lead_id in l.get("aliases", [])), None)
        if lead:  # re-tag with the lead's history (cached bars carry form-level tags)
            out = {**out, **layers.bars(out, engine().predict(dict(inp), extras=False), inp, lead)}
    return out


class AskReq(BaseModel):
    inputs: HomeInputs
    unknown: Optional[list[str]] = None  # fields the lead did not state; only these are asked


@app.post("/api/ask")
def ask(req: AskReq):
    inp = {**req.inputs.model_dump(), "_given": sorted(req.inputs.model_fields_set)}
    check_inputs(inp)
    return {"questions": engine().ask(inp, req.unknown)}


@app.get("/api/inbox")
def inbox(limit: int = 20):
    engine()
    if STATE.get("inbox") is None:
        warm_inbox()
    if STATE.get("inbox") is None:
        return err(503, "The inbox could not be built; see the engine log.")
    return STATE["inbox"][: max(1, min(limit, INBOX_MAX))]


# ---------- v1.9: the engine runs the call ----------

leads.KNOWN.update(HomeInputs.model_fields)


class LeadReq(BaseModel):
    customer_name: str = ""
    address_or_postcode: str = ""
    installer_id: Optional[Literal["2a8ba8e2", "23c108b7"]] = None
    facts: Optional[dict] = None
    source: Literal["form", "call"] = "form"
    test: bool = False  # scratch lead from an agent: hidden from GET /api/leads unless include_test=1
    phone: Optional[str] = None  # v2.14: the homeowner's mobile (E.164); the WhatsApp copilot never messages a lead without one


class StepReq(BaseModel):
    lead_id: str
    facts_so_far: Optional[dict] = None   # v1.9: voice intake names, latest value per field
    answers: Union[dict, list, None] = None  # older shape: HomeInputs fields or [{field, value}]
    note: Optional[str] = None
    base_version: Optional[int] = None
    phone: Optional[str] = None  # v2.14: the homeowner's mobile (E.164), stored on the lead
    source: Optional[Literal["whatsapp", "call", "form", "planner"]] = None  # v2.14: where the stated facts came from (chips show "via WhatsApp")
    overrides: Optional[dict] = None  # v2.13: the planner's kit choices (as /api/refine), stored on the lead; {} clears them


def _slots(v) -> list:
    """layout_slots: the slot ids the planner chose on the roof (from /api/explain/layers planes[].slots), stored as given."""
    if not isinstance(v, list) or len(v) > 2000 or not all(isinstance(x, str) and 0 < len(x) <= 64 for x in v):
        raise InputError("layout_slots must be a list of slot id strings (at most 2,000).")
    return list(v)


def _clean_overrides(raw: dict) -> dict:
    """Validate kit overrides exactly as /api/refine does; raises InputError (422) on a bad key or value."""
    raw = dict(raw)
    slots = _slots(raw.pop("layout_slots")) if "layout_slots" in raw else None
    bad = [k for k in raw if k not in FIELDS]
    if bad:
        raise InputError(f"Unknown override field: {', '.join(bad)}. Allowed: {', '.join(FIELDS)}.")
    nonnum = [k for k, v in raw.items() if v is not None and v != "include" and not (isinstance(v, (int, float)) and not isinstance(v, bool))]
    if nonnum:
        raise InputError(f"Override {', '.join(nonnum)} must be a number, null or \"include\".")
    ov = {k: v for k, v in raw.items() if not (k == "inverter_kw" and v == "include")}
    check_design({k: v for k, v in ov.items() if v != "include"}, "overrides")
    if slots is not None:
        ov["layout_slots"] = slots
    return ov


def _facts(raw: dict, block: bool = True) -> dict:
    """Validate merged facts as HomeInputs; returns inputs with _given (fields actually known).
    block=False never waits on a cold roof or postcode lookup: it starts one and drafts without the roof."""
    if not block and not raw.get("roof"):
        if raw.get("address"):
            r = roofs.cached(raw["address"])
        elif raw.get("postcode"):
            r = roofs.cached_postcode(raw["postcode"])
        else:
            r = None
        if r and r.get("source") != "none":
            raw = {**raw, "roof": r}
        elif r is None:
            raw = {k: v for k, v in raw.items() if k not in ("address", "postcode")} | {"_place": raw.get("address") or raw.get("postcode")}
    try:
        h = HomeInputs(**{k: v for k, v in raw.items() if not k.startswith("_")})
    except Exception as e:
        errs = getattr(e, "errors", lambda: [])()
        msg = " ".join(f"{'.'.join(str(x) for x in er.get('loc', []))}: {er.get('msg')}." for er in errs) or str(e)
        raise InputError(msg)
    inp = {**h.model_dump(), "_given": sorted(set(raw.get("_given") or []) | h.model_fields_set)}
    check_inputs(inp)
    if raw.get("_place"):  # keep the place for the next step, when the roof will be cached
        inp["address" if not leads.PC.match(raw["_place"]) else "postcode"] = raw["_place"]
        inp["roof"] = None
    return inp


def _question(eng, inp: dict, unknown: list):
    if not unknown:
        return None, 0.0
    qs = [q for q in eng.ask(inp, unknown) if q["spread"] >= 1.0]  # below 1 the answer stays inside tolerance
    if not qs:
        return None, 0.0
    q = qs[0]
    text, why = leads.QUESTION.get(q["field"], (q["field"], ""))
    base = eng.sizes_batch([inp])[0]
    return {"field": q["field"], "question": text, "why": why,
            "options": [{"value": o["value"], "label": o["label"]} for o in q["options"]],
            "expected_swing": leads.swing_text(base, q["options"])}, q["spread"]


def _public(inp: dict) -> dict:
    return {k: v for k, v in inp.items() if not k.startswith("_") and k != "roof"}


def _full_draft_later(lead_id: str, inp: dict):
    """The draft was made with /api/design's pipeline. When the roof was not cached yet (a call never waits on it), the roof
    is fetched here and the lead redrafted with it, so the lead matches /api/design for the same facts."""
    if inp.get("roof") or not (inp.get("address") or inp.get("postcode")):
        lead = leads.LEADS.get(lead_id)
        if lead:
            lead["draft_stamp"] = engine_stamp()
            leads.save(lead)
        return

    def run():
        try:
            full = _facts({k: v for k, v in inp.items() if k != "roof"}, block=True)
            d = engine().predict(dict(full))
            lead = leads.LEADS.get(lead_id)
            if lead and lead.get("inputs") is inp:  # no newer step has replaced the inputs meanwhile
                lead.update(inputs=full, draft=d, draft_stamp=engine_stamp())
                leads.save(lead)
        except Exception:
            log.exception("roof redraft failed")
    threading.Thread(target=run, daemon=True).start()


def _key_ok(key: Optional[str]) -> bool:
    want = os.environ.get("INTAKE_SECRET")
    return bool(want) and key == want


_RATE: dict = {}


def _rate_ok(ip: str, per_min: int = 20) -> bool:
    t = time.time()
    q = [x for x in _RATE.get(ip, []) if t - x < 60]
    if len(q) >= per_min:
        _RATE[ip] = q
        return False
    _RATE[ip] = q + [t]
    return True


def _snapshot(lead: dict) -> dict:
    """What a rehearsal resets to: the facts as the lead was created (roof and envelope are refetched on reset)."""
    inp = {k: v for k, v in lead["inputs"].items() if k not in ("roof", "envelope")}
    return {"inputs": json.loads(json.dumps(inp, default=float)), "status": lead["status"], "at": lead.get("created_at")}


def snapshot_untouched():
    """Leads made before snapshots existed get one only if no step has changed them yet."""
    for lead in leads.LEADS.values():
        if "initial" not in lead and not lead.get("history") and not lead.get("decision"):
            lead["initial"] = _snapshot(lead)
            leads.save(lead)


def _new_lead(eng, raw: dict, name: str, place: str, source: str, block: bool, lead_id: Optional[str] = None) -> dict:
    inp = _facts(raw, block=block)
    unknown = [c for c in leads.CANDIDATES if c not in inp["_given"]]
    draft = eng.predict(dict(inp))  # the one pipeline: exactly what /api/design returns for these inputs
    nq, spread = _question(eng, inp, unknown)
    t = leads.now()
    lead = {"lead_id": lead_id or leads.new_id(), "status": "draft" if source == "form" else "in_call", "source": source,
            "customer_name": name, "address_or_postcode": place, "inputs": inp, "unknown": unknown, "draft": draft,
            "history": [], "next_question": nq, "next_spread": spread, "questions_asked": 0, "created_at": t, "updated_at": t,
            "aliases": []}
    lead["initial"] = _snapshot(lead)
    leads.LEADS[lead["lead_id"]] = lead
    leads.save(lead)
    _full_draft_later(lead["lead_id"], inp)
    return lead


@app.post("/api/leads")
def create_lead(req: LeadReq, request: Request, x_intake_secret: Optional[str] = Header(None)):
    eng = engine()
    if not _key_ok(x_intake_secret) and not _rate_ok(request.client.host if request.client else "?"):
        return err(429, "Too many new leads from this address; try again in a minute.")
    mapped, meta = leads.map_intake(req.facts or {})
    raw = {"installer_id": req.installer_id or mapped.get("installer_id") or "2a8ba8e2",
           **leads.where(req.address_or_postcode), **mapped}
    raw["_given"] = [k for k in raw if k != "installer_id"] + (["installer_id"] if req.installer_id else [])
    lead = _new_lead(eng, raw, req.customer_name, req.address_or_postcode, req.source, block=False)
    if req.phone:
        if not wa.e164(req.phone):
            return err(422, f"phone {req.phone!r} is not a phone number (E.164, 8 to 15 digits).")
        lead["phone"] = wa.e164(req.phone)
    if req.test:
        lead["test"] = True
    if req.phone or req.test:
        leads.save(lead)
    if meta:
        lead["meta"] = meta
    return {"version": int(lead.get("version") or 0), "lead_id": lead["lead_id"], "draft": lead["draft"], "facts": _public(lead["inputs"]), "unknown": lead["unknown"],
            "next_question": lead["next_question"]}


@app.post("/api/intake/step")
def intake_step(req: StepReq, x_intake_secret: Optional[str] = Header(None)):
    if not _key_ok(x_intake_secret):
        return err(401, "Missing or wrong X-Intake-Secret header.")
    eng = engine()
    ctx = leads.REQUEST.get()
    if ctx is not None:  # the pinned-lead log shows which path sent the step (sentence box, Listening or the voice call)
        ctx["step_body"] = {"facts_so_far": req.facts_so_far, "answers": req.answers, "note": req.note}
        ctx["path_guess"] = ("call (ev word or customer facts)" if isinstance(req.facts_so_far, dict) and
                             ({"ev", "customer_name", "address", "heating_age", "monthly_bill_eur"} & set(req.facts_so_far))
                             else "sentence (HomeInputs fields)" if req.facts_so_far or req.answers else None)
    dropped: list = []  # the call never fails on one bad value: it is skipped and named here
    if req.facts_so_far is not None:
        ans, meta = leads.map_intake(req.facts_so_far, dropped)
    else:
        ans, meta = leads.normalise(req.answers or {}, dropped), {}
    for k in [k for k in ans if k not in HomeInputs.model_fields]:
        dropped.append({"field": k, "value": ans.pop(k), "reason": "not a field the engine uses"})
    for k in list(ans):  # per-field validation: drop what HomeInputs rejects or check_inputs would refuse
        try:
            HomeInputs(**{"installer_id": "2a8ba8e2", k: ans[k]})
            lo_hi = RANGES.get(k)
            if lo_hi and ans[k] is not None and not (lo_hi[0] <= ans[k] <= lo_hi[1]):
                raise ValueError(f"must be between {lo_hi[0]:,} and {lo_hi[1]:,}")
        except Exception as e:
            msg = e.errors()[0]["msg"] if hasattr(e, "errors") else str(e)
            dropped.append({"field": k, "value": ans.pop(k), "reason": msg})
    lead = leads.LEADS.get(req.lead_id) or next((l for l in leads.LEADS.values() if req.lead_id in l.get("aliases", [])), None)
    stale = _stale(lead, req.base_version)
    if stale is not None:
        return stale
    if req.phone is not None:
        if not wa.e164(req.phone):
            return err(422, f"phone {req.phone!r} is not a phone number (E.164, 8 to 15 digits).")
        if lead and lead.get("phone") != wa.e164(req.phone):
            lead["phone"] = wa.e164(req.phone)
            leads.save(lead)
        if lead and req.facts_so_far is None and not req.answers and req.overrides is None:  # phone only: no redraft
            return {"version": int(lead.get("version") or 0), "phone": lead["phone"], "status": lead["status"]}
    if req.overrides is not None:  # a kit edit on the Proposed Design card: kept on the lead so a reload shows it
        ov = _clean_overrides(req.overrides)
        if not lead:
            return err(404, f"No lead {req.lead_id}: overrides need an existing lead.")
        if ov != (lead.get("overrides") or {}):
            if ov:
                lead["overrides"] = ov
            else:
                lead.pop("overrides", None)
            if lead.get("status") in ("approved", "sent", "signed"):  # the design on screen moved after release: release it again
                lead["status"], lead["approved_at"] = "done", None
                lead.pop("approved", None)
                lead.pop("sent", None)
            lead["updated_at"] = leads.now()
            leads.save(lead)
        if req.facts_so_far is None and not req.answers:  # overrides only: no redraft, no history step
            return {"version": int(lead.get("version") or 0), "overrides": lead.get("overrides") or {}, "status": lead["status"]}
    if not lead:  # upsert: link to the homeowner page's lead by name and place, else start one from what is known
        name = meta.get("customer_name") or ""
        place = ans.get("address") or ans.get("postcode") or ""
        lead = leads.find_linked(name, place)
        if lead:
            lead.setdefault("aliases", []).append(req.lead_id)
        else:
            raw = {"installer_id": ans.get("installer_id") or "2a8ba8e2", **ans}
            raw["_given"] = [k for k in ans]
            lead = _new_lead(eng, raw, name, place, "call", block=False, lead_id=req.lead_id)
            if req.phone:
                lead["phone"] = wa.e164(req.phone)
            lead["meta"] = meta
            lead["history"].append({"step": 0, "field": None, "answer": ans, "changed": [], "note": "call started", "at": lead["created_at"]})
            leads.save(lead)
            return {"version": int(lead.get("version") or 0), "design": lead["draft"]["design"], "draft": lead["draft"], "changed": [], "next_question": lead["next_question"],
                    "done": lead["next_question"] is None, "step": 0, "dropped": dropped}
    if meta:
        lead.setdefault("meta", {}).update(meta)
    if req.source:
        for k in ans:
            if lead["inputs"].get(k) != ans[k] or k not in (lead["inputs"].get("_given") or []):
                lead.setdefault("fact_sources", {})[k] = req.source
    # only fields that are new or changed count as this step's answer
    ans = {k: v for k, v in ans.items() if lead["inputs"].get(k) != v or k not in (lead["inputs"].get("_given") or [])}
    asked = (lead.get("next_question") or {}).get("field")
    raw = {**lead["inputs"], **ans, "_given": sorted(set(lead["inputs"].get("_given", [])) | set(ans))}
    if ans.get("has_ev") is True and not ans.get("ev_annual_km") and not raw.get("ev_annual_km"):
        raw["ev_annual_km"] = 12000.0
    raw.pop("roof", None) if ("address" in ans or "postcode" in ans or not raw.get("roof")) else None
    inp = _facts(raw, block=False)
    before = lead["draft"]["design"]
    draft = eng.predict(dict(inp))  # the one pipeline: exactly what /api/design returns for these inputs
    unknown = [c for c in lead["unknown"] if c not in ans]
    nq, spread = _question(eng, inp, unknown)
    changed = []
    for k, comp in FIELDS.items():
        a, b = before.get(k), draft["design"].get(k)
        if a != b:
            why = draft["components"][comp]["reason"] if comp in draft["components"] else "Follows the PV size."
            changed.append({"component": comp, "from": a, "to": b, "why": why})
    step = lead["questions_asked"] + 1
    t = leads.now()
    field_asked = asked if asked in ans else (next(iter(ans)) if ans else None)
    was_done = lead.get("status") in ("done", "approved", "sent", "signed", "declined", "question")  # refinement after the call
    prev_status = lead.get("status")
    lead.update(inputs=inp, unknown=unknown, draft=draft, next_question=nq, questions_asked=step, updated_at=t,
                status="done" if (nq is None or was_done) else "in_call")
    route = ((leads.REQUEST.get() or {}).get("client_route") or "").lower()
    if lead["status"] == "in_call" and prev_status != "in_call" and ("sentence" in route or "hand" in route or req.source == "whatsapp"):
        lead["status"] = prev_status or "draft"  # a planner's edit is not a call: only Rina's steps open "On a call"
    if prev_status in ("approved", "sent", "signed", "declined", "question") and not changed:
        lead["status"] = prev_status  # nothing moved: the approval and any decision stand
    elif prev_status in ("approved", "sent", "signed") and changed:
        lead["approved_at"] = None  # the design changed after the planner released it: release it again
        lead.pop("approved", None)
        lead.pop("sent", None)
    if not lead.get("customer_name") and meta.get("customer_name"):
        lead["customer_name"] = meta["customer_name"]
    if not lead.get("address_or_postcode") and (ans.get("address") or ans.get("postcode")):
        lead["address_or_postcode"] = ans.get("address") or ans.get("postcode")
    lead["history"].append({"step": step, "field": field_asked, "answer": {k: ans[k] for k in ans}, "changed": changed,
                            "note": req.note, "at": t})
    swing = lead.get("next_spread", 0.0) if field_asked == asked else 0.0
    lead["next_spread"] = spread
    leads.save(lead)
    leads.log_step({"lead_id": lead["lead_id"], "step": step, "field_asked": field_asked, "answer": ans, "swing": swing, "at": t})
    if field_asked:
        model_mod.PRIORS.update({o["field"]: o["mean_swing"] for o in leads.priors()["order"]})
    _full_draft_later(lead["lead_id"], inp)
    return {"version": int(lead.get("version") or 0), "design": draft["design"], "draft": draft, "changed": changed, "next_question": nq, "done": nq is None, "step": step,
            "dropped": dropped}


_STAMP: dict = {}


def engine_stamp() -> str:
    """Changes whenever a design could change: model cache key, rules, hourly physics, roof model code, live recommender."""
    if "v" not in _STAMP:
        h = hashlib.sha256(cache_key().encode())
        here = Path(__file__).parent
        for f in sorted(list((here / "planner_rules").glob("*.py")) + list((here / "planner_rules").glob("*.json"))
                        + list((here / "hourly").glob("*.py")) + list((roofs.ROOT / "roof" / "model").glob("*.py"))):
            h.update(f.read_bytes())
        h.update(model_mod.RECOMMENDER["mode"].encode())
        _STAMP["v"] = h.hexdigest()[:12]
    return _STAMP["v"]


def refresh_lead(lead: dict) -> dict:
    """A draft made by an earlier engine is recomputed (same pipeline, with the roof) before it is shown, and saved."""
    if lead.get("draft_stamp") == engine_stamp() or STATE.get("engine") is None:
        return lead
    if lead.get("decision") or lead.get("status") in ("approved", "sent", "signed", "declined", "question"):
        return lead  # the homeowner saw or answered this proposal: its numbers and hash stay as released
    try:
        lead["draft"] = engine().predict(dict(lead["inputs"]))
        lead["draft_stamp"] = engine_stamp()
        leads.save(lead)
    except Exception as e:
        log.warning("lead %s refresh failed: %s", lead.get("lead_id"), e)
    return lead


def refresh_all_leads():
    for lead in list(leads.LEADS.values()):
        refresh_lead(lead)


def proposal_of(lead: dict, variant: Optional[str] = None) -> tuple[dict, str, float]:
    """(design, variant key, investment) of what the homeowner is offered: the approved variant, else the planners' design."""
    ap = lead.get("approved")
    if ap and variant in (None, ap.get("variant")):  # what the planner released, exactly as selected
        return {k: ap["design"].get(k) for k in model_mod.SIZES}, ap["variant"], float(ap.get("investment_eur") or 0)
    key = variant or lead.get("approved_variant") or "expert"
    draft = lead.get("draft") or {}
    v = next((x for x in draft.get("variants") or [] if x.get("key") == key), None)
    d = (v or {}).get("design") or draft.get("design") or {}
    capex = ((v or {}).get("economics") or draft.get("economics") or {}).get("capex_eur") or 0.0
    return {k: d.get(k) for k in ("pv_kwp", "inverter_kw", "battery_kwh", "heatpump_kw", "wallbox_kw")}, (key if v or key == "expert" else "expert"), float(capex)


def proposal_hash(design: dict, variant: str, investment: float) -> str:
    return model_mod.proposal_hash(design, variant, investment)


def current_hash(lead: dict) -> str:
    return proposal_hash(*proposal_of(lead))


def _stale(lead: dict, base_version) -> Optional[JSONResponse]:
    """409 with the current lead when the client edited an older version; None (go ahead) when no base_version was sent."""
    if base_version is None or lead is None or int(base_version) >= int(lead.get("version") or 0):
        return None
    return JSONResponse(status_code=409, content=jsonable_encoder({
        "error": f"This lead changed since you loaded it (your version {base_version}, now {lead.get('version')}). Reload and try again.",
        "version": lead.get("version"), "lead": _lead_out(lead)}))


def _sources(lead: dict) -> dict:
    """Per public fact: "whatsapp" when the homeowner stated it there, "stated" when given any other way, else "estimated"."""
    inp, fs = lead.get("inputs") or {}, lead.get("fact_sources") or {}
    given = set(((lead.get("initial") or {}).get("inputs") or {}).get("_given") or []) | set(fs)
    for h in lead.get("history") or []:
        if isinstance(h.get("answer"), dict):
            given |= set(h["answer"])
    if not lead.get("initial"):
        given |= set(inp.get("_given") or [])
    return {k: ("whatsapp" if fs.get(k) == "whatsapp" else "stated" if k in given else "estimated") for k in _public(inp)}


STATUS_LABEL = {"draft": "Draft", "in_call": "On a call", "done": "Ready", "approved": "Complete", "sent": "Sent", "signed": "Signed",
                "declined": "Declined", "question": "Question", "ended": "Ended"}


def _lead_out(lead: dict) -> dict:
    dec = lead.get("decision")
    if dec:
        dec = {**dec, "matches_current": dec.get("proposal_hash") == current_hash(lead)}
    return {"lead_id": lead["lead_id"], "version": int(lead.get("version") or 0), "status": lead["status"],
            "customer_name": lead["customer_name"], "approved_at": lead.get("approved_at"), "approved_variant": lead.get("approved_variant"),
            "proposal_hash": current_hash(lead), "decision": dec, "approved": lead.get("approved"), "overrides": lead.get("overrides") or {},
            "status_label": STATUS_LABEL.get(lead["status"], lead["status"]), "sent": lead.get("sent"), "phone": lead.get("phone"),
            "whatsapp": wa.public(lead), "fact_sources": lead.get("fact_sources") or {}, "sources": _sources(lead),
            "address_or_postcode": lead["address_or_postcode"], "facts": _public(lead["inputs"]), "draft": lead["draft"],
            "history": lead["history"], "next_question": lead["next_question"], "questions_asked": lead["questions_asked"], "pinned": bool(lead.get("pinned")),
            "created_at": lead["created_at"], "updated_at": lead["updated_at"]}


@app.get("/api/leads/{lead_id}")
def get_lead(lead_id: str, x_intake_secret: Optional[str] = Header(None)):
    if not _key_ok(x_intake_secret):
        return err(401, "Missing or wrong X-Intake-Secret header.")
    leads.expire_stale()
    lead = leads.LEADS.get(lead_id) or next((l for l in leads.LEADS.values() if lead_id in l.get("aliases", [])), None)
    if not lead:
        return err(404, f"No lead with id {lead_id}")
    return _lead_out(refresh_lead(lead))


@app.delete("/api/leads/{lead_id}")
def delete_lead(lead_id: str, force: bool = False, x_intake_secret: Optional[str] = Header(None)):
    if not _key_ok(x_intake_secret):
        return err(401, "Missing or wrong X-Intake-Secret header.")
    lead = leads.LEADS.get(lead_id) or next((l for l in leads.LEADS.values() if lead_id in l.get("aliases", [])), None)
    if not lead:
        return err(404, f"No lead with id {lead_id}")
    if lead.get("pinned") and not force:
        return err(409, "This lead is pinned (the demo lead). Unpin it first, or pass force=true.")
    leads.delete(lead["lead_id"])
    return {"deleted": lead["lead_id"]}


class PinReq(BaseModel):
    pinned: bool = True


@app.put("/api/leads/{lead_id}/pin")
def pin_lead(lead_id: str, req: Optional[PinReq] = None, x_intake_secret: Optional[str] = Header(None)):
    """A pinned lead (the demo lead) is never removed by a cleanup; DELETE refuses it without force=true."""
    if not _key_ok(x_intake_secret):
        return err(401, "Missing or wrong X-Intake-Secret header.")
    lead = leads.LEADS.get(lead_id) or next((l for l in leads.LEADS.values() if lead_id in l.get("aliases", [])), None)
    if not lead:
        return err(404, f"No lead with id {lead_id}")
    lead["pinned"] = req.pinned if req else True
    leads.save(lead)
    return {"version": int(lead.get("version") or 0), "lead_id": lead["lead_id"], "pinned": lead["pinned"]}


DEMO_KEYS = ("status", "inputs", "draft", "draft_stamp", "unknown", "next_question", "next_spread", "questions_asked", "history", "decision",
             "approved", "approved_at", "approved_variant", "approved_hash", "overrides", "sent", "meta", "fact_sources", "whatsapp")


class DemoStateReq(BaseModel):
    decided_at: Optional[str] = None  # ISO time shown for a stored decision (e.g. Lindner declined at 08:15 Munich)
    clear: bool = False                # true: forget the demo state, reset goes back to creation again


@app.put("/api/leads/{lead_id}/demo-state")
def set_demo_state(lead_id: str, req: Optional[DemoStateReq] = None, x_intake_secret: Optional[str] = Header(None)):
    """Store the lead as it is now as its demo state: reset (and reset-pinned) brings it back to exactly this."""
    if not _key_ok(x_intake_secret):
        return err(401, "Missing or wrong X-Intake-Secret header.")
    req = req or DemoStateReq()
    lead = _find_lead(lead_id)
    if not lead:
        return err(404, f"No lead with id {lead_id}")
    if req.clear:
        lead.pop("demo_state", None)
    else:
        if req.decided_at and lead.get("decision"):
            lead["decision"]["decided_at"] = req.decided_at
        lead["demo_state"] = json.loads(json.dumps({k: lead[k] for k in DEMO_KEYS if k in lead}, default=float))
    leads.save(lead)
    return {"version": int(lead.get("version") or 0), "lead_id": lead["lead_id"], "demo_state": bool(lead.get("demo_state")),
            "status": (lead.get("demo_state") or {}).get("status"), "decided_at": ((lead.get("demo_state") or {}).get("decision") or {}).get("decided_at")}


@app.put("/api/leads/{lead_id}/reset")
def reset_lead(lead_id: str, x_intake_secret: Optional[str] = Header(None)):
    """Rehearsal reset: facts back to the creation snapshot, redrafted with the one pipeline; steps, approval and any
    decision (and its signature) and kit overrides are dropped. Pinned and aliases stay; version still goes up (409 guard)."""
    if not _key_ok(x_intake_secret):
        return err(401, "Missing or wrong X-Intake-Secret header.")
    lead = leads.LEADS.get(lead_id) or next((l for l in leads.LEADS.values() if lead_id in l.get("aliases", [])), None)
    if not lead:
        return err(404, f"No lead with id {lead_id}")
    if lead.get("demo_state"):  # a pinned demo lead goes back to its demo state (Declined stays Declined), not to creation
        demo = json.loads(json.dumps(lead["demo_state"]))
        for k in DEMO_KEYS:
            if k in demo:
                lead[k] = demo[k]
            else:
                lead.pop(k, None)
        if not lead.get("decision"):
            (SIG_DIR / f"{lead['lead_id']}.png").unlink(missing_ok=True)
        lead["updated_at"] = leads.now()
        leads.save(lead)
        return {"version": int(lead.get("version") or 0), "lead_id": lead["lead_id"], "status": lead["status"], "design": lead["draft"]["design"],
                "reset_to": "demo state", "pinned": bool(lead.get("pinned"))}
    snap = lead.get("initial")
    if not snap:
        return err(409, "This lead has no creation snapshot (it was changed before snapshots existed); delete and recreate it.")
    eng = engine()
    inp = _facts(dict(snap["inputs"]), block=True)
    draft = eng.predict(dict(inp))
    unknown = [c for c in leads.CANDIDATES if c not in inp["_given"]]
    nq, spread = _question(eng, inp, unknown)
    for k in ("decision", "approved_at", "approved_variant", "approved_hash", "approved", "overrides", "sent", "fact_sources"):  # kit edits go too
        lead.pop(k, None)
    (SIG_DIR / f"{lead['lead_id']}.png").unlink(missing_ok=True)
    lead.update(inputs=inp, draft=draft, unknown=unknown, next_question=nq, next_spread=spread, questions_asked=0, history=[],
                status=snap.get("status") or "draft", updated_at=leads.now(), draft_stamp=engine_stamp())
    leads.save(lead)
    return {"version": int(lead.get("version") or 0), "lead_id": lead["lead_id"], "status": lead["status"], "design": draft["design"], "reset_to": snap.get("at"),
            "pinned": bool(lead.get("pinned"))}


DEMO_PHONE = "+6586936789"


def _wa_order(lead: dict) -> list:
    """Facts missing or estimated on the lead, the one that moves the design most first (the next-question ranking)."""
    inp = dict(lead["inputs"])
    unknown = [c for c in (lead.get("unknown") or []) if c in leads.CANDIDATES]  # the step keeps this list exact
    try:
        ranked = sorted(engine().ask(inp, unknown), key=lambda q: -q.get("spread", 0))
        order = [q["field"] for q in ranked]
    except Exception:
        log.exception("whatsapp order")
        order = []
    return order + [f for f in unknown if f not in order]


def _wa_step(lead_id: str, facts: dict) -> dict:
    out = intake_step(StepReq(lead_id=lead_id, facts_so_far=facts, source="whatsapp"), os.environ.get("INTAKE_SECRET"))
    if isinstance(out, JSONResponse):
        raise RuntimeError(json.loads(out.body).get("error") or f"intake step answered {out.status_code}")
    return out


def _find_lead(lead_id: str):
    return leads.LEADS.get(lead_id) or next((l for l in leads.LEADS.values() if lead_id in l.get("aliases", [])), None)


class PhoneReq(BaseModel):
    phone: Optional[str] = None  # null removes it
    base_version: Optional[int] = None


@app.put("/api/leads/{lead_id}/phone")
def set_phone(lead_id: str, req: PhoneReq, x_intake_secret: Optional[str] = Header(None)):
    if not _key_ok(x_intake_secret):
        return err(401, "Missing or wrong X-Intake-Secret header.")
    lead = _find_lead(lead_id)
    if not lead:
        return err(404, f"No lead with id {lead_id}")
    stale = _stale(lead, req.base_version)
    if stale is not None:
        return stale
    if req.phone and not wa.e164(req.phone):
        return err(422, f"phone {req.phone!r} is not a phone number (E.164, 8 to 15 digits).")
    if req.phone:
        lead["phone"] = wa.e164(req.phone)
    else:
        lead.pop("phone", None)
    lead["updated_at"] = leads.now()
    leads.save(lead)
    return {"version": int(lead.get("version") or 0), "phone": lead.get("phone")}


class WaAskReq(BaseModel):
    facts: Optional[list[str]] = None  # ask about these fields; default: missing or estimated facts by design impact
    base_version: Optional[int] = None
    dry: bool = False  # compose and log as kind "dry", send nothing


@app.post("/api/leads/{lead_id}/whatsapp/ask")
def whatsapp_ask(lead_id: str, req: Optional[WaAskReq] = None, dry: bool = False, x_intake_secret: Optional[str] = Header(None)):
    if not _key_ok(x_intake_secret):
        return err(401, "Missing or wrong X-Intake-Secret header.")
    req = req or WaAskReq()
    lead = _find_lead(lead_id)
    if not lead:
        return err(404, f"No lead with id {lead_id}")
    stale = _stale(lead, req.base_version)
    if stale is not None:
        return stale
    bad = [f for f in (req.facts or []) if f not in wa.ASK]
    if bad:
        return err(422, f"Cannot ask about {', '.join(bad)}. Askable: {', '.join(wa.ASK)}.")
    try:
        out = wa.ask(lead, req.facts, dry=req.dry or dry)
    except wa.ConversationError as e:
        return err(e.code, str(e))
    return {**out, "version": int(lead.get("version") or 0), "whatsapp": wa.public(lead)}


class SendReq(BaseModel):
    channel: Literal["whatsapp", "copy"]
    base_version: Optional[int] = None
    dry: bool = False  # compose and log as kind "dry", send nothing, status unchanged


@app.post("/api/leads/{lead_id}/send")
def send_proposal(lead_id: str, req: SendReq, dry: bool = False, x_intake_secret: Optional[str] = Header(None)):
    if not _key_ok(x_intake_secret):
        return err(401, "Missing or wrong X-Intake-Secret header.")
    lead = _find_lead(lead_id)
    if not lead:
        return err(404, f"No lead with id {lead_id}")
    stale = _stale(lead, req.base_version)
    if stale is not None:
        return stale
    if req.dry or dry:
        try:
            out = wa.send_proposal(lead, req.channel, dry=True)
        except wa.ConversationError as e:
            return err(e.code, str(e))
        return {"version": int(lead.get("version") or 0), "status": lead["status"], "status_label": STATUS_LABEL.get(lead["status"], lead["status"]),
                "dry": True, "sent": out, "whatsapp": wa.public(lead)}
    if lead.get("status") not in ("approved", "sent"):
        return err(409, "Complete the design before sending the proposal.")
    try:
        sent = wa.send_proposal(lead, req.channel)
    except wa.ConversationError as e:
        return err(e.code, str(e))
    return {"version": int(lead.get("version") or 0), "status": lead["status"], "status_label": STATUS_LABEL["sent"], "sent": sent}


@app.get("/api/leads")
def list_leads(limit: int = 20, include_test: bool = False, x_intake_secret: Optional[str] = Header(None)):
    if not _key_ok(x_intake_secret):
        return err(401, "Missing or wrong X-Intake-Secret header.")
    leads.expire_stale()
    rows = sorted((l for l in leads.LEADS.values() if include_test or not l.get("test")), key=lambda l: l["updated_at"],
                  reverse=True)[: max(1, min(limit, 200))]
    for l in rows:
        refresh_lead(l)
    out = []
    for l in rows:
        dec = l.get("decision")
        if dec:
            dec = {**dec, "matches_current": dec.get("proposal_hash") == current_hash(l)}
        out.append({"lead_id": l["lead_id"], "status": l["status"], "status_label": STATUS_LABEL.get(l["status"], l["status"]), "whatsapp_state": (l.get("whatsapp") or {}).get("state", "none"), "title": leads.title(l), "customer_name": l["customer_name"],
                    "address_or_postcode": l["address_or_postcode"], "questions_asked": l["questions_asked"],
                    "approved_at": l.get("approved_at"), "decision": dec, "created_at": l.get("created_at"), "updated_at": l["updated_at"],
                    "pinned": bool(l.get("pinned")), "test": bool(l.get("test"))})
    return out


class ApproveReq(BaseModel):
    variant: Optional[Literal["expert", "value", "payback", "independence", "upfront", "edit"]] = None
    design_hash: Optional[str] = None     # the design_hash of the design the planner saw (draft, variant or refine)
    overrides: Optional[dict] = None      # with variant "edit": the planner's own changes (as /api/refine)
    design: Optional[dict] = None         # the design shown (the five sizes); a hand edit is approved exactly as this
    base_version: Optional[int] = None


def _approve_conflict(lead: dict, msg: str) -> JSONResponse:
    return JSONResponse(status_code=409, content=jsonable_encoder({"error": msg, "version": lead.get("version"), "lead": _lead_out(lead)}))


@app.put("/api/leads/{lead_id}/approve")
def approve_lead(lead_id: str, req: Optional[ApproveReq] = None, x_intake_secret: Optional[str] = Header(None)):
    """The planner releases the proposal: status approved, so the homeowner page can show it and take a decision."""
    if not _key_ok(x_intake_secret):
        return err(401, "Missing or wrong X-Intake-Secret header.")
    lead = leads.LEADS.get(lead_id) or next((l for l in leads.LEADS.values() if lead_id in l.get("aliases", [])), None)
    if not lead:
        return err(404, f"No lead with id {lead_id}")
    stale = _stale(lead, req.base_version if req else None)
    if stale is not None:
        return stale
    refresh_lead(lead)
    if not req or not (req.design_hash or req.design):
        return _approve_conflict(lead, "Approval needs the design you saw: its design_hash, or the design itself.")
    variant, draft = req.variant or ("edit" if req.design else None), lead.get("draft") or {}
    if not variant:
        return _approve_conflict(lead, "Approval needs the selected variant.")
    shown = {k: (req.design or {}).get(k) or None for k in model_mod.SIZES} if req.design else None
    if variant == "edit":
        ov = {k: v for k, v in (req.overrides or {}).items() if k in FIELDS}
        if not ov and shown:  # the hand edit as shown: every size fixed, none re-sized
            ov = {k: (shown[k] if shown[k] is not None else None) for k in model_mod.SIZES}
        if not ov:
            return _approve_conflict(lead, "An edited design needs the overrides it was made with.")
        sel = engine().predict(dict(lead["inputs"]), ov)
        sel = {"design": sel["design"], "economics": sel["economics"]}
    elif variant == "expert":
        sel = {"design": draft.get("design") or {}, "economics": draft.get("economics") or {}}
    else:
        sel = next((v for v in draft.get("variants") or [] if v.get("key") == variant), None)
        if sel is None:
            return _approve_conflict(lead, f"This lead has no {variant} variant.")
    capex = (sel.get("economics") or {}).get("capex_eur") or 0.0
    h = proposal_hash(sel["design"], variant, capex)
    if shown is not None and {k: sel["design"].get(k) or None for k in model_mod.SIZES} != shown:
        return _approve_conflict(lead, f"The {variant} design differs from the one on screen; nothing was approved. Reload and approve again.")
    if req.design_hash and h != req.design_hash:
        return _approve_conflict(lead, f"The {variant} design changed since you saw it; nothing was approved. Reload and approve again.")
    lead["approved"] = {"variant": variant, "design": {k: sel["design"].get(k) for k in model_mod.SIZES},
                        "economics": sel.get("economics"), "investment_eur": capex, "design_hash": h,
                        **({"overrides": ov} if variant == "edit" else {})}
    lead.pop("sent", None)  # a new completion is sent again
    lead.update(status="approved", approved_at=leads.now(), approved_variant=variant, updated_at=leads.now())
    lead["approved_hash"] = current_hash(lead)
    leads.save(lead)
    return {"version": int(lead.get("version") or 0), "ok": True, "status": "approved", "status_label": "Complete", "approved_at": lead["approved_at"], "approved_variant": variant,
            "proposal_hash": lead["approved_hash"]}


class DecisionReq(BaseModel):
    action: Literal["sign", "decline", "question"]
    base_version: Optional[int] = None
    name: Optional[str] = None
    accepted: Optional[bool] = None
    signature_png: Optional[str] = None
    question: Optional[str] = None
    proposal_hash: str


SIG_DIR = leads.DIR / "sig"


@app.post("/api/leads/{lead_id}/decision")
def lead_decision(lead_id: str, req: DecisionReq, request: Request):
    """v2.5: the homeowner signs, declines or asks (demo acceptance, not a qualified e-signature). Open, rate limited."""
    if not _rate_ok("decision:" + (request.client.host if request.client else "?"), per_min=10):
        return err(429, "Too many decisions from this address; try again in a minute.")
    lead = leads.LEADS.get(lead_id) or next((l for l in leads.LEADS.values() if lead_id in l.get("aliases", [])), None)
    if not lead:
        return err(404, f"No lead with id {lead_id}")
    stale = _stale(lead, req.base_version)
    if stale is not None:
        return stale
    if req.action == "sign":
        if lead.get("status") not in ("approved", "sent", "signed"):
            return err(409, "The planner has not released this proposal yet.")
        if not req.accepted:
            return err(422, "Signing needs accepted: true.")
        if not (req.name or "").strip():
            return err(422, "Signing needs the signer's name.")
    if req.action == "question" and not (req.question or "").strip():
        return err(422, "A question needs its text.")
    has_sig = False
    if req.signature_png:
        import base64
        head, _, b64 = req.signature_png.partition(",")
        if not head.startswith("data:image/png;base64"):
            return err(422, "signature_png must be a PNG data URL (data:image/png;base64,...).")
        try:
            raw = base64.b64decode(b64, validate=True)
        except Exception:
            return err(422, "signature_png is not valid base64.")
        if len(raw) > 200_000:
            return err(413, f"The signature image is {len(raw) / 1000:.0f} KB; the limit is 200 KB.")
        if not raw.startswith(b"\x89PNG"):
            return err(422, "signature_png is not a PNG image.")
        SIG_DIR.mkdir(parents=True, exist_ok=True)
        (SIG_DIR / f"{lead['lead_id']}.png").write_bytes(raw)
        has_sig = True
    elif req.action == "sign" and (SIG_DIR / f"{lead['lead_id']}.png").exists():
        has_sig = True
    t = leads.now()
    status = {"sign": "signed", "decline": "declined", "question": "question"}[req.action]
    dec = {"action": req.action, "name": (req.name or "").strip() or None, "decided_at": t, "proposal_hash": req.proposal_hash,
           "has_signature": has_sig}
    if req.action == "question":
        dec["question"] = req.question.strip()[:2000]
    lead.update(status=status, decision=dec, updated_at=t)
    lead.setdefault("history", []).append({"step": None, "field": None, "answer": {}, "changed": [], "note": f"homeowner: {req.action}", "at": t})
    leads.save(lead)
    return {"version": int(lead.get("version") or 0), "ok": True, "status": status, "decided_at": t, "proposal_hash": req.proposal_hash,
            "matches_current": req.proposal_hash == current_hash(lead)}


@app.get("/api/intake/priors")
def intake_priors(x_intake_secret: Optional[str] = Header(None)):
    return leads.priors()


@app.get("/api/eval")
def evaluation():
    engine()
    out = dict(STATE["eval"])
    out["synthetic"] = synthetic_report()  # v1.4: null until the suite has written a report
    try:  # the lab's sealed test-half score, run once: these ARE the scoreboard's numbers (not recomputed)
        ft = json.loads((Path(__file__).parent / "final_test.json").read_text())
        out["final_test"] = ft
        out.update(sealed_scoreboard(ft))
        re_ = STATE.get("reonic_eval")
        if re_:  # Reonic's published rule of thumb, scored by the engine on the same homes (it reproduces the lab's textbook row)
            for blk, rows in re_["blocks"].items():
                out["recommenders_detail"].setdefault(blk, {}).update(rows)
            out["recommenders"].update(re_["blocks"]["test half | lowest option | ours"])
            out["recommenders_labels"] = re_["labels"]
            out["reonic_rule_check"] = re_["check"]
    except Exception as e:
        log.warning("final test table unavailable: %s", e)
    try:  # the lab's measurement rows: which definition of "right" moves the score (fit half, out-of-fold)
        out["measurement"] = json.loads((Path(__file__).parent / "measurement.json").read_text())
    except Exception:
        pass
    try:
        eng = STATE["engine"]
        out["rule_of_thumb_comparison"] = {"reonic_kwp_per_mwh": 1.0,
                                           "planners_kwp_per_mwh": {"all": eng.planners_kwp_per_mwh(None),
                                                                    **{i: eng.planners_kwp_per_mwh(i) for i in data.INSTALLERS}},
                                           "note": "Reonic's rule of thumb against the median the installers' planners fitted in signed designs."}
    except Exception:
        pass
    try:  # the lab's second look at the test half (engine-lab 54cf480): rules-5 against rules-4; rules-4 stays in production
        sl = second_look()
        if sl:
            out["second_look"] = sl
            r5 = sl["blocks"].get("test half: lowest option, ours", {}).get("rules-5")
            if r5 and "recommenders" in out:
                out["recommenders"]["rules5"] = {"design_match_share": r5["all_four"], "pv_within": r5["pv"],
                                                 "battery_within": r5["battery"], "wallbox_decision": r5["wallbox"], "n": r5["n"],
                                                 "source": "second look"}
    except Exception as e:
        log.warning("second look unavailable: %s", e)
    out["exam_note"] = ("The exam homes carry no address, so every column is scored without roof, shade or envelope data; "
                        "live leads add them.")

    return out


def second_look() -> dict | None:
    """Parses the lab's FINAL v2 report (aggregates only) into blocks of engine rows; label "second look"."""
    p = Path(__file__).resolve().parent.parent / "lab" / "reports" / "final_test_v2.md"
    if not p.exists():
        return None
    blocks, cur, cols = {}, None, None
    for line in p.read_text().splitlines():
        if line.startswith("## "):
            cur, cols = line[3:].strip(), None
            blocks[cur] = {}
        elif cur and line.startswith("|") and not line.startswith("|---"):
            cells = [c.strip() for c in line.strip("|").split("|")]
            if cols is None:
                cols = [c.lower().replace(" ", "_") for c in cells]
                continue
            name = re.sub(r"\s*\([0-9a-f]{7}\)", "", cells[0])
            row = {}
            for k, v in zip(cols[1:], cells[1:]):
                v = v.rstrip("%")
                try:
                    row[k] = round(float(v) / 100, 3) if k != "n" else int(v)
                except ValueError:
                    row[k] = v
            blocks[cur][name] = row
    return {"label": "second look", "source": "engine-lab 54cf480, lab/reports/final_test_v2.md",
            "verdict": "rules-5 does not replace rules-4: nested CV worse, test gain p 0.60.", "blocks": blocks}


ENGINE_KEY = {"rules-4": "readout", "rules-3-band": "band", "rules-1": "calibrated", "physics": "formula",
              "black box": "blackbox", "textbook": "textbook"}


def sealed_scoreboard(ft: dict) -> dict:
    """recommenders, recommenders_detail and deviation_quality from the lab's sealed test-half table."""
    def block(pop, gt, band):
        out = {}
        for r in ft["rows"]:
            if (r["population"], r["ground_truth"], r["band"]) == (pop, gt, band) and r["engine"] in ENGINE_KEY:
                out[ENGINE_KEY[r["engine"]]] = {"design_match_share": r["all_four"], "pv_within": r["pv"], "battery_within": r["battery"],
                                                "wallbox_decision": r["wallbox"], "n": r["n"]}
        return out
    detail = {f"{p} | {g} | {b}": block(p, g, b) for p in ("test half", "clean 126")
              for g in ("lowest option", "any offered option") for b in ("ours", "package step")}
    dv = next((d for d in ft.get("deviation", []) if d["engine"] == "rules-4" and d["population"] == "test half"), None)
    md = next((d for d in ft.get("deviation_medians", []) if d["engine"] == "rules-4" and d["population"] == "test half"), None)
    dq = None
    if dv:
        dq = {"n_differ": dv["n_differ"], "ours_better_npv": dv["ours_better_npv"], "expert_better_npv": dv["expert_better_npv"],
              "ours_better_payback": dv["ours_better_payback"], "expert_better_payback": dv["expert_better_payback"],
              "ours_better_autarky": dv["ours_better_autarky"], "expert_better_autarky": dv["expert_better_autarky"],
              "median_npv_gain_eur": (md or {}).get("median_npv_gain_eur"),
              "method": "rules-4 against the lowest-option expert design on the 633-home test half, where PV, battery or wallbox is "
                        "outside tolerance; both designs through the same hourly simulation (lab, sealed run)"}
    return {"recommenders": block("test half", "lowest option", "ours"), "recommenders_detail": detail,
            "recommenders_note": ("Sealed test-half run by the lab (engine/lab/reports/final_test.md). The black box is scored only on "
                                  "its 126 unseen homes. " + ft.get("significance", "")),
            "deviation_quality": dq}


def synthetic_report():
    """eval.synthetic (v1.4) from engine/synthetic when that package and its report exist; absent otherwise."""
    try:
        from synthetic import load_report  # engine/ is the working directory
    except ImportError:
        return None
    try:
        return load_report()
    except Exception as e:
        log.warning("synthetic report unavailable: %s", e)
        return None
