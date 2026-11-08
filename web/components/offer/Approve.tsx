// Approve at the foot of the offer: releases the proposal to the homeowner (PUT approve through the proxy, which
// Stage runs). The lead's own state is read once on open and after each approval, so an approved or signed lead
// says so here even when the card was opened later.
import { useEffect, useState } from "react";
import type { Lead } from "@/lib/api";
import { call } from "@/lib/client";
import s from "./offer.module.css";

const hm = (iso?: string | null) => (iso ? new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "");

export default function Approve({ leadId, approvedAt, onApprove, stale }: { leadId?: string | null; approvedAt: string | null; onApprove: () => void; stale?: boolean }) {
  const [lead, setLead] = useState<Pick<Lead, "status" | "approved_at" | "decision"> | null>(null);
  useEffect(() => {
    if (!leadId) return;
    const ac = new AbortController();
    call<Lead>(`/api/leads/${encodeURIComponent(leadId)}`, undefined, ac.signal).then((r) => { if (r.ok) setLead({ status: r.data.status, approved_at: r.data.approved_at, decision: r.data.decision }); }).catch(() => {});
    return () => ac.abort();
  }, [leadId, approvedAt]);
  const dec = lead?.decision;
  // A planner change after approval drops the lead back to a draft; the card's own state says so first.
  const signed = !stale && lead?.status === "signed" && dec?.action === "sign";
  const approved = approvedAt ?? (!stale && lead?.status === "approved" ? hm(lead.approved_at) : null);
  return (
    <div className={s.approve}>
      {signed ? (
        <span className={s.done} data-k="signed">Signed{dec?.name ? ` by ${dec.name}` : ""} {hm(dec?.decided_at)}</span>
      ) : approved ? (
        <span className={s.done}>Approved {approved}</span>
      ) : (
        <button type="button" className={`btn ${s.approveBtn}`} onClick={onApprove}>Approve</button>
      )}
      {dec && dec.matches_current === false && <span className={s.warnS}>Signed a different version than the one on screen</span>}
    </div>
  );
}
