import hashlib
import logging
import pickle
import threading
import time
from pathlib import Path
from typing import Literal, Optional

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from . import data
from .model import MODEL_VERSION, Engine, row_design, row_inputs

log = logging.getLogger("engine")
app = FastAPI(title="Reonic planner engine")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

STATE: dict = {"engine": None, "eval": None, "error": None}


@app.on_event("startup")
def startup():
    try:
        t = time.time()
        key = cache_key()
        path = CACHE / f"engine-{key}.pkl"
        if path.exists():
            STATE["engine"], STATE["eval"] = pickle.loads(path.read_bytes())
            log.warning("loaded cached model %s in %.1fs", key, time.time() - t)
        else:
            df, stats = data.load()
            eng = Engine(df, stats).fit()
            STATE["engine"] = eng
            STATE["eval"] = eng.evaluate()
            CACHE.mkdir(exist_ok=True)
            for old in CACHE.glob("engine-*.pkl"):
                old.unlink()
            path.write_bytes(pickle.dumps((eng, STATE["eval"])))
            log.warning("trained in %.1fs on %d projects", time.time() - t, len(eng.train))
    except Exception as e:  # keep serving /health with the reason
        STATE["error"] = str(e)
        log.exception("startup failed")
        return
    try:  # warm the hourly simulation (cold call about 1 s); failure falls back to the annual lookup per request
        from . import hourly
        hourly.simulate({"annual_demand_kwh": 4500, "installer_id": "2a8ba8e2"}, {"pv_kwp": 9, "inverter_kw": 8, "battery_kwh": 10})
    except Exception:
        log.exception("hourly warm-up failed")
    threading.Thread(target=warm_inbox, daemon=True).start()


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
    annual_demand_kwh: float
    load_profile: Literal["H0", "FamilyOfFour", "HomeOfficeOnePerson", "FullTimeOnePerson", "SeniorOnePerson", "PartTimeOnePerson"] = "H0"
    num_inhabitants: Optional[float] = None
    house_size_sqm: Optional[float] = None
    house_built_year: Optional[float] = None
    has_ev: bool = False
    ev_annual_km: Optional[float] = None
    has_wallbox: bool = False
    heating_type: Literal["Gas", "Oil", "Heatpump", "OtherNonRenewable", "OtherRenewable", "Unknown"] = "Unknown"
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
    offer_date: Optional[str] = None  # ISO date; picks the installer catalogue of that time. Default: latest.


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


RANGES = {"annual_demand_kwh": (300, 100_000, "kWh a year"), "num_inhabitants": (1, 20, "people"),
          "house_size_sqm": (20, 1_000, "m2"), "house_built_year": (1800, 2027, ""), "ev_annual_km": (0, 100_000, "km a year"),
          "heating_cost_per_year_eur": (0, 20_000, "EUR a year"), "heating_demand_kwh": (0, 100_000, "kWh a year"),
          "electricity_price_ct_kwh": (5, 100, "ct/kWh"), "existing_solar_kwp": (0, 100, "kWp"), "existing_storage_kwh": (0, 100, "kWh")}
DESIGN_RANGES = {"pv_kwp": (0, 100), "inverter_kw": (0, 100), "battery_kwh": (0, 100), "heatpump_kw": (0, 50), "wallbox_kw": (0, 50)}


def check_inputs(inp: dict):
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
    return {"ok": e is not None, "model_version": MODEL_VERSION,
            "trained_on": {"projects": len(e.train) if e else 0, "installers": len(e.catalogue) if e else 0},
            "data_loaded": e is not None, **({"error": STATE["error"]} if STATE["error"] else {})}


@app.post("/api/design")
def design(req: DesignReq):
    inp = req.inputs.model_dump()
    check_inputs(inp)
    return engine().predict(inp)


FIELDS = {"pv_kwp": "pv", "battery_kwh": "battery", "heatpump_kw": "heatpump", "wallbox_kw": "wallbox", "inverter_kw": "inverter"}


@app.post("/api/refine")
def refine(req: RefineReq):
    eng = engine()
    inp = req.inputs.model_dump()
    check_inputs(inp)
    bad = [k for k in (req.overrides or {}) if k not in FIELDS]
    if bad:
        return err(422, f"Unknown override field: {', '.join(bad)}. Allowed: {', '.join(FIELDS)}.")
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
    inp, d = req.inputs.model_dump(), req.design.model_dump()
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


class AskReq(BaseModel):
    inputs: HomeInputs
    unknown: Optional[list[str]] = None  # fields the lead did not state; only these are asked


@app.post("/api/ask")
def ask(req: AskReq):
    inp = req.inputs.model_dump()
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


@app.get("/api/eval")
def evaluation():
    engine()
    out = dict(STATE["eval"])
    rep = synthetic_report()
    if rep is not None:
        out["synthetic"] = rep
    return out


def synthetic_report():
    """eval.synthetic (v1.4) from engine/synthetic when that package and its report exist; absent otherwise."""
    try:
        from synthetic.report import load_report  # engine/ is the working directory
    except ImportError:
        return None
    try:
        return load_report()
    except Exception as e:
        log.warning("synthetic report unavailable: %s", e)
        return None
