"use client";
import { useState } from "react";
import { gapsOf, GAP_LABEL, type LeadLike } from "./gaps";
import { send } from "@/lib/client";
import { berlinTime } from "@/lib/time";
import "./gaps.css";

type Wa = { state?: string; messages?: { dir: string; at: string }[] } | null;
type LeadAsk = LeadLike & { whatsapp?: Wa; blockers?: { asked_at?: string | null }[] };
const isDemo = (l: LeadLike) => l.lead_id !== "db67b84935" && String((l as { customer_name?: string }).customer_name ?? "").trim().toLowerCase() === "katrin huber";
const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);

/** What the lead still needs, as quiet static pills, and one Ask for all of them in a single WhatsApp. */
export default function GapChips({ lead, address, onChanged }: { lead?: LeadLike | null; address?: string; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [askedNow, setAskedNow] = useState<string | null>(null);
  if (!lead) return null;
  const gaps = gapsOf(lead, address);
  if (!gaps.length) return null;
  const l = lead as LeadAsk;
  // Survives a reload: the lead's own open WhatsApp round or a blocker's asked_at (never a dry run).
  const out = [...(l.whatsapp?.messages ?? [])].reverse().find((m) => m.dir === "out");
  const at = l.blockers?.find((b) => b.asked_at)?.asked_at ?? (l.whatsapp?.state === "open" ? out?.at ?? null : null) ?? askedNow;
  const asked = !!at || !!askedNow;
  async function ask() {
    if (busy || asked || !lead || (!lead.phone && !isDemo(lead))) return;
    setBusy(true); setErr(null);
    const r = await send(`/api/leads/${encodeURIComponent(lead.lead_id)}/whatsapp/ask`, { facts: gaps }, "board-gap-ask");
    setBusy(false);
    if (r.ok) { setAskedNow(new Date().toISOString()); onChanged(); } else setErr(r.error);
  }
  const demo = isDemo(lead);
  const noPhone = !lead.phone && !demo;
  return (
    <div className={`gp${asked ? " asked" : ""}`} onClick={(e) => e.stopPropagation()}>
      <div className="gp-row">
        <span className="gp-label">Needs</span>
        {gaps.map((f) => <span key={f} className="gp-pill">{cap(GAP_LABEL[f])}</span>)}
        <span className="gp-end">
          {asked && <span className="gp-when">Asked {berlinTime(at ?? askedNow)}</span>}
          <button type="button" className={`gp-btn${busy ? " busy" : ""}`} disabled={noPhone || busy || asked} {...(noPhone ? { title: "No phone number on this lead", "aria-label": "No phone number on this lead" } : {})} onClick={ask}>{asked ? "Requested" : "Ask"}</button>
        </span>
      </div>
      {err && <span className="gp-err" role="alert">{err}</span>}
    </div>
  );
}
