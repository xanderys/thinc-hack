"""Parse the Reonic data pack into one row per project: inputs plus the expert design."""
import os
import re
from pathlib import Path

import numpy as np
import pandas as pd

MODULE_WP_DEFAULT = 450  # assumed module rating where the pack gives none (2026 TOPCon standard, docs/domain.md 4)
INSTALLERS = ["2a8ba8e2", "23c108b7"]
LOAD_PROFILES = ["H0", "FamilyOfFour", "HomeOfficeOnePerson", "FullTimeOnePerson", "SeniorOnePerson", "PartTimeOnePerson"]
HEATING_TYPES = ["Gas", "Oil", "Heatpump", "OtherNonRenewable", "OtherRenewable", "Unknown"]

KWH = re.compile(r"(\d+(?:\.\d+)?)\s*kWh", re.I)
KWP = re.compile(r"(\d+(?:\.\d+)?)\s*kWp", re.I)
KW = re.compile(r"(\d+(?:\.\d+)?)\s*kW(?![hp])", re.I)
WATT = re.compile(r"(\d+(?:\.\d+)?)\s*W\b")


def data_dir() -> Path:
    d = os.environ.get("REONIC_DATA_DIR")
    if not d:
        raise RuntimeError("REONIC_DATA_DIR is not set")
    p = Path(d)
    if not p.exists():
        raise RuntimeError(f"REONIC_DATA_DIR does not exist: {p}")
    return p


def _num(rx, s):
    m = rx.search(s or "")
    return float(m.group(1)) if m else None


def _pv(rows: pd.DataFrame):
    """Return (kwp, signal). Ordered from most to least direct evidence."""
    name = rows.component_name.fillna("")
    mod = rows[rows.component_type == "Module"]
    if len(mod):
        wp = [(_num(WATT, n) or MODULE_WP_DEFAULT) for n in mod.component_name]
        return float(np.sum(np.array(wp) * mod.quantity.values) / 1000), "module rows"
    pkg = rows[name.str.startswith("Complete Package")]
    if len(pkg):
        k = _num(KWP, pkg.component_name.iloc[0])
        if k:
            return k, "package name"
    for prefix, sig in [("DC Install", "DC install count"), ("Substructure", "substructure count")]:
        sub = rows[name.str.startswith(prefix) & (rows.quantity_units.fillna("Item") != "SquareMeter")]
        if len(sub) and sub.quantity.sum() > 1:
            return float(sub.quantity.sum() * MODULE_WP_DEFAULT / 1000), sig
    opt = rows[name.str.startswith("Power Optimizer")]
    if len(opt):
        return float(opt.quantity.sum() * MODULE_WP_DEFAULT / 1000), "optimiser count"
    m2 = rows[(rows.component_type == "ModuleFrameConstruction") & (rows.quantity_units == "SquareMeter")]
    if len(m2) and m2.quantity.max() > 1:
        return float(m2.quantity.max() * MODULE_WP_DEFAULT / 1000), "frame quantity"
    return None, "none"


def _design(rows: pd.DataFrame) -> dict:
    name = rows.component_name.fillna("")
    pv, sig = _pv(rows)
    bat = 0.0
    for _, r in rows[rows.component_type == "BatteryStorage"].iterrows():
        k = _num(KWH, r.component_name)
        if k:
            bat += k * (r.quantity or 1)
    if bat == 0:
        pkg = rows[name.str.startswith("Complete Package")]
        if len(pkg):
            bat = _num(KWH, pkg.component_name.iloc[0]) or 0.0
    inv = None
    invr = rows[rows.component_type == "Inverter"]
    if len(invr):
        inv = sum((_num(KW, n) or 0) for n in invr.component_name) or None
    hp = 0.0
    for _, r in rows[rows.component_type == "Heatpump"].iterrows():
        hp = max(hp, _num(KW, r.component_name) or (r.heatpump_nominal_power_kw or 0) / 1000)
    wb = 0.0
    for _, r in rows[rows.component_type == "Wallbox"].iterrows():
        k = (r.wb_charging_speed_kw / 1000) if pd.notna(r.wb_charging_speed_kw) else (_num(KW, r.component_name) or 11)
        wb = max(wb, k)
    return dict(pv_kwp=round(pv, 2) if pv else 0.0, pv_signal=sig, inverter_kw=inv, battery_kwh=round(bat, 2),
                heatpump_kw=hp, wallbox_kw=wb)


def load() -> tuple[pd.DataFrame, dict]:
    root = data_dir()
    out, stats = [], {}
    for inst in INSTALLERS:
        parts = pd.read_csv(root / inst / "project_options_parts.csv")
        sq = pd.read_csv(root / inst / "projects_status_quo.csv")
        first = parts.groupby("project_id").option_number.transform("min")
        parts = parts[parts.option_number == first]
        designs = {pid: _design(g) for pid, g in parts.groupby("project_id")}
        n_no_parts = int((~sq.project_id.isin(designs)).sum())
        stats[inst] = dict(status_quo=len(sq), with_parts=len(designs), without_parts=n_no_parts,
                           first_option_not_1=int(parts.groupby("project_id").option_number.first().ne(1).sum()))
        sq = sq[sq.project_id.isin(designs)]
        for r in sq.itertuples():
            d = designs[r.project_id]
            out.append(dict(project_id=r.project_id, installer_id=inst, **inputs_from_row(r), **d))
    df = pd.DataFrame(out)
    return df, stats


def _f(x):
    return None if x is None or (isinstance(x, float) and np.isnan(x)) else float(x)


def inputs_from_row(r) -> dict:
    heat = r.heating_existing_type if isinstance(r.heating_existing_type, str) else "Unknown"
    if heat not in HEATING_TYPES:
        heat = "Unknown"
    lp = r.load_profile if r.load_profile in LOAD_PROFILES else "H0"
    price = _f(r.energy_price_per_wh)
    hd = _f(r.heating_existing_heating_demand_wh)
    return dict(
        annual_demand_kwh=float(r.energy_demand_wh) / 1000,
        load_profile=lp,
        num_inhabitants=_f(r.num_inhabitants),
        house_size_sqm=_f(r.house_size_sqm),
        house_built_year=_f(r.house_built_year),
        has_ev=bool(r.has_ev),
        ev_annual_km=_f(r.ev_annual_drive_distance_km),
        has_wallbox=bool(r.has_wallbox),
        heating_type=heat,
        heating_cost_per_year_eur=_f(r.heating_existing_cost_per_year),
        heating_demand_kwh=hd / 1000 if hd else None,
        electricity_price_ct_kwh=price * 100000 if price and price * 100000 <= 100 else None,
        has_solar=bool(r.has_solar),
        existing_solar_kwp=_f(r.solar_size_kwp),
        has_storage=bool(r.has_storage),
        existing_storage_kwh=_f(r.storage_size_kwh),
    )


INPUT_KEYS = ["annual_demand_kwh", "load_profile", "num_inhabitants", "house_size_sqm", "house_built_year", "has_ev",
              "ev_annual_km", "has_wallbox", "heating_type", "heating_cost_per_year_eur", "heating_demand_kwh",
              "electricity_price_ct_kwh", "has_solar", "existing_solar_kwp", "has_storage", "existing_storage_kwh"]
