"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import ComposerField from "@/components/composer/ComposerField";
import { transcribe } from "@/components/composer/create";
import Blocks, { inline, openLead } from "./Blocks";
import s from "./agent.module.css";

type Op = { lead_id: string; name: string; action: string; overrides?: Record<string, unknown> };
type Row = { lead_id: string; name: string; what: string; price_from: number | null; price_to: number | null; autarky_from: number | null; autarky_to: number | null; verdict_from: string; verdict_to: string };
type Proposal = { title: string; ops: Op[]; rows: Row[]; refused: string[]; said: string; state: "open" | "applying" | "applied" | "undoing" | "undone"; results: { lead_id: string; name: string; ok: boolean; msg?: string }[]; undo?: Op[] };
type Item = { id: number; who: "you" | "agent"; text: string; pending?: boolean; err?: { src: string; msg: string }; proposals?: Proposal[] };

const eur = (x: number | null) => (x == null ? "" : `€${Math.round(x).toLocaleString("en-GB")}`);
const pct = (x: number | null) => (x == null ? "" : `${Math.round(x * 100)}`);
const signed = (x: number) => `${x > 0 ? "+" : x < 0 ? "-" : ""}${Math.abs(Math.round(x)).toLocaleString("en-GB")}`;

async function* lines(res: Response) {
  const r = res.body!.getReader(); const dec = new TextDecoder(); let buf = "";
  for (;;) {
    const { value, done } = await r.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let n; while ((n = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, n); buf = buf.slice(n + 1); if (l.trim()) yield JSON.parse(l) as Record<string, unknown>; }
  }
}

/** The composer line at the bottom of the board, and the agent card it expands into. */
export default function Agent() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [rec, setRec] = useState(false);
  const [drag, setDrag] = useState(0);
  const seq = useRef(0);
  const thread = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLTextAreaElement | null>(null);
  const media = useRef<{ r: MediaRecorder; chunks: Blob[]; stream: MediaStream } | null>(null);
  const dragFrom = useRef<{ y: number; t: number } | null>(null);
  useEffect(() => () => { media.current?.stream.getTracks().forEach((t) => t.stop()); }, []);
  useEffect(() => { const el = thread.current; if (el) el.scrollTop = el.scrollHeight; }, [items]);
  useEffect(() => { if (!open) return; const k = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); }; addEventListener("keydown", k); return () => removeEventListener("keydown", k); }, [open]);

  const patch = (id: number, f: (x: Item) => Item) => setItems((xs) => xs.map((x) => (x.id === id ? f(x) : x)));
  const patchP = (id: number, pi: number, f: (p: Proposal) => Proposal) => patch(id, (x) => ({ ...x, proposals: x.proposals!.map((p, j) => (j === pi ? f(p) : p)) }));
  const go = (id: string) => { setOpen(false); openLead(id); };

  const ask = useCallback(async (q: string) => {
    const you: Item = { id: ++seq.current, who: "you", text: q };
    const me: Item = { id: ++seq.current, who: "agent", text: "", pending: true, proposals: [] };
    const history = [...items, you].filter((x) => x.text.trim() && !x.err).map((x) => ({ role: x.who === "you" ? "user" : "assistant", content: x.text }));
    setItems((xs) => [...xs, you, me]); setBusy(true); setOpen(true);
    try {
      const res = await fetch("/api/agent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: history }) });
      if (!res.ok || !res.body) { const j = await res.json().catch(() => ({})); throw new Error(j.error ?? `${res.status} ${res.statusText}`); }
      for await (const e of lines(res)) {
        if (e.t === "text") patch(me.id, (x) => ({ ...x, text: x.text + String(e.d) }));
        else if (e.t === "propose") patch(me.id, (x) => ({ ...x, proposals: [...(x.proposals ?? []), { ...(e as unknown as Proposal), said: q, state: "open", results: [] }] }));
        else if (e.t === "created") dispatchEvent(new CustomEvent("marquee:lead-created", { detail: e.lead_id }));
        else if (e.t === "error") patch(me.id, (x) => ({ ...x, err: { src: String(e.src), msg: String(e.msg) } }));
      }
    } catch (e) { patch(me.id, (x) => ({ ...x, err: { src: "Agent said", msg: (e as Error).message } })); }
    patch(me.id, (x) => ({ ...x, pending: false, text: x.text.trim() })); setBusy(false);
  }, [items]);

  async function run(id: number, pi: number, p: Proposal, undo: boolean) {
    patchP(id, pi, (x) => ({ ...x, state: undo ? "undoing" : "applying", results: [] }));
    try {
      const res = await fetch("/api/agent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(undo ? { undo: p.undo } : { apply: p.ops, said: p.said }) });
      if (!res.ok || !res.body) throw new Error(`${res.status} ${res.statusText}`);
      for await (const e of lines(res)) {
        if (e.t === "result") patchP(id, pi, (x) => ({ ...x, results: [...x.results, e as unknown as Proposal["results"][number]] }));
        else if (e.t === "applied" && !undo) patchP(id, pi, (x) => ({ ...x, undo: (e.undo as Op[]) }));
      }
      patchP(id, pi, (x) => ({ ...x, state: undo ? "undone" : "applied" }));
    } catch (e) { patchP(id, pi, (x) => ({ ...x, state: undo ? "applied" : "open", results: [{ lead_id: "", name: "Agent said", ok: false, msg: (e as Error).message }] })); }
  }

  const submit = () => { const t = text.trim(); if (!t || busy) return; setText(""); void ask(t); };

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
    setBusy(true); const out = await transcribe(blob); setBusy(false);
    if ("text" in out) { setText((t) => (t.trim() ? `${t.trim()} ${out.text}` : out.text)); field.current?.focus(); }
  }
  async function pick(file: File) { try { setText((await file.text()).slice(0, 8000)); field.current?.focus(); } catch { /* unreadable file */ } }

  const chevron = (
    <button type="button" className={`${s.chev} ${open ? s.down : ""}`} aria-label={open ? "Collapse" : "Expand"} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4.5 11 9 6.5l4.5 4.5" /></svg>
    </button>
  );
  const fieldEl = <ComposerField value={text} onChange={setText} onSend={submit} onAttach={pick} onMicStart={() => void startRec()} onMicStop={() => void stopRec()}
    busy={busy} recording={rec} trailing={chevron} fieldRef={field} line={!open && busy ? <span className={`b-skel ${s.lineSkel}`} aria-hidden /> : null} />;

  const onDown = (e: React.PointerEvent) => { e.currentTarget.setPointerCapture(e.pointerId); dragFrom.current = { y: e.clientY, t: performance.now() }; };
  const onMove = (e: React.PointerEvent) => { if (dragFrom.current) setDrag(Math.max(0, e.clientY - dragFrom.current.y)); };
  const onUp = (e: React.PointerEvent) => {
    const f = dragFrom.current; dragFrom.current = null; if (!f) return;
    const dy = e.clientY - f.y, v = dy / Math.max(1, performance.now() - f.t);
    if (dy > 90 || v > 0.6) setOpen(false);
    setDrag(0);
  };

  return (
    <>
      <div className={`${s.dock} ${open ? s.dockHidden : ""}`}>{!open && fieldEl}</div>
      <div className={`${s.scrim} ${open ? s.scrimOn : ""}`} onClick={() => setOpen(false)} aria-hidden />
      <section className={`${s.card} ${open ? s.cardOn : ""} ${drag ? s.dragging : ""}`} style={drag ? { transform: `translateY(${drag}px)` } : undefined} aria-hidden={!open} aria-label="Agent">
        <div className={s.handle} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} role="button" aria-label="Drag down to collapse" tabIndex={-1}><span /></div>
        <div className={s.thread} ref={thread}>
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
        <div className={s.fieldWrap}>{open && fieldEl}</div>
      </section>
    </>
  );
}

function ProposalCard({ p, onLead, onApply, onUndo }: { p: Proposal; onLead: (id: string) => void; onApply: () => void; onUndo: () => void }) {
  const busy = p.state === "applying" || p.state === "undoing";
  const canUndo = p.state === "applied" && !!p.undo?.length;
  return (
    <div className={s.prop}>
      <div className={s.propHead}>{p.title}</div>
      <div className={s.tableWrap}><table className={s.table}>
        <thead><tr><th>Lead</th><th>Change</th><th className={s.num}>Price</th><th>Verdict</th></tr></thead>
        <tbody>{p.rows.map((r) => {
          const d = r.price_from != null && r.price_to != null ? r.price_to - r.price_from : null;
          const ad = r.autarky_from != null && r.autarky_to != null ? Math.round((r.autarky_to - r.autarky_from) * 100) : null;
          return <tr key={r.lead_id}>
            <td><button type="button" className={s.chip} onClick={() => onLead(r.lead_id)}>{r.name}</button></td>
            <td>{r.what}</td>
            <td className={s.num}><span className={s.fig}><b>{eur(r.price_to)}</b></span>{d ? <span className={s.unit}> {signed(d)}</span> : null}{ad ? <span className={s.unit}>, {pct(r.autarky_to)} % autarky ({signed(ad)})</span> : null}</td>
            <td>{r.verdict_from === r.verdict_to ? r.verdict_to : <>{r.verdict_from} to <b>{r.verdict_to}</b></>}</td>
          </tr>;
        })}</tbody>
      </table></div>
      {p.refused.map((x, i) => <p key={i} className={s.p}>{inline(`[[warn: ${x}]]`, onLead)}</p>)}
      {p.results.length > 0 && <ul className={s.results}>{p.results.map((r, i) => <li key={i}>{inline(r.ok ? `[[ok: ${r.name}]]` : `[[fail: ${r.name}]] ${r.msg ?? ""}`, onLead)}</li>)}</ul>}
      <div className={s.actions}>
        {(p.state === "open" || p.state === "applying") && <button type="button" className={`${s.apply} ${busy ? s.busyBtn : ""}`} disabled={busy || !p.ops.length} onClick={onApply}>Apply</button>}
        {(canUndo || p.state === "undoing") && <button type="button" className={`${s.undo} ${busy ? s.busyBtn : ""}`} disabled={busy} onClick={onUndo}>Undo</button>}
        {p.state === "undone" && <span className={s.unit}>Undone</span>}
      </div>
    </div>
  );
}
