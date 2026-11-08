"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Lead, LeadBlocker, WhatsAppAsk } from "@/lib/api";
import { call, send } from "@/lib/client";
import { useDry } from "@/lib/dry";
import { berlinTime } from "@/lib/time";

const POLL_MS = 5000;
const ASK: Record<string, string> = { has_solar: "Already has solar", has_ev: "Electric car", annual_demand_kwh: "Yearly use", heating_type: "Heating", house_size_sqm: "Floor area", house_built_year: "Year built", num_inhabitants: "People at home", electricity_price_ct_kwh: "Power price", has_wallbox: "Wallbox", has_storage: "Existing battery" };
const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
const MOVES: Record<string, string> = { "PV size": "PV" };
// "Already has solar? PV about €13k less": the fact as a short question, what it moves, the figure.
const rowText = (b: LeadBlocker) => `${ASK[b.field] ?? cap(b.label)}? ${[b.moves ? MOVES[b.moves] ?? b.moves : "", eur(b.delta_eur)].filter(Boolean).join(" ")}`.trim();
// The sign is words, never a bare minus.
const eur = (n?: number | null) => { if (n == null) return ""; const a = Math.abs(n); return `about €${a >= 1000 ? `${Math.round(a / 1000)}k` : Math.round(a / 10) * 10} ${n < 0 ? "less" : "more"}`; };

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
      for (const b of r.data.blockers ?? []) if (b.answered_at && answeredAt.current[b.field] == null) {
        answeredAt.current[b.field] = r.data.version ?? 0;
        setTimeout(() => void load(), 2000);   // the engine recomputes blockers in the background: read once more after an answer lands
      }
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
    // A round the engine has composed (a dry run) or has open stamps no asked_at on the blocker: the last outgoing message gives the time.
    const st = lead.whatsapp?.state, out = [...(lead.whatsapp?.messages ?? [])].reverse().find((m) => m.dir === "out");
    const at = b.asked_at ?? (out && (st === "dry" || st === "open") ? out.at : null);
    return at ? `Asked ${berlinTime(at)}` : "";
  };
  return (
    <section className="bk" aria-label="Blocking">
      <ul className="bk-rows">
        {rows.map((b) => (
          <li key={b.field}>
            <span className="bk-t">{rowText(b)}</span>
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
