"""Economic optimum over the installer's catalogue sizes."""
from .. import physics as rules
from .sim import simulate

NPV_TIE_EUR, NPV_TIE_SHARE = 500, 0.10  # NPV gaps below this are inside the model error


def _design(base, pv, bat):
    return {**base, "pv_kwp": pv or None, "inverter_kw": rules.inverter_kw(pv) if pv else None, "battery_kwh": bat or None}


def optimum(inputs: dict, catalogue: dict, proposal: dict | None = None, location="Munich") -> dict:
    """catalogue: {"pv_kwp": [...], "battery_kwh": [...]}; 0 means none and is always tried.
    Heat pump and wallbox are kept from the proposal."""
    base = {k: (proposal or {}).get(k) for k in ("heatpump_kw", "wallbox_kw")}
    pvs = sorted({0.0, *map(float, catalogue.get("pv_kwp", []))})
    bats = sorted({0.0, *map(float, catalogue.get("battery_kwh", []))})
    runs = []
    for pv in pvs:
        for bat in bats:
            if bat and not pv and not inputs.get("has_solar"):
                continue
            d = _design(base, pv, bat)
            e = simulate(inputs, d, location).economics
            runs.append((e["annual"]["npv_20y_eur"] or 0.0, e["capex_eur"], d, e))
    best = max(r[0] for r in runs)
    near = [r for r in runs if r[0] >= best - max(NPV_TIE_EUR, NPV_TIE_SHARE * abs(best))]
    if proposal:  # where the maths cannot tell designs apart, keep the expert's
        pp, pb = proposal.get("pv_kwp") or 0, proposal.get("battery_kwh") or 0
        pick = lambda r: abs((r[2]["pv_kwp"] or 0) - pp) / 2 + abs((r[2]["battery_kwh"] or 0) - pb) / 2.5
    else:
        pick = lambda r: r[1]
    npv, _, design, econ = min(near, key=pick)

    out = {"design": design, "economics": econ}
    if proposal:
        pe = simulate(inputs, proposal, location).economics
        out["delta_vs_proposal"] = {
            "capex_eur": float(round(econ["capex_eur"] - pe["capex_eur"], -1)),
            "annual_saving_eur": float(round(econ["annual_saving_eur"] - pe["annual_saving_eur"], -1)),
            "payback_years": round(float(econ["payback_years"] - pe["payback_years"]), 1)
            if econ["payback_years"] is not None and pe["payback_years"] is not None else None,
            "autarky_share": round(float(econ["autarky_share"] - pe["autarky_share"]), 3),
        }
        out["note"] = _note(proposal, design, econ, pe)
    else:
        out["delta_vs_proposal"] = {"capex_eur": 0, "annual_saving_eur": 0, "payback_years": 0, "autarky_share": 0}
        out["note"] = f"Best 20-year value: {_label(design)}."
    return out


def _label(d):
    pv, bat = d.get("pv_kwp") or 0, d.get("battery_kwh") or 0
    return f"{pv:g} kWp" + (f" with {bat:g} kWh" if bat else " with no battery") if pv else "no PV"


def _note(prop, opt, oe, pe):
    dn = (oe["annual"]["npv_20y_eur"] or 0) - (pe["annual"]["npv_20y_eur"] or 0)
    same = (prop.get("pv_kwp") or 0) == (opt.get("pv_kwp") or 0) and (prop.get("battery_kwh") or 0) == (opt.get("battery_kwh") or 0)
    if same:
        return f"The proposal ({_label(prop)}) is at the economic optimum for this home."
    da = oe["autarky_share"] - pe["autarky_share"]
    return (f"{_label(opt)} earns EUR {dn:,.0f} more over 20 years than the proposal ({_label(prop)}), "
            f"at {abs(da) * 100:.0f} points {'more' if da >= 0 else 'less'} autarky.")
