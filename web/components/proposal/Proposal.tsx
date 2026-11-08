"use client";
// v2.5: the homeowner's one-page proposal and sign step. Every number comes from the lead the engine serves.
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import House from "@/components/stage/House";
import type { ComponentKey, Design, DesignResponse, Lead, LeadStatus, Variant } from "@/lib/api";
import { KEYS, n0, n2 } from "@/lib/stage";
import { decide } from "@/lib/proposal";
import Signature, { type SignatureHandle } from "./Signature";
import KitSlot from "@/components/home/KitSlot";
import HomeSystems from "@/components/home/HomeSystems";
import SystemsChips from "@/components/systems/SystemsChips";
import ProposedCard from "@/components/systems/ProposedCard";
import Tiles from "@/components/offer/Tiles";
import type { SystemName } from "@/components/systems/system";
import type { Layers } from "@/components/spatial/types";
import RoofNote from "@/components/home/RoofNote";
import { LINE, VariantRows, type RowKey } from "@/components/offer/VariantTabs";
import { skusOf, years } from "@/components/offer/facts";
import { pastLine } from "@/lib/past";
import "./proposal.css";
import { berlinStamp } from "@/lib/time";

const SpatialDemo = dynamic(() => import("@/components/spatial/SpatialDemo"), { ssr: false });


const NAME: Record<ComponentKey, string> = { pv: "Solar panels", battery: "Battery", heatpump: "Heat pump", wallbox: "Wallbox" };
const FIELD: Record<ComponentKey, keyof Design> = { pv: "pv_kwp", battery: "battery_kwh", heatpump: "heatpump_kw", wallbox: "wallbox_kw" };
const OPTIONAL = new Set<ComponentKey>(["heatpump", "wallbox"]); // shown only when included
const UNIT: Record<ComponentKey, string> = { pv: "kWp", battery: "kWh", heatpump: "kW", wallbox: "kW" };

const eur = (x: number) => `€${n0(x)}`;
const pc = (x: number) => `${Math.round(x * 100)} %`;
const when = (d: Date) => berlinStamp(d.toISOString());
export const span = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min` : `${Math.floor(s / 60)} min ${s % 60} s`; };
// A street and number before the first comma, as in "Katharinenstraße 5, 82008 Unterhaching".
const hasStreet = (s: string) => s.includes(",") && /[A-Za-zÄÖÜäöüß.]{3,}\s+\d+\s*[a-zA-Z]?$/.test(s.split(",")[0].trim());

type Key = Variant["key"] | "edit";
// What the planner approved (engine v2.11 stores it on the lead, a hand edit included); before approval the draft.
export function offered(lead: Lead): { key: Key; design: Design; economics: DesignResponse["economics"] } {
  const a = lead.approved;
  if (a?.design) return { key: a.variant, design: a.design, economics: a.economics ?? { ...lead.draft?.economics, capex_eur: a.investment_eur } as DesignResponse["economics"] };
  const key = lead.approved_variant && lead.approved_variant !== "edit" ? lead.approved_variant : "expert";
  const v = lead.draft?.variants?.find((x) => x.key === key);
  return { key: v ? key : "expert", design: v?.design ?? lead.draft?.design, economics: v?.economics ?? lead.draft?.economics } as ReturnType<typeof offered>;
}

// The planner's four offers, in the planner's order and names (web/components/offer/VariantTabs.tsx). Best value is not offered here.
const ROWS: { key: Variant["key"]; name: string }[] = [
  { key: "expert", name: "Planners' pick" }, { key: "payback", name: "Best payback" },
  { key: "upfront", name: "Lowest upfront cost" }, { key: "independence", name: "Most independence" },
];
// The other offers, for the installer to talk through; the proposed one is the page itself.
function rowsOf(variants: Variant[], key: Key) {
  return ROWS.flatMap((r) => { const v = variants.find((x) => x.key === r.key); return v && r.key !== key ? [{ ...r, v }] : []; });
}

type Props = {
  lead: Lead; brand: string;
  startedAt?: number | null;              // the homeowner's own Submit time; else the lead's created_at
  onDecided?: (status: LeadStatus, at: number) => void;
};

export default function Proposal({ lead, brand, startedAt, onDecided }: Props) {
  const { key, design, economics: e } = offered(lead);
  if (!design || !e) return <ProposalSkeleton />;   // a lead whose design is not in yet
  const variants = lead.draft.variants ?? [];
  const address = lead.address_or_postcode ?? "";
  const street = hasStreet(address);
  const [spatial, setSpatial] = useState<boolean | null>(null);
  const [sys, setSys] = useState<SystemName>("panels");
  const [layers, setLayers] = useState<Layers | null>(null);

  const yieldKwh = e.annual?.pv_yield_kwh;
  const be = e.break_even_year !== undefined ? e.break_even_year : e.payback_years == null ? null : Math.ceil(e.payback_years);
  const name = lead.customer_name?.trim();
  const alts = rowsOf(variants, key);
  const own = e.annual ? Math.max(0, e.annual.load_kwh - e.annual.grid_import_kwh) : null;

  const mark = lead.status === "declined" ? "Declined" : lead.approved ? `Approved: ${key === "edit" ? "Planner's adjusted design" : ROWS.find((r) => r.key === key)?.name ?? "Planners' pick"}` : null;
  const figs = [
    { k: "kwp" as const, v: design.pv_kwp ? `${n2(design.pv_kwp)} kWp` : "No solar" },
    { k: "kwh" as const, v: design.battery_kwh ? `${n2(design.battery_kwh)} kWh` : "No battery" },
    { k: "price" as const, v: eur(e.capex_eur) },
  ];
  const tiles = [
    ...figs.map((f, i) => ({ k: ["Solar", "Battery", "Investment"][i], v: f.v })),
    ...(yieldKwh != null ? [{ k: "Yield", v: `${n0(yieldKwh)} kWh` }] : []),
    { k: "Supplied by your system", v: pc(e.autarky_share) },
    { k: "Break-even", v: be == null ? "20+ years" : years(be) },
  ];
  const decided = lead.status === "signed" ? "Signed" : lead.status === "declined" ? "Declined" : lead.status === "question" ? "Question sent" : "Sign";

  return (
    <article className="pp pp-dock" aria-label="Your proposal">
      <header className="pp-top">
        <p className="pp-brand">{brand}</p>
        {mark && <p className="pp-mark">{mark}</p>}
      </header>
      <SystemsChips active={sys} onPick={setSys} />
      <section className="pp-stage" aria-label="Your home">
        {street && spatial !== false ? (
          <div className="pp-spatial">
            <SpatialDemo leadId={lead.lead_id} inputs={lead.facts} design={design} address={address} response={lead.draft} bare homeowner endpoints={{ layers: `/start/proposal/${encodeURIComponent(lead.lead_id)}/layers`, layersGet: true }} system={sys} onLayers={setLayers} onAvailable={setSpatial}>
              <HomeSystems sys={sys} design={design} economics={e} layers={layers} demandKwh={lead.facts.annual_demand_kwh} pending={!layers} note={<RoofNote draft={lead.draft} />} />
            </SpatialDemo>
          </div>
        ) : <div className="pp-drawing"><House design={design} /></div>}
      </section>
      <ProposedCard title="Proposed Design" figs={figs} pending={false} lift={76}>
        <div className="pp-open">
          <Tiles items={tiles} mode="fade" />
          {alts.length > 0 && (
            <section className="pp-card" aria-labelledby="pp-alts">
              <h2 id="pp-alts">Alternatives for your installer to discuss</h2>
              <VariantRows label="Alternatives" rows={alts.map(({ key: k, name: label }) => ({ key: k as RowKey, name: label, line: LINE[k as RowKey], selected: false }))} />
            </section>
          )}
          <section className="pp-card" aria-label="Your system">
            <h2>Your system</h2>
            <KitSlot design={design} total={e.capex_eur} assumptions={e.assumptions} skus={skusOf(key === "expert" || key === "edit" ? (lead.approved ?? lead.draft) : lead.draft.variants?.find((v) => v.key === key) ?? lead.draft)} />
          </section>
        </div>
      </ProposedCard>
      <ProposedCard title={decided} figs={name ? [{ k: "kwp", v: name }] : []} pending={false}>
        <Decision lead={lead} brand={brand} startedAt={startedAt} onDecided={onDecided} />
      </ProposedCard>
    </article>
  );
}

function Kpi({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div className="pp-kpi"><span>{label}</span><b>{value}</b>{note && <small>{note}</small>}</div>;
}

type Act = "sign" | "decline" | "question";

function Decision({ lead, brand, startedAt, onDecided }: Omit<Props, "brand"> & { brand: string }) {
  const [name, setName] = useState(lead.customer_name ?? "");
  const [inked, setInked] = useState(false);
  const [tick, setTick] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const [mode, setMode] = useState<null | "question" | "decline">(null);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState<Act | null>(null);
  const [error, setError] = useState<{ act: Act; text: string } | null>(null);
  const [mine, setMine] = useState<{ action: Act; at: number; name?: string; question?: string } | null>(null);
  const sig = useRef<SignatureHandle>(null);

  useEffect(() => { const t = setInterval(() => setNow(new Date()), 15000); return () => clearInterval(t); }, []);

  // What the engine says, unless this page has just sent a newer decision.
  const dec = lead.decision;
  const fromLead = dec ? { action: dec.action, at: Date.parse(dec.decided_at), name: dec.name ?? undefined, question: dec.question ?? undefined } : null;
  const shown = mine && (!fromLead || mine.at >= fromLead.at - 2000) ? mine : fromLead;
  const status = mine?.action === "sign" ? "signed" : lead.status;
  const t0 = startedAt ?? Date.parse(lead.created_at);

  async function send(act: Act) {
    if (!lead.proposal_hash) { setError({ act, text: "This proposal has no hash from the engine yet. Try again in a moment." }); return; }
    setBusy(act); setError(null);
    const body = act === "sign"
      ? { action: act, name: name.trim(), accepted: true, signature_png: sig.current?.png() ?? undefined, proposal_hash: lead.proposal_hash }
      : act === "question" ? { action: act, question: question.trim(), proposal_hash: lead.proposal_hash }
      : { action: act, proposal_hash: lead.proposal_hash };
    if (act === "sign" && body.signature_png && body.signature_png.length * 0.75 > 200_000) { setBusy(null); setError({ act, text: "The signature image is over 200 KB. Clear it and sign again." }); return; }
    const r = await decide(lead.lead_id, body, lead.version);
    setBusy(null);
    if (r.status === 409) { setError({ act, text: "This proposal changed elsewhere. Reload the page to see the latest." }); return; }
    if (!r.ok) { setError({ act, text: r.error }); return; }
    const at = Date.parse(r.data.decided_at) || Date.now();
    setMine({ action: act, at, name: act === "sign" ? name.trim() : undefined, question: act === "question" ? question.trim() : undefined });
    setMode(null);
    onDecided?.(r.data.status, at);
  }

  if (status === "signed" && shown?.action === "sign")
    return (
      <section className="pp-card pp-done" aria-live="polite">
        <h2>Signed</h2>
        <p>{shown.name ? `${shown.name}, ` : ""}{when(new Date(shown.at))}</p>
        <dl className="pp-clock">
          <div><dt>Enquiry to signature</dt><dd>{span(shown.at - t0)}</dd></div>
        </dl>
        {pastLine(lead.facts.installer_id) && <p className="pp-past">{pastLine(lead.facts.installer_id)}</p>}
      </section>
    );
  if (status === "declined" && shown?.action === "decline")
    return <section className="pp-card pp-done" aria-live="polite"><h2>Declined</h2><p>{when(new Date(shown.at))}</p></section>;

  const asked = status === "question" && shown?.action === "question";
  const open = status === "approved";
  const ready = open && name.trim().length > 1 && inked && tick && !busy;

  return (
    <section className="pp-card pp-sign" aria-label="Sign">
      <h2>Sign</h2>
      {asked && <p className="pp-state" aria-live="polite">Question sent, {when(new Date(shown.at))}. You can sign once {brand} has answered.</p>}
      {!open && !asked && <p className="pp-state" aria-live="polite">{brand} is changing this proposal. You can sign once it is sent again.</p>}
      <fieldset disabled={!open || !!busy}>
        <label className="pp-l" htmlFor="pp-name">Full name</label>
        <input id="pp-name" className="pp-input" autoComplete="name" value={name} onChange={(ev) => setName(ev.target.value)} />
        <div className="pp-l pp-sighead"><span id="pp-sig-l">Signature</span><button type="button" className="pp-link" onClick={() => { sig.current?.clear(); setInked(false); }} disabled={!inked}>Clear</button></div>
        <Signature ref={sig} labelledBy="pp-sig-l" onInk={setInked} />
        <label className="pp-tick"><input type="checkbox" checked={tick} onChange={(ev) => setTick(ev.target.checked)} /><span>I accept this proposal</span></label>
        <button type="button" className="pp-go" disabled={!ready} onClick={() => send("sign")}>{busy === "sign" ? "Signing" : "Sign"}</button>
      </fieldset>
      {error && <p className="pp-err" role="alert">{error.text} <button type="button" className="pp-link" onClick={() => send(error.act)}>Try again</button></p>}

      <div className="pp-alt">
        <button type="button" className="pp-sec" aria-expanded={mode === "question"} onClick={() => setMode(mode === "question" ? null : "question")}>Ask a question</button>
        <button type="button" className="pp-sec" aria-expanded={mode === "decline"} onClick={() => setMode(mode === "decline" ? null : "decline")}>Decline</button>
      </div>
      {mode === "question" && (
        <div className="pp-more">
          <label className="pp-l" htmlFor="pp-q">Your question</label>
          <textarea id="pp-q" className="pp-input pp-area" rows={3} value={question} onChange={(ev) => setQuestion(ev.target.value)} />
          <button type="button" className="pp-go" disabled={!question.trim() || !!busy} onClick={() => send("question")}>{busy === "question" ? "Sending" : "Send question"}</button>
        </div>
      )}
      {mode === "decline" && (
        <div className="pp-more">
          <button type="button" className="pp-go pp-no" disabled={!!busy} onClick={() => send("decline")}>{busy === "decline" ? "Declining" : "Decline this proposal"}</button>
        </div>
      )}
      <p className="pp-small">Demo acceptance, not a qualified e-signature.</p>
    </section>
  );
}

// The proposal before its lead loads: the same boxes as the page above, with placeholder text hidden under a shimmer.
export function ProposalSkeleton() {
  return (
    <article className="pp pp-dock pp-sk" aria-busy="true" aria-label="Your proposal">
      <header className="pp-top"><p className="pp-brand"><Bar w="13ch" /></p></header>
      <div className="sys-head"><div className="sys-chips">{[0, 1, 2, 3].map((i) => <span key={i} className="pp-skt" style={{ width: 84, height: 34, borderRadius: 999 }}>{"\u00a0"}</span>)}</div></div>
      <section className="pp-stage" aria-hidden><div className="pp-skb" style={{ height: "100%", borderRadius: 20 }} /></section>
      <div className="pp-pass-sk" aria-hidden><Bar w="9ch" /><Bar w="22ch" /></div>
      <div className="pp-pass-sk pp-pass-sk2" aria-hidden><Bar w="5ch" /></div>
    </article>
  );
}

// A blank shimmer bar of a fixed width: no placeholder text, so nothing readable if the shimmer style is missing.
function Bar({ w }: { w: string }) {
  return <span className="pp-skt" style={{ width: w }}>{"\u00a0"}</span>;
}
