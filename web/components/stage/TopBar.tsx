"use client";
import { useState } from "react";
import type { AskQuestion, Design, DesignResponse, HeatingType, HomeInputs, InstallerId, Overrides, OverrideValue, ReadResponse, RoofResult } from "@/lib/api";
import { COMPONENT_DESIGN_FIELD, INSTALLER_NAME } from "@/lib/api";
import { Fix } from "@/components/DesignSheet";
import { HEATING_WORD, KEYS, n0, NAME, optionLabel, QUESTION } from "@/lib/stage";
import { askOptions, Marked, PREFS, type Pref } from "./Lead";
import { STEP, UNIT } from "./Refine";

type Props = {
  lead: string; read: ReadResponse; inputs: HomeInputs; roof: RoofResult | null;
  onFact: (f: keyof HomeInputs, v: unknown, label: string) => void; setInstaller: (i: InstallerId) => void;
  question: AskQuestion | null; answer: unknown; onAnswer: (v: unknown) => void; askError: string | null; asking: boolean;
  pref: Pref; setPref: (p: Pref) => void;
  res: DesignResponse | null; overrides: Overrides; setOverride: (f: keyof Design, v: OverrideValue | undefined) => void;
  canUndo: boolean; onUndo: () => void; approvedAt: string | null; onApprove: () => void;
};

type Kind = { f: keyof HomeInputs; label: string; show: (i: HomeInputs) => string; edit: "num" | "bool" | "heat"; unit?: string };
const FACTS: Kind[] = [
  { f: "annual_demand_kwh", label: "Annual use", show: (i) => `${n0(i.annual_demand_kwh)} kWh`, edit: "num", unit: "kWh" },
  { f: "heating_type", label: "Heating", show: (i) => HEATING_WORD[i.heating_type], edit: "heat" },
  { f: "electricity_price_ct_kwh", label: "Price", show: (i) => i.electricity_price_ct_kwh != null ? `${i.electricity_price_ct_kwh} ct/kWh` : "37 ct/kWh, assumed", edit: "num", unit: "ct/kWh" },
  { f: "has_ev", label: "Electric car", show: (i) => i.has_ev ? `Yes${i.ev_annual_km ? `, ${n0(i.ev_annual_km)} km` : ""}` : "No", edit: "bool" },
  { f: "num_inhabitants", label: "Household", show: (i) => i.num_inhabitants ? `${i.num_inhabitants} people` : "Not known", edit: "num", unit: "people" },
  { f: "house_size_sqm", label: "Floor area", show: (i) => i.house_size_sqm ? `${n0(i.house_size_sqm)} m²` : "Not known", edit: "num", unit: "m²" },
  { f: "house_built_year", label: "Built", show: (i) => i.house_built_year ? String(i.house_built_year) : "Not known", edit: "num" },
];

// One fact as a chip; tap to change it. A change reruns the design and says what moved.
function Chip({ k, i, onFact }: { k: Kind; i: HomeInputs; onFact: Props["onFact"] }) {
  const [v, setV] = useState("");
  const [open, setOpen] = useState(false);
  const set = (x: unknown) => { onFact(k.f, x, k.label); setOpen(false); };
  return (
    <details className="t-chip" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary><span className="k">{k.label}</span> {k.show(i)}</summary>
      <div className="t-edit">
        {k.edit === "bool" && <span className="seg">{[true, false].map((b) => <button key={String(b)} type="button" aria-pressed={i[k.f] === b} onClick={() => set(b)}>{b ? "Yes" : "No"}</button>)}</span>}
        {k.edit === "heat" && <span className="seg">{(["Gas", "Oil", "Heatpump", "OtherRenewable"] as HeatingType[]).map((h) => <button key={h} type="button" aria-pressed={i.heating_type === h} onClick={() => set(h)}>{HEATING_WORD[h]}</button>)}</span>}
        {k.edit === "num" && (
          <form onSubmit={(e) => { e.preventDefault(); const n = Number(v.replace(",", ".")); if (n > 0) set(n); }}>
            <input className="num" inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} placeholder={String(i[k.f] ?? "")} aria-label={k.label} autoFocus />
            {k.unit && <span className="u">{k.unit}</span>}
            <button className="btn" type="submit" disabled={!(Number(v.replace(",", ".")) > 0)}>Set</button>
          </form>
        )}
      </div>
    </details>
  );
}

// The open card's top bar: the inputs as chips, the one question, the preference, locks and Approve.
export default function TopBar(p: Props) {
  const i = p.inputs;
  return (
    <section className="t-bar" aria-label="Inputs and decisions">
      {p.question && (
        <div className="t-ask s-in">
          <span>{QUESTION[p.question.field] ?? `What is ${String(p.question.field)}?`}</span>
          <span className="seg" role="group" aria-label="Answer">
            {askOptions(p.question).map((o) => (
              <button key={String(o.value)} type="button" className={typeof o.value === "number" ? "num" : undefined} aria-pressed={p.answer === o.value} onClick={() => p.onAnswer(o.value)}>
                {optionLabel(p.question!.field, o.value)}
              </button>
            ))}
          </span>
          {p.question.field.endsWith("_kwh") && <span className="s-quiet">kWh</span>}
        </div>
      )}
      {p.asking && <p className="s-quiet s-wait">Finding the one question that matters</p>}
      {p.askError && <p className="s-quiet" role="status"><span className="src">Engine said </span>{p.askError}</p>}
      <div className="t-chips">
        {FACTS.filter((k) => !(p.question?.field === k.f && p.answer === undefined)).map((k) => <Chip key={k.f} k={k} i={i} onFact={p.onFact} />)}
        <details className="t-chip">
          <summary><span className="k">Style</span> {INSTALLER_NAME[i.installer_id]}</summary>
          <div className="t-edit"><span className="seg">{(Object.keys(INSTALLER_NAME) as InstallerId[]).map((id) => <button key={id} type="button" aria-pressed={i.installer_id === id} onClick={() => p.setInstaller(id)}>{INSTALLER_NAME[id]}</button>)}</span></div>
        </details>
      </div>
      <div className="t-row">
        <div className="s-pref t-pref" role="group" aria-label="Preference">
          {PREFS.map(([k, label]) => <button key={k} type="button" aria-pressed={p.pref === k} onClick={() => p.setPref(k)}>{label}</button>)}
        </div>
        {p.res && (
          <details className="t-locks">
            <summary>Locks{Object.keys(p.overrides).length ? ` (${Object.keys(p.overrides).length})` : ""}</summary>
            <div className="t-locks-in">
              {KEYS.map((k) => { const f = COMPONENT_DESIGN_FIELD[k]; return <div className="s-handrow" key={k}><span className="n">{NAME[k]}</span><Fix field={f} current={p.res!.design[f]} unit={UNIT[f]} step={STEP[k]} overrides={p.overrides} setOverride={p.setOverride} /></div>; })}
            </div>
          </details>
        )}
        <span className="t-go">
          {p.canUndo && <button className="btn ghost" onClick={p.onUndo}>Undo</button>}
          {p.res && (p.approvedAt
            ? <span className="s-approved s-mark">Approved {p.approvedAt}</span>
            : <button className="btn" onClick={p.onApprove}>Approve</button>)}
        </span>
      </div>
      {(p.lead || p.read.found.length > 0) && (
        <details className="t-mail"><summary>{p.read.source === "call" ? "From the call" : "The enquiry"}</summary>
          <div className="s-mail">{p.read.source === "call" ? p.lead || "Facts from the call." : <Marked text={p.lead} quotes={p.read.found.map((f) => f.quote)} />}</div>
        </details>
      )}
    </section>
  );
}
