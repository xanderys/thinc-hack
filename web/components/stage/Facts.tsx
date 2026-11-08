"use client";
import { useEffect, useState, type ReactNode } from "react";
import type { HeatingType, HomeInputs, RoofResult } from "@/lib/api";
import { n0 } from "@/lib/stage";
import { maskPhone } from "@/lib/phone";
import "./facts.css";

type Field = keyof HomeInputs;
type Glyph = "phone" | "bolt" | "flame" | "tag" | "car" | "people" | "ruler" | "calendar";

// One stroke weight, 20 by 20 grid, drawn here: no icon library.
const PATHS: Record<Glyph, ReactNode> = {
  phone: <path d="M6.5 2.5h2.2l1.2 3.6-1.7 1.2a9 9 0 0 0 4 4l1.2-1.7 3.6 1.2v2.2a1.8 1.8 0 0 1-1.9 1.8A12.5 12.5 0 0 1 4.7 4.4 1.8 1.8 0 0 1 6.5 2.5Z" />,
  bolt: <path d="M11 2.5 4.5 11H9.5L8.5 17.5 15.5 8.5H10.5Z" />,
  flame: <path d="M10 2.5c.5 3-3.5 4.6-3.5 8.5a3.5 3.5 0 0 0 7 0c0-1.3-.6-2.3-1.3-3.1-.2 1-.7 1.6-1.4 1.9.4-2.7-.3-5.3-.8-7.3Z" />,
  tag: <><path d="M3 3h6.5L17 10.5 10.5 17 3 9.5Z" /><circle cx="6.5" cy="6.5" r="1" /></>,
  car: <><path d="M3 12.5v-3l1.6-3.5h10.8L17 9.5v3Z" /><path d="M3 12.5v2M17 12.5v2M3.5 9.5h13" /><circle cx="6.5" cy="12.5" r=".6" /><circle cx="13.5" cy="12.5" r=".6" /></>,
  people: <><circle cx="7.5" cy="6.5" r="2.5" /><path d="M2.5 16c0-3 2.2-4.8 5-4.8s5 1.8 5 4.8" /><circle cx="14" cy="7.5" r="2" /><path d="M14 11.5c2 0 3.5 1.4 3.5 4" /></>,
  ruler: <><path d="M2.5 13.5 13.5 2.5 17.5 6.5 6.5 17.5Z" /><path d="M5.5 10.5 7.5 12.5M8 8 9.5 9.5M10.5 5.5 12 7" /></>,
  calendar: <><rect x="3" y="4.5" width="14" height="12.5" rx="1.5" /><path d="M3 8.5h14M7 2.5v3.5M13 2.5v3.5" /></>,
};
const Glyph = ({ g }: { g: Glyph }) => <svg viewBox="0 0 20 20" aria-hidden="true">{PATHS[g]}</svg>;

// The engine knows five heating kinds besides Unknown; District and Electric ride on its two "other" kinds.
const HEAT: { label: string; value: HeatingType }[] = [
  { label: "Gas", value: "Gas" }, { label: "Oil", value: "Oil" }, { label: "Heat pump", value: "Heatpump" },
  { label: "District", value: "OtherNonRenewable" }, { label: "Electric", value: "OtherRenewable" },
];
const heatWord = (h: HeatingType) => HEAT.find((x) => x.value === h)?.label ?? "Not known";
const DECADES = [1950, 1960, 1970, 1980, 1990, 2000, 2010, 2020];
const near = (v: number, est?: number | null) => est != null && Math.abs(v - est) < 0.5;

type Spec = {
  f: Field; label: string; glyph: Glyph;
  state: (i: HomeInputs, roof?: RoofResult | null) => "stated" | "estimated" | "missing";
  value: (i: HomeInputs, roof?: RoofResult | null) => string;
};
const SPECS: Spec[] = [
  { f: "annual_demand_kwh", label: "Household use", glyph: "bolt", state: () => "stated", value: (i) => `${n0(i.annual_demand_kwh)} kWh` },
  { f: "heating_type", label: "Heating", glyph: "flame", state: (i) => i.heating_type === "Unknown" ? "missing" : "stated", value: (i) => heatWord(i.heating_type) },
  { f: "electricity_price_ct_kwh", label: "Price", glyph: "tag", state: (i) => i.electricity_price_ct_kwh != null ? "stated" : "estimated", value: (i) => i.electricity_price_ct_kwh != null ? `${i.electricity_price_ct_kwh} ct/kWh` : "37 ct/kWh, assumed" },
  { f: "has_ev", label: "Electric car", glyph: "car", state: () => "stated", value: (i) => i.has_ev ? (i.ev_annual_km ? `${n0(i.ev_annual_km)} km a year` : "Yes") : "No" },
  { f: "num_inhabitants", label: "Household", glyph: "people", state: (i) => i.num_inhabitants ? "stated" : "missing", value: (i) => `${i.num_inhabitants ?? 0} people` },
  { f: "house_size_sqm", label: "Floor area", glyph: "ruler", state: (i, r) => !i.house_size_sqm ? "missing" : near(i.house_size_sqm, r?.floor_area_m2) ? "estimated" : "stated", value: (i, r) => `${n0(i.house_size_sqm ?? 0)} m²${near(i.house_size_sqm ?? 0, r?.floor_area_m2) ? ", estimated from the building" : ""}` },
  { f: "house_built_year", label: "Built", glyph: "calendar", state: (i, r) => !i.house_built_year ? "missing" : builtEstimated(i, r) ? "estimated" : "stated", value: (i, r) => builtEstimated(i, r) ? `estimated, ${r!.build_year_class}` : String(i.house_built_year) },
];
const builtEstimated = (i: HomeInputs, r?: RoofResult | null) => !!i.house_built_year && !!r?.build_year_class && r.build_year_estimate != null && Math.abs(i.house_built_year - r.build_year_estimate) < 0.5;

// An E.164 number shown with its country code, then the rest in groups of four.
const E164 = /^\+[1-9]\d{7,14}$/;
function PhoneField({ value, onSet }: { value: string | null | undefined; onSet: (v: string) => void }) {
  const [d, setD] = useState(value ?? "");
  const clean = d.replace(/[\s().-]/g, "");
  const ok = E164.test(clean) && clean !== value;
  return (
    <form className="fc-phone" onSubmit={(e) => { e.preventDefault(); if (ok) onSet(clean); }}>
      <input type="tel" inputMode="tel" autoComplete="tel" value={d} aria-label="Phone number" placeholder="Country code first, like +49 151 2345678" autoFocus aria-invalid={d !== "" && !E164.test(clean)} onChange={(e) => setD(e.target.value.replace(/[^\d+\s().-]/g, ""))} />
      {d !== "" && !E164.test(clean) && <span className="u err" role="status">Country code first, like +49 151 2345678</span>}
      <button type="submit" className="fc-set" disabled={!ok}>Set</button>
    </form>
  );
}

/** Numeric field with its unit fixed, and a range slider on the same value. Set writes it. */
function NumRange({ value, min, max, step, unit, label, onSet }: { value: number | undefined; min: number; max: number; step: number; unit: string; label: string; onSet: (n: number) => void }) {
  const [d, setD] = useState<number>(value ?? Math.round((min + max) / 2 / step) * step);
  useEffect(() => { if (value != null) setD(value); }, [value]);
  const ok = Number.isFinite(d) && d >= min && d <= max;
  return (
    <>
      <div className="fc-num">
        <input type="number" inputMode="decimal" min={min} max={max} step={step} value={Number.isFinite(d) ? d : ""} aria-label={label} onChange={(e) => setD(e.target.value === "" ? NaN : Number(e.target.value))} />
        <span className="u">{unit}</span>
      </div>
      <input className="fc-range" type="range" min={min} max={max} step={step} value={Number.isFinite(d) ? Math.min(max, Math.max(min, d)) : min} aria-label={`${label}, slider`} onChange={(e) => setD(Number(e.target.value))} />
      <button type="button" className="fc-set" disabled={!ok || d === value} onClick={() => onSet(d)}>Set</button>
    </>
  );
}

function Panel({ spec, i, roof, onFact }: { spec: Spec; i: HomeInputs; roof?: RoofResult | null; onFact: (f: Field, v: unknown, label: string) => void }) {
  const set = (v: unknown) => onFact(spec.f, v, spec.label);
  switch (spec.f) {
    case "num_inhabitants": {
      const n = i.num_inhabitants ?? 0;
      return <div className="fc-step"><button type="button" aria-label="One fewer" disabled={n <= 1} onClick={() => set(n - 1)}>−</button><output aria-live="polite">{n || "–"}</output><button type="button" aria-label="One more" disabled={n >= 10} onClick={() => set(Math.max(1, n + 1))}>+</button></div>;
    }
    case "heating_type":
      return <div className="fc-seg" role="group" aria-label="Heating">{HEAT.map((h) => <button key={h.value} type="button" aria-pressed={i.heating_type === h.value} onClick={() => set(h.value)}>{h.label}</button>)}</div>;
    case "annual_demand_kwh":
      return <NumRange value={i.annual_demand_kwh} min={500} max={30000} step={100} unit="kWh a year" label="Household use" onSet={set} />;
    case "house_size_sqm":
      return <NumRange value={i.house_size_sqm} min={20} max={600} step={5} unit="m²" label="Floor area" onSet={set} />;
    case "electricity_price_ct_kwh":
      return <NumRange value={i.electricity_price_ct_kwh ?? 37} min={10} max={80} step={1} unit="ct/kWh" label="Price" onSet={set} />;
    case "house_built_year": {
      const est = builtEstimated(i, roof) || !i.house_built_year;
      return est
        ? <div className="fc-seg" role="group" aria-label="Decade built">{DECADES.map((d) => <button key={d} type="button" aria-pressed={!!i.house_built_year && Math.floor(i.house_built_year / 10) * 10 === d && !builtEstimated(i, roof)} onClick={() => set(d)}>{d}s</button>)}</div>
        : <NumRange value={i.house_built_year} min={1900} max={2026} step={1} unit="built" label="Year built" onSet={set} />;
    }
    case "has_ev": {
      const kind = !i.has_ev ? "no" : "yes";
      return (
        <>
          <div className="fc-seg" role="group" aria-label="Electric car">
            <button type="button" aria-pressed={kind === "yes"} onClick={() => set(true)}>Have one</button>
            <button type="button" aria-pressed={false} onClick={() => set(true)}>Planned</button>
            <button type="button" aria-pressed={kind === "no"} onClick={() => set(false)}>No</button>
          </div>
          {i.has_ev && <NumRange value={i.ev_annual_km ?? 15000} min={1000} max={40000} step={500} unit="km a year" label="Kilometres a year" onSet={(n) => onFact("ev_annual_km", n, "Electric car km")} />}
        </>
      );
    }
    default: return null;
  }
}

/** The facts row. An explicit edit calls onFact (the existing intake-step path); opening a chip never writes. slot: room for a button at the row's end. */
export default function Facts({ inputs, roof, onFact, hidden, slot, origin, phone, onPhone, sources }: { sources?: Record<string, string>; phone?: string | null; onPhone?: (v: string) => void; origin?: Record<string, string>; inputs: HomeInputs; roof?: RoofResult | null; onFact: (f: Field, v: unknown, label: string) => void; hidden?: Field | null; slot?: ReactNode }) {
  const [open, setOpen] = useState<Field | "phone" | null>(null);
  // A fact the planner sets here is stated from then on, whatever the lead said before.
  const [edited, setEdited] = useState<Set<string>>(new Set());
  const specs = SPECS.filter((s) => s.f !== hidden);
  const cur = specs.find((s) => s.f === open);
  useEffect(() => {
    if (!open) return;
    const on = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(null); };
    addEventListener("keydown", on); return () => removeEventListener("keydown", on);
  }, [open]);
  return (
    <div className="fc-wrap">
      <div className="fc-row" data-facts-row="">
        {specs.map((s) => {
          const base = s.state(inputs, roof);
          // The engine's own word for each fact (lead.sources) sets the tone; a missing value stays missing.
          const st = base === "missing" ? base : edited.has(s.f) ? "stated" : sources?.[s.f] ? (sources[s.f] === "estimated" ? "estimated" : "stated") : base;
          return (
            <button key={s.f} type="button" className="fc" data-state={st} aria-expanded={open === s.f} aria-controls="fc-panel" onClick={() => setOpen((o) => o === s.f ? null : s.f)}>
              <Glyph g={s.glyph} /><span className="k">{s.label}</span>{st !== "missing" && <span className="v">{s.value(inputs, roof)}</span>}{origin?.[s.f] === "whatsapp" && st !== "missing" && <span className="via">via WhatsApp</span>}
            </button>
          );
        })}
        {onPhone && (
          <button type="button" className="fc" data-state={phone ? "stated" : "missing"} aria-expanded={open === "phone"} aria-controls="fc-panel" onClick={() => setOpen((o) => o === "phone" ? null : "phone")}>
            <Glyph g="phone" /><span className="k">Phone</span>{phone && <span className="v">{maskPhone(phone)}</span>}
          </button>
        )}
        {slot != null && <span className="fc-slot">{slot}</span>}
      </div>
      {open === "phone" && onPhone && <div className="fc-panel" id="fc-panel" role="group" aria-label="Phone" key="phone"><PhoneField value={phone} onSet={(v) => { onPhone(v); setOpen(null); }} /></div>}
      {cur && <div className="fc-panel" id="fc-panel" role="group" aria-label={cur.label} key={cur.f}><Panel spec={cur} i={inputs} roof={roof} onFact={(f, v, l) => { onFact(f, v, l); setEdited((x) => new Set(x).add(f === "ev_annual_km" ? "has_ev" : f)); if (f !== "ev_annual_km" && !(f === "has_ev" && v === true)) setOpen(null); }} /></div>}
    </div>
  );
}
