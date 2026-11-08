"use client";
import { useCallback, useEffect, useState } from "react";
import type { InstallerId } from "@/lib/api";
import type { IntakeFacts, Source } from "@/app/start/intake";
import { berlinStamp } from "@/lib/time";

export type CallLead = { conversation_id: string; facts: IntakeFacts; sources: Record<string, Source>; inputs: Record<string, unknown> };
type Row = { conversation_id: string; lead_id?: string | null; started_at: number | null; call_secs: number | null; status: string; title: string | null; customer_name?: string | null; address_or_postcode?: string | null };

const when = (s: number | null) => s ? berlinStamp(new Date(s * 1000).toISOString()) : "";
const live = (s: number | null, now: number) => { const t = s ? Math.max(0, Math.floor(now / 1000 - s)) : 0; return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`; };
const mins = (s: number | null) => s ? `${Math.max(1, Math.round(s / 60))} min` : "";

// Behind NEXT_PUBLIC_VOICE=1: homeowner calls from the /start widget, and a way to start one here.
export default function Calls({ installer, onLead }: { installer: InstallerId; onLead: (l: CallLead) => void }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [calling, setCalling] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  // Polled every 3 s while the Lead step is open, so a call in progress shows up live.
  useEffect(() => {
    let stop = false;
    const load = () => fetch("/start/leads", { cache: "no-store" }).then(async (r) => {
      const b = await r.json().catch(() => ({ error: `Leads returned ${r.status}` }));
      if (stop) return;
      if (r.ok) { setRows(b); setErr(null); } else setErr(b.error ?? `Leads returned ${r.status}`);
    }).catch((e) => { if (!stop) setErr(String(e)); });
    load();
    const t = setInterval(load, 3000);
    return () => { stop = true; clearInterval(t); };
  }, [tick]);
  const [now, setNow] = useState(() => Date.now());
  const anyLive = !!rows?.some((r) => r.status === "in_progress");
  useEffect(() => {
    if (!anyLive) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [anyLive]);

  // The analysis lands a few seconds after the call ends: 202 until then.
  const open = useCallback(async (id: string) => {
    setOpening(id); setErr(null);
    for (let k = 0; k < 30; k++) {
      const r = await fetch(`/start/lead/${id}`, { cache: "no-store" });
      const b = await r.json().catch(() => ({ error: `Lead returned ${r.status}` }));
      if (r.status === 202) { await new Promise((ok) => setTimeout(ok, 3000)); continue; }
      setOpening(null);
      if (!r.ok) { setErr(b.error ?? `Lead returned ${r.status}`); return; }
      onLead({ conversation_id: id, facts: b.facts, sources: b.sources ?? {}, inputs: b.inputs });
      return;
    }
    setOpening(null); setErr("The call is still being analysed.");
  }, [onLead]);

  useEffect(() => {
    const on = (e: MessageEvent) => {
      if (e.origin !== location.origin || e.data?.type !== "marquee:lead" || typeof e.data.conversation_id !== "string") return;
      setCalling(false); setTick((t) => t + 1); open(e.data.conversation_id);
    };
    addEventListener("message", on); return () => removeEventListener("message", on);
  }, [open]);

  return (
    <section className="s-calls">
      <div className="s-calls-h">
        <h3 className="s-h3">From calls</h3>
        <button type="button" className="btn ghost" onClick={() => setCalling((c) => !c)}>{calling ? "Close" : "Call the homeowner"}</button>
      </div>
      {calling && <iframe className="s-call-frame" src={`/start?installer=${installer}`} allow="microphone" title="Call the homeowner" />}
      {err && <div className="error" role="alert"><span><span className="src">Calls said</span>{err}</span><button className="btn ghost" onClick={() => setTick((t) => t + 1)}>Retry</button></div>}
      {opening && <p className="s-quiet s-wait">Reading the call</p>}
      {rows && rows.length === 0 && <p className="s-quiet">No calls yet.</p>}
      {rows && rows.length > 0 && (
        <ul className="s-calls-l">
          {[...rows.filter((r) => r.status === "in_progress"), ...rows.filter((r) => r.status !== "in_progress")].slice(0, 6).map((r) => r.status === "in_progress" ? (
            <li key={`live-${r.conversation_id}`} className="s-live">
              <span className="s-live-mesh" aria-hidden><i /><i /><i /></span>
              {(() => { const t = <span className="s-live-t"><span className="dot" aria-hidden />Live call with {[r.customer_name ?? "a homeowner", r.address_or_postcode?.match(/\b\d{5}\b/)?.[0] ?? r.address_or_postcode].filter(Boolean).join(", ")}, <span className="num">{live(r.started_at, now)}</span></span>;
                return r.lead_id ? <a className="s-live-a" href={`/leads/${r.lead_id}`}>{t}</a> : t; })()}
            </li>
          ) : (
            <li key={r.conversation_id} className="s-in">
              {r.lead_id
                ? <a href={`/leads/${r.lead_id}`}><span>{r.title ?? "Call"}</span><span className="num">{[when(r.started_at), mins(r.call_secs)].filter(Boolean).join(", ")}</span></a>
                : <button type="button" disabled={!!opening} onClick={() => open(r.conversation_id)}>
                <span>{r.title ?? "Call"}</span><span className="num">{[when(r.started_at), mins(r.call_secs)].filter(Boolean).join(", ")}</span>
              </button>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
