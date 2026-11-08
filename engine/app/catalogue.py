"""One SKU catalogue for every installer, built at startup from project_options_parts.csv (aggregates only: brand, name,
size and how often each appears; no project rows). Lead designs, variants and refines snap to its ladder so every size
on screen is a real product; the sealed exam path does not snap (its published figures stay as scored)."""
import logging
import re
from collections import Counter, defaultdict

log = logging.getLogger("engine")

MODULE_W = 463  # Sunpro 463 W TOPCon glass-glass, the most common module in the data
LADDER = {
    "battery_kwh": [5.0, 7.0, 9.0, 10.0, 18.0],
    "inverter_kw": [5.0, 10.0, 20.0],
    "heatpump_kw": [5.5, 7.5, 10.5, 12.5],
    "wallbox_kw": [11.0, 22.0],
}
PART = {"pv_kwp": "module", "battery_kwh": "battery", "inverter_kw": "inverter", "heatpump_kw": "heatpump", "wallbox_kw": "wallbox"}
TYPES = {"BatteryStorage": "battery", "Inverter": "inverter", "Wallbox": "wallbox", "Heatpump": "heatpump", "Module": "module"}
UNIT = {"battery": "kWh", "inverter": "kW", "wallbox": "kW", "heatpump": "kW", "module": "W"}
DC_AC = (0.7, 1.3)

CAT: dict = {}  # part -> list of {brand, name, size, count}


def _size(part: str, name: str):
    pat = {"battery": r"(\d+(?:\.\d+)?)\s*kWh", "module": r"(\d{3})\s*W\b"}.get(part, r"(\d+(?:\.\d+)?)\s*kW\b")
    m = re.search(pat, name or "")
    return float(m.group(1)) if m else None


def build():
    """Reads the parts files once; keeps counts per (brand, name, size)."""
    from .data import data_dir
    import pandas as pd
    counts: Counter = Counter()
    for f in sorted(data_dir().glob("*/project_options_parts.csv")):
        df = pd.read_csv(f, usecols=["component_type", "component_name", "component_brand"])
        df = df[df.component_type.isin(TYPES)]
        for (t, name, brand), n in df.groupby(["component_type", "component_name", "component_brand"], dropna=False).size().items():
            part = TYPES[t]
            if part == "battery" and re.search(r"extension|coupling", str(name), re.I):
                continue  # add-on modules and couplers are not a storage size
            size = _size(part, str(name))
            if size is None or not isinstance(brand, str):
                continue
            counts[(part, brand, str(name), size)] += int(n)
    cat = defaultdict(list)
    for (part, brand, name, size), n in counts.items():
        cat[part].append({"brand": brand, "name": name, "size": size, "count": n})
    # 18 kWh is two Sigenergy AIOS 9 kWh stacked (the data sells the 9 kWh module; two of them make the ladder's top step)
    nine = [e for e in cat["battery"] if e["size"] == 9.0 and e["brand"] == "Sigenergy"]
    if nine:
        cat["battery"].append({"brand": "Sigenergy", "name": f"{nine[0]['name']} x 2", "size": 18.0, "count": nine[0]["count"], "stacked": 2})
    for part in cat:
        cat[part].sort(key=lambda e: (e["size"], -e["count"]))
    CAT.clear()
    CAT.update(cat)
    log.warning("catalogue ready: %s", {p: len(v) for p, v in CAT.items()})
    return CAT


def public() -> dict:
    """GET /api/catalogue: per part the SKUs with brand, name, size and count, the ladder and the default per size."""
    if not CAT:
        build()
    out = {"module_w": MODULE_W, "ladder": {PART[k]: v for k, v in LADDER.items()}, "parts": {}}
    for part, rows in CAT.items():
        out["parts"][part] = {"unit": UNIT[part], "skus": rows,
                              "default_by_size": {f"{s:g}": sku(part, s) for s in sorted({r["size"] for r in rows})}}
    return out


def _display(brand: str, name: str) -> str:
    return name if name.lower().startswith(brand.lower()) else f"{brand} {name}"


def sku(part: str, size, brand: str | None = None) -> dict | None:
    """The SKU for this part and size: the given brand if it sells that size, else the most common brand at that size."""
    if not CAT:
        build()
    if size is None:
        return None
    rows = [r for r in CAT.get(part, []) if abs(r["size"] - float(size)) < 1e-6]
    if not rows:
        return None
    by_brand = defaultdict(int)
    for r in rows:
        by_brand[r["brand"]] += r["count"]
    total = sum(by_brand.values())
    pick = brand if brand in by_brand else max(by_brand, key=by_brand.get)
    r = max((x for x in rows if x["brand"] == pick), key=lambda x: x["count"])
    return {"brand": pick, "name": _display(pick, r["name"]), "size": float(size), "unit": UNIT[part],
            "share": round(by_brand[pick] / total, 3), "brands": sorted(by_brand, key=lambda b: -by_brand[b])}


def brand_sizes(part: str, brand: str) -> list:
    if not CAT:
        build()
    return sorted({r["size"] for r in CAT.get(part, []) if r["brand"].lower() == (brand or "").lower()})


def snap_pv(kwp):
    """PV in whole 463 W modules. A size from the 450 W world (a multiple of 0.45 kWp) keeps its module count."""
    if not kwp:
        return kwp
    k = float(kwp)
    n = round(k / 0.45) if abs(k / 0.45 - round(k / 0.45)) < 1e-3 and abs(k / (MODULE_W / 1000) - round(k / (MODULE_W / 1000))) > 1e-3 \
        else round(k / (MODULE_W / 1000))
    return round(max(1, n) * MODULE_W / 1000, 2)


def _nearest(v, ladder):
    return min(ladder, key=lambda s: (abs(s - v), -s))


def snap_inverter(pv, inv=None):
    ladder = LADDER["inverter_kw"]
    if inv:  # a stated or planner size goes to the nearest real one
        return _nearest(float(inv), ladder)
    if not pv:
        return None
    ok = [s for s in ladder if DC_AC[0] <= pv / s <= DC_AC[1]]
    return _nearest(pv / 1.15, ok or ladder)


def snap(design: dict, overrides: dict | None = None) -> tuple[dict, dict]:
    """(snapped design, skus). Brand overrides (sku_<part>: brand) move a size to that brand's nearest ladder size."""
    ov = overrides or {}
    d = dict(design)
    d["pv_kwp"] = snap_pv(d.get("pv_kwp")) or None
    for k in ("battery_kwh", "heatpump_kw", "wallbox_kw"):
        v = d.get(k)
        if v:
            lad = LADDER[k]
            b = ov.get(f"sku_{PART[k]}")
            if b:
                have = [s for s in lad if s in brand_sizes(PART[k], b)]
                lad = have or lad
            d[k] = _nearest(float(v), lad)
    inv_given = d.get("inverter_kw") if "inverter_kw" in ov and ov.get("inverter_kw") not in (None, "include") else None
    d["inverter_kw"] = snap_inverter(d.get("pv_kwp"), inv_given) if d.get("pv_kwp") else (d.get("inverter_kw") and snap_inverter(None, d["inverter_kw"]))
    b_inv = ov.get("sku_inverter")
    if b_inv and d.get("inverter_kw"):
        have = [s for s in LADDER["inverter_kw"] if s in brand_sizes("inverter", b_inv)]
        if have and d["inverter_kw"] not in have:
            d["inverter_kw"] = _nearest(d["inverter_kw"], have)
    skus = {}
    if d.get("pv_kwp"):
        m = sku("module", MODULE_W, ov.get("sku_module"))
        if m:
            m["modules"] = int(round(d["pv_kwp"] / (MODULE_W / 1000)))
        skus["module"] = m
    for k in ("inverter_kw", "battery_kwh", "wallbox_kw", "heatpump_kw"):
        if d.get(k):
            skus[PART[k]] = sku(PART[k], d[k], ov.get(f"sku_{PART[k]}"))
    return d, skus


def skus_for(design: dict) -> dict:
    """Products for a design at its own sizes (no snapping): for drafts frozen before the catalogue (approved, sent,
    decided) so every stored design still names real products."""
    out = {}
    pv = (design or {}).get("pv_kwp")
    if pv:
        m = sku("module", MODULE_W)
        if m:
            k = float(pv)
            m["modules"] = int(round(k / 0.45)) if abs(k / 0.45 - round(k / 0.45)) < 1e-3 else int(round(k / (MODULE_W / 1000)))
        out["module"] = m
    for k in ("inverter_kw", "battery_kwh", "wallbox_kw", "heatpump_kw"):
        v = (design or {}).get(k)
        if v:
            out[PART[k]] = sku(PART[k], v) or {"brand": None, "name": None, "size": float(v), "unit": UNIT[PART[k]], "share": None, "brands": []}
    return out


def attach(draft: dict, inputs: dict | None = None) -> dict:
    """Fills skus (and, with inputs, the rate card) on a stored draft where they are missing; sizes and stored economics
    untouched."""
    if not isinstance(draft, dict) or not draft.get("design"):
        return draft
    if inputs is not None and not draft.get("rates"):
        try:
            from .hourly import sim
            draft["rates"] = sim.rates(inputs, draft["design"])
        except Exception:
            log.exception("rates on read")
    if not draft.get("skus"):
        draft["skus"] = skus_for(draft["design"])
    comps = draft.get("components") or {}
    for c, part in (("pv", "module"), ("battery", "battery"), ("wallbox", "wallbox"), ("heatpump", "heatpump")):
        if c in comps and draft["skus"].get(part) and not comps[c].get("sku"):
            comps[c]["sku"] = draft["skus"][part]
    if "pv" in comps and draft["skus"].get("inverter") and not comps["pv"].get("inverter_sku"):
        comps["pv"]["inverter_sku"] = draft["skus"]["inverter"]
    for v in draft.get("variants") or []:
        if not v.get("skus"):
            v["skus"] = skus_for(v.get("design") or {})
    names = {"pv": "module", "battery": "battery", "wallbox": "wallbox", "heatpump": "heatpump"}
    for ln in (draft.get("rates") or {}).get("lines") or []:
        sk = draft["skus"].get(names.get(ln.get("item"), ""))
        if sk and sk.get("name") and not ln.get("sku"):
            ln["sku"] = sk["name"] + (f" x {sk['modules']}" if sk.get("modules") else "")
    return draft
