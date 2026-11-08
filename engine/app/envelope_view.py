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


def enrich(env: dict) -> dict:
    """Adds elements[], window_share per wall and window face, and constants; idempotent; never raises."""
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
                     "note": "0.34 Wh/m3K x air changes x net volume (0.8 of the LoD2 volume)"})
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
