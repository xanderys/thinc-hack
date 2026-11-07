"use client";
import { useState } from "react";
import Listen from "./Listen";
import { Fix } from "@/components/DesignSheet";
import type { Design, DesignResponse, HomeInputs, InterpretChange, InterpretOverride, OverrideValue, Overrides } from "@/lib/api";
import { COMPONENT_DESIGN_FIELD } from "@/lib/api";
import { KEYS, n0, n2, NAME } from "@/lib/stage";

export type Moved = { cause: string; lines: { name: string; from: number | null; to: number | null; unit: string; why?: string }[] };

const FIELD: Partial<Record<keyof HomeInputs, string>> = {
  annual_demand_kwh: "Annual use", num_inhabitants: "Household", has_ev: "Electric car", ev_annual_km: "Car distance", has_wallbox: "Existing wallbox",
  heating_type: "Heating", house_size_sqm: "Floor area", house_built_year: "Year built", electricity_price_ct_kwh: "Price", has_solar: "Existing solar",
  existing_solar_kwp: "Existing solar", has_storage: "Existing battery", existing_storage_kwh: "Existing battery", heating_demand_kwh: "Heat demand", load_profile: "Load profile",
};
const show = (x: unknown) => x == null ? "none" : typeof x === "boolean" ? (x ? "yes" : "no") : typeof x === "number" ? n0(x) : String(x);
const ov = (x: OverrideValue | undefined) => x === undefined ? "auto" : x === "include" ? "include" : x == null ? "none" : n2(x);
export const UNIT: Record<keyof Design, string> = { pv_kwp: "kWp", inverter_kw: "kW", battery_kwh: "kWh", heatpump_kw: "kW", wallbox_kw: "kW" };
export const STEP: Record<string, number> = { pv: 0.5, battery: 2.5, heatpump: 1, wallbox: 11 };

type Props = {
  res: DesignResponse; llm: boolean | null;
  busy: boolean; error: string | null; onSay: (s: string, quiet?: boolean, route?: string) => Promise<boolean>;
  chips: InterpretChange[]; ovChips: InterpretOverride[]; onUnchip: (c: InterpretChange | InterpretOverride) => void;
  moved: Moved | null; canUndo: boolean; onUndo: () => void;
  approvedAt: string | null; onApprove: () => void;
  overrides: Overrides; setOverride: (f: keyof Design, v: OverrideValue | undefined) => void;
  bare?: boolean;   // in the open card: locks, Undo and Approve live in the top bar
};

export default function Refine(p: Props) {
  const [s, setS] = useState("");
  const submit = async (e: React.FormEvent) => { e.preventDefault(); if (s.trim() && await p.onSay(s.trim())) setS(""); };
  const form = (cls: string) => p.llm === false ? null : (
    <form className={cls} onSubmit={submit}>
      <input value={s} onChange={(e) => setS(e.target.value)} placeholder="The family buys an EV next year" aria-label="Describe a change to the home" disabled={p.busy} />
      <button className="btn" type="submit" disabled={p.busy || !s.trim()}>{p.busy ? "Reading" : "Apply"}</button>
    </form>
  );
  return (
    <section className={p.bare ? "s-refine bare" : "s-refine"} aria-label="Change it in a sentence">
      <div>
        <h3 className="s-h3">Change it in a sentence</h3>
        {p.llm === false && <p className="s-quiet">Sentences are off: no ANTHROPIC_API_KEY in web/.env.local. Change by hand still works.</p>}
        {form(p.bare ? "s-say" : "s-say desk")}
        {p.llm !== false && <Listen busy={p.busy} onSentence={async (t) => { setS(t); return p.onSay(t, true, "sentence-apply-listening"); }} />}
        {p.error && <div className="error" role="alert"><span><span className="src">Interpreter said</span>{p.error}</span></div>}
        {(p.chips.length > 0 || p.ovChips.length > 0) && (
          <div className="s-chips">
            {p.chips.map((c) => <span className="s-chip s-mark" key={`${c.field}${String(c.to)}`} title={c.note}>{FIELD[c.field] ?? c.field}: {show(c.from)} to {show(c.to)}{c.field === "has_ev" ? "" : ""}<button aria-label={`Undo ${FIELD[c.field] ?? c.field}`} onClick={() => p.onUnchip(c)}>×</button></span>)}
            {p.ovChips.map((c) => <span className="s-chip s-mark" key={`${c.field}${String(c.to)}`} title={c.note}>{NAME[(Object.keys(COMPONENT_DESIGN_FIELD) as (keyof typeof COMPONENT_DESIGN_FIELD)[]).find((k) => COMPONENT_DESIGN_FIELD[k] === c.field) ?? "pv"]}: {ov(c.to)}<button aria-label="Undo" onClick={() => p.onUnchip(c)}>×</button></span>)}
          </div>
        )}
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
        {!p.bare && <details className="s-hand">
          <summary>Change by hand</summary>
          {KEYS.map((k) => {
            const f = COMPONENT_DESIGN_FIELD[k];
            return <div className="s-handrow" key={k}><span className="n">{NAME[k]}</span><Fix field={f} current={p.res.design[f]} unit={UNIT[f]} step={STEP[k]} overrides={p.overrides} setOverride={p.setOverride} /></div>;
          })}
        </details>}
      </div>
      {!p.bare && <div className="s-decide">
        <button className="btn ghost" onClick={p.onUndo} disabled={!p.canUndo}>Undo</button>
        {p.approvedAt
          ? <span className="s-approved s-mark">Approved {p.approvedAt}<a href="/check">See what really happened</a></span>
          : <button className="btn" onClick={p.onApprove}>Approve</button>}
      </div>}
      {!p.bare && form("s-say phonebar")}
    </section>
  );
}
