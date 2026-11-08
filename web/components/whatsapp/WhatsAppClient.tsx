"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Lead, WhatsAppAsk, WhatsAppMessage } from "@/lib/api";
import { call, send } from "@/lib/client";
import { LEAD_LIVE, whatsappFields } from "@/lib/whatsapp";
import s from "./whatsapp.module.css";

const POLL_MS = 5000;
const LABEL: Record<string, string> = {
  annual_demand_kwh: "Household use", heating_type: "Heating", electricity_price_ct_kwh: "Price", has_ev: "Electric car", ev_annual_km: "Km a year",
  num_inhabitants: "Household", house_size_sqm: "Floor area", house_built_year: "Built", heating_cost_per_year_eur: "Heating cost", heating_demand_kwh: "Heating demand",
  has_wallbox: "Wallbox", has_solar: "Existing solar", existing_solar_kwp: "Existing solar", has_storage: "Existing battery", existing_storage_kwh: "Existing battery",
};
const hm = (ts: string) => { const d = new Date(ts); return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }); };

function Glyph() {
  return (
    <svg className={s.glyph} width="15" height="15" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10 2.5a7.5 7.5 0 0 0-6.5 11.2L2.5 17.5l3.9-1A7.5 7.5 0 1 0 10 2.5z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M7.4 7.2c.2 2.6 2.7 5 5.3 5.4l.9-1.3-1.6-.8-.7.7c-1-.4-1.9-1.3-2.3-2.3l.7-.7-.8-1.6z" fill="currentColor" />
    </svg>
  );
}

// The facts row's "WhatsApp client": asks the client for the missing facts on WhatsApp, then shows the thread.
export default function WhatsAppClient({ leadId }: { leadId: string | null }) {
  const [lead, setLead] = useState<Lead | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ text: string; retry: () => void } | null>(null);
  const [sent, setSent] = useState<WhatsAppMessage | null>(null);   // the ask's own message, until the lead's log carries it
  const [host, setHost] = useState<Element | null>(null);
  const seen = useRef<number | null>(null);

  // Sit in the facts row when there is one; otherwise stay where Chain put us.
  useLayoutEffect(() => { setHost(document.querySelector("[data-facts-row], .t-chips")); }, [leadId]);

  const load = useCallback(async (id: string) => {
    const r = await call<Lead>(`/api/leads/${encodeURIComponent(id)}`);
    if (!r.ok) { setErr({ text: r.error, retry: () => { setErr(null); void load(id); } }); return; }
    if (r.data.lead_id !== id) return;
    setLead(r.data);
    const v = r.data.version ?? null;
    // A new version (a reply was read and written as facts): the open card folds it in.
    if (seen.current != null && v != null && v !== seen.current) dispatchEvent(new CustomEvent(LEAD_LIVE, { detail: r.data }));
    if (v != null) seen.current = v;
  }, []);

  useEffect(() => { setLead(null); setSent(null); setErr(null); seen.current = null; if (leadId) void load(leadId); }, [leadId, load]);

  // The engine confirmed a send but the lead has not logged it yet: the conversation is open.
  const state = lead?.whatsapp?.state && lead.whatsapp.state !== "none" ? lead.whatsapp.state : sent ? "open" : "none";
  const live = state === "open" || busy;
  useEffect(() => {
    if (!leadId || !live) return;
    const t = setInterval(() => void load(leadId), POLL_MS);
    return () => clearInterval(t);
  }, [leadId, live, load]);

  async function ask() {
    if (!leadId || !lead?.phone || busy) return;
    setBusy(true); setErr(null);
    const r = await send<WhatsAppAsk>(`/api/leads/${encodeURIComponent(leadId)}/whatsapp/ask`, {}, "whatsapp-ask");
    if (r.ok) {
      const m = r.data.sent;
      if (typeof m === "string") setSent({ dir: "out", text: m, ts: new Date().toISOString() });
      else if (m && typeof m === "object") setSent(m);
      await load(leadId);
    } else setErr({ text: r.error, retry: () => void ask() });
    setBusy(false);
  }

  if (!leadId || !lead) {
    const out = err ? <Err err={err} /> : null;
    return out && host ? createPortal(out, host) : out;
  }

  const log = lead.whatsapp?.messages ?? [];
  const thread = sent && !log.some((m) => m.dir === "out" && m.text === sent.text) ? [sent, ...log] : log;
  const filled = whatsappFields(lead).map((f) => LABEL[f] ?? f.replace(/_/g, " "));
  let chip;
  if (state === "none") {
    const noPhone = !lead.phone;
    chip = (
      <span className={s.wrap} title={noPhone ? "No phone number on this lead" : undefined}>
        <button type="button" className={s.chip} aria-disabled={noPhone || busy} aria-busy={busy} onClick={ask}>
          <Glyph />{busy ? "Sending" : "WhatsApp client"}
        </button>
      </span>
    );
  } else {
    chip = (
      <details className={s.wrap}>
        <summary className={`${s.chip} ${state === "open" ? s.on : ""}`}>
          {state === "open" && <span className={s.dot} aria-hidden />}
          <Glyph /><span key={state} className={s.label}>{state === "open" ? "Asking on WhatsApp" : "Answered on WhatsApp"}</span>
        </summary>
        <div className={s.pop} role="log" aria-live="polite" aria-label="WhatsApp thread">
          <ol className={s.thread}>
            {thread.map((m) => (
              <li key={`${m.dir}-${m.ts}-${m.text.slice(0, 24)}`} className={m.dir === "out" ? s.out : s.in}>
                <p>{m.text}</p>
                <span className={s.ts}>{m.dir === "out" ? "Sent" : lead.customer_name?.split(" ")[0] || "Client"} {hm(m.ts)}</span>
              </li>
            ))}
          </ol>
          {filled.length > 0 && <p className={s.filled}>Filled: {filled.join(", ")}</p>}
        </div>
      </details>
    );
  }
  const out = <>{chip}{err && <Err err={err} />}</>;
  return host ? createPortal(out, host) : <div className={s.inline}>{out}</div>;
}

function Err({ err }: { err: { text: string; retry: () => void } }) {
  return (
    <span className={s.err} role="alert">
      <span><span className={s.src}>Engine said </span>{err.text}</span>
      <button type="button" className="btn ghost" onClick={err.retry}>Retry</button>
    </span>
  );
}
