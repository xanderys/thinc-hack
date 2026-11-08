"use client";
import { useState, type ReactNode } from "react";
import type { LeadLike } from "./gaps";
import { gapsOf, GAP_LABEL, type GapField } from "./gaps";
import { send } from "@/lib/client";
import "./gaps.css";

type Glyph = "bolt" | "flame" | "car" | "people" | "pin";
// Same one-stroke 20 by 20 glyphs as the facts chips (components/stage/Facts.tsx), drawn here: no icon library.
const PATHS: Record<Glyph, ReactNode> = {
  bolt: <path d="M11 2.5 4.5 11H9.5L8.5 17.5 15.5 8.5H10.5Z" />,
  flame: <path d="M10 2.5c.5 3-3.5 4.6-3.5 8.5a3.5 3.5 0 0 0 7 0c0-1.3-.6-2.3-1.3-3.1-.2 1-.7 1.6-1.4 1.9.4-2.7-.3-5.3-.8-7.3Z" />,
  car: <><path d="M3 12.5v-3l1.6-3.5h10.8L17 9.5v3Z" /><path d="M3 12.5v2M17 12.5v2M3.5 9.5h13" /><circle cx="6.5" cy="12.5" r=".6" /><circle cx="13.5" cy="12.5" r=".6" /></>,
  people: <><circle cx="7.5" cy="6.5" r="2.5" /><path d="M2.5 16c0-3 2.2-4.8 5-4.8s5 1.8 5 4.8" /><circle cx="14" cy="7.5" r="2" /><path d="M14 11.5c2 0 3.5 1.4 3.5 4" /></>,
  pin: <><path d="M10 17.5s5-4.6 5-8.5a5 5 0 0 0-10 0c0 3.9 5 8.5 5 8.5Z" /><circle cx="10" cy="9" r="1.8" /></>,
};
const GLYPH: Record<GapField, Glyph> = { annual_demand_kwh: "bolt", heating_type: "flame", has_ev: "car", num_inhabitants: "people", address: "pin" };
const HEAT = [["Gas", "Gas"], ["Oil", "Oil"], ["Heat pump", "Heatpump"], ["District", "OtherNonRenewable"], ["Electric", "OtherRenewable"]] as const;

function Field({ lead, f, onDone }: { lead: LeadLike; f: GapField; onDone: () => void }) {
  const [v, setV] = useState("");
  const [busy, setBusy] = useState<"set" | "ask" | null>(null);
  const [asked, setAsked] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const value = (): unknown => f === "annual_demand_kwh" || f === "num_inhabitants" ? Number(v) : f === "has_ev" ? v === "yes" : v.trim();
  const ok = v.trim() !== "" && (f === "address" || f === "heating_type" || f === "has_ev" || Number(v) > 0);
  async function set() {
    if (!ok || busy) return;
    setBusy("set"); setErr(null);
    const r = await send(`/api/intake/step`, { lead_id: lead.lead_id, facts_so_far: { [f]: value() }, source: "planner", ...(lead.version != null ? { base_version: lead.version } : {}) }, "board-gap");
    setBusy(null);
    if (r.ok) onDone(); else setErr(r.error);
  }
  async function ask() {
    if (busy || !lead.phone) return;
    setBusy("ask"); setErr(null);
    const r = await send(`/api/leads/${encodeURIComponent(lead.lead_id)}/whatsapp/ask`, { facts: [f] }, "board-gap-ask");
    setBusy(null);
    if (r.ok) { setAsked(true); onDone(); } else setErr(r.error);
  }
  return (
    <form className="gp-field" onSubmit={(e) => { e.preventDefault(); void set(); }}>
      {f === "heating_type" ? (
        <select aria-label="Heating type" value={v} onChange={(e) => setV(e.target.value)} autoFocus><option value="" />{HEAT.map(([l, x]) => <option key={x} value={x}>{l}</option>)}</select>
      ) : f === "has_ev" ? (
        <select aria-label="Electric car" value={v} onChange={(e) => setV(e.target.value)} autoFocus><option value="" /><option value="yes">Yes</option><option value="no">No</option></select>
      ) : (
        <input aria-label={GAP_LABEL[f]} type={f === "address" ? "text" : "number"} inputMode={f === "address" ? "text" : "decimal"} min={f === "address" ? undefined : 1} value={v} autoFocus onChange={(e) => setV(e.target.value)} />
      )}
      <button type="submit" className={`gp-btn${busy === "set" ? " busy" : ""}`} disabled={!ok || !!busy}>Set</button>
      <button type="button" className={`gp-btn${busy === "ask" ? " busy" : ""}`} disabled={!lead.phone || !!busy || asked} onClick={ask}>{asked ? "Asked" : "Ask"}</button>
      {err && <span className="gp-err" role="alert">{err}</span>}
    </form>
  );
}

/** One chip per missing or estimated fact; tap opens a one-line field with Set and Ask. */
export default function GapChips({ lead, address, onChanged }: { lead?: LeadLike | null; address?: string; onChanged: () => void }) {
  const [open, setOpen] = useState<GapField | null>(null);
  if (!lead) return null;
  const gaps = gapsOf(lead, address);
  if (!gaps.length) return null;
  return (
    <div className="gp" onClick={(e) => e.stopPropagation()}>
      <div className="gp-row">
        {gaps.map((f) => (
          <button key={f} type="button" className="gp-chip" aria-expanded={open === f} onClick={() => setOpen(open === f ? null : f)}>
            <svg viewBox="0 0 20 20" aria-hidden="true">{PATHS[GLYPH[f]]}</svg><span>Needs: {GAP_LABEL[f]}</span>
          </button>
        ))}
      </div>
      {open && gaps.includes(open) && <Field key={open} lead={lead} f={open} onDone={() => { setOpen(null); onChanged(); }} />}
    </div>
  );
}
