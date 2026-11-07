"use client";
// Chip "Shading simulation", its card (Shading X %, Y kWh a year loss, source) and the month and hour scrubber.
// Renders nothing until GET /api/roof/shading is ready for this address and kWp.
import { useEffect, useRef, useState } from "react";
import { dayHours, SHADE_GRADIENT, setShadeAt, setShadeOn, useShadeView, useShading } from "@/lib/shading";
import s from "./ShadingScrubber.module.css";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pct1 = (x: number) => `${(Math.round(x * 1000) / 10).toLocaleString("en-GB")} %`;
const n0 = (x: number) => Math.round(x).toLocaleString("en-GB");

// compact: the phone strip under the model (one line, months and hour in one row, source on tap).
type Props = { address?: string | null; kwp?: number | null; solarStage?: boolean; float?: boolean; compact?: boolean };

export default function ShadingPanel({ address, kwp, solarStage, float, compact }: Props) {
  const [src, setSrc] = useState(false);
  const data = useShading(address, kwp);
  const { on, at } = useShadeView();
  // The Solar stage lands on the year's figure.
  const was = useRef(false);
  useEffect(() => {
    if (solarStage && !was.current && data) { setShadeOn(true); setShadeAt(null); }
    was.current = !!solarStage && !!data;
  }, [solarStage, data]);
  if (!data || !data.modules.length) return null;

  const month = at?.m ?? 6;
  const [lo, hi] = dayHours(data, month);
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
              <button key={m} type="button" aria-pressed={!!at && at.m === i + 1} aria-label={m} onClick={() => { const [a, b] = dayHours(data, i + 1); setShadeAt({ m: i + 1, h: Math.min(b, Math.max(a, at?.h ?? 13)) }); }}>{m[0]}</button>
            ))}
          </div>
          <input type="range" min={lo} max={hi} step={1} value={hour} aria-label="Hour of the day" onChange={(e) => setShadeAt({ m: month, h: Number(e.target.value) })} />
        </div>
      )}
      {on && <span className={s.whenC}>{at ? `15 ${MONTHS[at.m - 1]}, ${String(at.h).padStart(2, "0")}:30${litShare != null ? `, ${Math.round(litShare * 100)} % in sun` : ", no direct sun"}` : "Solar access over the year"}</span>}
      {src && <p className={s.src}>{data.source}</p>}
    </div>
  );

  return (
    <div className={float ? `${s.wrap} ${s.float}` : s.wrap} data-cover={float ? "" : undefined}>
      <button type="button" className={s.chip} aria-pressed={on} onClick={() => setShadeOn(!on)}>Shading simulation</button>
      {on && (
        <div className={s.card}>
          <p className={s.head}>Shading <b>{pct1(data.total.shade_share)}</b>, <b>{n0(data.total.loss_kwh_year)}</b> kWh a year loss</p>
          <div className={s.scale} aria-hidden="true"><i style={{ background: SHADE_GRADIENT }} /><span>60 %</span><span>100 % sun</span></div>
          <div className={s.months} role="group" aria-label="Month">
            <button type="button" className={s.year} aria-pressed={!at} onClick={() => setShadeAt(null)}>Across the year</button>
            {MONTHS.map((m, i) => (
              <button key={m} type="button" aria-pressed={!!at && at.m === i + 1} aria-label={m} onClick={() => { const [a, b] = dayHours(data, i + 1); setShadeAt({ m: i + 1, h: Math.min(b, Math.max(a, at?.h ?? 13)) }); }}>{m[0]}</button>
            ))}
          </div>
          <div className={s.hour}>
            <input type="range" min={lo} max={hi} step={1} value={hour} aria-label="Hour of the day"
              onChange={(e) => setShadeAt({ m: month, h: Number(e.target.value) })} />
            <span className={s.when}>{at ? `15 ${MONTHS[at.m - 1]}, ${String(at.h).padStart(2, "0")}:30${litShare != null ? `, ${Math.round(litShare * 100)} % in sun` : ", no direct sun"}` : "Solar access over the year"}</span>
          </div>
          <p className={s.src}>{data.source}</p>
        </div>
      )}
    </div>
  );
}
