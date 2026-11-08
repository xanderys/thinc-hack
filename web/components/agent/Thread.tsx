"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import ComposerField from "@/components/composer/ComposerField";
import { transcribe } from "@/components/composer/create";
import Blocks, { inline, openLead } from "./Blocks";
import { useCopilotContext } from "./context";
import { ask, run, useThread, type Proposal } from "./store";
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
  const go = onLead ?? openLead;
  useEffect(() => () => { media.current?.stream.getTracks().forEach((t) => t.stop()); }, []);
  // Reopened: back where the reader was. New content: follow it only when the reader is at the bottom.
  const atEnd = useRef(true);
  useEffect(() => { const el = thread.current; if (!el) return; el.scrollTop = kept ?? el.scrollHeight; }, []);
  useEffect(() => { const el = thread.current; if (el && atEnd.current) el.scrollTop = el.scrollHeight; }, [items]);
  const onScroll = () => { const el = thread.current; if (!el) return; kept = el.scrollTop; atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; };

  const submit = () => { const t = text.trim(); if (!t || busy) return; setText(""); void ask(t, ctx); };
  async function startRec() {
    if (busy || rec) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const r = new MediaRecorder(stream); const chunks: Blob[] = [];
      r.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      media.current = { r, chunks, stream }; r.start(); setRec(true);
    } catch { /* no microphone: the button stays idle */ }
  }
  async function stopRec() {
    const m = media.current; if (!m) return; media.current = null; setRec(false);
    await new Promise<void>((res) => { m.r.onstop = () => res(); if (m.r.state !== "inactive") m.r.stop(); else res(); });
    m.stream.getTracks().forEach((t) => t.stop());
    const blob = new Blob(m.chunks, { type: m.r.mimeType || "audio/webm" }); if (blob.size < 800) return;
    setVoicing(true); const out = await transcribe(blob); setVoicing(false);
    if ("text" in out) { setText((t) => (t.trim() ? `${t.trim()} ${out.text}` : out.text)); field.current?.focus(); }
  }
  async function pick(file: File) { try { setText((await file.text()).slice(0, 8000)); field.current?.focus(); } catch { /* unreadable file */ } }

  return (
    <div className={s.shell}>
      <div className={s.thread} ref={thread} onScroll={onScroll}>
        {items.map((it) => it.who === "you"
          ? <div key={it.id} className={s.you}>{it.text}</div>
          : <div key={it.id} className={s.agent}>
              {it.text && <Blocks text={it.text} onLead={go} />}
              {it.pending && !it.text && <div className={s.shimmer} aria-hidden><span className="b-skel" /><span className="b-skel" /><span className="b-skel" /></div>}
              {it.pending && it.text && <span className={`b-skel ${s.tail}`} aria-hidden />}
              {it.proposals?.map((p, pi) => <ProposalCard key={pi} p={p} onLead={go} onApply={() => void run(it.id, pi, p, false)} onUndo={() => void run(it.id, pi, p, true)} />)}
              {it.err && <p className={s.err} role="alert"><b>{it.err.src}</b> {it.err.msg}</p>}
            </div>)}
      </div>
      <div className={s.fieldWrap}>
        <ComposerField value={text} onChange={setText} onSend={submit} onAttach={pick} onMicStart={() => void startRec()} onMicStop={() => void stopRec()}
          busy={busy || voicing} recording={rec} trailing={fieldTrailing ?? trailing} fieldRef={field} />
      </div>
    </div>
  );
}

function ProposalCard({ p, onLead, onApply, onUndo }: { p: Proposal; onLead: (id: string) => void; onApply: () => void; onUndo: () => void }) {
  const busy = p.state === "applying" || p.state === "undoing";
  const canUndo = p.state === "applied" && !!p.undo?.length;
  const one = p.rows.length === 1 ? p.rows[0] : null;
  return (
    <div className={s.prop}>
      <div className={s.propHead}>{p.title}</div>
      {p.rows.length === 0 ? null : one ? (
        // One lead: before and after, figure by figure.
        <div className={s.tableWrap}><table className={s.table}>
          <thead><tr><th><button type="button" className={s.chip} onClick={() => onLead(one.lead_id)}>{one.name}</button></th><th className={s.num}>Now</th><th className={s.num}>After</th></tr></thead>
          <tbody>
            {(one.kwp_from != null || one.kwp_to != null) && <tr><td>Solar</td><td className={s.num}><b>{num(one.kwp_from)}</b><span className={s.unit}> kWp</span></td><td className={s.num}><b>{num(one.kwp_to)}</b><span className={s.unit}> kWp</span></td></tr>}
            <tr><td>Battery</td><td className={s.num}>{one.kwh_from ? <><b>{num(one.kwh_from, 1)}</b><span className={s.unit}> kWh</span></> : "None"}</td><td className={s.num}>{one.kwh_to ? <><b>{num(one.kwh_to, 1)}</b><span className={s.unit}> kWh</span></> : "None"}</td></tr>
            <tr><td>Price</td><td className={s.num}><b>{eur(one.price_from)}</b></td><td className={s.num}><b>{eur(one.price_to)}</b>{one.price_from != null && one.price_to != null && one.price_to !== one.price_from ? <span className={s.unit}> {signed(one.price_to - one.price_from)}</span> : null}</td></tr>
            {(one.payback_from != null || one.payback_to != null) && <tr><td>Break-even</td><td className={s.num}><span className={s.unit}>year </span><b>{num(one.payback_from, 0)}</b></td><td className={s.num}><span className={s.unit}>year </span><b>{num(one.payback_to, 0)}</b></td></tr>}
            <tr><td>Autarky</td><td className={s.num}><b>{num((one.autarky_from ?? 0) * 100, 0)}</b><span className={s.unit}> %</span></td><td className={s.num}><b>{num((one.autarky_to ?? 0) * 100, 0)}</b><span className={s.unit}> %</span></td></tr>
            <tr><td>Verdict</td><td className={s.num}>{one.verdict_from}</td><td className={s.num}>{one.verdict_to}</td></tr>
          </tbody>
        </table></div>
      ) : (
        <div className={s.tableWrap}><table className={s.table}>
          <thead><tr><th>Lead</th><th>Change</th><th className={s.num}>Price</th><th className={s.num}>Autarky</th><th>Verdict</th></tr></thead>
          <tbody>{p.rows.map((r) => {
            const d = r.price_from != null && r.price_to != null ? r.price_to - r.price_from : null;
            const ad = r.autarky_from != null && r.autarky_to != null ? Math.round((r.autarky_to - r.autarky_from) * 100) : null;
            return <tr key={r.lead_id}>
              <td><button type="button" className={s.chip} onClick={() => onLead(r.lead_id)}>{r.name}</button></td>
              <td>{r.what}</td>
              <td className={s.num}><span className={s.fig}><b>{eur(r.price_to)}</b></span>{d ? <span className={s.unit}> {signed(d)}</span> : null}</td>
              <td className={s.num}><span className={s.fig}><b>{num((r.autarky_to ?? 0) * 100, 0)}</b></span><span className={s.unit}> %{ad ? ` ${signed(ad)} pts` : ""}</span></td>
              <td>{r.verdict_from === r.verdict_to ? r.verdict_to : <>{r.verdict_from} to <b>{r.verdict_to}</b></>}</td>
            </tr>;
          })}</tbody>
        </table></div>
      )}
      {one && <p className={s.p}>{one.what}</p>}
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
