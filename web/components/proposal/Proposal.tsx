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
import RoofNote from "@/components/home/RoofNote";
import "./proposal.css";

const SpatialDemo = dynamic(() => import("@/components/spatial/SpatialDemo"), { ssr: false });

// docs/data-insights.md, installer 23c108b7 medians: enquiry to offer 8.2 days, offer to signature 28.7 days.
export const TODAY_OFFER_DAYS = 8;
export const TODAY_SIGN_DAYS = 29;
export const TODAY_LINE = `Today: ${TODAY_OFFER_DAYS} days to an offer, ${TODAY_SIGN_DAYS} more to a signature`;

const NAME: Record<ComponentKey, string> = { pv: "Solar panels", battery: "Battery", heatpump: "Heat pump", wallbox: "Wallbox" };
const FIELD: Record<ComponentKey, keyof Design> = { pv: "pv_kwp", battery: "battery_kwh", heatpump: "heatpump_kw", wallbox: "wallbox_kw" };
const OPTIONAL = new Set<ComponentKey>(["heatpump", "wallbox"]); // shown only when included
const UNIT: Record<ComponentKey, string> = { pv: "kWp", battery: "kWh", heatpump: "kW", wallbox: "kW" };

const eur = (x: number) => `€${n0(x)}`;
const pc = (x: number) => `${Math.round(x * 100)} %`;
const when = (d: Date) => d.toLocaleString("en-GB", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
export const span = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min` : `${Math.floor(s / 60)} min ${s % 60} s`; };
// A street and number before the first comma, as in "Katharinenstraße 5, 82008 Unterhaching".
const hasStreet = (s: string) => s.includes(",") && /[A-Za-zÄÖÜäöüß.]{3,}\s+\d+\s*[a-zA-Z]?$/.test(s.split(",")[0].trim());

type Key = Variant["key"] | "edit";
// What the planner approved (engine v2.11 stores it on the lead, a hand edit included); before approval the draft.
export function offered(lead: Lead): { key: Key; design: Design; economics: DesignResponse["economics"] } {
  const a = lead.approved;
  if (a?.design) return { key: a.variant, design: a.design, economics: a.economics ?? { ...lead.draft.economics, capex_eur: a.investment_eur } };
  const key = lead.approved_variant && lead.approved_variant !== "edit" ? lead.approved_variant : "expert";
  const v = lead.draft.variants?.find((x) => x.key === key);
  return { key: v ? key : "expert", design: v?.design ?? lead.draft.design, economics: v?.economics ?? lead.draft.economics };
}

// The planner's four offers, in the planner's order and names (web/components/offer/VariantTabs.tsx). Best value is not offered here.
const ROWS: { key: Variant["key"]; name: string }[] = [
  { key: "expert", name: "Planners' pick" }, { key: "independence", name: "Most independence" },
  { key: "payback", name: "Best payback" }, { key: "upfront", name: "Lowest upfront cost" },
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
  const variants = lead.draft.variants ?? [];
  const address = lead.address_or_postcode ?? "";
  const street = hasStreet(address);
  const [spatial, setSpatial] = useState<boolean | null>(null);
  const [layer, setLayer] = useState(3);

  const yieldKwh = e.annual?.pv_yield_kwh;
  const be = e.break_even_year !== undefined ? e.break_even_year : e.payback_years == null ? null : Math.ceil(e.payback_years);
  const name = lead.customer_name?.trim();
  const alts = rowsOf(variants, key);
  const own = e.annual ? Math.max(0, e.annual.load_kwh - e.annual.grid_import_kwh) : null;

  return (
    <article className="pp" aria-label="Your proposal">
      <header className="pp-cover">
        <svg className="pp-band" viewBox="0 0 390 260" preserveAspectRatio="none" aria-hidden>
          <polygon points="165,100 390,26 390,80 205,134" />
          <polygon points="0,78 112,50 112,88 0,116" />
        </svg>
        <p className="pp-brand">{brand}</p>
        <div className="pp-title">
          <h1>Your proposal</h1>
          <p>{[name, address].filter(Boolean).join(", ")}</p>
        </div>
      </header>

      {/* One fixed box for the 3D house, its fallback drawing and the skeleton, so the page below never moves. */}
      <section className="pp-house" aria-label="Your home">
        <div className="pp-housebox">
          {street && spatial !== false && (
            <div className="pp-spatial">
              <SpatialDemo leadId={lead.lead_id} inputs={lead.facts} design={design} address={address} response={lead.draft} layer={layer} onLayerChange={setLayer} onAvailable={setSpatial} homeowner />
            </div>
          )}
          {(!street || spatial === false) && <div className="pp-drawing"><House design={design} /></div>}
        </div>
        <RoofNote draft={lead.draft} className="pp-roofnote" />
      </section>

      <section className="pp-kpis" aria-label="Key figures">
        {yieldKwh != null && <Kpi label="Yield a year" value={`${n0(yieldKwh)} kWh`} />}
        <div className="pp-kpi">
          <span>Supplied by your system</span><b>{pc(e.autarky_share)}</b>
          <small>{pc(e.autarky_share)} of your electricity supplied by your system</small>
          {e.annual && own != null && (
            <details className="pp-more-d">
              <summary>Details</summary>
              <p>{n0(own)} of the {n0(e.annual.load_kwh)} kWh your home uses a year comes from your panels and battery; {n0(e.annual.grid_import_kwh)} kWh still comes from the grid.</p>
            </details>
          )}
        </div>
        <Kpi label="Investment estimate" value={eur(e.capex_eur)} note="An estimate until the site visit." />
        <Kpi label="Break-even" value={be == null ? "over 20 years" : `${n0(be)} years`} />
      </section>

      {alts.length > 0 && (
        <section className="pp-card" aria-labelledby="pp-alts">
          <h2 id="pp-alts">Alternatives for your installer to discuss</h2>
          <ul className="pp-vars">
            {alts.map(({ key: k, name: label, v }) => (
              <li key={k}>
                <span className="pp-vname">{label}</span>
                <Chips d={v.design} />
                <span className="pp-vnum">{eur(v.economics.capex_eur)}<small>estimate</small></span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="pp-card" aria-label="Your system">
        <h2>Your system</h2>
        <KitSlot design={design} />
        <ul className="pp-parts">
          {KEYS.filter((k) => !OPTIONAL.has(k) || design[FIELD[k]] != null).map((k) => {
            const v = design[FIELD[k]];
            return (
              <li key={k} className={v == null ? "off" : undefined}>
                <span className={`pp-dot ${k}`} aria-hidden />
                <span className="pp-pname"><b>{NAME[k]}</b>{v == null && <span className="pp-size">Not included</span>}</span>
              </li>
            );
          })}
        </ul>
      </section>

      <Decision lead={lead} brand={brand} startedAt={startedAt} onDecided={onDecided} />
    </article>
  );
}

function Kpi({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div className="pp-kpi"><span>{label}</span><b>{value}</b>{note && <small>{note}</small>}</div>;
}

function Chips({ d }: { d: Design }) {
  return (
    <span className="pp-chips">
      {d.pv_kwp != null && <span className="pp-pill pv">{n2(d.pv_kwp)} kWp</span>}
      {d.battery_kwh != null && <span className="pp-pill battery">{n2(d.battery_kwh)} kWh</span>}
      {d.heatpump_kw != null && <span className="pp-pill heatpump">{n2(d.heatpump_kw)} kW</span>}
      {d.wallbox_kw != null && <span className="pp-pill wallbox">{n2(d.wallbox_kw)} kW</span>}
    </span>
  );
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
          <div><dt>{TODAY_LINE.split(": ")[0]}</dt><dd>{TODAY_LINE.split(": ")[1]}</dd></div>
        </dl>
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
        <p className="pp-time">{when(now)}</p>
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
  const v = ROWS.map((r) => r.name);
  return (
    <article className="pp pp-sk" aria-busy="true" aria-label="Your proposal">
      <header className="pp-cover">
        <svg className="pp-band" viewBox="0 0 390 260" preserveAspectRatio="none" aria-hidden>
          <polygon points="165,100 390,26 390,80 205,134" />
          <polygon points="0,78 112,50 112,88 0,116" />
        </svg>
        <p className="pp-brand"><Bar w="13ch" /></p>
        <div className="pp-title">
          <h1>Your proposal</h1>
          <p><Bar w="26ch" /></p>
        </div>
      </header>
      <section className="pp-house" aria-hidden><div className="pp-housebox pp-skb" /></section>
      <section className="pp-kpis" aria-hidden>
        {[["Yield a year", "10ch"], ["Supplied by your system", "4ch"], ["Investment estimate", "7ch"], ["Break-even", "8ch"]].map(([l, w], i) => (
          <div key={l} className="pp-kpi"><span>{l}</span><b><Bar w={w} /></b>{i === 2 && <small><Bar w="30ch" /></small>}</div>
        ))}
      </section>
      <section className="pp-card" aria-hidden>
        <h2>Alternatives for your installer to discuss</h2>
        <ul className="pp-vars">
          {v.slice(1).map((x) => (
            <li key={x}>
              <span className="pp-vname"><span className="pp-skt">{x}</span></span>
              <span className="pp-chips"><span className="pp-pill pp-skt" style={{ width: "9ch" }}>{"\u00a0"}</span><span className="pp-pill pp-skt" style={{ width: "6ch" }}>{"\u00a0"}</span></span>
              <span className="pp-vnum"><Bar w="7ch" /><small><Bar w="8ch" /></small></span>
            </li>
          ))}
        </ul>
      </section>
      <section className="pp-card" aria-hidden>
        <h2>Your system</h2>
        <KitSlot design={null} />
        <ul className="pp-parts">
          {KEYS.filter((k) => !OPTIONAL.has(k)).map((k) => (
            <li key={k}>
              <span className="pp-dot pp-skb" aria-hidden />
              <span className="pp-pname"><b className="pp-skt">{NAME[k]}</b></span>
            </li>
          ))}
        </ul>
      </section>
      <section className="pp-card pp-sign pp-signsk" aria-hidden><h2>Sign</h2></section>
    </article>
  );
}

// A blank shimmer bar of a fixed width: no placeholder text, so nothing readable if the shimmer style is missing.
function Bar({ w }: { w: string }) {
  return <span className="pp-skt" style={{ width: w }}>{"\u00a0"}</span>;
}
