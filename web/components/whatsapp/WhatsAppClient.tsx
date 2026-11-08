"use client";
import { maskPhonesIn } from "@/lib/phone";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Lead, WhatsAppAsk } from "@/lib/api";
import { call, send } from "@/lib/client";
import { useDry } from "@/lib/dry";
import { LEAD_LIVE, whatsappFields } from "@/lib/whatsapp";
import s from "./whatsapp.module.css";
import { berlinTime } from "@/lib/time";

const POLL_MS = 5000;
const LABEL: Record<string, string> = {
  annual_demand_kwh: "Household use", heating_type: "Heating", electricity_price_ct_kwh: "Price", has_ev: "Electric car", ev_annual_km: "Km a year",
  num_inhabitants: "Household", house_size_sqm: "Floor area", house_built_year: "Built", heating_cost_per_year_eur: "Heating cost", heating_demand_kwh: "Heating demand",
  has_wallbox: "Wallbox", has_solar: "Existing solar", existing_solar_kwp: "Existing solar", has_storage: "Existing battery", existing_storage_kwh: "Existing battery",
};
const hm = (ts: string) => berlinTime(ts);

function Glyph() {
  return (
    <svg className={s.glyph} width="15" height="15" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10 2.5a7.5 7.5 0 0 0-6.5 11.2L2.5 17.5l3.9-1A7.5 7.5 0 1 0 10 2.5z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M7.4 7.2c.2 2.6 2.7 5 5.3 5.4l.9-1.3-1.6-.8-.7.7c-1-.4-1.9-1.3-2.3-2.3l.7-.7-.8-1.6z" fill="currentColor" />
    </svg>
  );
}

// The facts row's "WhatsApp client": asks the client for the missing facts on WhatsApp, then shows the thread.
// phone: the open card's own phone, so a number typed a moment ago counts before the lead is read again.
export default function WhatsAppClient({ leadId, phone }: { leadId: string | null; phone?: string | null }) {
  const dry = useDry();
  const [lead, setLead] = useState<Lead | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ text: string; retry: () => void } | null>(null);
  const seen = useRef<number | null>(null);

  const take = useCallback((l: Lead) => {
    setLead(l);
    const v = l.version ?? null;
    // A new version (a reply was read and written as facts): the open card folds it in.
    if (seen.current != null && v != null && v !== seen.current) dispatchEvent(new CustomEvent(LEAD_LIVE, { detail: l }));
    if (v != null) seen.current = v;
  }, []);

  const load = useCallback(async (id: string) => {
    const r = await call<Lead>(`/api/leads/${encodeURIComponent(id)}`);
    if (!r.ok) { setErr({ text: r.error, retry: () => { setErr(null); void load(id); } }); return; }
    if (r.data.lead_id === id) take(r.data);
  }, [take]);

  useEffect(() => { setLead(null); setErr(null); seen.current = null; if (leadId) void load(leadId); }, [leadId, load]);

  const state = lead?.whatsapp?.state ?? "none";
  useEffect(() => {
    if (!leadId || !(state === "open" || busy)) return;
    const t = setInterval(() => void load(leadId), POLL_MS);
    return () => clearInterval(t);
  }, [leadId, state, busy, load]);

  const tel = phone !== undefined ? phone : lead?.phone;
  async function ask() {
    if (!leadId || !tel || busy) return;
    setBusy(true); setErr(null);
    const r = await send<WhatsAppAsk>(`/api/leads/${encodeURIComponent(leadId)}/whatsapp/ask`, dry ? { dry: true } : {}, dry ? "whatsapp-ask-dry" : "whatsapp-ask");
    if (r.ok) {
      const wa = r.data.whatsapp;
      if (wa) setLead((l) => l && { ...l, whatsapp: wa });
      await load(leadId);
    } else setErr({ text: r.error, retry: () => void ask() });
    setBusy(false);
  }

  if (!leadId || !lead) return err ? <Err err={err} /> : null;

  const wa = lead.whatsapp;
  const thread = (wa?.messages ?? []).filter((m) => dry || m.kind !== "dry");
  const dryRun = dry && thread.some((m) => m.kind === "dry") && state !== "open";
  const filled = whatsappFields(lead).map((f) => LABEL[f] ?? f.replace(/_/g, " "));
  const who = lead.customer_name?.split(" ")[0] || "Client";
  let chip;
  if (state === "none" && !dryRun) {
    const noPhone = !tel;
    chip = (
      <span className={s.wrap} title={noPhone ? "No phone number on this lead" : undefined}>
        <button type="button" className={s.chip} aria-disabled={noPhone || busy} aria-busy={busy} onClick={ask}>
          <Glyph />{busy ? "Sending" : "WhatsApp client"}
        </button>
      </span>
    );
  } else {
    const label = state === "open" ? "Asking on WhatsApp" : dryRun ? "Dry run" : "Answered on WhatsApp";
    chip = (
      <details className={s.wrap}>
        <summary className={`${s.chip} ${state === "open" ? s.on : ""}`}>
          {state === "open" && <span className={s.dot} aria-hidden />}
          <Glyph /><span key={label} className={s.label}>{label}</span>
        </summary>
        <div className={s.pop} role="log" aria-live="polite" aria-label="WhatsApp thread">
          <ol className={s.thread}>
            {thread.map((m, i) => (
              <li key={`${i}-${m.at}`} className={m.dir === "out" ? s.out : s.in}>
                {m.kind === "voice" ? <p><span className={s.tag}>Voice note</span>{maskPhonesIn(m.transcript || m.text || "No transcript")}</p> : <p>{maskPhonesIn(m.text)}</p>}
                <span className={s.ts}>{m.dir === "out" ? "Sent" : who} {hm(m.at)}{m.kind === "dry" && <span className={s.tag}>not sent</span>}</span>
              </li>
            ))}
          </ol>
          {wa?.last_error && <p className={s.lastErr} role="alert"><span className={s.src}>WhatsApp said </span>{wa.last_error}</p>}
          {filled.length > 0 && <p className={s.filled}>Filled: {filled.join(", ")}</p>}
          {dryRun && <button type="button" className="btn ghost" onClick={ask} disabled={busy}>Dry run again</button>}
        </div>
      </details>
    );
  }
  return <>{chip}{err && <Err err={err} />}</>;
}

function Err({ err }: { err: { text: string; retry: () => void } }) {
  return (
    <span className={s.err} role="alert">
      <span><span className={s.src}>Engine said </span>{err.text}</span>
      <button type="button" className="btn ghost" onClick={err.retry}>Retry</button>
    </span>
  );
}
