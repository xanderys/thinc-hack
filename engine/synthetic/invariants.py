"""Named invariants: metamorphic relations on the frozen engine, and physics checks with the hourly simulator as oracle.
Each returns {name, group, pass_share, n_checked, n_failed, worst (5, largest violation first)}."""
import json

import numpy as np

from app.hourly.sim import BAT_USABLE

FOSSIL = ("Gas", "Oil", "OtherNonRenewable", "Unknown")
NPV_TOL_EUR, NPV_TOL_SHARE = 1000, 0.10
HTW_CAP = 1.5  # usable kWh per kWp and per MWh a year, the smaller applies (HTW Stromspeicher-Inspektion 2025)

# metamorphic transforms: (key, applies, transform)
VARIANTS = [
    ("demand_up", lambda h: True, lambda h: {**h, "annual_demand_kwh": round(h["annual_demand_kwh"] * 1.2, 1)}),
    ("demand_5pct", lambda h: True, lambda h: {**h, "annual_demand_kwh": round(h["annual_demand_kwh"] * 1.05, 1)}),
    ("add_ev", lambda h: not h.get("has_ev"), lambda h: {**h, "has_ev": True, "ev_annual_km": 12000.0}),
    ("heat_pump", lambda h: h.get("heating_type") in FOSSIL, lambda h: {**h, "heating_type": "Heatpump"}),
    ("tariff_up", lambda h: True, lambda h: {**h, "electricity_price_ct_kwh": round((h.get("electricity_price_ct_kwh") or 32.0) * 1.3, 1)}),
]


def v(d, k):
    return float(d.get(k) or 0.0)


def show(h):
    return {k: x for k, x in h.items() if x not in (None, False) and k not in ("_id",)}


def _inv(name, group, rows, desc):
    """rows: (ok, severity, case) per checked home."""
    fails = sorted([r for r in rows if not r[0]], key=lambda r: -r[1])
    n = len(rows)
    return {"name": name, "group": group, "description": desc, "n_checked": n, "n_failed": len(fails),
            "pass_share": round(1 - len(fails) / n, 4) if n else None, "worst": distinct([r[2] for r in fails])}


def distinct(cases, k=5):
    """First k distinct cases: many synthetic homes share the pack's 4,500 kWh default."""
    out, seen = [], set()
    for c in cases:
        key = json.dumps({**c, "inputs": {a: b for a, b in c["inputs"].items() if not a.startswith("_")}}, sort_keys=True, default=str)
        if key not in seen:
            seen.add(key)
            out.append(c)
        if len(out) == k:
            break
    return out


def _pair(h, d, h2, d2, note):
    return {"inputs": show(h), "design": d, "changed_inputs": {k: h2[k] for k in h2 if h2.get(k) != h.get(k) and not k.startswith("_")},
            "changed_design": d2, "note": note}


def pv_step(eng, inst, a, b) -> int:
    """Catalogue steps between two PV sizes; a decision flip counts as the whole catalogue."""
    cat = eng.catalogue[inst]["pv"]
    if (a > 0) != (b > 0):
        return len(cat)
    if not a:
        return 0
    i, j = (int(np.argmin(np.abs(cat - x))) for x in (a, b))
    return abs(i - j)


def metamorphic(eng, homes, base, var) -> list:
    """homes, base designs; var: {key: {_id: (variant home, variant design)}}."""
    out = []
    rows = []
    for h, d in zip(homes, base):
        h2, d2 = var["demand_up"][h["_id"]]
        drop = v(d, "pv_kwp") - v(d2, "pv_kwp")
        rows.append((drop <= 1e-9, drop, _pair(h, d, h2, d2, f"Demand up 20%: PV {v(d, 'pv_kwp'):g} to {v(d2, 'pv_kwp'):g} kWp.")))
    out.append(_inv("Raising demand never lowers PV", "monotonicity", rows, "Demand +20%, rest fixed: pv_kwp must not fall."))

    rows_wb, rows_pv, rows_c = [], [], []
    for h, d in zip(homes, base):
        if h["_id"] not in var["add_ev"]:
            continue
        h2, d2 = var["add_ev"][h["_id"]]
        note = f"EV added: PV {v(d, 'pv_kwp'):g} to {v(d2, 'pv_kwp'):g} kWp, wallbox {v(d, 'wallbox_kw'):g} to {v(d2, 'wallbox_kw'):g} kW."
        rows_wb.append((not (v(d, "wallbox_kw") and not v(d2, "wallbox_kw")), v(d, "wallbox_kw"), _pair(h, d, h2, d2, note)))
        drop = v(d, "pv_kwp") - v(d2, "pv_kwp")
        rows_pv.append((drop <= 1e-9, drop, _pair(h, d, h2, d2, note)))
        same = v(d, "wallbox_kw") == v(d2, "wallbox_kw") and v(d, "pv_kwp") == v(d2, "pv_kwp")
        rows_c.append((not same, 1.0, _pair(h, d, h2, d2, note)))
    out.append(_inv("Adding an EV never removes a wallbox", "monotonicity", rows_wb, "EV added at 12,000 km: a wallbox stays."))
    out.append(_inv("Adding an EV never lowers PV", "monotonicity", rows_pv, "EV added at 12,000 km: pv_kwp must not fall."))

    rows = []
    for h, d in zip(homes, base):
        if h["_id"] not in var["heat_pump"]:
            continue
        h2, d2 = var["heat_pump"][h["_id"]]
        drop = v(d, "pv_kwp") - v(d2, "pv_kwp")
        rows.append((drop <= 1e-9, drop, _pair(h, d, h2, d2, f"Heating {h.get('heating_type')} to heat pump: PV {v(d, 'pv_kwp'):g} to {v(d2, 'pv_kwp'):g} kWp.")))
    out.append(_inv("A heat pump never lowers PV", "monotonicity", rows, "Fossil or unknown heating replaced by a heat pump: pv_kwp must not fall."))

    rows = []
    for h, d in zip(homes, base):
        h2, d2 = var["tariff_up"][h["_id"]]
        drop = v(d, "battery_kwh") - v(d2, "battery_kwh")
        rows.append((drop <= 1e-9, drop, _pair(h, d, h2, d2, f"Tariff +30%: battery {v(d, 'battery_kwh'):g} to {v(d2, 'battery_kwh'):g} kWh.")))
    out.append(_inv("A higher tariff never shrinks the battery", "monotonicity", rows, "Electricity price +30%: battery_kwh must not fall."))

    out.append(_inv("Adding an EV changes the wallbox or PV", "coupling", rows_c, "EV added: wallbox or pv_kwp must change."))
    rows = []
    for h, d in zip(homes, base):
        bad = v(d, "battery_kwh") > 0 and not v(d, "pv_kwp") and not h.get("has_solar")
        rows.append((not bad, v(d, "battery_kwh"), {"inputs": show(h), "design": d, "note": "Battery with no PV, new or existing."}))
    out.append(_inv("No battery without PV", "coupling", rows, "has_solar false: a battery needs proposed PV."))

    rows = []
    for h, d in zip(homes, base):
        h2, d2 = var["demand_5pct"][h["_id"]]
        s = pv_step(eng, h["installer_id"], v(d, "pv_kwp"), v(d2, "pv_kwp"))
        rows.append((s <= 1, s, _pair(h, d, h2, d2, f"Demand +5%: PV {v(d, 'pv_kwp'):g} to {v(d2, 'pv_kwp'):g} kWp, {s} catalogue steps.")))
    out.append(_inv("A 5% demand change moves PV at most one catalogue step", "stability", rows, "Demand +5%: |change in pv_kwp| at most one step of the installer's sizes."))
    return out


def physics(homes, base, phys, all_homes, all_designs) -> list:
    """homes, base: in-distribution and edge; all_homes, all_designs: every simulated home (energy balance)."""
    out = []
    ok_rows = [(h, d, phys[h["_id"]]) for h, d in zip(homes, base) if "error" not in phys[h["_id"]]]
    rows = [(not p["hard"], len(p["hard"]), {"inputs": show(h), "design": d, "note": " ".join(p["hard"].values())}) for h, d, p in ok_rows]
    out.append(_inv("No implausible flag", "plausibility", rows, "Proposed design: no hard rule (the /api/validate 'implausible' level)."))
    rows = [(not p["phys_warn"], len(p["phys_warn"]), {"inputs": show(h), "design": d, "note": " ".join(p["phys_warn"])}) for h, d, p in ok_rows]
    out.append(_inv("Physics checks pass", "plausibility", rows, "validate_physics: no warning (clipping, cycles, oversized battery, heat pump hours, autarky, self-consumption)."))
    rows = []
    for h, d, p in ok_rows:
        if v(d, "pv_kwp") and v(d, "inverter_kw"):
            r = v(d, "pv_kwp") / v(d, "inverter_kw")
            rows.append((0.8 <= r <= 1.3, abs(r - 1.05), {"inputs": show(h), "design": d, "note": f"DC/AC {r:.2f}."}))
    out.append(_inv("DC/AC within 0.8 to 1.3", "plausibility", rows, "pv_kwp / inverter_kw on designs with PV."))
    rows = []
    for h, d, p in ok_rows:
        b = v(d, "battery_kwh")
        if b:
            pv = v(d, "pv_kwp") + (v(h, "existing_solar_kwp") if h.get("has_solar") else 0)
            cap = HTW_CAP * min(pv, h["annual_demand_kwh"] / 1000)
            u = b * BAT_USABLE
            rows.append((u <= cap + 1e-9, u - cap, {"inputs": show(h), "design": d, "note": f"{u:.1f} kWh usable; HTW cap {cap:.1f} kWh."}))
    out.append(_inv("Battery within HTW cap", "plausibility", rows, "Usable kWh at most the smaller of 1.5 per kWp and 1.5 per MWh (HTW 2025); installers often exceed it."))

    rows, beat = [], []
    for h, d, p in ok_rows:
        if p["opt_npv"] is None or p["npv"] is None:
            continue
        gap = p["opt_npv"] - p["npv"]
        tol = max(NPV_TOL_EUR, NPV_TOL_SHARE * abs(p["opt_npv"]))
        case = {"inputs": show(h), "design": d, "optimum": p["opt_design"], "npv_eur": p["npv"], "optimum_npv_eur": p["opt_npv"],
                "note": f"Optimum NPV EUR {p['opt_npv']:,.0f}, proposal EUR {p['npv']:,.0f}, gap EUR {gap:,.0f}."}
        rows.append((gap <= tol, gap, case))
        beat.append((gap >= -1.0, -gap, case))
    gap_inv = _inv("Proposal NPV within 10% or EUR 1,000 of the optimum", "optimum gap", rows, "Same catalogue, same simulator, 20-year NPV.")
    g = np.array([r[1] for r in rows]) if rows else np.zeros(1)
    gap_inv["distribution_eur"] = {f"p{q}": float(round(np.percentile(g, q), -1)) for q in (10, 25, 50, 75, 90, 99)}
    gap_inv["distribution_eur"]["max"] = float(round(g.max(), -1))
    gap_inv["at_optimum_share"] = round(float((np.abs(g) < 1).mean()), 4)
    out.append(gap_inv)
    out.append(_inv("Proposal never scores above the optimum", "optimum gap", beat, "Proposal NPV at most the simulator's optimum NPV."))

    rows = []
    for h, d in zip(all_homes, all_designs):
        p = phys[h["_id"]]
        b, bd = p["bal_worst"]
        rows.append((p["bal_fail"] == 0 and "error" not in p, b if "error" not in p else 1e9,
                     {"inputs": show(h), "design": bd or d, "note": p.get("error") or f"Largest residual {b:.3g} kWh over {p['sims']} simulations."}))
    bal = _inv("Energy balance closes", "energy balance", rows, "Every simulation (proposal and optimum grid): yield = self-consumed + fed in, load = direct + battery + grid, battery within capacity; within 1 kWh.")
    bal["simulations"] = int(sum(phys[h["_id"]]["sims"] for h in all_homes))
    bal["simulations_failed"] = int(sum(phys[h["_id"]]["bal_fail"] for h in all_homes))
    bal["max_residual_kwh"] = float(max((phys[h["_id"]]["bal_worst"][0] for h in all_homes), default=0.0))
    out.append(bal)
    return out


def honesty(adv, errors, designs, phys) -> dict:
    """Adversarial homes: a plain-word error or a flag, never a silent design."""
    rows, by_kind = [], {}
    for h in adv:
        e = errors.get(h["_id"])
        if e:
            ok, note, d = True, f"Rejected: {e}", None
        else:
            p, d = phys[h["_id"]], designs[h["_id"]]
            flags = list(p.get("hard", {}).values()) + p.get("phys_warn", []) + ([p["error"]] if "error" in p else [])
            ok, note = bool(flags), (" ".join(flags) if flags else "Designed with no error and no flag.")
        by_kind.setdefault(h["_kind"], []).append(ok)
        rows.append((ok, 1.0, {"kind": h["_kind"], "inputs": show(h), "design": d, "note": note}))
    inv = _inv("Adversarial inputs get an error or a flag", "honesty", rows, "Contradictory or placeholder inputs: a plain-word error or a flag, never a silent design.")
    inv["by_kind"] = {k: round(float(np.mean(x)), 4) for k, x in sorted(by_kind.items())}
    # worst: one per failing kind first
    seen, first = set(), []
    for r in rows:
        if not r[0] and r[2]["kind"] not in seen:
            seen.add(r[2]["kind"])
            first.append(r[2])
    inv["worst"] = first[:5]
    return inv
