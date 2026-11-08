"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import ComposerField from "./ComposerField";
import { createLeadFromText, REPLY, sourceOf, transcribe, type Facts, type Source } from "./create";
import s from "./composer.module.css";

type Fail = { src: string; msg: string; retry: () => void };

/** Bottom of the board: a scrap, a pasted email or a voice note becomes a lead and its first draft. */
export default function Composer() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<{ line: string; open?: string } | null>(null);
  const [fail, setFail] = useState<Fail | null>(null);
  const [rec, setRec] = useState(false);
  const field = useRef<HTMLTextAreaElement | null>(null);
  const [row, setRow] = useState<{ name: string; place: string; id?: string } | null>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const want = useRef(false);   // the button is still held
  const voiced = useRef(false);   // the field holds a transcript
  const kept = useRef<Facts | null>(null);   // facts kept while the address is still missing
  const media = useRef<{ r: MediaRecorder; chunks: Blob[]; stream: MediaStream } | null>(null);
  // The optimistic row is pinned at the top of the board until the real card has its verdict.
  useEffect(() => {
    if (!row) return;
    const board = document.querySelector(".b-board"); if (!board) return;
    const h = document.createElement("div"); board.prepend(h); setHost(h);
    const t0 = Date.now();
    const check = () => {
      const card = row.id ? board.querySelector(`[style*="card-${row.id}"]`) : null;
      if ((card && !card.querySelector(".b-skel")) || Date.now() - t0 > (row.id ? 45000 : 90000)) setRow(null);
    };
    const mo = new MutationObserver(check); mo.observe(board, { childList: true, subtree: true, attributes: true });
    const iv = setInterval(check, 2000);
    return () => { mo.disconnect(); clearInterval(iv); h.remove(); setHost(null); };
  }, [row?.id, !!row]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { media.current?.stream.getTracks().forEach((t) => t.stop()); }, []);

  const run = useCallback(async (input: string, source: Source) => {
    setBusy(true); setFail(null); setReply(null);
    const r = await createLeadFromText(input, source, { kept: kept.current, onRoof: (p, n) => { setReply({ line: REPLY.roof(p) }); setRow({ name: n, place: p }); } });
    setBusy(false);
    if (r.ok) { setRow((x) => (x ? { ...x, id: r.lead_id } : x)); kept.current = null; setText(""); setReply({ line: REPLY.ready(r.name), open: r.lead_id }); return; }
    setReply(null); setRow(null);
    if (r.ask) { kept.current = r.facts; setReply({ line: REPLY.ask }); setText(""); requestAnimationFrame(() => field.current?.focus()); return; }
    setFail({ src: r.src, msg: r.msg, retry: () => void run(input, source) });
  }, []);

  const submit = () => { const t = text.trim(); if (t && !busy) { const src = sourceOf(t); const v = voiced.current; voiced.current = false; void run(t, src === "planner" && v ? "voice" : src); }; };

  async function startRec() {
    want.current = true;
    if (busy || rec || media.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!want.current) { stream.getTracks().forEach((t) => t.stop()); return; }   // released before the permission came back
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "";
      const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      media.current = { r, chunks, stream };
      r.start(); setRec(true); setFail(null);
    } catch (e) { want.current = false; setFail({ src: "Microphone said", msg: (e as Error).message, retry: startRec }); }
  }
  async function stopRec() {
    want.current = false;
    const m = media.current; if (!m) return;
    media.current = null; setRec(false);
    await new Promise<void>((res) => { m.r.onstop = () => res(); if (m.r.state !== "inactive") m.r.stop(); else res(); });
    m.stream.getTracks().forEach((t) => t.stop());
    const blob = new Blob(m.chunks, { type: m.r.mimeType || "audio/webm" });
    if (blob.size < 800) return;
    const go = async () => {
      setBusy(true); setFail(null); setReply(null);
      const out = await transcribe(blob);
      setBusy(false);
      if ("error" in out) { setFail({ src: "Transcriber said", msg: out.error, retry: go }); return; }
      voiced.current = true; setText((t) => (t.trim() ? `${t.trim()} ${out.text}` : out.text)); field.current?.focus();
    };
    await go();
  }

  async function pick(file: File) {
    try { setText((await file.text()).slice(0, 8000)); field.current?.focus(); }
    catch (e) { setFail({ src: "File said", msg: (e as Error).message, retry: () => void pick(file) }); }
  }

  const line = (
    <>
      {busy && !reply && <span className={`b-skel ${s.skel}`} aria-hidden />}
      {reply && <span>{reply.line}{!busy && reply.open && <button type="button" className={s.open} onClick={() => { history.pushState({ h: reply.open }, "", `/h/${reply.open}`); dispatchEvent(new PopStateEvent("popstate")); }}>Open</button>}</span>}
      {fail && <span className={s.err} role="alert"><span className={s.src}>{fail.src}</span> {fail.msg}<button type="button" className={s.open} onClick={fail.retry}>Retry</button></span>}
    </>
  );
  const openCard = (id: string) => { history.pushState({ h: id }, "", `/h/${id}`); dispatchEvent(new PopStateEvent("popstate")); };
  const pinned = row && host ? createPortal(
    <ul className={s.newrow}><li><button type="button" className={s.newcard} disabled={!row.id} onClick={() => row.id && openCard(row.id)}>
      <h3>{row.name}</h3><p>{row.place}</p><span className="b-skel b-skel-line" aria-hidden /><span className="b-skel b-skel-line short" aria-hidden />
    </button></li></ul>, host) : null;
  return <div /* composer mount */>{pinned}<div aria-hidden style={{ height: "var(--composer-h, 96px)" }} /><ComposerField value={text} onChange={setText} onSend={submit} onAttach={pick} onMicStart={() => void startRec()} onMicStop={() => void stopRec()} busy={busy} recording={rec} line={line} fieldRef={field} /></div>;
}
