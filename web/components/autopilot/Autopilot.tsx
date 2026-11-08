"use client";
// The board's "Run autopilot" button and the agent log that slides up above the composer while a run streams.
import { useEffect, useRef, useState } from "react";
import { berlinTime } from "@/lib/time";
import { askRun, cancelRun, closeLog, confirmRun, openLog, useRun, type ApEvent } from "./store";
import s from "./autopilot.module.css";

// ?dry=1 runs without sending; ?mock=1 plays the scripted run (off production only); ?leads=a,b and ?wait=s narrow a check run.
const flags = () => {
  const q = new URLSearchParams(location.search), ids = q.get("leads")?.split(",").filter(Boolean), w = q.get("wait");
  return { ...(q.get("dry") === "1" ? { dry: true } : {}), ...(q.get("mock") === "1" ? { mock: true } : {}), ...(ids?.length ? { lead_ids: ids } : {}), ...(w != null && /^\d+$/.test(w) ? { wait_s: Number(w) } : {}), ...(q.get("confirm") === "1" ? { confirm: true } : {}) };
};

export function RunButton() {
  const run = useRun();
  const [elsewhere, setElsewhere] = useState(false);
  useEffect(() => {
    if (flags().mock) return;   // the mock run calls nothing real
    fetch("/api/autopilot/status", { cache: "no-store" }).then((r) => r.ok ? r.json() : null).then((b) => setElsewhere(!!b?.running)).catch(() => {});
  }, [run.phase]);
  const busy = run.phase === "running" || run.phase === "confirm";
  // The copilot's "Run autopilot" chip starts the same flow as this button, confirm line included.
  useEffect(() => {
    const on = () => askRun(flags());
    addEventListener("marquee:run-autopilot", on); return () => removeEventListener("marquee:run-autopilot", on);
  }, []);
  const go = () => {
    askRun(flags());
  };
  return (
    <div className={s.bar}>
      <button type="button" className={`btn ${s.run}${busy ? ` ${s.busy}` : ""}`} onClick={go} disabled={busy || (elsewhere && run.phase === "idle")} aria-busy={busy}
        title={elsewhere && !busy ? "A run is already going on the engine" : undefined}>
        Run autopilot
      </button>
      {!run.open && run.phase !== "idle" && <button type="button" className={`btn ghost ${s.run}`} onClick={openLog}>Log</button>}
    </div>
  );
}

// The engine names its glyphs; each maps to the step icon it stands for.
const BY_GLYPH: Record<string, string> = { doc: "read", ruler: "measure", message: "ask", pencil: "draft", paperplane: "send", hand: "needs_you", check: "summary" };
function Glyph({ step, glyph, state }: { step: string; glyph?: string; state: ApEvent["state"] }) {
  const k = state === "error" ? "error" : (glyph && BY_GLYPH[glyph]) || step;
  const p: Record<string, React.ReactNode> = {
    read: <path d="M2 4h12v8H2zM2 4l6 5 6-5" />,
    measure: <path d="M2 12 8 4l6 8M5 8h6" />,
    ask: <path d="M2 3h12v8H7l-3 3v-3H2z" />,
    draft: <path d="M3 2h7l3 3v9H3zM10 2v3h3M5 9h6M5 11.5h4" />,
    send: <path d="M2 8 14 2 10 14 8 9z" />,
    needs_you: <path d="M8 2v7M8 12v1.5" />,
    summary: <path d="M3 8.5 6.5 12 13 4" />,
    error: <path d="M4 4l8 8M12 4l-8 8" />,
  };
  return <svg className={s.glyph} data-step={k} viewBox="0 0 16 16" aria-hidden>{p[k] ?? <circle cx="8" cy="8" r="2.5" />}</svg>;
}

export function AgentLog() {
  const run = useRun();
  const list = useRef<HTMLOListElement>(null);
  useEffect(() => { const el = list.current; if (el) el.scrollTop = el.scrollHeight; }, [run.events.length, run.open]);
  useEffect(() => {
    if (!run.open || run.phase === "running") return;
    const on = (e: KeyboardEvent) => { if (e.key === "Escape") { if (run.phase === "confirm") cancelRun(); else closeLog(); } };
    addEventListener("keydown", on); return () => removeEventListener("keydown", on);
  }, [run.open, run.phase]);
  if (!run.open) return null;
  const summary = run.events.find((e) => e.step === "summary");
  const lines = run.events.filter((e) => e.step !== "summary");
  return (
    <section className={s.log} aria-label="Autopilot" aria-live="polite">
      <header className={s.head}>
        <h2>Autopilot</h2>
        {run.phase === "confirm" ? <button type="button" className="btn ghost" onClick={cancelRun}>Cancel</button>
          : run.phase !== "running" && <button type="button" className="btn ghost" onClick={closeLog}>Close</button>}
      </header>
      {run.phase === "confirm" && (
        <div className={s.confirm}>
          {run.sends == null ? <span className={`b-skel ${s.skelT}`} aria-hidden />
            : <span>Sends {run.sends} WhatsApp{run.sends === 1 ? "" : "s"} to homeowners.</span>}
          <button type="button" className={`btn ${s.run}`} onClick={confirmRun} disabled={run.sends == null}>Run</button>
        </div>
      )}
      {run.phase !== "confirm" && <ol className={s.lines} ref={list}>
        {lines.map((e, i) => (
          <li key={`${e.lead_id}:${e.step}:${i}`} className={s.line} data-state={e.state}>
            <Glyph step={e.step} glyph={e.glyph} state={e.state} />
            <span className={s.who}>{e.name ?? ""}</span>
            <span className={s.text}>{e.text}</span>
            <time className={`${s.at} num`} dateTime={e.at}>{berlinTime(e.at)}</time>
          </li>
        ))}
        {run.phase === "running" && !summary && (lines.length === 0 || lines.at(-1)?.state !== "active") && (
          <li className={s.line} aria-hidden><span className={`b-skel ${s.skelG}`} /><span className={`b-skel ${s.skelT}`} /></li>
        )}
        {summary && <li className={`${s.line} ${s.sum}`} data-state="done"><Glyph step="summary" glyph={summary.glyph} state={summary.state} /><span className={s.text}>{summary.text}</span><time className={`${s.at} num`} dateTime={summary.at}>{berlinTime(summary.at)}</time></li>}
      </ol>}
      {run.error && (
        <div className="error" role="alert"><span><span className="src">Engine said</span>{run.error}</span>
          {run.phase !== "running" && <button className="btn ghost" onClick={() => askRun(flags())}>Retry</button>}
        </div>
      )}
    </section>
  );
}

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
