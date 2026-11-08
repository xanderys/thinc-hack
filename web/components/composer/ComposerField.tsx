"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode, type Ref } from "react";
import s from "./composer.module.css";

export type ComposerFieldProps = {
  value: string; onChange: (v: string) => void; onSend: () => void;
  onAttach: (file: File) => void; onMicStart: () => void; onMicStop: () => void;
  busy?: boolean; recording?: boolean; elapsed?: number;
  /** The reply and error line above the field. */
  line?: ReactNode;
  /** Right of the field, left of the send arrow: the expand chevron slot. */
  trailing?: ReactNode;
  fieldRef?: Ref<HTMLTextAreaElement>;
  /** Called when the field is focused or any of its controls is pressed (the collapsed line expands the card). */
  onActivate?: () => void;
};

export default function ComposerField({ value, onChange, onSend, onAttach, onMicStart, onMicStop, busy, recording, elapsed = 0, line, trailing, fieldRef, onActivate }: ComposerFieldProps) {
  const own = useRef<HTMLTextAreaElement | null>(null);
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
        <button type="button" className={s.glyph} aria-label="Attach a text or email file" onClick={() => files.current?.click()} disabled={busy}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M16 9.5 10 15.5a3.5 3.5 0 0 1-5-5l6.5-6.5a2.3 2.3 0 0 1 3.3 3.3L8.3 13.8a1.1 1.1 0 0 1-1.6-1.6L12.5 6.4" /></svg>
        </button>
        <input ref={files} type="file" accept=".txt,.eml,text/plain,message/rfc822" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onAttach(f); e.target.value = ""; }} />
        <textarea ref={setRef} className={s.field} rows={1} value={value} disabled={busy && !recording} placeholder="Address and household, or paste an email"
          aria-label="Add a house" onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); onSend(); } }} />
        {trailing}
        {recording && <span className={s.secs} aria-live="off">{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}</span>}
        <button type="button" className={`${s.glyph} ${recording ? s.on : ""}`} aria-label="Hold to talk" aria-pressed={!!recording} disabled={busy}
          onPointerDown={(e) => { onMicStart(); try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ } }} onPointerUp={onMicStop} onPointerCancel={onMicStop} onMouseDown={onMicStart} onMouseUp={onMicStop} onTouchStart={onMicStart} onTouchEnd={(e) => { e.preventDefault(); onMicStop(); }} onTouchCancel={onMicStop} onContextMenu={(e) => e.preventDefault()}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><rect x="7.5" y="2.5" width="5" height="10" rx="2.5" /><path d="M4.5 9.5a5.5 5.5 0 0 0 11 0M10 15v2.5" /></svg>
        </button>
        <button type="submit" className={s.go} aria-label="Send" disabled={!value.trim() || busy}>
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M9 14.5v-11M4.5 8 9 3.5 13.5 8" /></svg>
        </button>
      </form>
    </div>
  );
}

export { s as composerStyles };
