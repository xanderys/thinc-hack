"use client";
import { useState } from "react";
import dynamic from "next/dynamic";
import type { HomeInputs, ReadResponse } from "@/lib/api";
import { call, send } from "@/lib/client";

const Calls = dynamic(() => import("@/components/stage/Calls"), { ssr: false });

const FIELD: Record<string, string> = {
  address: "Address", postcode: "Postcode", annual_demand_kwh: "Annual use", monthly_bill_eur: "Monthly bill", num_inhabitants: "Household", has_ev: "Electric car",
  ev_annual_km: "Car distance", heating_type: "Heating", heating_cost_per_year_eur: "Heating cost", house_size_sqm: "Floor area", house_built_year: "Year built",
  electricity_price_ct_kwh: "Price", has_solar: "Existing solar", has_storage: "Existing battery", has_wallbox: "Existing wallbox", wants: "Wants", load_profile: "Household",
};
// "Best regards,\nKatrin Huber": the sign-off name, when the lead has one.
const guessName = (t: string) => {
  const last = t.trim().split("\n").map((l) => l.trim()).filter(Boolean).at(-1) ?? "";
  return /^[A-ZÄÖÜ][\p{L}'-]+(\s[A-ZÄÖÜ][\p{L}'-]+)+$/u.test(last) && last.length < 40 ? last : "";
};

// "+": the anything-goes box. Read it, check the facts, add the house; its card opens with the first design.
export default function AddSheet({ onClose, onCreated, sample, voice }: { onClose: () => void; onCreated: (id: string) => void; sample: string; voice: boolean }) {
  const [text, setText] = useState("");
  const [read, setRead] = useState<ReadResponse | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<"read" | "add" | null>(null);
  const [err, setErr] = useState<{ src: string; msg: string } | null>(null);

  async function doRead() {
    setBusy("read"); setErr(null);
    const r = await call<ReadResponse>("/api/read", { lead: text });
    setBusy(null);
    if (!r.ok) { setErr({ src: "Reader said", msg: r.error }); return; }
    setRead(r.data); setName((n) => n || guessName(text));
  }
  async function add() {
    if (!read) return;
    setBusy("add"); setErr(null);
    const place = read.inputs.address ?? read.postcode ?? text.trim();
    const facts: Partial<HomeInputs> = { ...read.inputs };
    const r = await send<{ lead_id: string }>("/api/leads", { customer_name: name.trim() || place, address_or_postcode: place, installer_id: read.inputs.installer_id ?? "2a8ba8e2", facts, source: "form" }, "add-lead");
    setBusy(null);
    if (!r.ok) { setErr({ src: "Engine said", msg: r.error }); return; }
    try { sessionStorage.setItem(`marquee.read.${r.data.lead_id}`, JSON.stringify({ read, text })); } catch { /* storage blocked: the card reads the lead instead */ }
    onCreated(r.data.lead_id);
  }

  return (
    <div className="b-sheet-bg" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="b-sheet" role="dialog" aria-modal="true" aria-label="Add a house">
        <div className="b-sheet-h"><h2>Add a house</h2><button type="button" className="btn ghost" onClick={onClose}>Close</button></div>
        {!read ? (
          <form onSubmit={(e) => { e.preventDefault(); if (text.trim()) doRead(); }}>
            <textarea className="b-paste" value={text} onChange={(e) => setText(e.target.value)} rows={7} placeholder="Paste the enquiry, or just an address or postcode." aria-label="Enquiry, address or postcode" autoFocus />
            <div className="b-row">
              <button className="btn" type="submit" disabled={!text.trim() || busy != null}>{busy === "read" ? "Reading" : "Read it"}</button>
              {!text && <button type="button" className="s-link" onClick={() => setText(sample)}>Use the sample enquiry</button>}
            </div>
          </form>
        ) : (
          <div>
            <dl className="b-facts">
              {read.found.map((f) => (
                <div key={`${f.field}${f.quote}`}><dt>{FIELD[f.field] ?? f.field}</dt><dd>{typeof f.value === "boolean" ? (f.value ? "Yes" : "No") : String(f.value)}<span className="src">&ldquo;{f.quote}&rdquo;</span></dd></div>
              ))}
              {read.found.length === 0 && <p className="s-quiet">{read.postcode ? `Postcode ${read.postcode}; the rest is asked.` : "Nothing specific in it; the rest is asked."}</p>}
            </dl>
            <label className="b-name-f">Name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="The homeowner's name" /></label>
            <div className="b-row">
              <button className="btn" type="button" onClick={add} disabled={busy != null}>{busy === "add" ? "Adding" : "Add house"}</button>
              <button type="button" className="s-link" onClick={() => setRead(null)}>Edit</button>
            </div>
          </div>
        )}
        {err && <div className="error" role="alert"><span><span className="src">{err.src}</span>{err.msg}</span><button className="btn ghost" onClick={read ? add : doRead}>Retry</button></div>}
        {voice && <Calls installer="2a8ba8e2" onLead={(l) => onCreated(l.conversation_id)} />}
      </section>
    </div>
  );
}
