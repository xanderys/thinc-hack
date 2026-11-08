"use client";
// Chip "Shading", its card (Shading X %, Y kWh a year loss, source) and the month and hour scrubber.
// Renders nothing until GET /api/roof/shading is ready for this address and kWp.
import { useEffect, useRef, useState } from "react";
import { dayHours, SHADE_GRADIENT, setShadeAt, setShadeOn, useShadeView, useShading, type ShadeAt } from "@/lib/shading";
import s from "./ShadingScrubber.module.css";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// Sunrise to sunset on the 15th of month m as the hours h whose h:30 has the sun up, at Munich (48.14 N, 11.58 E),
// German clock time (summer time April to October). Declination and equation of time from the NOAA approximations,
// within a few minutes: enough for whole half-past slots. Hours outside the engine's data read "no direct sun".
const DOY = [15, 46, 74, 105, 135, 166, 196, 227, 258, 288, 319, 349];
function sunHours(m: number): [number, number] {
  const n = DOY[m - 1], rad = Math.PI / 180, lat = 48.14, lon = 11.58;
  const dec = 23.44 * Math.sin((2 * Math.PI * (284 + n)) / 365);
  const w0 = Math.acos(Math.max(-1, Math.min(1, -Math.tan(lat * rad) * Math.tan(dec * rad)))) / rad;
  const B = (2 * Math.PI * (n - 81)) / 364, eot = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);
  const noon = 12 - lon / 15 + (m >= 4 && m <= 10 ? 2 : 1) - eot / 60, half = w0 / 15;
  return [Math.ceil(noon - half - 0.5), Math.floor(noon + half - 0.5)];
}
const hh = (h: number) => `${String(h).padStart(2, "0")}:30`;
const pct1 = (x: number) => `${(Math.round(x * 1000) / 10).toLocaleString("en-GB")} %`;
const n0 = (x: number) => Math.round(x).toLocaleString("en-GB");

// compact: the phone strip under the model (one line, months and hour in one row, source on tap).
// start: the moment the Solar stage lands on (null: across the year).
type Props = { address?: string | null; kwp?: number | null; solarStage?: boolean; float?: boolean; compact?: boolean; start?: ShadeAt };

export default function ShadingPanel({ address, kwp, solarStage, float, compact, start = null }: Props) {
  const [src, setSrc] = useState(false);
  const data = useShading(address, kwp);
  const { on, at } = useShadeView();
  // The Solar stage lands on the year's figure, or on the given moment.
  const was = useRef(false);
  useEffect(() => {
    if (solarStage && !was.current && data) { setShadeOn(true); setShadeAt(start); }
    was.current = !!solarStage && !!data;
  }, [solarStage, data]);
  if (!data || !data.modules.length) return null;

  const month = at?.m ?? 6;
  // A month's slider runs sunrise to sunset, and wider if the engine has sun on a module outside it.
  const span = (m: number): [number, number] => { const [a, b] = dayHours(data, m), [c, d] = sunHours(m); return [Math.min(a, c), Math.max(b, d)]; };
  const [lo, hi] = span(month);
  const hour = at ? Math.min(hi, Math.max(lo, at.h)) : Math.round((lo + hi) / 2);
  const lit = at ? data.modules.map((m) => m.hourly[at.m - 1]?.[at.h]).filter((v): v is number => v != null) : [];
  const litShare = lit.length ? lit.reduce((a, b) => a + b, 0) / lit.length : null;

  if (compact) return (
    <div className={s.strip}>
      <div className={s.stripHead}>
        <button type="button" className={s.chip} aria-pressed={on} onClick={() => setShadeOn(!on)}>Shading</button>
        <p className={s.head}><b>{pct1(data.total.shade_share)}</b>, <b>{n0(data.total.loss_kwh_year)}</b> kWh a year loss</p>
        <button type="button" className={s.srcBtn} aria-expanded={src} onClick={() => setSrc((x) => !x)}>Source</button>
      </div>
      {on && (
        <div className={s.stripRow}>
          <div className={s.monthsC} role="group" aria-label="Month">
            <button type="button" aria-pressed={!at} onClick={() => setShadeAt(null)}>Year</button>
            {MONTHS.map((m, i) => (
              <button key={m} type="button" aria-pressed={!!at && at.m === i + 1} aria-label={m} onClick={() => { const [a, b] = span(i + 1); setShadeAt({ m: i + 1, h: Math.min(b, Math.max(a, at?.h ?? 13)) }); }}>{m[0]}</button>
            ))}
          </div>
          <input type="range" min={lo + 0.5} max={hi + 0.5} step={1} value={hour + 0.5} aria-valuetext={hh(hour)} aria-label="Hour of the day" onChange={(e) => setShadeAt({ m: month, h: Math.floor(Number(e.target.value)) })} />
        </div>
      )}
      {on && <span className={s.whenC}>{at ? `15 ${MONTHS[at.m - 1]}, ${hh(at.h)}${litShare != null ? `, ${Math.round(litShare * 100)} % in sun` : ", no direct sun"}` : "Solar access over the year"}</span>}
      {src && <p className={s.src}>{data.source}</p>}
    </div>
  );

  return (
    <div className={float ? `${s.wrap} ${s.float}` : s.wrap} data-cover={float ? "" : undefined}>
      <button type="button" className={s.chip} aria-pressed={on} onClick={() => setShadeOn(!on)}>Shading</button>
      {on && (
        <div className={s.card}>
          <p className={s.head}>Shading <b>{pct1(data.total.shade_share)}</b>, <b>{n0(data.total.loss_kwh_year)}</b> kWh a year loss</p>
          <div className={s.scale} aria-hidden="true"><i style={{ background: SHADE_GRADIENT }} /><span>60 %</span><span>100 % sun</span></div>
          <div className={s.months} role="group" aria-label="Month">
            <button type="button" className={s.year} aria-pressed={!at} onClick={() => setShadeAt(null)}>Across the year</button>
            {MONTHS.map((m, i) => (
              <button key={m} type="button" aria-pressed={!!at && at.m === i + 1} aria-label={m} onClick={() => { const [a, b] = span(i + 1); setShadeAt({ m: i + 1, h: Math.min(b, Math.max(a, at?.h ?? 13)) }); }}>{m[0]}</button>
            ))}
          </div>
          <div className={s.hour}>
            <input type="range" min={lo + 0.5} max={hi + 0.5} step={1} value={hour + 0.5} aria-valuetext={hh(hour)} aria-label="Hour of the day"
              onChange={(e) => setShadeAt({ m: month, h: Math.floor(Number(e.target.value)) })} />
            <span className={s.when}>{at ? `15 ${MONTHS[at.m - 1]}, ${hh(at.h)}${litShare != null ? `, ${Math.round(litShare * 100)} % in sun` : ", no direct sun"}` : "Solar access over the year"}</span>
          </div>
          <p className={s.src}>{data.source}</p>
        </div>
      )}
    </div>
  );
}
