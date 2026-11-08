"use client";
import { Fix } from "@/components/DesignSheet";
import type { Design, DesignResponse, OverrideValue, Overrides } from "@/lib/api";
import { COMPONENT_DESIGN_FIELD } from "@/lib/api";
import { KEYS, n2, NAME } from "@/lib/stage";

export type Moved = { cause: string; lines: { name: string; from: number | null; to: number | null; unit: string; why?: string }[] };

export const UNIT: Record<keyof Design, string> = { pv_kwp: "kWp", inverter_kw: "kW", battery_kwh: "kWh", heatpump_kw: "kW", wallbox_kw: "kW" };
export const STEP: Record<string, number> = { pv: 0.5, battery: 2.5, heatpump: 1, wallbox: 11 };

type Props = {
  res: DesignResponse;
  moved: Moved | null; canUndo: boolean; onUndo: () => void;
  approvedAt: string | null; onApprove: () => void;
  overrides: Overrides; setOverride: (f: keyof Design, v: OverrideValue | undefined) => void;
};

export default function Refine(p: Props) {
  return (
    <section className="s-refine" aria-label="Change it by hand">
      <div>
        {p.moved && p.moved.lines.length > 0 && (
          <div className="s-moved" aria-live="polite">
            <p className="cause">{p.moved.cause}</p>
            <ul>
              {p.moved.lines.map((l) => (
                <li key={l.name} className="s-mark">{l.name}: <span className="num">{l.from == null ? "none" : n2(l.from)}</span> <span className="ar">→</span> <span className="num">{l.to == null ? "none" : `${n2(l.to)} ${l.unit}`}</span>{l.why && <span className="why2">{l.why}</span>}</li>
              ))}
            </ul>
          </div>
        )}
        {p.moved && p.moved.lines.length === 0 && <p className="s-quiet">{p.moved.cause} Nothing in the design moved.</p>}
        <details className="s-hand">
          <summary>Change by hand</summary>
          {KEYS.map((k) => {
            const f = COMPONENT_DESIGN_FIELD[k];
            return <div className="s-handrow" key={k}><span className="n">{NAME[k]}</span><Fix field={f} current={p.res.design[f]} unit={UNIT[f]} step={STEP[k]} overrides={p.overrides} setOverride={p.setOverride} /></div>;
          })}
        </details>
      </div>
      <div className="s-decide">
        <button className="btn ghost" onClick={p.onUndo} disabled={!p.canUndo}>Undo</button>
        {p.approvedAt
          ? <span className="s-approved s-mark">Complete<a href="/check">See what really happened</a></span>
          : <button className="btn" onClick={p.onApprove}>Complete</button>}
      </div>
    </section>
  );
}
