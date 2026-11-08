"use client";
import { useCallback, useEffect, useRef, useState } from "react";
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
  const kept = useRef<Facts | null>(null);   // facts kept while the address is still missing
  const media = useRef<{ r: MediaRecorder; chunks: Blob[]; stream: MediaStream } | null>(null);
  useEffect(() => () => { media.current?.stream.getTracks().forEach((t) => t.stop()); }, []);

  const run = useCallback(async (input: string, source: Source) => {
    setBusy(true); setFail(null); setReply(null);
    const r = await createLeadFromText(input, source, { kept: kept.current, onRoof: (p) => setReply({ line: REPLY.roof(p) }) });
    setBusy(false);
    if (r.ok) { kept.current = null; setText(""); setReply({ line: REPLY.ready(r.name), open: r.lead_id }); return; }
    setReply(null);
    if (r.ask) { kept.current = r.facts; setReply({ line: REPLY.ask }); setText(""); requestAnimationFrame(() => field.current?.focus()); return; }
    setFail({ src: r.src, msg: r.msg, retry: () => void run(input, source) });
  }, []);

  const submit = () => { const t = text.trim(); if (t && !busy) void run(t, sourceOf(t)); };

  async function startRec() {
    if (busy || rec) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "";
      const r = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks: Blob[] = [];
      r.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      media.current = { r, chunks, stream };
      r.start(); setRec(true); setFail(null);
    } catch (e) { setFail({ src: "Microphone said", msg: (e as Error).message, retry: startRec }); }
  }
  async function stopRec() {
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
      setText((t) => (t.trim() ? `${t.trim()} ${out.text}` : out.text)); field.current?.focus();
    };
    await go();
  }

  async function pick(file: File) {
    try { setText((await file.text()).slice(0, 8000)); field.current?.focus(); }
    catch (e) { setFail({ src: "File said", msg: (e as Error).message, retry: () => void pick(file) }); }
  }

  const line = (
    <>
      {busy && <span className={`b-skel ${s.skel}`} aria-hidden />}
      {!busy && reply && <span>{reply.line}{reply.open && <button type="button" className={s.open} onClick={() => { history.pushState({ h: reply.open }, "", `/h/${reply.open}`); dispatchEvent(new PopStateEvent("popstate")); }}>Open</button>}</span>}
      {fail && <span className={s.err} role="alert"><span className={s.src}>{fail.src}</span> {fail.msg}<button type="button" className={s.open} onClick={fail.retry}>Retry</button></span>}
    </>
  );
  return <div /* composer mount */><ComposerField value={text} onChange={setText} onSend={submit} onAttach={pick} onMicStart={() => void startRec()} onMicStop={() => void stopRec()} busy={busy} recording={rec} line={line} fieldRef={field} /></div>;
}
