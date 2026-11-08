"use client";
// Check page: the shoot's seed action. The run itself lives in the copilot thread (store.ts, agent/Thread.tsx).
import { useState } from "react";
import s from "./autopilot.module.css";

// Check page: six test enquiries for the shoot (engine replaces its previous six).
export function SeedDemo() {
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const go = async () => {
    setBusy(true); setErr(null); setOut(null);
    try {
      const r = await fetch("/api/autopilot/seed", { method: "POST" });
      const b = await r.json().catch(() => ({})) as { error?: string; lead_ids?: string[] };
      if (!r.ok) setErr(b.error ?? `Engine answered ${r.status}`);
      else { const n = b.lead_ids?.length ?? 0; setOut(`${n} demo ${n === 1 ? "enquiry" : "enquiries"} on the board`); }
    } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };
  return (
    <div className={s.seed}>
      <button className={`btn ghost${busy ? ` ${s.busy}` : ""}`} onClick={go} disabled={busy} aria-busy={busy}>Seed demo enquiries</button>
      {out && <span>{out}</span>}
      {err && <div className="error" role="alert"><span><span className="src">Engine said</span>{err}</span><button className="btn ghost" onClick={go}>Retry</button></div>}
    </div>
  );
}
