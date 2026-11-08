"use client";
// One typical day as a 24 h strip: thin filled areas for the series, a band under it for a 0..1 state (battery fill),
// sunrise and sunset ticks on the hour axis, and the hour scrubber in the panels scrubber's own look (native range,
// accent thumb, the small tabular caption under it). Summer or winter is a two-button toggle in the month buttons' style.
// No motion of its own beyond the shimmer before the first day lands; the shimmer stops under Reduce Motion.
import type { ReactNode } from "react";
import type { Season } from "./day";
import "./strip.css";

export type Series = { k: string; v: number[]; tone: "solar" | "load" | "accent" | "soft" | "line"; axis?: "right"; unit?: string };
type Props = {
  series: Series[]; band?: { k: string; v: number[] } | null;
  hour: number; onHour: (h: number) => void;
  season?: Season; onSeason?: (s: Season) => void;
  sunrise?: number | null; sunset?: number | null;
  loading?: boolean; readout?: ReactNode; label: string;
};

const W = 240, PH = 54, BH = 12;
const hhmm = (h: number) => { const m = Math.round(h * 60); return `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; };
const x = (h: number) => (h / 23) * W;

function path(v: number[], max: number, min: number, h: number, area: boolean) {
  const y = (q: number) => h - ((q - min) / (max - min || 1)) * (h - 2);
  const pts = v.map((q, i) => `${x(i).toFixed(1)},${y(q).toFixed(1)}`);
  return area ? `M0,${h} L${pts.join(" L")} L${W},${h} Z` : `M${pts.join(" L")}`;
}

export default function DayStrip({ series, band, hour, onHour, season, onSeason, sunrise, sunset, loading, readout, label }: Props) {
  const left = series.filter((s) => s.axis !== "right"), right = series.filter((s) => s.axis === "right");
  const max = Math.max(0.5, ...left.flatMap((s) => s.v));
  const rMin = right.length ? Math.min(...right.flatMap((s) => s.v)) : 0, rMax = right.length ? Math.max(...right.flatMap((s) => s.v)) : 1;
  const pad = right.length ? Math.max(1, (rMax - rMin) * 0.15) : 0;
  const pos = (h: number) => `${(h / 23) * 100}%`;
  return (
    <div className="ds" role="group" aria-label={label}>
      <div className="ds-top">
        {onSeason && season && (
          <div className="ds-season" role="group" aria-label="Day">
            {(["summer", "winter"] as const).map((s) => <button key={s} type="button" aria-pressed={season === s} onClick={() => onSeason(s)}>{s === "summer" ? "Summer" : "Winter"}</button>)}
          </div>
        )}
        <ul className="ds-key" aria-hidden="true">
          {series.map((s) => <li key={s.k}><i className={`ds-sw ds-${s.tone}`} />{s.k}</li>)}
          {band && <li><i className="ds-sw ds-accent" />{band.k}</li>}
        </ul>
      </div>
      {loading ? <span className="ds-skel b-skel" aria-hidden="true" /> : (
        <div className="ds-plot">
          <div className="ds-chart">
            <svg viewBox={`0 0 ${W} ${PH}`} preserveAspectRatio="none" className="ds-svg" aria-hidden="true">
              {left.map((s) => s.tone === "line"
                ? <path key={s.k} d={path(s.v, max, 0, PH, false)} className="ds-l ds-line" vectorEffect="non-scaling-stroke" />
                : <g key={s.k}><path d={path(s.v, max, 0, PH, true)} className={`ds-a ds-${s.tone}`} /><path d={path(s.v, max, 0, PH, false)} className={`ds-l ds-${s.tone}`} vectorEffect="non-scaling-stroke" /></g>)}
              {right.map((s) => <path key={s.k} d={path(s.v, rMax + pad, rMin - pad, PH, false)} className="ds-l ds-temp" vectorEffect="non-scaling-stroke" />)}
              <line x1={x(hour)} x2={x(hour)} y1={0} y2={PH} className="ds-cur" vectorEffect="non-scaling-stroke" />
            </svg>
            {right.length > 0 && <span className="ds-r" aria-hidden="true"><span>{Math.round(rMax)} {right[0].unit}</span><span>{Math.round(rMin)} {right[0].unit}</span></span>}
          </div>
          {band && (
            <svg viewBox={`0 0 ${W} ${BH}`} preserveAspectRatio="none" className="ds-band" aria-hidden="true">
              <rect x={0} y={0} width={W} height={BH} className="ds-track" />
              <path d={path(band.v, 1, 0, BH, true)} className="ds-a ds-accent ds-full" />
              <line x1={x(hour)} x2={x(hour)} y1={0} y2={BH} className="ds-cur" vectorEffect="non-scaling-stroke" />
            </svg>
          )}
          <div className="ds-axis" aria-hidden="true">
            {[0, 6, 12, 18, 23].map((h) => <span key={h} style={{ left: pos(h) }}>{h === 23 ? "24" : String(h).padStart(2, "0")}</span>)}
            {sunrise != null && <i className="ds-sun" style={{ left: pos(Math.max(0, sunrise - 0.5)) }} title={`Sunrise ${hhmm(sunrise)}`} />}
            {sunset != null && <i className="ds-sun" style={{ left: pos(Math.min(23, sunset - 0.5)) }} title={`Sunset ${hhmm(sunset)}`} />}
          </div>
        </div>
      )}
      <input className="ds-range" type="range" min={0} max={23} step={1} value={hour} aria-label="Hour of the day" aria-valuetext={`${hhmm(hour + 0.5)}`}
        disabled={loading} onChange={(e) => onHour(Number(e.target.value))} />
      <span className="ds-when">{hhmm(hour + 0.5)}{readout ? <>, {readout}</> : null}</span>
    </div>
  );
}
