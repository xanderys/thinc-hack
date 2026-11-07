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
        if (e.results[i].isFinal) { if (t.split(/\s+/).length >= 3) { queue.current.push(t); drain(); } setLine(t); }
        else interim += `${t} `;
      }
      if (interim) setLine(interim.trim());
    };
    r.onerror = (e) => { if (e.error === "not-allowed" || e.error === "service-not-allowed") { want.current = false; setOn(false); setErr("The browser blocked the microphone. Allow it in the address bar, then try again."); } else if (e.error !== "no-speech" && e.error !== "aborted") setErr(`Speech recognition said: ${e.error}`); };
    // Chrome ends a session after a pause; keep listening until Stop.
    r.onend = () => { if (want.current) { try { r.start(); } catch { /* already restarting */ } } };
    rec.current = r; want.current = true; setErr(null); setOn(true); setLine("");
    try { r.start(); } catch (e) { setErr(String(e)); }
  }
  function stop() { want.current = false; rec.current?.stop(); setOn(false); }
  useEffect(() => () => { want.current = false; rec.current?.abort(); }, []);

  if (!supported) return <p className="s-quiet">Listening needs Chrome. Type the change instead.</p>;
  return (
    <div className="s-listen">
      <button type="button" className={on ? "btn ghost on" : "btn ghost"} onClick={on ? stop : start} aria-pressed={on}>
        {on ? <><span className="dot" aria-hidden />Stop listening</> : "Listening"}
      </button>
      {on && <p className="s-heard" aria-live="polite">{line || "Waiting for speech"}</p>}
      {last && <p className="s-quiet s-last">{last.applied == null || busy ? `Reading: "${last.text}"` : last.applied ? `Applied: "${last.text}"` : `Heard, nothing to change: "${last.text}"`}</p>}
      {err && <div className="error" role="alert"><span><span className="src">Microphone</span>{err}</span><button className="btn ghost" onClick={start}>Retry</button></div>}
    </div>
  );
}
