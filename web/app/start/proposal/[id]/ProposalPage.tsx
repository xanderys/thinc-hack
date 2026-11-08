"use client";
import { useEffect, useRef, useState } from "react";
import Proposal, { ProposalSkeleton } from "@/components/proposal/Proposal";
import type { Lead } from "@/lib/api";
import { INSTALLER_BRAND } from "../../intake";

export default function ProposalPage({ id }: { id: string }) {
  const [lead, setLead] = useState<Lead | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tries, setTries] = useState(0);
  // Once released, the proposal stays on screen; a later planner change shows as a notice inside it.
  const released = useRef(false);
  useEffect(() => {
    let live = true;
    const load = async () => {
      const r = await fetch(`/api/leads/${encodeURIComponent(id)}`, { cache: "no-store" }).catch((e) => ({ ok: false, json: async () => ({ error: (e as Error).message }) }) as Response);
      const b = await r.json().catch(() => ({}));
      if (!live) return;
      if (r.ok) { setLead(b as Lead); setError(null); } else setError(b.error ?? `Engine answered ${r.status}.`);
    };
    load();
    const t = setInterval(load, 3000);
    return () => { live = false; clearInterval(t); };
  }, [id, tries]);

  if (!lead && error)
    return (
      <div className="h-page">
        <section className="h-card" style={{ marginTop: 24 }}>
          <h1>This proposal did not load</h1>
          <p className="h-why" role="alert">{error} <button type="button" className="pp-link" onClick={() => setTries(tries + 1)}>Try again</button></p>
        </section>
      </div>
    );
  if (!lead) return <div className="h-prop"><ProposalSkeleton /></div>;
  if (lead.approved_at || lead.decision || ["approved", "sent", "signed", "declined", "question"].includes(lead.status)) released.current = true;
  const brand = INSTALLER_BRAND[lead.facts.installer_id] ?? INSTALLER_BRAND["2a8ba8e2"];
  if (lead.status === "draft" || lead.status === "in_call" || !released.current)
    return (
      <div className="h-page">
        <section className="h-card" style={{ marginTop: 24 }}><h1>{brand} has not sent this proposal yet</h1></section>
      </div>
    );
  return <div className="h-prop"><Proposal lead={lead} brand={brand} /></div>;
}
