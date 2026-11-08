"""Per-element view of the envelope block (roof/model/envelope.py, REONIC MODEL) for the heat pump step's x-ray and
heat-loss bar: both read these fields. Additive: the faces and totals stay as the model computed them."""

CONSTANTS = {
    "bivalence_c": {"value": -6.0, "unit": "C", "label": "Bivalence point",
                    "source": "Named planning constant (heat pump step brief, docs/briefs/heatpump-step.md): below it a second heat source shares the load"},
    "hot_water_kw_per_person": {"value": 0.5, "unit": "kW per person", "label": "Hot water",
                                "source": "Reonic: plus 0.5 kW per person for hot water"},
}
ORDER = [("outer_wall", "Outer wall", "wall"), ("window", "Window", "window"), ("floor", "Floor", "floor"),
         ("ceiling", "Top ceiling", "ceiling"), ("roof", "Roof", "roof")]


WINDOW_PER_FLOOR = 0.20   # window area as a share of the heated floor area (typical single-family share; IWU/TABULA)
CLEAR_HEIGHT_M = 2.5      # net room height for the ventilated volume (DIN EN 12831 simplified)


def correct(env: dict) -> dict:
    """v2.14 C: the heated rooms, not the whole LoD2 solid. The cached envelope put windows at 20% of every wall (gables
    included) and ventilated the full gross volume incl. the roof space; here windows are 20% of the heated floor area and
    ventilation runs on that floor area x 2.5 m. Walls, roof, floor and U-values are unchanged. Idempotent; never raises."""
    import copy
    import re
    if not isinstance(env, dict) or not env.get("faces") or env.get("corrected"):
        return env
    try:
        raw = copy.deepcopy({k: env[k] for k in ("faces", "thermal_bridges_w", "ventilation_w", "design_heat_load_kw",
                                                     "annual_heat_demand_kwh", "annual_heat_demand_source", "design") if k in env})
        d = env.get("design") or {}
        dt = float(d.get("inside_c", 20.0)) - float(d.get("outside_c", -16.0))
        m = re.search(r"on (\d+) m2", env.get("annual_heat_demand_source") or "")
        if not m:
            return env
        area = float(m.group(1))                                  # heated floor area: footprint x storeys below the eaves x 0.72
        faces = env["faces"]
        walls = {f["id"].split("_", 1)[1]: f for f in faces if f.get("kind") == "wall" and "_" in f.get("id", "")}
        wins = {f["id"].split("_", 1)[1]: f for f in faces if f.get("kind") == "window" and "_" in f.get("id", "")}
        gross = {k: walls[k]["area_m2"] + (wins.get(k) or {}).get("area_m2", 0.0) for k in walls}
        tot = sum(gross.values())
        win_total = min(WINDOW_PER_FLOOR * area, 0.35 * tot) if tot else 0.0
        for k, g in gross.items():
            w = win_total * g / tot if tot else 0.0
            wall = walls[k]
            wall["area_m2"] = round(g - w, 1)
            wall["loss_w"] = round(wall["area_m2"] * wall["u_value"] * dt)
            if k in wins:
                win = wins[k]
                win["area_m2"] = round(w, 1)
                win["loss_w"] = round(w * win["u_value"] * dt)
                win["source"] = re.sub(r"window area assumed .*", f"window area {WINDOW_PER_FLOOR:.0%} of the {area:.0f} m2 heated floor area", win.get("source", ""))
        env_area = sum(f["area_m2"] for f in faces)
        d_tb = (raw.get("thermal_bridges_w") or 0) / (sum(f["area_m2"] for f in raw["faces"]) * dt) if raw.get("faces") else 0.0
        tb_w = round(env_area * d_tb * dt)
        ach = float(d.get("air_changes_per_h") or 0.5)
        vol = area * CLEAR_HEIGHT_M
        h_ve = 0.34 * ach * vol
        vent_w = round(h_ve * dt)
        h_tr = sum(f["loss_w"] for f in faces) / dt + env_area * d_tb
        load_w = sum(f["loss_w"] for f in faces) + tb_w + vent_w
        old_h = (sum(f["loss_w"] for f in raw["faces"]) + (raw.get("thermal_bridges_w") or 0) + (raw.get("ventilation_w") or 0)) / dt
        kh = re.search(r"x ([\d,]+) kKh", env.get("annual_heat_demand_source") or "")
        kkh = float(kh.group(1).replace(",", "")) * 1000 if kh else None
        gains = (old_h * kkh / 1000 - (raw.get("annual_heat_demand_kwh") or 0)) if kkh else 0.0   # internal gains as the model counted them
        demand = max(0.0, (h_tr + h_ve) * kkh / 1000 - gains) if kkh else raw.get("annual_heat_demand_kwh")
        env.update(thermal_bridges_w=tb_w, ventilation_w=vent_w, design_heat_load_kw=round(load_w / 1000, 1),
                   annual_heat_demand_kwh=round(demand, -2) if demand is not None else None, heated_area_m2=round(area),
                   corrected=True, uncorrected=raw)
        env["design"] = {**d, "volume_m3": round(vol, 1), "volume_note": f"heated floor area {area:.0f} m2 x {CLEAR_HEIGHT_M:g} m clear height"}
        env["annual_heat_demand_source"] = (raw.get("annual_heat_demand_source") or "") + "; windows and ventilation on the heated rooms"
        env.setdefault("sources", []).append(f"Windows {WINDOW_PER_FLOOR:.0%} of the heated floor area; ventilation on heated floor area x "
                                             f"{CLEAR_HEIGHT_M:g} m at {ach:g} air changes (DIN EN 12831 simplified)")
        env.pop("elements", None)
    except Exception:
        pass
    return env


def enrich(env: dict) -> dict:
    """Adds elements[], window_share per wall and window face, and constants; idempotent; never raises."""
    correct(env)
    if not isinstance(env, dict) or not env.get("faces") or env.get("elements"):
        return env
    try:
        d = env.get("design") or {}
        dt = float(d.get("inside_c", 20.0)) - float(d.get("outside_c", -16.0))
        faces = env["faces"]
        rows = []
        for key, label, kind in ORDER:
            fs = [f for f in faces if f.get("kind") == kind]
            a = sum(f.get("area_m2") or 0 for f in fs)
            w = sum(f.get("loss_w") or 0 for f in fs)
            row = {"element": key, "label": label, "w": round(w), "a_m2": round(a, 1),
                   "u": round(w / (a * dt), 2) if a and w else (fs[0].get("u_value") if fs else None), "dt_k": dt}
            if kind == "floor" and fs:
                row["u"] = fs[0].get("u_value")
                row["dt_k"] = round(w / (a * row["u"]), 1) if a and row["u"] else dt
                row["note"] = "to ground or unheated cellar: temperature difference times 0.5 (TABULA b_tr)"
            if kind == "ceiling" and not fs:
                row.update(w=0, a_m2=0.0, u=None, note="heated roof space: the roof is the boundary, no separate top ceiling")
            rows.append(row)
        area = sum(f.get("area_m2") or 0 for f in faces)
        tb = env.get("thermal_bridges_w") or 0
        rows.append({"element": "ventilation", "label": "Ventilation", "w": round(env.get("ventilation_w") or 0), "a_m2": None,
                     "u": None, "dt_k": dt, "air_changes_per_h": d.get("air_changes_per_h"), "volume_m3": d.get("volume_m3"),
                     "note": "0.34 Wh/m3K x air changes x heated volume (heated floor area x 2.5 m)"})
        rows.append({"element": "thermal_bridges", "label": "Thermal bridges", "w": round(tb), "a_m2": round(area, 1),
                     "u": round(tb / (area * dt), 3) if area else None, "dt_k": dt, "note": "IWU allowance on the envelope area"})
        total = sum(r["w"] for r in rows)
        for r in rows:
            r["share"] = round(r["w"] / total, 3) if total else 0.0
        rows.append({"element": "total", "label": "Total", "w": round(total), "a_m2": round(area, 1), "u": None, "dt_k": dt,
                     "share": 1.0, "design_heat_load_kw": env.get("design_heat_load_kw")})
        walls = {f["id"].split("_", 1)[1]: f for f in faces if f.get("kind") == "wall" and "_" in f.get("id", "")}
        for f in faces:
            if f.get("kind") in ("wall", "window") and "_" in f.get("id", ""):
                side = f["id"].split("_", 1)[1]
                win = next((g for g in faces if g.get("id") == f"window_{side}"), None)
                wall = walls.get(side)
                gross = (wall or {}).get("area_m2", 0) + (win or {}).get("area_m2", 0)
                f["window_share"] = round((win or {}).get("area_m2", 0) / gross, 3) if gross else None
                f["window_share_source"] = (f"{env.get('typology')}: window area assumed 20% of the wall for every build-year "
                                            "class (no window data in LoD2; per-class IWU shares not yet encoded)")
        env["elements"] = rows
        env["constants"] = CONSTANTS
        env["estimated_from"] = "address"
    except Exception:
        pass
    return env
