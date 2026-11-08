"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { call, send } from "@/lib/client";
import s from "./composer.module.css";

type Facts = Partial<{ name: string; address: string; postcode: string; num_inhabitants: number; heating_type: string; heating_stated: string; has_ev: boolean; ev_planned: boolean; annual_demand_kwh: number; phone: string; note: string }>;
type Source = "email" | "planner" | "voice";
type Fail = { src: string; msg: string; retry: () => void };

const isEmail = (t: string) => t.length > 200 || /\b(From:|Betreff|Subject)/i.test(t);
const errOf = (e: string) => e.replace(/^\{?"?detail"?:\s*/, "");

// Rina's lines come from fixed templates, never from the model.
const R = {
  roof: (a: string) => `Got it, measuring the roof at ${a}.`,
  ready: (n: string) => `Draft ready for ${n}.`,
  ask: "Got it. Which address?",
};

/** Bottom of the board: a scrap, a pasted email or a voice note becomes a lead and its first draft. */
export default function Composer() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<{ line: string; open?: string } | null>(null);
  const [fail, setFail] = useState<Fail | null>(null);
  const [rec, setRec] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const files = useRef<HTMLInputElement>(null);
  const pending = useRef<Facts | null>(null);   // facts kept while the address is still missing
  const media = useRef<{ r: MediaRecorder; chunks: Blob[]; stream: MediaStream } | null>(null);

  const grow = useCallback(() => {
    const el = field.current; if (!el) return;
    el.style.height = "auto"; el.style.height = `${Math.min(el.scrollHeight, 6 * 24 + 20)}px`;
  }, []);
  useEffect(grow, [text, grow]);
  useEffect(() => () => { media.current?.stream.getTracks().forEach((t) => t.stop()); }, []);

  const run = useCallback(async (input: string, source: Source) => {
    setBusy(true); setFail(null); setReply(null);
    const again = () => run(input, source);
    const read = await call<Facts>("/api/interpret", { mode: "composer", text: input });
    if (!read.ok) { setBusy(false); setFail({ src: "Reader said", msg: read.error, retry: again }); return; }
    const f: Facts = { ...(pending.current ?? {}), ...read.data };
    const place = f.address ?? f.postcode;
    if (!place) {
      pending.current = f; setBusy(false); setReply({ line: R.ask }); setText(""); requestAnimationFrame(() => field.current?.focus()); return;
    }
    const name = f.name?.trim() || place;
    setReply({ line: R.roof(f.address ?? f.postcode!) });
    const made = await send<{ lead_id: string }>("/api/leads", { customer_name: name, address_or_postcode: place, installer_id: "2a8ba8e2", source: "form", test: true, ...(f.phone ? { phone: f.phone } : {}) }, "composer-lead");
    if (!made.ok) { setBusy(false); setReply(null); setFail({ src: "Engine said", msg: errOf(made.error), retry: again }); return; }
    const id = made.data.lead_id;
    const facts: Record<string, unknown> = { customer_name: name };
    for (const k of ["address", "postcode", "num_inhabitants", "heating_type", "heating_stated", "has_ev", "ev_planned", "annual_demand_kwh"] as const) if (f[k] !== undefined) facts[k] = f[k];
    let step = await send("/api/intake/step", { lead_id: id, facts_so_far: facts, source }, "composer-step");
    // The engine's documented sources are whatsapp, call, form, planner: an older engine refuses email and voice.
    if (!step.ok && step.status === 422 && source !== "planner") step = await send("/api/intake/step", { lead_id: id, facts_so_far: facts, source: "planner" }, "composer-step");
    setBusy(false);
    if (!step.ok) { setReply(null); setFail({ src: "Engine said", msg: errOf(step.error), retry: async () => {
      setBusy(true); setFail(null);
      const r = await send("/api/intake/step", { lead_id: id, facts_so_far: facts, source: "planner" }, "composer-step");
      setBusy(false);
      if (!r.ok) setFail({ src: "Engine said", msg: errOf(r.error), retry: () => { void 0; } }); else { setReply({ line: R.ready(name), open: id }); announce(id); }
    } }); return; }
    pending.current = null; setText("");
    setReply({ line: R.ready(name), open: id }); announce(id);
  }, []);

  const submit = () => { const t = text.trim(); if (t && !busy) void run(t, isEmail(t) ? "email" : "planner"); };

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
    await new Promise<void>((res) => { m.r.onstop = () => res(); m.r.state !== "inactive" ? m.r.stop() : res(); });
    m.stream.getTracks().forEach((t) => t.stop());
    const blob = new Blob(m.chunks, { type: "audio/webm" });
    if (blob.size < 800) return;
    const go = async () => {
      setBusy(true); setFail(null); setReply(null);
      let said = "", last = "";
      // WalaoFlow first (16 kHz mono PCM); the engine's speech to text when it is unreachable.
      try {
        const res = await fetch("/api/leads/dictate", { method: "POST", headers: { "content-type": "application/octet-stream" }, body: await pcm16k(blob) });
        const j = await res.json().catch(() => ({}));
        if (res.ok && typeof j.text === "string") said = j.text; else last = j.error ?? `${res.status} ${res.statusText}`;
      } catch (e) { last = (e as Error).message; }
      if (!said.trim()) {
        const fd = new FormData(); fd.append("audio", blob, "voice.webm");
        try {
          const res = await fetch("/api/leads/transcribe", { method: "POST", body: fd });
          const j = await res.json().catch(() => ({ error: `${res.status} ${res.statusText}` }));
          if (res.ok && typeof j.text === "string") said = j.text; else last = (typeof j.error === "string" ? j.error : typeof j.detail === "string" ? j.detail : `${res.status} ${res.statusText}`);
        } catch (e) { last = (e as Error).message; }
      }
      setBusy(false);
      if (!said.trim()) { setFail({ src: "Transcriber said", msg: last || "Nothing was heard.", retry: go }); return; }
      setText((t) => (t.trim() ? `${t.trim()} ${said.trim()}` : said.trim())); field.current?.focus();
    };
    await go();
  }

  async function pick(file?: File) {
    if (!file) return;
    try { setText((await file.text()).slice(0, 8000)); field.current?.focus(); }
    catch (e) { setFail({ src: "File said", msg: (e as Error).message, retry: () => files.current?.click() }); }
    if (files.current) files.current.value = "";
  }

  return (
    <div className={s.dock} /* composer mount */>
      <div className={s.line} aria-live="polite">
        {busy && !reply && <span className={`b-skel ${s.skel}`} aria-hidden />}
        {reply && <span className={busy ? s.shim : undefined}>{busy ? <span className={`b-skel ${s.skel}`} aria-hidden /> : reply.line}{!busy && reply.open && <button type="button" className={s.open} onClick={() => { history.pushState({ h: reply.open }, "", `/h/${reply.open}`); dispatchEvent(new PopStateEvent("popstate")); }}>Open</button>}</span>}
        {fail && <span className={s.err} role="alert"><span className={s.src}>{fail.src}</span> {fail.msg}<button type="button" className={s.open} onClick={fail.retry}>Retry</button></span>}
      </div>
      <form className={`${s.box} ${busy ? s.busy : ""} ${rec ? s.rec : ""}`} onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <button type="button" className={s.glyph} aria-label="Attach a text or email file" onClick={() => files.current?.click()} disabled={busy}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M16 9.5 10 15.5a3.5 3.5 0 0 1-5-5l6.5-6.5a2.3 2.3 0 0 1 3.3 3.3L8.3 13.8a1.1 1.1 0 0 1-1.6-1.6L12.5 6.4" /></svg>
        </button>
        <input ref={files} type="file" accept=".txt,.eml,text/plain,message/rfc822" hidden onChange={(e) => pick(e.target.files?.[0])} />
        <textarea ref={field} className={s.field} rows={1} value={text} disabled={busy && !rec} placeholder="Name, address, household. Or paste the email."
          aria-label="Add a house" onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }} />
        <button type="button" className={`${s.glyph} ${rec ? s.on : ""}`} aria-label="Hold to talk" aria-pressed={rec} disabled={busy}
          onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); void startRec(); }} onPointerUp={() => void stopRec()} onPointerCancel={() => void stopRec()} onContextMenu={(e) => e.preventDefault()}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="7.5" y="2.5" width="5" height="10" rx="2.5" /><path d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v2.5" /></svg>
        </button>
        <button type="submit" className={s.go} aria-label="Send" disabled={!text.trim() || busy}>
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 14.5v-11M4.5 8 9 3.5 13.5 8" /></svg>
        </button>
      </form>
    </div>
  );
}

async function pcm16k(blob: Blob): Promise<ArrayBuffer> {
  const ctx = new AudioContext();
  try {
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(buf.duration * 16000)), 16000);
    const src = off.createBufferSource(); src.buffer = buf; src.connect(off.destination); src.start();
    const f = (await off.startRendering()).getChannelData(0);
    const out = new Int16Array(f.length);
    for (let i = 0; i < f.length; i++) out[i] = Math.max(-1, Math.min(1, f[i])) * 0x7fff;
    return out.buffer;
  } finally { void ctx.close(); }
}

function announce(id: string) { dispatchEvent(new CustomEvent("marquee:lead-created", { detail: id })); }
