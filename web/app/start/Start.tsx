"use client";
import { useRef, useState } from "react";
import { ConversationProvider, useConversation } from "@elevenlabs/react";
import { FORM, firstMessage, formNote, formVariables, type FormAnswers, type InstallerId } from "./intake";

type Props = { agentId: string; installerId: InstallerId };

export default function Start(props: Props) {
  return (
    <ConversationProvider>
      <Widget {...props} />
    </ConversationProvider>
  );
}

const COLS = { house_type: 2, people: 5, bill_band: 2, heating: 3, ev: 3 } as const;

type Step = "form" | "call" | "thanks";
type Line = { you: boolean; text: string };

function Widget({ agentId, installerId }: Props) {
  const [step, setStep] = useState<Step>("form");
  const [a, setA] = useState<Partial<FormAnswers>>({ interests: [] });
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState<string | null>(null);
  const connected = useRef(false);
  const sendNote = useRef<(() => void) | null>(null);

  const conversation = useConversation({
    onConnect: ({ conversationId }) => {
      connected.current = true;
      sendNote.current?.();
      try { window.parent?.postMessage({ type: "marquee:lead", conversation_id: conversationId }, "*"); } catch {}
    },
    onMessage: ({ message, role }) => {
      const text = message.replace(/\[[^\]]*\]\s*/g, "").trim();
      if (text) setLines((l) => [...l, { you: role === "user", text }].slice(-3));
    },
    onDisconnect: () => setStep(connected.current ? "thanks" : "form"),
    onError: (m) => {
      setError(String(m));
      if (!connected.current) setStep("form");
    },
  });

  const ready = /^\d{5}$/.test(a.postcode ?? "") && a.house_type && a.people && a.bill_band && a.heating && a.ev;

  const start = () => {
    if (!ready) return;
    setError(null);
    setLines([]);
    connected.current = false;
    setStep("call");
    sendNote.current = () => conversation.sendContextualUpdate(formNote(a));
    conversation.startSession({
      agentId, connectionType: "webrtc",
      dynamicVariables: formVariables(a, installerId),
      overrides: { agent: { firstMessage: firstMessage(a) } },
    });
  };

  if (step === "thanks")
    return (
      <section className="s-panel" key="thanks">
        <h1>Thanks, your installer will send your design shortly.</h1>
      </section>
    );

  if (step === "call")
    return (
      <section className="s-panel" key="call">
        <h1>Rina is calling</h1>
        <p className="s-status" aria-live="polite">
          {conversation.status === "connected" ? (conversation.isSpeaking ? "Speaking" : "Listening") : "Connecting"}
        </p>
        <ol className="s-captions" aria-live="polite">
          {lines.map((l, i) => <li key={i} className={l.you ? "s-you" : undefined}>{l.text}</li>)}
        </ol>
        <button type="button" className="s-go s-quiet" onClick={() => conversation.endSession()}>End call</button>
        {error && <p className="s-error" role="alert">{error}</p>}
      </section>
    );

  const one = <K extends "house_type" | "people" | "bill_band" | "heating" | "ev">(k: K, legend: string, hint?: string) => (
    <fieldset className="s-q">
      <legend>{legend}{hint && <span className="s-hint"> {hint}</span>}</legend>
      <div className="s-chips" style={{ "--cols": COLS[k] } as React.CSSProperties}>
        {Object.entries(FORM[k]).map(([value, label]) => (
          <button key={value} type="button" className="s-chip" aria-pressed={a[k] === value} onClick={() => setA({ ...a, [k]: value })}>
            {label}
          </button>
        ))}
      </div>
    </fieldset>
  );

  const toggle = (v: keyof typeof FORM.interests) =>
    setA({ ...a, interests: a.interests?.includes(v) ? a.interests.filter((x) => x !== v) : [...(a.interests ?? []), v] });

  return (
    <form className="s-panel" key="form" onSubmit={(e) => { e.preventDefault(); start(); }}>
      <h1>Your energy design</h1>
      <div className="s-q">
        <label className="s-label" htmlFor="s-postcode">Postcode</label>
        <input id="s-postcode" className="s-input" inputMode="numeric" autoComplete="postal-code" maxLength={5}
          value={a.postcode ?? ""} onChange={(e) => setA({ ...a, postcode: e.target.value.replace(/\D/g, "") })} />
      </div>
      {one("house_type", "House")}
      {one("people", "People living there")}
      {one("bill_band", "Electricity bill", "EUR a month")}
      {one("heating", "Heating")}
      {one("ev", "Electric car")}
      <fieldset className="s-q">
        <legend>Interested in</legend>
        <div className="s-chips">
          {Object.entries(FORM.interests).map(([value, label]) => (
            <button key={value} type="button" className="s-chip" aria-pressed={!!a.interests?.includes(value as keyof typeof FORM.interests)}
              onClick={() => toggle(value as keyof typeof FORM.interests)}>{label}</button>
          ))}
        </div>
      </fieldset>
      <div className="s-q">
        <label className="s-label" htmlFor="s-name">First name <span className="s-hint">optional</span></label>
        <input id="s-name" className="s-input" autoComplete="given-name" value={a.first_name ?? ""} onChange={(e) => setA({ ...a, first_name: e.target.value })} />
      </div>
      <button type="submit" className="s-go" disabled={!ready}>Start a 2-minute call</button>
      <p className="s-small">Your browser will ask for the microphone.</p>
      {error && <p className="s-error" role="alert">{error} <button type="button" className="s-chip" onClick={start}>Try again</button></p>}
    </form>
  );
}
