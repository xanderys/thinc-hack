"""Textbook-vs-practice gap table: per rule, the textbook value, the planners' median and IQR, by installer. Fit half, new-system jobs, aggregates only.

    cd engine && uv run python -m lab.gap_table
Textbook = Engine.baseline (rule of thumb): PV 1.3 kWp per MWh of use plus 2.5 kWp with an EV; battery the installer's median size when at least half of its jobs have one;
wallbox 11 kW with an EV; no heat pump. DC/AC 1.2 is the rules-2 midpoint of the 1.1 to 1.3 range.
"""
import os
for _v in ("OMP_NUM_THREADS", "MKL_NUM_THREADS", "OPENBLAS_NUM_THREADS"):
    os.environ[_v] = "1"
from pathlib import Path
import numpy as np
import pandas as pd
from app import data
from lab.score_rules import NEW_SYSTEM
from lab.split import load_split


def q(x):
    x = pd.Series(x).dropna()
    return (len(x), x.median(), x.quantile(0.25), x.quantile(0.75)) if len(x) else (0, np.nan, np.nan, np.nan)


def main():
    df = data.load()[0]
    pop = df[~((df.pv_kwp > 40) | (df.battery_kwh > 40) | (df.annual_demand_kwh < 500) | (df.annual_demand_kwh > 30000))]
    pop = pop.assign(project_id=pop.project_id.astype(str)).reset_index(drop=True)
    fit_ids, _ = load_split()
    fit = NEW_SYSTEM(pop[pop.project_id.isin(set(fit_ids))].reset_index(drop=True))
    rows = []
    fmt = lambda v, f="{:.2f}": "n/a" if pd.isna(v) else f.format(v)
    for inst, g in sorted(fit.groupby("installer_id"), key=lambda kv: kv[0]):
        mwh = g.annual_demand_kwh / 1000
        ev = g.has_ev.astype(bool)
        pvg = g[g.pv_kwp > 0]
        mw = pvg.annual_demand_kwh / 1000
        n, m, lo, hi = q((pvg.pv_kwp / mw)[~pvg.has_ev.astype(bool)])
        rows.append(("PV, homes without an EV: kWp per MWh of use", inst, n, "1.30", fmt(m), f"{fmt(lo)} to {fmt(hi)}"))
        n, m, lo, hi = q((pvg.pv_kwp - 1.3 * mw)[pvg.has_ev.astype(bool)])
        rows.append(("PV, homes with an EV: kWp above 1.3 per MWh", inst, n, "2.50", fmt(m), f"{fmt(lo)} to {fmt(hi)}"))
        bat = g[g.battery_kwh > 0]
        share = len(bat) / len(g)
        tb = "median size" if share >= 0.5 else "none"
        rows.append(("Battery: share of homes with one", inst, len(g), "yes" if share >= 0.5 else "no", f"{share * 100:.0f}%", "n/a"))
        n, m, lo, hi = q(bat.battery_kwh)
        rows.append(("Battery size, kWh, where fitted (textbook: installer median, " + tb + ")", inst, n, fmt(m, "{:.1f}"), fmt(m, "{:.1f}"), f"{fmt(lo, '{:.1f}')} to {fmt(hi, '{:.1f}')}"))
        e = g[ev]
        rows.append(("Wallbox: share of EV homes with one", inst, len(e), "100%", f"{(e.wallbox_kw > 0).mean() * 100:.0f}%" if len(e) else "n/a", "n/a"))
        n, m, lo, hi = q(e[e.wallbox_kw > 0].wallbox_kw)
        rows.append(("Wallbox size, kW, where fitted", inst, n, "11.0", fmt(m, "{:.1f}"), f"{fmt(lo, '{:.1f}')} to {fmt(hi, '{:.1f}')}"))
        rows.append(("Heat pump: share of homes with one", inst, len(g), "0%", f"{(g.heatpump_kw > 0).mean() * 100:.1f}%", "n/a"))
        n, m, lo, hi = q((pvg.pv_kwp / pvg.inverter_kw.replace(0, np.nan)))
        rows.append(("DC/AC ratio (PV kWp over inverter kW)", inst, n, "1.20", fmt(m), f"{fmt(lo)} to {fmt(hi)}"))
    md = ["# Textbook against practice", "",
          f"Fit half, {len(fit)} new-system jobs, by installer, aggregates only. Textbook = the engine's rule of thumb (1.3 kWp per MWh + 2.5 kWp with an EV, battery at the installer's median, 11 kW wallbox with an EV, no heat pump) "
          "and DC/AC 1.2. Planners' median and IQR (25th to 75th percentile) are over the installer's own jobs. The pure Reonic textbook rows are added when the rules-5 module exposes it.", "",
          "| Rule | Installer | n | Textbook | Planners' median | IQR |", "|---|---|---|---|---|---|"]
    md += [f"| {r[0]} | {r[1]} | {r[2]} | {r[3]} | {r[4]} | {r[5]} |" for r in rows]
    out = "\n".join(md)
    (Path(__file__).parent / "reports" / "gap_table.md").write_text(out + "\n")
    print(out)


if __name__ == "__main__":
    main()
