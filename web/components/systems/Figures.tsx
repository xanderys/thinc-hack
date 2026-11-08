"use client";
// Figures for the calculation cards: no sentences, the engine's numbers drawn. One accent hue (Reonic electric blue)
// in three validated steps for the day split, the x-ray's own scale for the heat-loss shares, a neutral track.
// Every bar carries its value as text beside it, so nothing is colour alone; segments keep a 2 px surface gap.
import type { ReactNode } from "react";

const n0 = (x: number) => Math.round(x).toLocaleString("en-GB");
export const SPLIT = ["#6f7ff0", "#2a3bc4", "#0a1450"];   // light to dark; dataviz validator: CVD 17.1, normal 20.3, contrast >= 3:1

// The card's title: the figure that matters bold, its unit or second figure lighter, one line.
export function Head({ main, sub }: { main: string; sub?: string | null }) {
  return <><b>{main}</b>{sub ? <span className="sc-sub"> {sub}</span> : null}</>;
}

// Panels: what the roof makes against what the home uses. The Home bar is stacked, household then car, with the
// total at its end, so the sum is always visible; the share the roof covers is named under it.
export function PairBars({ roof, parts, share }: { roof: number; parts: { k: string; v: number }[]; share: number | null }) {
  const shown = parts.filter((p) => p.v > 0), home = shown.reduce((a, p) => a + p.v, 0);
  const max = Math.max(roof, home, 1), cov = share != null ? Math.max(0, Math.min(1, share)) : null;
  const HOME = ["#2a3bc4", "#6f7ff0"];
  return (
    <div className="fg-pair" role="img" aria-label={`Roof ${n0(roof)} kWh a year; home ${shown.map((p) => `${p.k.toLowerCase()} ${n0(p.v)}`).join(" plus ")}, ${n0(home)} kWh a year${cov != null ? `; ${Math.round(cov * 100)} % from the roof` : ""}`}>
      <span className="fg-k">Roof</span>
      <span className="fg-track"><i className="fg-fill" style={{ width: `${(roof / max) * 100}%` }} /></span>
      <span className="fg-v"><b>{n0(roof)}</b> kWh a year</span>
      <span className="fg-k">Home</span>
      <span className="fg-stack" style={{ width: `${(home / max) * 100}%` }}>{shown.map((p, i) => <i key={p.k} style={{ flexGrow: p.v, background: HOME[i % HOME.length] }} />)}</span>
      <span className="fg-v"><b>{n0(home)}</b> kWh a year</span>
      <ul className="fg-legend fg-under">
        {shown.map((p, i) => <li key={p.k}><i style={{ background: HOME[i % HOME.length] }} />{p.k} <b>{n0(p.v)}</b></li>)}
        {cov != null && <li className="fg-cov"><b>{Math.round(cov * 100)} %</b> from the roof</li>}
      </ul>
    </div>
  );
}

// A stacked bar of parts of one total, each part labelled under it with its value.
export function SplitBar({ parts, unit, colours = SPLIT, label }: { parts: { k: string; v: number; c?: string }[]; unit: string; colours?: string[]; label: string }) {
  const shown = parts.filter((p) => p.v > 0), sum = shown.reduce((a, p) => a + p.v, 0) || 1;
  const fmt = (v: number) => (v >= 100 ? n0(v) : (Math.round(v * 10) / 10).toLocaleString("en-GB"));
  return (
    <div className="fg-split" role="img" aria-label={`${label}: ${shown.map((p) => `${p.k} ${fmt(p.v)} ${unit}`).join(", ")}`}>
      <span className="fg-bar">{shown.map((p, i) => <i key={p.k} style={{ flexGrow: p.v / sum, background: p.c ?? colours[i % colours.length] }} />)}</span>
      <ul className="fg-legend">{shown.map((p, i) => <li key={p.k}><i style={{ background: p.c ?? colours[i % colours.length] }} />{p.k} <b>{fmt(p.v)}</b>{unit ? ` ${unit}` : ""}</li>)}</ul>
    </div>
  );
}

// Linked figures: one quantity turning into the next, with a thin connector between them.
export function Chainline({ steps }: { steps: { v: string; u: string }[] }) {
  return (
    <ol className="fg-chain">
      {steps.map((s, i) => <li key={i}>{i > 0 && <span className="fg-arrow" aria-hidden="true" />}<b>{s.v}</b><span>{s.u}</span></li>)}
    </ol>
  );
}

// One figure with its lighter qualifier, for a single number under a bar.
export function Fig({ v, u }: { v: string; u: ReactNode }) {
  return <p className="fg-fig"><b>{v}</b> <span>{u}</span></p>;
}
