"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode, type Ref } from "react";
import s from "./composer.module.css";
import { useCopilotContext } from "@/components/copilot/context";
import "@/components/autopilot/store";   // registers marquee:run-autopilot

export type ComposerFieldProps = {
  value: string; onChange: (v: string) => void; onSend: () => void;
  onAttach: (file: File) => void; onMicStart: () => void; onMicStop: () => void;
  busy?: boolean; recording?: boolean; elapsed?: number;
  /** While recording: the live mic stream for the waveform, and cancel (discard the clip). */
  stream?: MediaStream | null; onMicCancel?: () => void;
  /** The clip is being turned into text. */
  transcribing?: boolean;
  /** The reply and error line above the field. */
  line?: ReactNode;
  /** Right of the field, left of the send arrow: the expand chevron slot. */
  trailing?: ReactNode;
  fieldRef?: Ref<HTMLTextAreaElement>;
  /** Called when the field is focused or any of its controls is pressed (the collapsed line expands the card). */
  onActivate?: () => void;
  /** Short and specific to where the field is. */
  placeholder?: string;
};

export default function ComposerField({ value, onChange, onSend, onAttach, onMicStart, onMicStop, busy, recording, elapsed = 0, stream, onMicCancel, transcribing, line, trailing, fieldRef, onActivate, placeholder = "New enquiry or a question" }: ComposerFieldProps) {
  const own = useRef<HTMLTextAreaElement | null>(null);
  // Autopilot: on the board only (no lead open); it runs in the copilot thread.
  const ctx = useCopilotContext();
  const [board, setBoard] = useState(false);
  const apPressed = useRef(false);
  useEffect(() => { const on = () => setBoard(location.pathname === "/"); on(); addEventListener("popstate", on); return () => removeEventListener("popstate", on); }, []);
  const files = useRef<HTMLInputElement>(null);
  const dock = useRef<HTMLDivElement>(null);
  // --composer-h: the dock's height with the safe area, for the panel that sits above it.
  useEffect(() => {
    const el = dock.current; if (!el) return;
    const set = () => document.documentElement.style.setProperty("--composer-h", `${Math.ceil(el.getBoundingClientRect().height)}px`);
    set(); const ro = new ResizeObserver(set); ro.observe(el);
    return () => { ro.disconnect(); document.documentElement.style.removeProperty("--composer-h"); };
  }, []);
  const grow = useCallback(() => {
    const el = own.current; if (!el) return;
    el.style.height = "auto"; el.style.height = `${Math.min(el.scrollHeight, 6 * 24 + 20)}px`;
  }, []);
  useEffect(grow, [value, grow]);
  const setRef = (el: HTMLTextAreaElement | null) => { own.current = el; if (typeof fieldRef === "function") fieldRef(el); else if (fieldRef) (fieldRef as { current: HTMLTextAreaElement | null }).current = el; };
  return (
    <div ref={dock} className={s.dock}>
      <div className={s.line} aria-live="polite">{line}</div>
      <form onFocusCapture={onActivate} onPointerDownCapture={onActivate} className={`${s.box} ${busy ? s.busy : ""} ${recording ? s.rec : ""}`} onSubmit={(e) => { e.preventDefault(); onSend(); }}>
        {(recording && onMicCancel) || transcribing ? (
          <div className={s.voice}>
            {recording && <button type="button" className={s.glyph} aria-label="Cancel recording" onClick={onMicCancel}>
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4.5 4.5l9 9M13.5 4.5l-9 9" /></svg>
            </button>}
            {recording ? <Wave stream={stream ?? null} /> : <div className={s.waveIdle} aria-label="Transcribing">{Array.from({ length: 28 }, (_, k) => <i key={k} style={{ animationDelay: `${(k % 7) * 90}ms` }} />)}</div>}
            {recording && <span className={s.secs} aria-live="off">{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}</span>}
            {recording && <button type="button" className={`${s.go} ${s.done}`} aria-label="Done" onClick={onMicStop}>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3.5 8.5l3 3 6-7" /></svg>
            </button>}
          </div>
        ) : <>
        <button type="button" className={s.glyph} aria-label="Attach a text or email file" onClick={() => files.current?.click()} disabled={busy}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15.5 9.2 9.6 15.1a3.6 3.6 0 0 1-5.1-5.1l6.2-6.2a2.4 2.4 0 0 1 3.4 3.4l-6 6a1.2 1.2 0 0 1-1.7-1.7l5.4-5.4" /></svg>
        </button>
        <input ref={files} type="file" accept=".txt,.eml,text/plain,message/rfc822" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onAttach(f); e.target.value = ""; }} />
        <textarea ref={setRef} className={s.field} rows={1} value={value} disabled={busy && !recording} placeholder={placeholder}
          aria-label="Add a house" onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); onSend(); } }} />
        {board && !ctx.leadId && (
          <button type="button" className={s.glyph} title="Autopilot" aria-label="Autopilot" disabled={busy}
            // On press: the collapsed field opens the card on the same press and is gone before a click would land.
            onPointerDown={() => { apPressed.current = true; dispatchEvent(new CustomEvent("marquee:run-autopilot")); }}
            onClick={() => { if (!apPressed.current) dispatchEvent(new CustomEvent("marquee:run-autopilot")); apPressed.current = false; }}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 10h3.5l2-5 3 10 2-5H17" /></svg>
          </button>
        )}
        {trailing}
        {recording && <span className={s.secs} aria-live="off">{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}</span>}
        <button type="button" className={`${s.glyph} ${recording ? s.on : ""}`} aria-label={recording ? "Stop recording" : "Record"} aria-pressed={!!recording} disabled={busy && !recording}
          onClick={() => (recording ? onMicStop() : onMicStart())} onContextMenu={(e) => e.preventDefault()}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="7.25" y="2.75" width="5.5" height="9.5" rx="2.75" /><path d="M4.75 9.75a5.25 5.25 0 0 0 10.5 0M10 15v2.25" /></svg>
        </button>
        <button type="submit" className={s.go} aria-label="Send" disabled={!value.trim() || busy}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 13V3.5M3.75 7.5 8 3.25l4.25 4.25" /></svg>
        </button>
        </>}
      </form>
    </div>
  );
}

export { s as composerStyles };

/** Live mic level as scrolling bars, the way Sill draws dictation. */
function Wave({ stream }: { stream: MediaStream | null }) {
  const c = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!stream || !c.current) return;
    const ctx = new AudioContext(); const an = ctx.createAnalyser(); an.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(an);
    const data = new Uint8Array(an.fftSize); const bars: number[] = []; let raf = 0, last = 0;
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      const cv = c.current; if (!cv) return;
      if (t - last > 60) {
        last = t; an.getByteTimeDomainData(data);
        let sum = 0; for (let k = 0; k < data.length; k++) { const v = (data[k] - 128) / 128; sum += v * v; }
        bars.push(Math.min(1, Math.sqrt(sum / data.length) * 4));
      }
      const w = cv.clientWidth, h = cv.clientHeight, dpr = devicePixelRatio || 1;
      if (cv.width !== w * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
      const g = cv.getContext("2d"); if (!g) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
      const step = 5, n = Math.floor(w / step); while (bars.length > n) bars.shift();
      g.fillStyle = getComputedStyle(cv).color;
      bars.forEach((v, k) => { const bh = Math.max(3, v * (h - 4)); g.fillRect(w - (bars.length - k) * step, (h - bh) / 2, 3, bh); });
    };
    raf = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(raf); void ctx.close(); };
  }, [stream]);
  return <canvas ref={c} className={s.wave} aria-label="Recording" />;
}
