"use client";
import type { Design, Economics, Optimum } from "@/lib/api";
import { fmt } from "@/lib/client";

const ROWS: { field: keyof Design; name: string; unit: string }[] = [
  { field: "pv_kwp", name: "PV array", unit: "kWp" },
  { field: "battery_kwh", name: "Battery", unit: "kWh" },
  { field: "heatpump_kw", name: "Heat pump", unit: "kW" },
  { field: "wallbox_kw", name: "Wallbox", unit: "kW" },
];
const size = (x: number | null, u: string) => x == null ? "none" : `${fmt.n(x)} ${u}`;
const signed = (x: number | null, f: (v: number) => string) => x == null ? "n/a" : `${x > 0 ? "+" : x < 0 ? "-" : ""}${f(Math.abs(x))}`;

export default function OptimumBlock({ design, economics, optimum }: { design: Design; economics: Economics; optimum: Optimum }) {
  const o = optimum.economics, d = optimum.delta_vs_proposal;
  const money = [
    { name: "Investment", ours: fmt.eur(economics.capex_eur), opt: fmt.eur(o.capex_eur), delta: signed(d.capex_eur, fmt.eur) },
    { name: "Saving a year", ours: fmt.eur(economics.annual_saving_eur), opt: fmt.eur(o.annual_saving_eur), delta: signed(d.annual_saving_eur, fmt.eur) },
    { name: "Payback", ours: economics.payback_years == null ? "n/a" : `${fmt.n(economics.payback_years, 1)} yrs`, opt: o.payback_years == null ? "n/a" : `${fmt.n(o.payback_years, 1)} yrs`, delta: signed(d.payback_years, (v) => `${fmt.n(v, 1)} yrs`) },
    { name: "Autarky", ours: fmt.pct(economics.autarky_share), opt: fmt.pct(o.autarky_share), delta: signed(d.autarky_share == null ? null : Math.round(d.autarky_share * 100), (v) => `${v} pts`) },
  ];
  return (
    <section className="section optimum" aria-label="Economic optimum">
      <h2>Economic optimum</h2>
      <p className="opt-note">{optimum.note}</p>
      <div className="scroll">
        <table className="data">
          <thead><tr><th></th><th className="num">Proposal</th><th className="num">Optimum</th><th className="num">Difference</th></tr></thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.field} className={design[r.field] !== optimum.design[r.field] ? "differs" : undefined}>
                <td>{r.name}</td>
                <td className="num">{size(design[r.field], r.unit)}</td>
                <td className="num">{size(optimum.design[r.field], r.unit)}</td>
                <td></td>
              </tr>
            ))}
            {money.map((m) => (
              <tr key={m.name}><td>{m.name}</td><td className="num">{m.ours}</td><td className="num">{m.opt}</td><td className="num">{m.delta}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
