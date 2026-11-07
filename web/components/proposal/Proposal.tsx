"use client";
// v2.5: the homeowner's one-page proposal and sign step. Every number comes from the lead the engine serves.
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import House from "@/components/stage/House";
import { INSTALLER_NAME, type ComponentKey, type Design, type DesignResponse, type Lead, type LeadStatus, type Variant, type WriteResponse } from "@/lib/api";
import { buildFacts, KEYS, n0, n2 } from "@/lib/stage";
import { decide } from "@/lib/proposal";
import Signature, { type SignatureHandle } from "./Signature";
import "./proposal.css";

const SpatialDemo = dynamic(() => import("@/components/spatial/SpatialDemo"), { ssr: false });

// docs/data-insights.md, installer 23c108b7 medians: enquiry to offer 8.2 days, offer to signature 28.7 days.
export const TODAY_OFFER_DAYS = 8;
export const TODAY_SIGN_DAYS = 29;
export const TODAY_LINE = `Today: ${TODAY_OFFER_DAYS} days to an offer, ${TODAY_SIGN_DAYS} more to a signature`;

const NAME: Record<ComponentKey, string> = { pv: "Solar panels", battery: "Battery", heatpump: "Heat pump", wallbox: "Wallbox" };
const FIELD: Record<ComponentKey, keyof Design> = { pv: "pv_kwp", battery: "battery_kwh", heatpump: "heatpump_kw", wallbox: "wallbox_kw" };
const UNIT: Record<ComponentKey, string> = { pv: "kWp", battery: "kWh", heatpump: "kW", wallbox: "kW" };

const eur = (x: number) => `€${n0(x)}`;
const pc = (x: number) => `${Math.round(x * 100)} %`;
const when = (d: Date) => d.toLocaleString("en-GB", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
export const span = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return s >= 3600 ? `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min` : `${Math.floor(s / 60)} min ${s % 60} s`; };
// A street and number before the first comma, as in "Katharinenstraße 5, 82008 Unterhaching".
const hasStreet = (s: string) => s.includes(",") && /[A-Za-zÄÖÜäöüß.]{3,}\s+\d+\s*[a-zA-Z]?$/.test(s.split(",")[0].trim());

export function offered(lead: Lead): { key: Variant["key"]; design: Design; economics: DesignResponse["economics"] } {
  const key = lead.approved_variant ?? "expert";
  const v = lead.draft.variants?.find((x) => x.key === key);
  return { key: v ? key : "expert", design: v?.design ?? lead.draft.design, economics: v?.economics ?? lead.draft.economics };
}

const writes = new Map<string, WriteResponse | "failed">();

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

  // One sentence per component from /api/write, homeowner voice; the draft's explanation if that fails.
  const hash = lead.proposal_hash ?? JSON.stringify(design);
  const [write, setWrite] = useState<WriteResponse | "failed" | null>(writes.get(hash) ?? null);
  useEffect(() => {
    if (writes.has(hash)) { setWrite(writes.get(hash)!); return; }
    const ctl = new AbortController();
    const facts = buildFacts(lead.facts, { ...lead.draft, design, economics: e })
      .map((f) => Object.values(INSTALLER_NAME).reduce((s, n) => s.split(n).join(brand), f));
    fetch("/api/write", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ facts, mode: "homeowner", lead_id: lead.lead_id }), signal: ctl.signal })
      .then(async (r) => (r.ok ? ((await r.json()) as WriteResponse) : "failed" as const))
      .catch((err) => ((err as Error).name === "AbortError" ? null : ("failed" as const)))
      .then((w) => { if (w) { writes.set(hash, w); setWrite(w); } });
    return () => ctl.abort();
  }, [hash]); // eslint-disable-line react-hooks/exhaustive-deps
  const lines = write && write !== "failed" ? write.lines : null;
  const fallback = write === "failed" || (lines && KEYS.every((k) => !lines[k]));

  const yieldKwh = e.annual?.pv_yield_kwh;
  const be = e.break_even_year !== undefined ? e.break_even_year : e.payback_years == null ? null : Math.ceil(e.payback_years);
  const name = lead.customer_name?.trim();

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

      <section className="pp-house" aria-label="Your home">
        {street && spatial !== false && (
          <div className="pp-spatial">
            <SpatialDemo leadId={lead.lead_id} inputs={lead.facts} design={design} address={address} response={lead.draft} layer={layer} onLayerChange={setLayer} onAvailable={setSpatial} />
          </div>
        )}
        {(!street || spatial === false) && <div className="pp-drawing"><House design={design} /></div>}
      </section>

      <section className="pp-kpis" aria-label="Key figures">
        {yieldKwh != null && <Kpi label="Yield a year" value={`${n0(yieldKwh)} kWh`} />}
        <Kpi label="Autarky" value={pc(e.autarky_share)} />
        <Kpi label="Investment" value={eur(e.capex_eur)} note={`Estimate, final price confirmed by ${brand}`} />
        <Kpi label="Break-even" value={be == null ? "over 20 years" : `${n0(be)} years`} />
      </section>

      {variants.length > 0 && (
        <section className="pp-card" aria-label="Variants">
          <h2>Variants</h2>
          <ul className="pp-vars">
            {variants.map((v) => (
              <li key={v.key} className={v.key === key ? "on" : undefined} aria-current={v.key === key ? "true" : undefined}>
                <span className="pp-vname">{v.label}{v.key === key && <span className="pp-pill blue">Proposed</span>}</span>
                <Chips d={v.design} />
                <span className="pp-vnum">{eur(v.economics.capex_eur)}<small>{pc(v.economics.autarky_share)} autarky</small></span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="pp-card" aria-label="Your system">
        <h2>Your system</h2>
        <ul className="pp-parts">
          {KEYS.map((k) => {
            const v = design[FIELD[k]];
            return (
              <li key={k} className={v == null ? "off" : undefined}>
                <span className={`pp-dot ${k}`} aria-hidden />
                <span className="pp-pname"><b>{NAME[k]}</b><span className="pp-size">{v == null ? "Not included" : `${n2(v)} ${UNIT[k]}`}</span></span>
                {lines?.[k] && <p>{lines[k]}</p>}
                {!write && <span className="pp-wait" aria-hidden />}
              </li>
            );
          })}
        </ul>
        {fallback && <ul className="pp-why">{lead.draft.explanation.map((x) => <li key={x}>{x}</li>)}</ul>}
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
