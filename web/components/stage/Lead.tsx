"use client";
import { useState } from "react";
import type { AskQuestion, HomeInputs, InstallerId, ReadResponse, RoofResult } from "@/lib/api";
import { INSTALLER_NAME } from "@/lib/api";
import { HEATING_WORD, n0, optionLabel, QUESTION } from "@/lib/stage";

type Props = {
  lead: string; setLead: (s: string) => void;
  read: ReadResponse | null; busy: boolean; error: string | null; onRead: () => void; onEdit: () => void;
  inputs: HomeInputs; changed: Partial<HomeInputs>;
  setInstaller: (i: InstallerId) => void;
  roof: RoofResult | null;
  question: AskQuestion | null; answer: unknown; onAnswer: (v: unknown) => void; askError: string | null;
  pref: Pref; setPref: (p: Pref) => void; asking: boolean; call?: React.ReactNode;
};

export type Pref = "expert" | "independence" | "payback" | "upfront";
const PREFS: [Pref, string][] = [["independence", "Most independence"], ["payback", "Best payback"], ["upfront", "Lowest upfront cost"], ["expert", "As planners design it"]];

// The lead with every quoted span underlined.
function Marked({ text, quotes }: { text: string; quotes: string[] }) {
  const low = text.toLowerCase(), ranges: [number, number][] = [];
  for (const q of quotes) { const i = low.indexOf(q.toLowerCase()); if (i >= 0) ranges.push([i, i + q.length]); }
  ranges.sort((a, b) => a[0] - b[0]);
  const out: React.ReactNode[] = []; let at = 0;
  for (const [s, e] of ranges) { if (s < at) continue; out.push(text.slice(at, s), <mark key={s}>{text.slice(s, e)}</mark>); at = e; }
  out.push(text.slice(at));
  return <>{out}</>;
}

function Fact({ k, v, src, was }: { k: string; v: React.ReactNode; src: React.ReactNode; was?: string }) {
  return (
    <div className="s-fact">
      <span className="fk">{k}</span>
      <span className="fv">{v}{was != null && <span className="chg"> (was {was})</span>}</span>
      <span className="fq">{src}</span>
    </div>
  );
}

// "5, Katharinenstraße, Am Klosterfeld, Unterhaching, Landkreis München, Bayern, 82008, Deutschland" to the parts a planner checks.
function shortAddress(s: string) {
  return s.split(", ").filter((x) => !/^(Landkreis|Bayern|Deutschland|Germany|Regierungsbezirk)/.test(x)).join(", ");
}

export default function Lead(p: Props) {
  const { read, inputs: i } = p;
  const [bill, setBill] = useState<{ eur: number; kwh: number } | null>(null);
  const [billIn, setBillIn] = useState("");
  const price = i.electricity_price_ct_kwh ?? 37;
  const fromBill = bill && p.answer === bill.kwh ? bill : null;
  const quote = (f: keyof HomeInputs | "wants" | "monthly_bill_eur") => read?.found.find((x) => x.field === f)?.quote;
  const src = (f: keyof HomeInputs) => {
    const q = quote(f);
    if (q && f === "annual_demand_kwh" && q === quote("monthly_bill_eur")) return `From "${q}" at ${price} ct`;
    if (q) return `"${q}"`;
    if (read?.source === "call" && f in read.inputs) return read.estimated?.includes(f) ? "Estimated on the call" : "Said on the call";
    if (f === p.question?.field && p.answer !== undefined) return fromBill && f === "annual_demand_kwh" ? `About ${n0(fromBill.kwh)} kWh from ${n0(fromBill.eur)} EUR a month at ${price} ct` : "You answered";
    return f === "annual_demand_kwh" && !p.asking && p.question?.field !== f ? "Assumed: not in the lead" : "Not in the lead";
  };
  const evWas = "has_ev" in p.changed && read && read.inputs.has_ev !== p.changed.has_ev ? (read.inputs.has_ev ? "yes" : "no") : undefined;
  const addr = read?.inputs.address ? (p.roof && p.roof.source !== "none" ? `${read.inputs.address} (matched)` : read.inputs.address) : null;
  const more = [
    addr,
    // Stated in the lead wins; otherwise the address estimate, labelled as one.
    read?.inputs.house_size_sqm ? `${n0(read.inputs.house_size_sqm)} m²` : p.roof?.floor_area_m2 ? `about ${n0(Math.round(p.roof.floor_area_m2 / 10) * 10)} m², estimated from the address, upper bound` : null,
    read?.inputs.house_built_year ? `built ${read.inputs.house_built_year}` : p.roof?.build_year_estimate ? `built about ${p.roof.build_year_estimate}${p.roof.build_year_class ? ` (${p.roof.build_year_class.replace(/\s*[-–]\s*/, " to ")})` : ""}, estimated from the address` : null,
    i.has_solar ? `solar ${i.existing_solar_kwp ?? ""} kWp already` : "no solar",
    i.has_storage ? `battery ${i.existing_storage_kwh ?? ""} kWh already` : "no battery",
  ].filter(Boolean).join("; ");

  return (
    <section className="s-lead" aria-label="The lead">
      <h2 className="s-h3">{read ? (read.source === "call" ? "From the call" : "From the lead") : "Paste the lead."}</h2>
      {!read ? (
        <form onSubmit={(e) => { e.preventDefault(); if (p.lead.trim()) p.onRead(); }}>
          <textarea className="s-mailin" value={p.lead} onChange={(e) => p.setLead(e.target.value)} rows={11} aria-label="The lead" disabled={p.busy} />
          <div className="s-row"><button className="btn" type="submit" disabled={p.busy || !p.lead.trim()}>{p.busy ? "Reading" : "Read it"}</button></div>
        </form>
      ) : null}
      {!read && p.call}
      {read && (read.source === "call"
        ? <div className="s-mail s-in">{p.lead || "Facts from the call."}<button className="s-link" onClick={p.onEdit}>Edit</button></div>
        : <div className="s-mail s-in"><Marked text={p.lead} quotes={read.found.map((f) => f.quote)} /><button className="s-link" onClick={p.onEdit}>Edit</button></div>)}
      {p.error && <div className="error" role="alert"><span><span className="src">Claude said</span>{p.error}</span><button className="btn ghost" onClick={p.onRead}>Retry</button></div>}

      {read && (
        <div className="s-facts s-in">
          <h3 className="s-fh">Consumption</h3>
          <Fact k="Annual use" v={<span className={p.answer !== undefined && !quote("annual_demand_kwh") ? "num asked" : "num"}>{quote("annual_demand_kwh") || p.answer !== undefined || (!p.asking && p.question?.field !== "annual_demand_kwh") ? `${n0(i.annual_demand_kwh)} kWh` : "Not known yet"}</span>} src={src("annual_demand_kwh")} />
          <Fact k="Heating" v={<>{HEATING_WORD[i.heating_type]}{i.heating_cost_per_year_eur ? <>, <span className="num">{n0(i.heating_cost_per_year_eur)} EUR</span> a year</> : null}</>} src={src("heating_type")} />
          {i.electricity_price_ct_kwh != null && <Fact k="Price" v={<><span className="num">{i.electricity_price_ct_kwh} ct</span> per kWh</>} src={src("electricity_price_ct_kwh")} />}
          <h3 className="s-fh">Demand</h3>
          <Fact k="Electric car" v={i.has_ev ? <>Yes{i.ev_annual_km ? <>, <span className="num">{n0(i.ev_annual_km)} km</span> a year</> : null}</> : "No"} src={evWas ? "Changed in a sentence" : src("has_ev")} was={evWas} />
          <Fact k="Household" v={i.num_inhabitants ? `${i.num_inhabitants} people` : "Not known"} src={src("num_inhabitants")} />
          <h3 className="s-fh">Preferences</h3>
          {quote("wants") && <Fact k="Wants" v={String(read.found.find((x) => x.field === "wants")?.value ?? "").replace(/^./, (c) => c.toUpperCase())} src={`"${quote("wants")}"`} />}
          <div className="s-pref" role="group" aria-label="Preference">
            {PREFS.map(([k, label]) => <button key={k} type="button" aria-pressed={p.pref === k} onClick={() => p.setPref(k)}>{label}</button>)}
          </div>
          <details className="s-more"><summary>More details</summary>
            <p>{more}</p>
            <div className="s-fact">
              <span className="fk">Installer</span>
              <span className="fv"><span className="seg" role="group" aria-label="Installer style">
                {(Object.keys(INSTALLER_NAME) as InstallerId[]).map((id) => <button key={id} type="button" aria-pressed={i.installer_id === id} onClick={() => p.setInstaller(id)}>{INSTALLER_NAME[id]}</button>)}
              </span></span>
              <span className="fq">Design style to follow</span>
            </div>
          </details>
        </div>
      )}

      {read && p.question && (
        <div className="s-ask s-in">
          <p>{QUESTION[p.question.field] ?? `What is ${String(p.question.field)}?`} It changes the design most.</p>
          <span className="seg" role="group" aria-label="Answer">
            {p.question.options.map((o) => (
              <button key={String(o.value)} type="button" className={typeof o.value === "number" ? "num" : undefined} aria-pressed={p.answer === o.value} title={o.label} onClick={() => p.onAnswer(o.value)}>
                {optionLabel(p.question!.field, o.value)}
              </button>
            ))}
          </span>
          {p.question.field.endsWith("_kwh") && <span className="label s-unit">kWh</span>}
          {p.question.field === "annual_demand_kwh" && (
            <form className="s-bill" onSubmit={(e) => { e.preventDefault(); const eur = Number(billIn.replace(",", ".")); if (!(eur > 0)) return;
              const kwh = Math.round((eur * 12) / (price / 100) / 100) * 100; setBill({ eur, kwh }); p.onAnswer(kwh); }}>
              <label>Or the monthly bill <input inputMode="decimal" className="num" value={billIn} onChange={(e) => setBillIn(e.target.value)} aria-label="Monthly bill in EUR" /> EUR</label>
              <button className="btn ghost" type="submit" disabled={!(Number(billIn.replace(",", ".")) > 0)}>Use</button>
            </form>
          )}
        </div>
      )}
      {read && p.askError && <p className="s-quiet" role="status"><span className="src">Engine said </span>{p.askError}</p>}
    </section>
  );
}
