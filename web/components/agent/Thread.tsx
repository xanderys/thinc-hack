"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import ComposerField from "@/components/composer/ComposerField";
import { transcribe } from "@/components/composer/create";
import Blocks, { inline, openLead } from "./Blocks";
import { useCopilotContext } from "./context";
import { ask, run, sendMessage, useSuggestions, useThread, type ApEntry, type Message, type Proposal } from "./store";
import { cancelRun, confirmRun } from "@/components/autopilot/store";
import type { Suggestion } from "./suggest";
import s from "./agent.module.css";

const eur = (x: number | null | undefined) => (x == null ? "" : `€${Math.round(x).toLocaleString("en-GB")}`);
const num = (x: number | null | undefined, d = 2) => (x == null ? "" : (Math.round(x * 10 ** d) / 10 ** d).toLocaleString("en-GB"));
const signed = (x: number) => `${x > 0 ? "+" : x < 0 ? "-" : ""}${Math.abs(Math.round(x)).toLocaleString("en-GB")}`;

/** The copilot's thread and its field. Fills whatever container it is put in (flex column, 100 % height). */
// Where the reader left the thread, kept across closes and remounts.
let kept: number | null = null;

/** `fieldTrailing` (or `trailing`) sits in the field between the text and the mic, for the shell's own button. */
export default function Thread({ trailing, fieldTrailing, onLead }: { trailing?: ReactNode; fieldTrailing?: ReactNode; onLead?: (id: string) => void }) {
  const ctx = useCopilotContext();
  const { items, busy } = useThread();
  const [text, setText] = useState("");
  const [rec, setRec] = useState(false);
  const [voicing, setVoicing] = useState(false);
  const thread = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement | null>(null);
  const media = useRef<{ r: MediaRecorder; chunks: Blob[]; stream: MediaStream } | null>(null);
  const starting = useRef(false), t0 = useRef(0), tick = useRef<ReturnType<typeof setInterval> | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [micErr, setMicErr] = useState<string | null>(null);
  const [live, setLive] = useState<MediaStream | null>(null);
  const go = onLead ?? openLead;
  // Chips come from the store, computed per screen there (no model call, no race with this component).
  const sugs = useSuggestions();
  const tap = (x: Suggestion) => { if (x.event) dispatchEvent(new CustomEvent(x.event)); else if (x.message && !busy) void ask(x.message, ctx); };
  useEffect(() => () => { media.current?.stream.getTracks().forEach((t) => t.stop()); }, []);
  // Reopened: back where the reader was. New content: follow it only when the reader is at the bottom.
  const atEnd = useRef(true);
  useEffect(() => { const el = thread.current; if (!el) return; el.scrollTop = kept ?? el.scrollHeight; }, []);
  useEffect(() => { const el = thread.current; if (el && atEnd.current) el.scrollTop = el.scrollHeight; }, [items]);
  const onScroll = () => { const el = thread.current; if (!el) return; kept = el.scrollTop; atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; };

  const submit = () => { const t = text.trim(); if (!t || busy) return; setText(""); void ask(t, ctx); };
  async function startRec() {
    if (busy || rec || starting.current) return;
    starting.current = true; setMicErr(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const r = new MediaRecorder(stream); const chunks: Blob[] = [];
      r.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      media.current = { r, chunks, stream }; r.start(250); setRec(true); setLive(stream);
      t0.current = Date.now(); setElapsed(0);
      tick.current = setInterval(() => setElapsed(Math.floor((Date.now() - t0.current) / 1000)), 250);
    } catch (e) { setMicErr(e instanceof DOMException && e.name === "NotAllowedError" ? "Microphone access is blocked in this browser." : "The microphone is not available."); }
    finally { starting.current = false; }
  }
  async function stopRec() {
    if (tick.current) { clearInterval(tick.current); tick.current = null; }
    const m = media.current; if (!m) return; media.current = null; setRec(false); setLive(null);
    await new Promise<void>((res) => { m.r.onstop = () => res(); if (m.r.state !== "inactive") m.r.stop(); else res(); });
    m.stream.getTracks().forEach((t) => t.stop());
    const blob = new Blob(m.chunks, { type: m.r.mimeType || "audio/webm" }); if (blob.size < 800) return;
    setVoicing(true); const out = await transcribe(blob); setVoicing(false);
    if (!("text" in out)) setMicErr("Couldn't hear that. Try again.");
    if ("text" in out) { setText((t) => (t.trim() ? `${t.trim()} ${out.text}` : out.text)); field.current?.focus(); }
  }
  function cancelRec() {
    if (tick.current) { clearInterval(tick.current); tick.current = null; }
    const m = media.current; media.current = null; setRec(false); setLive(null);
    if (m) { try { m.r.stop(); } catch { /* already stopped */ } m.stream.getTracks().forEach((x) => x.stop()); }
  }
  async function pick(file: File) { try { setText((await file.text()).slice(0, 8000)); field.current?.focus(); } catch { /* unreadable file */ } }

  return (
    <div className={s.shell}>
      <div className={s.thread} ref={thread} onScroll={onScroll}>
        {items.map((it) => it.ap ? <ApItem key={it.id} a={it.ap} onLead={go} /> : it.who === "event" ? <p key={it.id} className={s.event}>{inline(it.text, go)}</p> : it.who === "you"
          ? <div key={it.id} className={s.you}>{it.text}</div>
          : <div key={it.id} className={s.agent}>
              {it.text && <Blocks text={it.text} onLead={go} />}
              {it.pending && !it.text && <div className={s.shimmer} aria-hidden><span className="b-skel" /><span className="b-skel" /><span className="b-skel" /></div>}
              {it.pending && it.text && <span className={`b-skel ${s.tail}`} aria-hidden />}
              {it.messages?.map((m, mi) => <MessageCard key={`m${mi}`} m={m} onLead={go} onSend={() => void sendMessage(it.id, mi, m, `${m.name} [${m.lead_id}]`)} />)}
              {it.proposals?.map((p, pi) => <ProposalCard key={pi} p={p} onLead={go} onApply={() => void run(it.id, pi, p, false)} onUndo={() => void run(it.id, pi, p, true)} />)}
              {it.err && <p className={s.err} role="alert"><b>{it.err.src}</b> {it.err.msg}</p>}
            </div>)}
      </div>
      {sugs.length > 0 && !busy && <div className={s.sugs}>{sugs.map((x) => <button key={x.label} type="button" className={s.sug} onClick={() => tap(x)}>{x.label}</button>)}</div>}
      <div className={s.fieldWrap}>
        <ComposerField value={text} onChange={setText} onSend={submit} onAttach={pick} onMicStart={() => void startRec()} onMicStop={() => void stopRec()}
          busy={busy || voicing} recording={rec} elapsed={elapsed} stream={live} onMicCancel={cancelRec} transcribing={voicing} trailing={fieldTrailing ?? trailing} fieldRef={field} placeholder={ctx.name ? `Ask about ${ctx.name}` : "New enquiry or a question"} />
        {micErr && <p role="alert" style={{ margin: "6px 4px 0", fontSize: 13, color: "var(--muted, #6b6b73)" }}>{micErr}</p>}
      </div>
    </div>
  );
}

function ProposalCard({ p, onLead, onApply, onUndo }: { p: Proposal; onLead: (id: string) => void; onApply: () => void; onUndo: () => void }) {
  const busy = p.state === "applying" || p.state === "undoing";
  const canUndo = p.state === "applied" && !!p.undo?.length;
  const one = p.rows.length === 1 && !(p.rows[0].what === "Complete" || p.rows[0].what.startsWith("Send")) ? p.rows[0] : null;
  const flat = p.rows.every((r) => r.price_from === r.price_to && r.kwp_from === r.kwp_to && r.kwh_from === r.kwh_to);
  return (
    <div className={s.prop}>
      <div className={s.propHead}>{p.title}</div>
      {p.rows.length === 0 ? null : one ? <OneLead r={one} onLead={onLead} /> : flat ? (
        // Nothing in the design moves (Complete, Send): one line per lead, no table.
        <ul className={s.results}>{p.rows.map((r) => <li key={r.lead_id}><button type="button" className={s.chip} onClick={() => onLead(r.lead_id)}>{r.name}</button> {r.what}, {r.verdict_to}</li>)}</ul>
      ) : (
        <div className={s.tableWrap}><table className={s.table}>
          <thead><tr><th>Lead</th><th>Change</th><th className={s.num}>Price</th><th className={s.num}>Autarky</th></tr></thead>
          <tbody>{p.rows.map((r) => {
            const d = r.price_from != null && r.price_to != null ? r.price_to - r.price_from : null;
            const ad = r.autarky_from != null && r.autarky_to != null ? Math.round((r.autarky_to - r.autarky_from) * 100) : null;
            return <tr key={r.lead_id}>
              <td><button type="button" className={s.chip} onClick={() => onLead(r.lead_id)}>{r.name}</button></td>
              <td>{r.what}</td>
              <td className={s.num}><span className={s.fig}><b>{eur(r.price_to)}</b></span>{d ? <span className={s.unit}> {signed(d)}</span> : null}</td>
              <td className={s.num}><span className={s.fig}><b>{num((r.autarky_to ?? 0) * 100, 0)}</b></span><span className={s.unit}> %{ad ? ` ${signed(ad)} pts` : ""}</span></td>
            </tr>;
          })}</tbody>
        </table></div>
      )}

      {p.unchanged?.map((x, i) => <p key={`u${i}`} className={s.p}>{x}</p>)}
      {p.refused.map((x, i) => <p key={i} className={s.p}>{inline(`[[warn: ${x}]]`, onLead)}</p>)}
      {p.results.length > 0 && <ul className={s.results}>{p.results.map((r, i) => <li key={i}>{inline(r.ok ? `[[ok: ${r.name}]] ${r.what ?? ""}` : `[[fail: ${r.name}]] ${r.msg ?? ""}`, onLead)}</li>)}</ul>}
      <div className={s.actions}>
        {(p.state === "open" || p.state === "applying") && p.ops.length > 0 && <button type="button" className={`${s.apply} ${busy ? s.busyBtn : ""}`} disabled={busy || !p.ops.length} onClick={onApply}>Apply</button>}
        {(canUndo || p.state === "undoing") && <button type="button" className={`${s.undo} ${busy ? s.busyBtn : ""}`} disabled={busy} onClick={onUndo}>Undo</button>}
        {p.state === "undone" && <span className={s.unit}>Undone</span>}
      </div>
    </div>
  );
}

// Before and after for one lead: only the rows that change, the changed facts first.
function OneLead({ r, onLead }: { r: Proposal["rows"][number]; onLead: (id: string) => void }) {
  const kwh = (x: number | null | undefined) => (x ? <><b>{num(x, 1)}</b><span className={s.unit}> kWh</span></> : "None");
  const rows: [string, ReactNode, ReactNode][] = [];
  for (const f of r.facts ?? []) rows.push([f.label, String(f.from ?? "not known"), <b key="t">{String(f.to)}</b>]);
  if (r.kwp_from !== r.kwp_to) rows.push(["Solar", <><b>{num(r.kwp_from)}</b><span className={s.unit}> kWp</span></>, <><b>{num(r.kwp_to)}</b><span className={s.unit}> kWp</span></>]);
  if (r.kwh_from !== r.kwh_to) rows.push(["Battery", kwh(r.kwh_from), kwh(r.kwh_to)]);
  if (r.price_from !== r.price_to) rows.push(["Price", <b key="f">{eur(r.price_from)}</b>, <><b>{eur(r.price_to)}</b>{r.price_from != null && r.price_to != null ? <span className={s.unit}> {signed(r.price_to - r.price_from)}</span> : null}</>]);
  if (r.payback_from !== r.payback_to) rows.push(["Break-even", <><span className={s.unit}>year </span><b>{num(r.payback_from, 0)}</b></>, <><span className={s.unit}>year </span><b>{num(r.payback_to, 0)}</b></>]);
  if (Math.round((r.autarky_from ?? 0) * 100) !== Math.round((r.autarky_to ?? 0) * 100)) rows.push(["Autarky", <><b>{num((r.autarky_from ?? 0) * 100, 0)}</b><span className={s.unit}> %</span></>, <><b>{num((r.autarky_to ?? 0) * 100, 0)}</b><span className={s.unit}> %</span></>]);
  if (r.verdict_from !== r.verdict_to) rows.push(["Verdict", r.verdict_from, <b key="v">{r.verdict_to}</b>]);
  return (
    <>
      <div><button type="button" className={s.chip} onClick={() => onLead(r.lead_id)}>{r.name}</button> <span className={s.unit}>{r.what}</span></div>
      {rows.length > 0 && <div className={s.tableWrap}><table className={s.table}>
        <thead><tr><th /><th className={s.num}>Now</th><th className={s.num}>After</th></tr></thead>
        <tbody>{rows.map(([k, a, b]) => <tr key={k}><td>{k}</td><td className={s.num}>{a}</td><td className={s.num}>{b}</td></tr>)}</tbody>
      </table></div>}
    </>
  );
}

// A WhatsApp ask: who gets it, the exact words, and Send on WhatsApp (the planner's tap only).
function MessageCard({ m, onLead, onSend }: { m: Message; onLead: (id: string) => void; onSend: () => void }) {
  return (
    <div className={s.prop}>
      <div><button type="button" className={s.chip} onClick={() => onLead(m.lead_id)}>{m.name}</button> <span className={s.unit}>WhatsApp</span></div>
      <div className={s.msg}>{m.text}</div>
      {m.err && <p className={s.err} role="alert"><b>Engine said</b> {m.err}</p>}
      <div className={s.actions}>
        {m.state === "sent" ? <span className={s.unit}>Sent {m.at}</span>
          : <button type="button" className={`${s.apply} ${m.state === "sending" ? s.busyBtn : ""}`} disabled={m.state === "sending"} onClick={onSend}>Send on WhatsApp</button>}
      </div>
    </div>
  );
}

// Autopilot in the thread: the confirm card, then one entry per step (lead chip, the engine's words, a badge or bubble).
function ApItem({ a, onLead }: { a: ApEntry; onLead: (id: string) => void }) {
  if (a.kind === "confirm") return (
    <div className={s.agent}><div className={s.prop}>
      {a.n == null && a.state === "open" ? <span className={`b-skel ${s.apSkel}`} aria-hidden /> : a.state !== "error" && <p className={s.p}>Sends {a.n} WhatsApp{a.n === 1 ? "" : "s"} to homeowners.</p>}
      {a.err && <p className={s.err} role="alert"><b>Engine said</b> {a.err}</p>}
      {a.state === "open" && <div className={s.actions}>
        <button type="button" className={s.apply} disabled={a.n == null} onClick={confirmRun}>Run</button>
        <button type="button" className={s.undo} onClick={cancelRun}>Cancel</button>
      </div>}
      {a.state === "cancelled" && <span className={s.unit}>Cancelled</span>}
    </div></div>
  );
  const who = a.lead_id ? <button type="button" className={s.chip} onClick={() => onLead(a.lead_id!)}>{a.name}</button> : <b>{a.name}</b>;
  if (a.step === "ask" && a.state !== "active") return (
    <div className={s.apStep}>{who}<div className={s.msg}>{a.text}</div></div>
  );
  return (
    <p className={`${s.event} ${s.apStep}`} data-state={a.state}>
      {who} <span className={a.state === "active" ? s.apActive : a.state === "needs_you" ? s.apNeeds : undefined}>{a.text}</span>
      {a.step === "send" && a.state === "done" && <> <span className={`${s.badge} ${s.ok}`}>Sent</span></>}
    </p>
  );
}
