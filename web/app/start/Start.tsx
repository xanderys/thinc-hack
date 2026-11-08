"use client";
import { useEffect, useRef, useState } from "react";
import { ConversationProvider, useConversation } from "@elevenlabs/react";
import { endTone, startRing, stopRing, tick, unlock } from "./sounds";
import type { Lead } from "@/lib/api";
import { designLine, n0, n2, pct } from "@/lib/stage";
import Proposal, { span } from "@/components/proposal/Proposal";
import { pastLine } from "@/lib/past";
import RoofNote from "@/components/home/RoofNote";
import { HOME_FORM, homeFacts, INSTALLER_BRAND, homeFirstMessage, homeNote, homeVariables, type HomeAnswers, type InstallerId, type RoofInfo } from "./intake";

type Props = { agentId: string; installerId: InstallerId; test?: boolean };

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
// Optional; stored as E.164 with spaces and dashes removed.
const phoneClean = (s: string) => s.replace(/[\s().-]/g, "");
const phoneOk = (s: string) => !s.trim() || /^\+[1-9]\d{6,14}$/.test(phoneClean(s));
const first = (s: string) => s.trim().split(/\s+/)[0] ?? "";
// Engine statuses before the call has finished; everything else has a design to show.
const CALLING = new Set(["draft", "in_call"]);
// Planner steps only: the engine also logs the homeowner's decision as a history row with no step.
const steps = (l: Lead) => l.history.filter((h) => h.step != null).length;
// "now with a wallbox", "now 13.05 kWp of solar": the biggest news first.
function whatsNew(a: Lead["draft"]["design"], b: Lead["draft"]["design"]): string {
  const add: [keyof typeof a, string][] = [["wallbox_kw", "a wallbox"], ["heatpump_kw", "a heat pump"], ["battery_kwh", "a battery"]];
  for (const [f, w] of add) if (a[f] == null && b[f] != null) return `now with ${w}`;
  for (const [f, w] of add) if (a[f] != null && b[f] == null) return `now without ${w}`;
  if (a.pv_kwp !== b.pv_kwp && b.pv_kwp != null) return `now ${b.pv_kwp.toLocaleString("en-GB", { maximumFractionDigits: 2 })} kWp of solar`;
  if (a.battery_kwh !== b.battery_kwh && b.battery_kwh != null) return `now a ${b.battery_kwh.toLocaleString("en-GB", { maximumFractionDigits: 2 })} kWh battery`;
  return "with the latest details";
}
// The engine's own words: {error}, FastAPI's {detail} (a string or a list of {msg}).
function errorText(b: { error?: unknown; detail?: unknown }): string | null {
  if (typeof b.error === "string" && b.error) return b.error;
  if (typeof b.detail === "string" && b.detail) return b.detail;
  if (Array.isArray(b.detail)) return b.detail.map((d: { msg?: string }) => d?.msg ?? JSON.stringify(d)).join("; ");
  return null;
}
const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

function Page({ agentId, installerId, test }: Props) {
  const brand = INSTALLER_BRAND[installerId];
  const [step, setStep] = useState<Step>("form");
  const [a, setA] = useState<HomeAnswers>({ name: "", location: "" });
  const [miss, setMiss] = useState<"name" | "location" | "phone" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [leadError, setLeadError] = useState<string | null>(null);
  const [since, setSince] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const [speaker, setSpeaker] = useState(true);
  const connected = useRef(false);
  const ring = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nameRef = useRef<HTMLInputElement>(null), placeRef = useRef<HTMLInputElement>(null), phoneRef = useRef<HTMLInputElement>(null);

  const roof = useRef<RoofInfo | null | undefined>(undefined);
  // v1.9: the lead exists from Submit; the engine refines its draft during the call.
  const [leadId, setLeadId] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [doneAt, setDoneAt] = useState<number | null>(null);
  const [lead, setLead] = useState<Lead | null>(null);
  const [summary, setSummary] = useState(false);
  // v2.5: the planner's release opens the proposal; the stopwatch runs on to the signature.
  const [open, setOpen] = useState(false);
  const openRef = useRef(false); openRef.current = open;
  const [ready, setReady] = useState<string | null>(null);
  const shownHash = useRef<string | null>(null);
  const [signedAt, setSignedAt] = useState<number | null>(null);
  const [tickNow, setTickNow] = useState(0);
  const noted = useRef(false);
  const declinedRef = useRef(false);
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
  // The stopwatch runs from Submit until the homeowner signs.
  useEffect(() => {
    if (startedAt == null || signedAt != null) return;
    const t = setInterval(() => setTickNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [startedAt, signedAt]);
  // Keeps polling after the first design: a planner's change shows up as a second notification.
  const [update, setUpdate] = useState<string | null>(null);
  const seen = useRef(0);
  const leadSeen = useRef<Lead | null>(null);
  const updatedOnce = useRef(false);
  useEffect(() => {
    if (!leadId) return;
    const t = setInterval(async () => {
      const r = await fetch(`/api/leads/${leadId}`, { cache: "no-store" }).catch(() => null);
      if (!r?.ok) return;
      const l: Lead = await r.json();
      // A declined call never moves the lead past "draft": its Submit draft is the design to show.
      if (CALLING.has(l.status) && !declinedRef.current) return;
      const prev = leadSeen.current;
      leadSeen.current = l; setLead(l);
      if (l.status === "approved" && l.proposal_hash && l.proposal_hash !== shownHash.current) {
        shownHash.current = l.proposal_hash;
        if (!openRef.current) setReady(l.proposal_hash);
      }
      if (l.status === "signed" && l.decision?.action === "sign") setSignedAt((s) => s ?? Date.parse(l.decision!.decided_at));
      if (!prev) { seen.current = steps(l); setDoneAt(Date.now()); return; }
      if (steps(l) > seen.current) { seen.current = steps(l); updatedOnce.current = true; setReady(null); if (!openRef.current) { setUpdate(whatsNew(prev.draft.design, l.draft.design)); setSummary(false); } }
    }, 3000);
    return () => clearInterval(t);
  }, [leadId]);

  const submit = () => {
    if (!a.name.trim()) { setMiss("name"); nameRef.current?.focus(); return; }
    if (!locationOk(a.location)) { setMiss("location"); placeRef.current?.focus(); return; }
    if (!phoneOk(a.phone ?? "")) { setMiss("phone"); phoneRef.current?.focus(); return; }
    setMiss(null); setError(null);
    unlock();   // the submit tap allows every sound that follows
    setStartedAt(Date.now()); setDoneAt(null); setLead(null); leadSeen.current = null; updatedOnce.current = false; setUpdate(null); setLeadId(null); setSummary(false);
    setOpen(false); setReady(null); shownHash.current = null; setSignedAt(null); declinedRef.current = false;
    setLeadError(null);
    setStep("waiting");
    // Look the address up while the lead is made, so the call starts with it.
    roof.current = undefined;
    const ctl = new AbortController(); setTimeout(() => ctl.abort(), 8000);
    fetch(`/start/roof?address=${encodeURIComponent(a.location)}`, { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : null)).catch(() => null).then((r: RoofInfo | null) => { roof.current = r; });
    // The phone rings only once the engine holds the lead; on failure the form shows the engine's words and a retry.
    const shown = Date.now();
    fetch("/api/leads", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ customer_name: a.name.trim(), address_or_postcode: a.location.trim(), ...(a.phone?.trim() ? { phone: phoneClean(a.phone) } : {}), installer_id: installerId, facts: homeFacts(a), source: "form", ...(test ? { test: true } : {}) }) })
      .then(async (r) => {
        const b = await r.json().catch(() => ({}));
        if (!r.ok || !b.lead_id) throw new Error(errorText(b) ?? `The engine answered ${r.status} with no lead.`);
        setLeadId(b.lead_id);
        // The call back arrives a moment after Submit, the way a phone call would.
        ring.current = setTimeout(() => { setStep("ringing"); startRing(); try { navigator.vibrate?.([400, 200, 400]); } catch {} }, Math.max(0, 1400 - (Date.now() - shown)));
      })
      .catch((e: Error) => { setStartedAt(null); setLeadError(e.message || "The request did not reach the engine."); setStep("form"); });
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
      dynamicVariables: homeVariables(a, installerId, roof.current, leadId),
      overrides: { agent: { firstMessage: homeFirstMessage(a, installerId) } },
    });
    if (mic) mic.then((st) => { st.getTracks().forEach((t) => t.stop()); go(); }, (e) => setError(`Microphone: ${e?.message ?? e}`));
    else go();
  };

  const end = () => { if (connected.current) conversation.endSession(); else { endTone(); conversation.endSession(); setStep("form"); } };
  const decline = () => { stopRing(); endTone(); declinedRef.current = true; setStep("declined"); };

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

  const took = startedAt != null ? Math.max(0, Math.round(((doneAt ?? tickNow) - startedAt) / 1000)) : 0;
  const notify = doneAt != null && !summary && (step === "thanks" || step === "declined" || step === "form");
  const signTook = startedAt != null ? Math.max(0, (signedAt ?? tickNow) - startedAt) : 0;
  const openProposal = () => { setOpen(true); setReady(null); setUpdate(null); window.scrollTo(0, 0); };

  // The planner released the proposal: an iOS notification that opens it.
  const readyBanner = ready && !open && step !== "ringing" && step !== "call" && (
    <button type="button" key={ready} className="ios-banner ios-note" onClick={openProposal}>
      <span className="ios-app" aria-hidden>{brand.charAt(0)}</span>
      <span className="ios-note-t"><small><b>{brand}</b><span>now</span></small>Your proposal is ready</span>
    </button>
  );

  if (open && lead)
    return (
      <div className="h-prop">
        <Proposal lead={lead} brand={brand} startedAt={startedAt} onDecided={(st, at) => { if (st === "signed") setSignedAt(at); }} />
      </div>
    );

  // The design card: the same box from Submit until the design lands, so nothing moves when it arrives.
  const design = (
    <DesignCard lead={doneAt != null ? lead : null} took={took} signedAt={signedAt} signTook={signTook} brand={brand} onOpen={openProposal} />
  );

  if (summary && lead)
    return (
      <div className="h-page">{head}
        <section className="h-card h-in h-sum" key="sum">
          <h1>{updatedOnce.current ? `Your updated design, ${first(a.name)}` : `Your first design, ${first(a.name)}`}</h1>
          {design}
        </section>
        {readyBanner}
      </div>
    );

  const banner = readyBanner || (notify && (
    <button type="button" key={update ?? "first"} className="ios-banner ios-note" onClick={() => { setSummary(true); setUpdate(null); }}>
      <span className="ios-app" aria-hidden>{brand.charAt(0)}</span>
      <span className="ios-note-t"><small><b>{brand}</b><span>now</span></small>{update ? `Your design was updated, ${update}` : "Your first design is ready"}</span>
    </button>
  ));

  if (step === "thanks" || step === "declined")
    return (
      <div className="h-page">{head}
        <section className="h-card h-in" key="end">
          <h1>{step === "thanks" ? `Thanks ${first(a.name)}, ${brand} will send the offer.` : `No problem, ${first(a.name)}. ${brand} will call you back later.`}</h1>
          {startedAt != null && <p className="h-watch" aria-live="off">{doneAt != null ? `Enquiry to design: ${Math.floor(took / 60)} min ${took % 60} s` : `Your design: ${clock(took)}`}</p>}
          {startedAt != null && design}
        </section>
        {banner}
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
        <div className="h-q">
          <label htmlFor="h-phone">Phone (optional)</label>
          <input id="h-phone" ref={phoneRef} className="h-input" type="tel" autoComplete="tel" inputMode="tel" value={a.phone ?? ""} aria-invalid={miss === "phone"}
            placeholder="+49" onChange={(e) => setA({ ...a, phone: e.target.value })} />
          {miss === "phone" && <p className="h-why" role="alert">Use the international format, for example +49 151 2345678.</p>}
        </div>
        <p className="h-opt">Optional. Leave anything you are not sure of.</p>
        {pick("people", "People in the home")}
        {pick("heating", "Heating")}
        {pick("ev", "Electric car")}
        {pick("bill_band", "Electricity bill", "€ a month")}
        {pick("roof", "Roof faces")}
        <button type="submit" className="h-go" disabled={step !== "form"}>{step === "waiting" ? "Sending" : "Submit"}</button>
        {leadError && step === "form" && <p className="h-why" role="alert">{leadError} <button type="button" className="h-retry" onClick={submit}>Retry</button></p>}
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
            {/* Until the call connects, both lines hold their final size as skeletons. */}
            <p className="ios-time" aria-live="polite">{live ? clock(secs) : <span className="ios-sk" style={{ width: "3.2ch" }}><span className="h-vh">Connecting</span></span>}</p>
            <p className="ios-mode">{live ? (conversation.isSpeaking ? "Rina is speaking" : "Listening") : <span className="ios-sk" style={{ width: "9ch" }} />}</p>
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
      {step === "form" && banner}
    </div>
  );
}

// Blank bars sized like the real lines: no placeholder text, so nothing readable if the shimmer style is missing.
const SK_PARTS = ["86%", "100%", "78%", "62%"];
const nb = "\u00a0";
const Bar = ({ w }: { w: string }) => <span className="h-bar" style={{ width: w }}>{nb}</span>;

function DesignCard({ lead, took, signedAt, signTook, brand, onOpen }: { lead: Lead | null; took: number; signedAt: number | null; signTook: number; brand: string; onOpen: () => void }) {
  const d = lead?.draft, e = d?.economics, v = d?.variants?.[0];
  const say = d ? [
    d.design.pv_kwp != null ? `${n2(d.design.pv_kwp)} kWp of solar panels on your roof.` : "No solar panels for now.",
    d.design.battery_kwh != null ? `A ${n2(d.design.battery_kwh)} kWh battery keeps daytime sun for the evening.` : "No battery for now.",
    d.design.heatpump_kw != null ? `A ${n2(d.design.heatpump_kw)} kW heat pump heats the house.` : "No heat pump for now.",
    d.design.wallbox_kw != null ? `A wallbox for the car, ${n2(d.design.wallbox_kw)} kW.` : "No car charger for now.",
  ] : null;
  const released = lead && (lead.status === "approved" || lead.status === "signed" || lead.status === "question");
  return (
    <div className={lead ? "h-design h-arrive" : "h-design h-sk"} aria-busy={!lead} aria-hidden={!lead || undefined}>
      <dl className="h-nums">
        <div><dt>Solar a year</dt><dd>{e ? (e.annual ? `${n0(e.annual.pv_yield_kwh)} kWh` : "None") : <Bar w="9ch" />}</dd></div>
        <div><dt>Supplied by your system</dt><dd>{e ? `${pct(e.autarky_share)} %` : <Bar w="4ch" />}</dd></div>
        <div><dt>Investment estimate</dt><dd>{e ? `€${n0(e.capex_eur)}` : <Bar w="10ch" />}</dd></div>
        <div><dt>Payback</dt><dd>{e ? (e.payback_years == null ? "None" : `${n2(Math.round(e.payback_years * 10) / 10)} years`) : <Bar w="8ch" />}</dd></div>
      </dl>
      <p className="h-est">Prices are an estimate until the site visit.</p>
      <ul className="h-parts">
        {say ? say.map((x, i) => <li key={i}>{x}{i === 0 && lead && <RoofNote draft={lead.draft} className="h-roofnote" />}</li>)
          : SK_PARTS.map((w, i) => <li key={i} style={{ width: w }}>{nb}</li>)}
      </ul>
      <p className="h-pref"><b>{v ? v.label.split(" (")[0] : <Bar w="12ch" />}</b> {v ? designLine(v.design) : <Bar w="20ch" />}</p>
      <dl className="h-times">
        <div><dt>Enquiry to design</dt><dd>{Math.floor(took / 60)} min {took % 60} s</dd></div>
        <div><dt>Enquiry to signature</dt><dd>{signedAt != null ? span(signTook) : clock(Math.floor(signTook / 1000))}</dd></div>
        {pastLine(lead?.facts.installer_id) && <p>{pastLine(lead?.facts.installer_id)}</p>}
      </dl>
      {released
        ? <button type="button" className="h-go" onClick={onOpen}>Open your proposal</button>
        : <p className="h-send">{brand} will send the full offer.</p>}
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
