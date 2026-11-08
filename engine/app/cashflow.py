"""Reonic's cashflow chart from the hourly economics: the same undiscounted flows break_even_year counts
(avoided purchases rise with prices, feed-in fixed, both degrade with the PV, upkeep each year; the battery replacement and
its year-20 residual counted as the NPV counts them)."""
from .hourly import sim as S


def add(inputs: dict, design: dict, econ: dict) -> dict:
    """Adds cashflow_yearly_eur (years 0 to 20, year 0 minus the investment) and cashflow_cumulative_eur to econ in place."""
    try:
        a, capex = econ.get("annual") or {}, econ.get("capex_eur") or 0
        if not capex or econ.get("method") != "hourly-simulation":
            return econ
        inc_b = 0.0
        if inputs.get("has_solar"):
            before = S._flows(inputs, S.before_design(design), "Munich")
            inc_b = S._bill(inputs, before, 0, "Munich")[1]
        income = (a.get("feed_in_income_eur") or 0) - inc_b
        energy = (a.get("bill_before_eur") or 0) - (a.get("bill_after_eur") or 0) - income
        opex = S.OPEX_SHARE * S._capex(inputs, design)[1]
        flows = S._flows_by_year(energy, income, opex) + S.replacement_flows(econ.get("battery_replacement"))
        yearly = [-round(capex)] + [round(float(x)) for x in flows]
        cum, run = [], 0
        for x in yearly:
            run += x
            cum.append(run)
        econ["cashflow_yearly_eur"], econ["cashflow_cumulative_eur"] = yearly, cum
    except Exception:
        pass
    return econ
