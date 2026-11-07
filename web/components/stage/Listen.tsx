"use client";
import { useEffect, useRef, useState } from "react";

// Minimal Web Speech API types (Chrome ships it as webkitSpeechRecognition).
type Rec = {
  lang: string; continuous: boolean; interimResults: boolean;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null; onend: (() => void) | null;
  start: () => void; stop: () => void; abort: () => void;
};
const make = (): Rec | null => {
  if (typeof window === "undefined") return null;
  const C = (window as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec }).SpeechRecognition
    ?? (window as unknown as { webkitSpeechRecognition?: new () => Rec }).webkitSpeechRecognition;
  return C ? new C() : null;
};

/**
 * "Listening": the laptop mic hears a phone on speaker. Each finished sentence goes to onSentence,
 * one at a time; it returns true when the sentence changed something. Never starts by itself.
 */
export default function Listen({ onSentence, busy }: { onSentence: (s: string) => Promise<boolean>; busy?: boolean }) {
  const [on, setOn] = useState(false);
  const [line, setLine] = useState("");
  const [last, setLast] = useState<{ text: string; applied: boolean | null } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [why, setWhy] = useState<string | null>(null);
  const idle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rec = useRef<Rec | null>(null);
  const want = useRef(false);
  const queue = useRef<string[]>([]);
  const working = useRef(false);
  const cb = useRef(onSentence); cb.current = onSentence;
  const [supported, setSupported] = useState(true);
  useEffect(() => { setSupported(!!make()); }, []);

  async function drain() {
    if (working.current) return;
    working.current = true;
    while (queue.current.length) {
      const s = queue.current.shift()!;
      setLast({ text: s, applied: null });
      const ok = await cb.current(s).catch(() => false);
      setLast({ text: s, applied: ok });
    }
    working.current = false;
  }

  function start() {
    const r = make();
    if (!r) { setSupported(false); return; }
    r.lang = "en-GB"; r.continuous = true; r.interimResults = true;
    r.onresult = (e) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript.trim();
        if (e.results[i].isFinal) { arm(); if (t.split(/\s+/).length >= 3) { queue.current.push(t); drain(); } setLine(t); }
        else interim += `${t} `;
      }
      if (interim) setLine(interim.trim());
    };
    r.onerror = (e) => { if (e.error === "not-allowed" || e.error === "service-not-allowed") { want.current = false; setOn(false); setErr("The browser blocked the microphone. Allow it in the address bar, then try again."); } else if (e.error !== "no-speech" && e.error !== "aborted") setErr(`Speech recognition said: ${e.error}`); };
    // Chrome ends a session after a pause; keep listening until Stop.
    r.onend = () => { if (want.current) { try { r.start(); } catch { /* already restarting */ } } };
    rec.current = r; want.current = true; setErr(null); setWhy(null); setOn(true); setLine(""); arm();
    try { r.start(); } catch (e) { setErr(String(e)); }
  }
  function stop(reason?: string) {
    want.current = false; rec.current?.stop(); setOn(false);
    if (idle.current) clearTimeout(idle.current);
    setWhy(reason ?? null);
  }
  // A room left listening must not keep changing a lead: 90 s without a recognised sentence ends the session.
  function arm() {
    if (idle.current) clearTimeout(idle.current);
    idle.current = setTimeout(() => { if (want.current) stop("Stopped after 90 s without speech."); }, 90000);
  }
  // Leaving the tab or the window ends listening; it stays off on return until pressed again.
  useEffect(() => {
    const away = () => { if (want.current) stop("Stopped when you left the tab."); };
    const vis = () => { if (document.visibilityState === "hidden") away(); };
    document.addEventListener("visibilitychange", vis); window.addEventListener("blur", away); window.addEventListener("pagehide", away);
    return () => { document.removeEventListener("visibilitychange", vis); window.removeEventListener("blur", away); window.removeEventListener("pagehide", away); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => () => { want.current = false; rec.current?.abort(); if (idle.current) clearTimeout(idle.current); }, []);

  if (!supported) return <p className="s-quiet">Listening needs Chrome. Type the change instead.</p>;
  return (
    <div className="s-listen">
      {on ? (
        <div className="s-live" role="status">
          <span className="s-chip"><span className="dot" aria-hidden />Listening</span>
          <button type="button" className="btn ghost" onClick={() => stop()}>Stop</button>
        </div>
      ) : <button type="button" className="btn ghost" onClick={start} aria-pressed={false}>Listen</button>}
      {!on && why && <p className="s-quiet">{why}</p>}
      {on && <p className="s-heard" aria-live="polite">{line || "Waiting for speech"}</p>}
      {last && <p className="s-quiet s-last">{last.applied == null || busy ? `Reading: "${last.text}"` : last.applied ? `Applied: "${last.text}"` : `Heard, nothing to change: "${last.text}"`}</p>}
      {err && <div className="error" role="alert"><span><span className="src">Microphone</span>{err}</span><button className="btn ghost" onClick={start}>Retry</button></div>}
    </div>
  );
}
