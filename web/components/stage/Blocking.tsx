"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Lead, LeadBlocker, WhatsAppAsk } from "@/lib/api";
import { call, send } from "@/lib/client";
import { useDry } from "@/lib/dry";
import { berlinTime } from "@/lib/time";

const POLL_MS = 5000;
const eur = (n?: number | null) => n == null ? "" : n >= 1000 ? `about €${Math.round(n / 1000)}k` : `about €${Math.round(n / 10) * 10}`;

/** The card's top row: the facts that move the design most, what each moves, and one batched ask on WhatsApp. Nothing without blockers. */
export default function Blocking({ leadId }: { leadId: string }) {
  const dry = useDry();
  const [lead, setLead] = useState<Lead | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const answeredAt = useRef<Record<string, number | undefined>>({});   // the lead version when an answer was first seen
  const load = useCallback(async () => {
    const r = await call<Lead>(`/api/leads/${encodeURIComponent(leadId)}`);
    if (r.ok && r.data.lead_id === leadId) {
      for (const b of r.data.blockers ?? []) if (b.answered_at && answeredAt.current[b.field] == null) answeredAt.current[b.field] = r.data.version ?? 0;
      setLead(r.data);
    }
  }, [leadId]);
  useEffect(() => { setLead(null); answeredAt.current = {}; void load(); }, [load]);
  const waiting = (lead?.blockers ?? []).some((b) => b.asked_at && !b.answered_at);
  useEffect(() => {
    if (!waiting && !busy) return;
    const t = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(t);
  }, [waiting, busy, load]);

  const rows = lead?.blockers ?? [];
  if (!lead || rows.length === 0) return null;
  const noPhone = !lead.phone;
  async function ask() {
    if (noPhone || busy) return;
    setBusy(true); setErr(null);
    const facts = rows.map((b) => b.field);
    const r = await send<WhatsAppAsk>(`/api/leads/${encodeURIComponent(leadId)}/whatsapp/ask`, dry ? { dry: true, facts } : { facts }, dry ? "whatsapp-ask-dry" : "whatsapp-ask");
    if (r.ok) await load(); else setErr(r.error);
    setBusy(false);
  }
  const line = (b: LeadBlocker) => {
    const v0 = answeredAt.current[b.field];
    if (b.answered_at) return v0 != null && (lead.version ?? 0) > v0 ? "Updated" : `Answered ${berlinTime(b.answered_at)}`;
    return b.asked_at ? `Asked ${berlinTime(b.asked_at)}` : "";
  };
  return (
    <section className="bk" aria-label="Blocking">
      <ul className="bk-rows">
        {rows.map((b) => (
          <li key={b.field}>
            <span className="bk-t">{b.label}{b.delta_text ? `: ${b.delta_text}` : ""}{b.delta_eur != null ? `, ${eur(b.delta_eur)}` : ""}</span>
            {line(b) && <span className="bk-s">{line(b)}</span>}
          </li>
        ))}
      </ul>
      <button type="button" className="bk-ask" disabled={noPhone || busy} aria-busy={busy} title={noPhone ? "No phone number on this lead" : undefined} onClick={ask}>
        {noPhone ? "No phone number on this lead" : busy ? <span className="b-skel" aria-hidden style={{ display: "inline-block", width: 96, height: 12 }} /> : "Ask on WhatsApp"}
      </button>
      {err && <p className="bk-err" role="alert"><span className="src">Engine said </span>{err}</p>}
    </section>
  );
}
