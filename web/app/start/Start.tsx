"use client";
import { useEffect, useRef, useState } from "react";
import { ConversationProvider, useConversation } from "@elevenlabs/react";
import { endTone, startRing, stopRing, tick, unlock } from "./sounds";
import { HOME_FORM, INSTALLER_BRAND, homeFirstMessage, homeNote, homeVariables, type HomeAnswers, type InstallerId, type RoofInfo } from "./intake";

type Props = { agentId: string; installerId: InstallerId };

export default function Start(props: Props) {
  return (
    <ConversationProvider>
      <Page {...props} />
    </ConversationProvider>
  );
}

// form: the enquiry; waiting: the call back is on its way; ringing: the incoming-call banner; call: the full-screen call; thanks / declined: the end.
type Step = "form" | "waiting" | "ringing" | "call" | "thanks" | "declined";
type Opt = "people" | "heating" | "ev" | "bill_band" | "roof";

const locationOk = (s: string) => /\b\d{5}\b/.test(s);
const first = (s: string) => s.trim().split(/\s+/)[0] ?? "";
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

function Page({ agentId, installerId }: Props) {
  const brand = INSTALLER_BRAND[installerId];
  const [step, setStep] = useState<Step>("form");
  const [a, setA] = useState<HomeAnswers>({ name: "", location: "" });
  const [miss, setMiss] = useState<"name" | "location" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [since, setSince] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const [speaker, setSpeaker] = useState(true);
  const connected = useRef(false);
  const ring = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nameRef = useRef<HTMLInputElement>(null), placeRef = useRef<HTMLInputElement>(null);

  const roof = useRef<RoofInfo | null | undefined>(undefined);
  const noted = useRef(false);
  const conversation = useConversation({
    onConnect: ({ conversationId }) => {
      connected.current = true; setSince(Date.now());
      // The planner preview embeds this page; it opens the lead when the call ends.
      try { window.parent?.postMessage({ type: "marquee:lead", conversation_id: conversationId }, location.origin); } catch {}
    },
    onDisconnect: () => { if (connected.current) { endTone(); setStep("thanks"); } },
    onError: (m) => setError(String(m)),   // stays on the call screen with the words and a retry
  });
  // The enquiry note goes in once the call is up, with the address lookup if it has arrived.
  useEffect(() => {
    if (conversation.status !== "connected" || noted.current) return;
    noted.current = true;
    conversation.sendContextualUpdate(homeNote(a, installerId, roof.current));
  }, [conversation.status]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (since == null) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [since]);
  useEffect(() => () => { if (ring.current) clearTimeout(ring.current); stopRing(); }, []);

  const submit = () => {
    if (!a.name.trim()) { setMiss("name"); nameRef.current?.focus(); return; }
    if (!locationOk(a.location)) { setMiss("location"); placeRef.current?.focus(); return; }
    setMiss(null); setError(null);
    unlock();   // the submit tap allows every sound that follows
    // Look the address up while the phone rings, so the call starts with it.
    roof.current = undefined;
    const ctl = new AbortController(); setTimeout(() => ctl.abort(), 8000);
    fetch(`/start/roof?address=${encodeURIComponent(a.location)}`, { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : null)).catch(() => null).then((r: RoofInfo | null) => { roof.current = r; });
    // The call back arrives a moment later, the way a phone call would.
    ring.current = setTimeout(() => { setStep("ringing"); startRing(); try { navigator.vibrate?.([400, 200, 400]); } catch {} }, 1400);
    setStep("waiting");
  };

  // Accept is the user gesture. iPhone plays call audio only if the microphone and an audio context are unlocked
  // inside the tap itself, so both happen here, synchronously, before the session starts.
  const accept = () => {
    stopRing(); tick();
    connected.current = false; noted.current = false; setSince(null); setStep("call"); setError(null);
    const mic = navigator.mediaDevices?.getUserMedia({ audio: true });
    unlock();
    setTimeout(() => { if (!connected.current) setError((e) => e ?? "No connection to the call service after 20 seconds."); }, 20000);
    const go = () => conversation.startSession({
      agentId, connectionType: "webrtc",
      userId: `${a.name.trim()}|${a.location.trim()}`,
      dynamicVariables: homeVariables(a, installerId, roof.current),
      overrides: { agent: { firstMessage: homeFirstMessage(a, installerId) } },
    });
    if (mic) mic.then((st) => { st.getTracks().forEach((t) => t.stop()); go(); }, (e) => setError(`Microphone: ${e?.message ?? e}`));
    else go();
  };

  const end = () => { if (connected.current) conversation.endSession(); else { endTone(); conversation.endSession(); setStep("form"); } };
  const decline = () => { stopRing(); endTone(); setStep("declined"); };

  const pick = (k: Opt, legend: string, hint?: string) => (
    <fieldset className="h-q">
      <legend>{legend}{hint && <span className="h-hint"> {hint}</span>}</legend>
      <div className="h-chips">
        {Object.entries(HOME_FORM[k]).map(([value, label]) => (
          <button key={value} type="button" className={value === "unknown" ? "h-chip dk" : "h-chip"} aria-pressed={a[k] === value}
            onClick={() => setA({ ...a, [k]: a[k] === value ? undefined : value })}>{label}</button>
        ))}
      </div>
    </fieldset>
  );

  const head = (
    <header className="h-top">
      <span className="h-mark" aria-hidden>{brand.charAt(0)}</span>
      <span><b>{brand}</b><small>Solar, storage and heat pumps</small></span>
    </header>
  );

  if (step === "thanks" || step === "declined")
    return (
      <div className="h-page">{head}
        <section className="h-card h-in" key="end">
          <h1>{step === "thanks" ? `Thanks ${first(a.name)}, ${brand} will send the offer.` : `No problem, ${first(a.name)}. ${brand} will call you back later.`}</h1>
        </section>
      </div>
    );

  const live = conversation.status === "connected";
  const secs = since ? Math.max(0, Math.floor((now - since) / 1000)) : 0;

  return (
    <div className="h-page">
      {head}
      <form className="h-card" onSubmit={(e) => { e.preventDefault(); submit(); }} aria-hidden={step === "call"}>
        <h1>Request your solar offer</h1>
        <div className="h-q">
          <label htmlFor="h-name">Name</label>
          <input id="h-name" ref={nameRef} className="h-input" autoComplete="name" value={a.name} aria-invalid={miss === "name"}
            onChange={(e) => setA({ ...a, name: e.target.value })} />
          {miss === "name" && <p className="h-why" role="alert">Add your name so Rina knows who to ask for.</p>}
        </div>
        <div className="h-q">
          <label htmlFor="h-place">Address or postcode</label>
          <input id="h-place" ref={placeRef} className="h-input" autoComplete="street-address" inputMode="text" value={a.location} aria-invalid={miss === "location"}
            placeholder="Katharinenstraße 5, 82008 Unterhaching" onChange={(e) => setA({ ...a, location: e.target.value })} />
          {miss === "location" && <p className="h-why" role="alert">Add a postcode, or the full address.</p>}
        </div>
        <p className="h-opt">Optional. Leave anything you are not sure of.</p>
        {pick("people", "People in the home")}
        {pick("heating", "Heating")}
        {pick("ev", "Electric car")}
        {pick("bill_band", "Electricity bill", "EUR a month")}
        {pick("roof", "Roof faces")}
        <button type="submit" className="h-go" disabled={step !== "form"}>Submit</button>
        {error && <p className="h-why" role="alert">ElevenLabs said: {error}</p>}
      </form>

      {step === "ringing" && (
        <div className="ios-banner" role="dialog" aria-label={`Incoming call from Rina, ${brand}`}>
          <span className="ios-av" aria-hidden>R</span>
          <span className="ios-who"><small>{brand}</small><b>Rina</b></span>
          <button type="button" className="ios-btn no" aria-label="Decline" onClick={decline}><Phone down /></button>
          <button type="button" className="ios-btn yes" aria-label="Accept" onClick={accept}><Phone /></button>
        </div>
      )}

      {step === "call" && (
        <div className="ios-call" role="dialog" aria-label={`Call with Rina, ${brand}`}>
          <div className="ios-call-top">
            <h2>Rina</h2>
            <p>{brand}</p>
            <p className="ios-time" aria-live="polite">{live ? clock(secs) : "Connecting"}</p>
            {live && <p className="ios-mode">{conversation.isSpeaking ? "Rina is speaking" : "Listening"}</p>}
          </div>
          {/* The iOS grid: mute, speaker and end work; keypad, add call, FaceTime and contacts are shown, not active. */}
          <div className="ios-keys">
            <button type="button" className={conversation.isMuted ? "ios-key on" : "ios-key"} aria-pressed={conversation.isMuted} onClick={() => conversation.setMuted(!conversation.isMuted)}>
              <Mic /><span>mute</span>
            </button>
            <span className="ios-key off" aria-disabled="true"><Keypad /><span>keypad</span></span>
            <button type="button" className={speaker ? "ios-key on" : "ios-key"} aria-pressed={speaker} onClick={() => { conversation.setVolume({ volume: speaker ? 0.5 : 1 }); setSpeaker(!speaker); }}>
              <Speaker /><span>speaker</span>
            </button>
            <span className="ios-key off" aria-disabled="true"><Plus /><span>add call</span></span>
            <span className="ios-key off" aria-disabled="true"><Video /><span>FaceTime</span></span>
            <span className="ios-key off" aria-disabled="true"><Person /><span>contacts</span></span>
          </div>
          <button type="button" className="ios-end" aria-label="End call" onClick={end}><Phone down /></button>
          {error && <p className="ios-err" role="alert">{error} <button type="button" className="ios-retry" onClick={accept}>Try again</button></p>}
        </div>
      )}
    </div>
  );
}

function Phone({ down }: { down?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden style={down ? { transform: "rotate(135deg)" } : undefined}>
      <path fill="currentColor" d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z" />
    </svg>
  );
}
function Keypad() {
  return <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden>{[5, 12, 19].flatMap((y) => [5, 12, 19].map((x) => <circle key={`${x}${y}`} cx={x} cy={y} r="2" fill="currentColor" />))}</svg>;
}
function Plus() {
  return <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden><path fill="currentColor" d="M11 4h2v7h7v2h-7v7h-2v-7H4v-2h7z" /></svg>;
}
function Video() {
  return <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden><path fill="currentColor" d="M3 7a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v2.5l4.4-2.9A1 1 0 0 1 22 7.4v9.2a1 1 0 0 1-1.6.8L16 14.5V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>;
}
function Person() {
  return <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden><path fill="currentColor" d="M12 12a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9zm0 2c-4.4 0-8 2.2-8 5v2h16v-2c0-2.8-3.6-5-8-5z" /></svg>;
}
function Mic() {
  return <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden><path fill="currentColor" d="M12 14a3 3 0 0 0 3-3V5a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.92V21h2v-3.08A7 7 0 0 0 19 11z" /></svg>;
}
function Speaker() {
  return <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden><path fill="currentColor" d="M3 9v6h4l5 5V4L7 9H3zm13.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4zM14 3.23v2.06a7 7 0 0 1 0 13.42v2.06a9 9 0 0 0 0-17.54z" /></svg>;
}
