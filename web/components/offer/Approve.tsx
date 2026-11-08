// Complete at the foot of the offer: saves the design exactly as shown (Stage's approve path: design hash, overrides,
// 409 on a mismatch) and opens the Send sheet. The lead's own state is read on open and after each save, so a complete,
// sent or signed lead says so here. No time stamps on the card: the chip carries the state.
import { useCallback, useEffect, useState } from "react";
import type { Lead } from "@/lib/api";
import { call } from "@/lib/client";
import SendSheet from "./SendSheet";
import { LEAD_LIVE } from "@/lib/whatsapp";
import s from "./offer.module.css";

type Read = Pick<Lead, "status" | "status_label" | "approved_at" | "decision" | "customer_name" | "version"> & { installer?: string };

export default function Approve({ leadId, approvedAt, onApprove, stale, want, onApproved, undo }: { undo?: { can: boolean; run: () => void }; leadId?: string | null; approvedAt: string | null; onApprove: (want?: unknown) => Promise<string | null> | void; stale?: boolean; want?: string | null; onApproved?: (a: Lead["approved"] | null) => void }) {
  const [busy, setBusy] = useState(false);
  const [fail, setFail] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const [sent, setSent] = useState(false);
  const [lead, setLead] = useState<Read | null>(null);
  const go = async () => {
    setBusy(true); setFail(null);
    try { const e = await onApprove(want ?? undefined); setFail(e || null); if (!e && leadId) setSheet(true); } finally { setBusy(false); }
  };
  useEffect(() => {
    if (!leadId) return;
    const ac = new AbortController();
    call<Lead>(`/api/leads/${encodeURIComponent(leadId)}`, undefined, ac.signal).then((r) => {
      if (!r.ok) return;
      setLead({ status: r.data.status, status_label: r.data.status_label, version: r.data.version, approved_at: r.data.approved_at, decision: r.data.decision, customer_name: r.data.customer_name, installer: (r.data as { facts?: { installer_id?: string } }).facts?.installer_id });
      setSent(r.data.status === "sent");
      onApproved?.(["approved", "sent", "signed"].includes(r.data.status) ? r.data.approved ?? null : null);
    }).catch(() => {});
    return () => ac.abort();
  }, [leadId, approvedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const close = useCallback(() => setSheet(false), []);
  // After a send: the lead as the engine holds it, here and on the board (header chip and card) via the live-lead event.
  const reread = async () => {
    if (!leadId) return;
    const r = await call<Lead>(`/api/leads/${encodeURIComponent(leadId)}`);
    if (!r.ok) return;
    setLead((x) => ({ ...(x ?? {} as Read), status: r.data.status, status_label: r.data.status_label, version: r.data.version }));
    dispatchEvent(new CustomEvent(LEAD_LIVE, { detail: r.data }));
  };
  const dec = lead?.decision;
  // A planner change after saving drops the lead back to a draft; the card's own state says so first.
  const signed = !stale && lead?.status === "signed" && dec?.action === "sign";
  const complete = !!approvedAt || (!stale && (lead?.status === "approved" || lead?.status === "sent"));
  const link = leadId && typeof location !== "undefined" ? `${location.origin}/start/proposal/${encodeURIComponent(leadId)}` : "";
  return (
    <div className={s.approve}>
      <div className={s.approveRow}>
      {/* Undo reverts the last edit to the design (moved here from the model toolbar, where it read as restart). */}
      {undo && <button type="button" className={s.undoBtn} onClick={undo.run} disabled={!undo.can} title="Revert the last edit">Undo</button>}
      {signed ? (
        <span className={s.done} data-k="signed">Signed{dec?.name ? ` by ${dec.name}` : ""}</span>
      ) : complete ? (
        <>
          <span className={s.done}>{(!stale && lead?.status_label) || (sent && !stale ? "Sent" : "Complete")}</span>
          {leadId && <button type="button" className="btn ghost" onClick={() => setSheet(true)}>Send</button>}
        </>
      ) : (
        <button type="button" className={`btn ${s.approveBtn}`} onClick={go} disabled={busy}>{busy ? "Saving" : "Complete"}</button>
      )}
      </div>
      {fail && !complete && !signed && <span className={s.failS} role="alert">{fail}</span>}
      {dec && dec.matches_current === false && <span className={s.warnS}>Signed a different version than the one on screen</span>}
      {sheet && leadId && <SendSheet leadId={leadId} name={lead?.customer_name ?? ""} link={link} version={lead?.version} onClose={close} onSent={() => { setSent(true); void reread(); }} />}
    </div>
  );
}
