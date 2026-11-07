"use client";
// Small SVG charts for the battery and value layers. Numbers come from POST /api/explain/layers.
import { useEffect, useState } from "react";
import type { DayHour, FrontierPoint, Layers } from "./types";
import { labelOf } from "./types";
import s from "./spatial.module.css";

const n1 = (x: number) => x.toLocaleString("en-GB", { maximumFractionDigits: 1 });
const eur = (x: number) => `${Math.round(x).toLocaleString("en-GB")}`;

// The hours after sunset: from the first evening hour when the roof no longer covers the home,
// through midnight, until the sun covers the home again (the same day's early hours stand in for the next morning).
export function nightHours(hours: DayHour[]): DayHour[] {
  if (!hours.length) return [];
  const noon = hours.findIndex((x) => x.h >= 12);
  let start = -1;
  for (let i = Math.max(0, noon); i < hours.length; i++) if (hours[i].pv_kw < hours[i].load_kw && hours.slice(i).every((x) => x.pv_kw < 0.5)) { start = i; break; }
  if (start < 0) return [];
  const out = hours.slice(start);
  for (const x of hours) { if (x.pv_kw >= x.load_kw && x.pv_kw > 0.2) break; out.push(x); }
  return out;
}

export function BatteryChart({ layers, battery, reduce }: { layers: Layers; battery: number | null; reduce: boolean }) {
  const { night, day } = layers;
  const nh = nightHours(day.hours);
  const [k, setK] = useState(reduce ? 1 : 0);
  useEffect(() => {
    if (reduce) { setK(1); return; }
    setK(0);
    let raf = 0; const t0 = performance.now(), w = (2 * Math.PI) / 0.5;
    const tick = (t: number) => { const x = (t - t0) / 1000; const v = 1 - (1 + w * x) * Math.exp(-w * x); setK(v); if (x < 1) raf = requestAnimationFrame(tick); else setK(1); };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [battery, reduce]);

  const W = 300, H = 170, pad = { l: 8, r: 8, t: 14, b: 26 };
  // Left: load per hour after sunset (kW). Right: the store in kWh.
  const lw = 190, maxKw = Math.max(0.5, ...nh.map((x) => x.load_kw));
  const bw = (lw - pad.l) / Math.max(1, nh.length);
  const top = Math.max(night.evening_kwh, night.htw_cap_kwh, battery ?? 0) * 1.12 || 1;
  const tx = lw + 34, tw = 46, ty = (v: number) => H - pad.b - (v / top) * (H - pad.b - pad.t);
  const fill = (battery ?? 0) * k;
  return (
    <svg className={s.chart} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Use after sunset ${n1(night.evening_kwh)} kWh, battery ${battery == null ? "none" : `${n1(battery)} kWh`}, HTW cap ${n1(night.htw_cap_kwh)} kWh`}>
      {nh.map((x, i) => {
        const h = (x.load_kw / maxKw) * (H - pad.b - pad.t);
        const fromBatt = x.load_kw > 0 ? Math.min(1, Math.max(0, x.battery_kw) / x.load_kw) : 0;
        return (
          <g key={i}>
            <rect x={pad.l + i * bw + 1} y={H - pad.b - h} width={bw - 2} height={h} className={s.cBar} />
            <rect x={pad.l + i * bw + 1} y={H - pad.b - h * fromBatt} width={bw - 2} height={h * fromBatt} className={s.cBarFill} style={{ opacity: k }} />
            {(i === 0 || i === nh.length - 1 || x.h === 0) && <text x={pad.l + i * bw + bw / 2} y={H - 10} className={s.cTick} textAnchor="middle">{String(x.h).padStart(2, "0")}</text>}
          </g>
        );
      })}
      <line x1={pad.l} x2={lw} y1={H - pad.b} y2={H - pad.b} className={s.cAxis} />
      <text x={pad.l} y={10} className={s.cTick}>kW after sunset, {day.date.split(" (")[0]}</text>

      <rect x={tx} y={ty(night.evening_kwh)} width={tw} height={ty(0) - ty(night.evening_kwh)} className={s.cTank} />
      <rect x={tx} y={ty(fill)} width={tw} height={ty(0) - ty(fill)} className={s.cFill} />
      <line x1={tx - 8} x2={tx + tw + 8} y1={ty(night.htw_cap_kwh)} y2={ty(night.htw_cap_kwh)} className={s.cCap} />
      <text x={tx + tw + 10} y={ty(night.htw_cap_kwh) + 4} className={s.cTick}>cap</text>
      <text x={tx - 6} y={ty(night.evening_kwh) - 4} className={s.cTick} textAnchor="end">use {n1(night.evening_kwh)}</text>
      <text x={tx + tw / 2} y={H - 10} className={s.cTick} textAnchor="middle">kWh</text>
      <line x1={tx - 4} x2={tx + tw + 4} y1={H - pad.b} y2={H - pad.b} className={s.cAxis} />
    </svg>
  );
}

function pareto(points: FrontierPoint[]) {
  if (points.some((p) => p.on_frontier)) return points.filter((p) => p.on_frontier).sort((a, b) => a.capex_eur - b.capex_eur);
  const sorted = [...points].sort((a, b) => a.capex_eur - b.capex_eur);
  const out: FrontierPoint[] = []; let best = -Infinity;
  for (const p of sorted) if (p.npv_20y_eur > best) { out.push(p); best = p.npv_20y_eur; }
  return out;
}

export function FrontierChart({ frontier }: { frontier: FrontierPoint[] }) {
  if (!frontier.length) return null;
  const W = 360, H = 230, pad = { l: 40, r: 12, t: 16, b: 28 };
  const front = pareto(frontier);
  const xs = frontier.map((p) => p.capex_eur), fy = front.map((p) => p.npv_20y_eur);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y1 = Math.max(...fy);
  // Dominated sizes far below the frontier would squash it; the axis starts a little under the frontier's lowest point.
  const y0 = Math.min(0, Math.min(...fy) - (y1 - Math.min(...fy)) * 0.6);
  const shown = frontier.filter((p) => p.npv_20y_eur >= y0);
  const X = (v: number) => pad.l + ((v - x0) / Math.max(1, x1 - x0)) * (W - pad.l - pad.r);
  const Y = (v: number) => H - pad.b - ((v - y0) / Math.max(1, y1 - y0)) * (H - pad.b - pad.t);
  const line = front.map((p, i) => `${i ? "L" : "M"}${X(p.capex_eur).toFixed(1)},${Y(p.npv_20y_eur).toFixed(1)}`).join(" ");
  const labelled = frontier.filter((p) => p.label || p.chosen).sort((a, b) => a.capex_eur - b.capex_eur);
  const yTicks = [y0, (y0 + y1) / 2, y1].map((v) => Math.round(v / 1000) * 1000);
  return (
    <svg className={s.chart} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Upfront cost against 20-year value for every size the engine swept">
      {yTicks.map((v) => <g key={v}><line x1={pad.l} x2={W - pad.r} y1={Y(v)} y2={Y(v)} className={s.cGrid} /><text x={pad.l - 4} y={Y(v) + 3} className={s.cTick} textAnchor="end">{eur(v / 1000)}k</text></g>)}
      <line x1={pad.l} x2={W - pad.r} y1={H - pad.b} y2={H - pad.b} className={s.cAxis} />
      <text x={pad.l} y={H - 6} className={s.cTick}>{eur(x0)} EUR</text>
      <text x={W - pad.r} y={H - 6} className={s.cTick} textAnchor="end">{eur(x1)} EUR upfront</text>
      <text x={pad.l + 2} y={pad.t - 2} className={s.cTick}>20-year value, EUR</text>
      {shown.map((p, i) => <circle key={i} cx={X(p.capex_eur)} cy={Y(p.npv_20y_eur)} r={2.2} className={s.cDot} />)}
      <path d={line} className={s.cLine} />
      {labelled.map((p, i) => {
        const cx = X(p.capex_eur), cy = Y(p.npv_20y_eur), right = cx < W * 0.55;
        // The chosen point is labelled above, the others below in steps so labels do not collide.
        const dy = p.chosen ? -9 : 16 + (i % 2) * 13;
        return (
          <g key={`l${i}`}>
            <circle cx={cx} cy={cy} r={p.chosen ? 5 : 4} className={p.chosen ? s.cChosen : s.cAlt} />
            {!p.chosen && <line x1={cx} y1={cy + 4} x2={cx} y2={cy + dy - 9} className={s.cGrid} />}
            <text x={cx + (right ? 4 : -4)} y={cy + dy} className={p.chosen ? s.cLabelStrong : s.cLabel} textAnchor={right ? "start" : "end"}>{labelOf(p)}</text>
          </g>
        );
      })}
    </svg>
  );
}
