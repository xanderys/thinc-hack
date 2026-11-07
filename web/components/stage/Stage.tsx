"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Lead, { type Pref } from "@/components/stage/Lead";
import dynamic from "next/dynamic";
import type { CallLead } from "@/components/stage/Calls";
const Calls = dynamic(() => import("@/components/stage/Calls"), { ssr: false });
const VOICE = process.env.NEXT_PUBLIC_VOICE === "1";
import Plan, { type Variant } from "@/components/stage/Plan";
import Refine, { type Moved } from "@/components/stage/Refine";
import TopBar from "@/components/stage/TopBar";
import type { RoofResult, AskQuestion, AskResponse, Design, DesignResponse, HomeInputs, InstallerId, InterpretChange, InterpretOverride, InterpretResponse, OverrideValue, Overrides, ReadResponse, RefineResponse, WriteResponse } from "@/lib/api";
import { call } from "@/lib/client";
import { HERO_LEAD } from "@/lib/demo";
import { buildFacts, DEFAULTS, KEYS, NAME, pickFlag, variantName } from "@/lib/stage";
import { COMPONENT_DESIGN_FIELD } from "@/lib/api";

const UNIT: Record<keyof Design, string> = { pv_kwp: "kWp", inverter_kw: "kW", battery_kwh: "kWh", heatpump_kw: "kW", wallbox_kw: "kW" };
type Snap = { changed: Partial<HomeInputs>; overrides: Overrides; chips: InterpretChange[]; ovChips: InterpretOverride[] };

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const COMPONENT_FIELD_SET: Record<string, true> = { pv_kwp: true, inverter_kw: true, battery_kwh: true, heatpump_kw: true, wallbox_kw: true };

// A house opened from the board: the lead's id (refinements write back to it) and what was read.
export type Seed = { leadId: string; read: ReadResponse; text?: string };
// While Rina's call runs: the lead's facts so far, the step count, what the last answer changed and what she is asking.
export type Live = { step: number; facts: Partial<HomeInputs>; changed: { component: string; why: string }[]; asking: string | null };

export default function Stage({ seed, onApproved, live }: { seed?: Seed; onApproved?: (id: string) => void; live?: Live | null }) {
  const [lead, setLead] = useState(HERO_LEAD);
  const [read, setRead] = useState<ReadResponse | null>(null);
  const [readBusy, setReadBusy] = useState(false);
  const [readErr, setReadErr] = useState<string | null>(null);
  const [installer, setInstaller] = useState<InstallerId>("2a8ba8e2");
  const [roof, setRoof] = useState<RoofResult | null>(null);
  const roofGen = useRef(0);
  const [question, setQuestion] = useState<AskQuestion | null | undefined>(undefined); // undefined while asking
  const [askErr, setAskErr] = useState<string | null>(null);
  const [answer, setAnswer] = useState<unknown>(undefined);
  const [changed, setChanged] = useState<Partial<HomeInputs>>({});    // from sentences, Moment 3
  const [overrides, setOverrides] = useState<Overrides>({});
  const [res, setRes] = useState<DesignResponse | null>(null);
  const [prev, setPrev] = useState<DesignResponse | null>(null);
  const [drafted, setDrafted] = useState<DesignResponse | null>(null);  // the agent's own draft, no overrides
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const [write, setWrite] = useState<WriteResponse | null>(null);
  const [writeBusy, setWriteBusy] = useState(false);
  const [pvOnly, setPvOnly] = useState<RefineResponse | null>(null);
  const [pref, setPref] = useState<Pref>("expert");
  const last = useRef<DesignResponse | null>(null);
  const cause = useRef<string | null>(null);
  // The homeowner's lead when the stage was opened from a call: refinements write back to it.
  const leadRef = useRef<string | null>(null);
  const [moved, setMoved] = useState<Moved | null>(null);
  const [llm, setLlm] = useState<boolean | null>(null);
  const [sayBusy, setSayBusy] = useState(false);
  const [sayErr, setSayErr] = useState<string | null>(null);
  const [chips, setChips] = useState<InterpretChange[]>([]);
  const [ovChips, setOvChips] = useState<InterpretOverride[]>([]);
  const [history, setHistory] = useState<Snap[]>([]);
  const [approvedAt, setApprovedAt] = useState<string | null>(null);

  const inputs: HomeInputs = useMemo(() => {
    const base: HomeInputs = { ...DEFAULTS, ...(read?.inputs ?? {}), installer_id: installer };
    if (question && answer !== undefined) (base as unknown as Record<string, unknown>)[question.field] = answer;
    const out: HomeInputs = { ...base, ...changed };
    // One roof lookup per lead; later calls carry the result instead of the address.
    if (roof && roof.source !== "none" && !roof.pending) { out.roof = roof; delete out.address; }
    return out;
  }, [read, installer, question, answer, changed, roof]);
  const ready = !!read && question !== undefined && (question === null || answer !== undefined);
  // The planner's answer to the one question goes back to the lead, so its card shows the same design.
  useEffect(() => {
    if (!leadRef.current || !question || answer === undefined) return;
    call("/api/intake/step", { lead_id: leadRef.current, facts_so_far: { [question.field]: answer } });
  }, [question, answer]);

  // Shortcut d loads the hero lead.
  useEffect(() => {
    if (seed) return;
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key !== "d" || e.metaKey || e.ctrlKey || /INPUT|TEXTAREA|SELECT/.test(t.tagName)) return;
      setLead(HERO_LEAD); setRead(null);
    };
    addEventListener("keydown", on); return () => removeEventListener("keydown", on);
  }, []);

  async function doRead() {
    setReadBusy(true); setReadErr(null);
    const r = await call<ReadResponse>("/api/read", { lead });
    setReadBusy(false);
    if (!r.ok) { setReadErr(r.error); return; }
    await begin(r.data);
  }

  // Facts from the call: everything was said, so nothing is asked.
  // Facts from a homeowner call, each tagged form, call or estimated; nothing is asked.
  function onCall(l: CallLead) {
    leadRef.current = l.conversation_id;
    const { preference, ...rest } = l.inputs as Partial<HomeInputs>;
    if (rest.installer_id) setInstaller(rest.installer_id as InstallerId);
    setPref(preference ?? "expert");
    setLead(l.facts.summary ?? "");
    begin({ inputs: rest, found: [], unknown: [], source: "call", origin: l.sources });
  }

  // Opened from the board: start from the lead, keep its id for write-back.
  useEffect(() => {
    if (!seed) return;
    if (seed.read.inputs.installer_id) setInstaller(seed.read.inputs.installer_id as InstallerId);
    setLead(seed.text ?? "");
    begin(seed.read, seed.leadId);
  }, [seed?.leadId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Each answer from the call: the facts move, the design reruns, and what moved carries the engine's why.
  const liveWhy = useRef<{ component: string; why: string }[] | null>(null);
  useEffect(() => {
    if (!live || !read) return;
    const { installer_id: _i, ...facts } = live.facts as Partial<HomeInputs> & { installer_id?: string }; void _i;
    if (Object.entries(facts).every(([k, v]) => JSON.stringify((read.inputs as Record<string, unknown>)[k]) === JSON.stringify(v))) return;
    cause.current = "From the call:"; liveWhy.current = live.changed;
    setRead((r) => r && { ...r, inputs: { ...r.inputs, ...facts } });
  }, [live?.step]); // eslint-disable-line react-hooks/exhaustive-deps

  async function begin(data: ReadResponse, leadId?: string) {
    if (leadId) leadRef.current = leadId; else if (data.source !== "call") leadRef.current = null;
    const r = { data };
    setQuestion(undefined); setAnswer(undefined); setChanged({}); setOverrides({}); setRes(null); setPrev(null); last.current = null;
    setChips([]); setOvChips([]); setHistory([]); setMoved(null); setApprovedAt(null);
    setRead(r.data); setRoof(null);
    const where = r.data.inputs.address ? `address=${encodeURIComponent(r.data.inputs.address)}` : r.data.postcode ? `postcode=${r.data.postcode}` : null;
    // A pending roof means the 3D measurement is still running: design on the standard face, ask again every 3 s.
    const gen = ++roofGen.current;
    const look = async (k: number): Promise<void> => {
      const x = await call<RoofResult>(`/api/roof?${where}`);
      if (gen !== roofGen.current) return;
      if (!x.ok) { setRoof(null); return; }
      if (x.data.pending && k >= 40) { setRoof({ ...x.data, pending: false, source: "none" }); return; }
      setRoof(x.data);
      if (x.data.pending) setTimeout(() => { void look(k + 1); }, 3000);
    };
    if (where) void look(0);
    const base: HomeInputs = { ...DEFAULTS, ...r.data.inputs, installer_id: (r.data.inputs.installer_id as InstallerId) ?? installer };
    // A restarting engine answers 502 for about 35 s: wait and ask again rather than skip the question.
    for (let k = 0; ; k++) {
      const a = await call<AskResponse>("/api/ask", { inputs: base, unknown: r.data.unknown });
      if (a.ok) { setQuestion(a.data.questions[0] ?? null); setAskErr(null); return; }
      if (/404|not found/i.test(a.error)) { setQuestion(null); setAskErr(null); return; }
      if (k >= 15) { setQuestion(null); setAskErr(a.error); return; }
      setAskErr(`${a.error} Asking again.`);
      await new Promise((ok) => setTimeout(ok, 6000));
    }
  }

  // Design, or refine when the planner has fixed something.
  useEffect(() => {
    if (!ready) return;
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const fixed = Object.keys(overrides).length > 0;
        const r = fixed ? await call<RefineResponse>("/api/refine", { inputs, overrides }, ctl.signal) : await call<DesignResponse>("/api/design", { inputs }, ctl.signal);
        if (r.ok) {
          const before = last.current;
          if (before && cause.current) {
            const engineWhy = "diff" in r.data ? (r.data as RefineResponse).diff : [];
            const lines = ([...KEYS.map((k) => COMPONENT_DESIGN_FIELD[k]), "inverter_kw"] as (keyof Design)[])
              .filter((f) => before.design[f] !== r.data.design[f])
              .map((f) => {
                const key = f === "inverter_kw" ? "inverter" : KEYS.find((k) => COMPONENT_DESIGN_FIELD[k] === f)!;
                const why = engineWhy.find((d) => d.component === key)?.why ?? liveWhy.current?.find((d) => d.component === key)?.why;
                return { name: key === "inverter" ? "Inverter" : NAME[key], from: before.design[f], to: r.data.design[f], unit: UNIT[f], why: why && why !== "Set by the planner." ? why : undefined };
              });
            setMoved({ cause: cause.current, lines });
          }
          cause.current = null; liveWhy.current = null;
          setPrev(before); last.current = r.data; setRes(r.data); setErr(null);
          if (!fixed) setDrafted(r.data);
        } else setErr(r.error);
        setBusy(false);
      } catch { /* superseded */ }
    }, 150);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [ready, inputs, overrides, retry]);

  useEffect(() => {
    if (!err?.includes("restarting")) return;
    const t = setTimeout(() => setRetry((x) => x + 1), 8000);
    return () => clearTimeout(t);
  }, [err, retry]);

  // Prose and component lines, grounded in the engine's facts.
  const facts = useMemo(() => res ? buildFacts(inputs, res) : null, [res]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!facts) return;
    const ctl = new AbortController();
    setWriteBusy(true); setWrite(null);
    call<WriteResponse>("/api/write", { facts, mode: "planner" }, ctl.signal)
      .then((r) => { setWrite(r.ok ? r.data : null); setWriteBusy(false); })
      .catch(() => {});
    return () => ctl.abort();
  }, [facts]);

  // The PV-only variant for the current home.
  useEffect(() => {
    setPvOnly(null);
    if (!res || res.design.battery_kwh == null || res.variants?.length) return;
    const ctl = new AbortController();
    call<RefineResponse>("/api/refine", { inputs, overrides: { ...overrides, battery_kwh: null } }, ctl.signal)
      .then((r) => { if (r.ok) setPvOnly(r.data); }).catch(() => {});
    return () => ctl.abort();
  }, [res]); // eslint-disable-line react-hooks/exhaustive-deps

  const variants: Variant[] = useMemo(() => {
    if (!res) return [];
    // Engine v1.7: four offers the homeowner can choose between; the preference only reorders them.
    const ev = (Object.keys(overrides).length ? drafted?.variants : null) ?? res.variants ?? drafted?.variants;
    if (ev?.length) {
      const order = [...ev].sort((a, b) => (b.key === pref ? 1 : 0) - (a.key === pref ? 1 : 0));
      return order.map((v, n) => {
        const [name, how] = v.label.split(" (");
        return { name, tag: n === 0 ? "Preferred" : v.key === "expert" ? (how ? how.replace(/\)$/, "").replace(/^./, (c) => c.toUpperCase()).replace(" here ", " ") : "As planners design it") : "",
          design: v.design, e: v.economics, note: v.key === "expert" ? "" : v.note, current: same(v.design, res.design),
          overrides: v.key === "expert" ? {} : { pv_kwp: v.design.pv_kwp, battery_kwh: v.design.battery_kwh, wallbox_kw: v.design.wallbox_kw, heatpump_kw: v.design.heatpump_kw } };
      });
    }
    const fixed = Object.keys(overrides).length > 0;
    const out: Variant[] = [{ name: variantName(res.design), tag: fixed ? "Chosen" : "", design: res.design, e: res.economics, overrides: null, current: true }];
    if (fixed && drafted && !same(drafted.design, res.design)) out.push({ name: variantName(drafted.design, res.design), tag: "Agent's draft", design: drafted.design, e: drafted.economics, overrides: {}, current: false });
    const o = res.optimum;
    if (o && !same(o.design, res.design)) out.push({ name: variantName(o.design, res.design), tag: "Earns most", design: o.design, e: o.economics, overrides: { ...overrides, pv_kwp: o.design.pv_kwp, battery_kwh: o.design.battery_kwh }, current: false });
    if (res.design.battery_kwh != null) out.push({ name: "PV only", tag: "Cheapest", design: pvOnly?.design ?? { ...res.design, battery_kwh: null }, e: pvOnly?.economics ?? null, overrides: { ...overrides, battery_kwh: null }, current: false });
    return out.filter((v, k) => out.findIndex((w) => w.name === v.name) === k);
  }, [res, drafted, pvOnly, overrides, pref]);

  useEffect(() => { call<{ available: boolean }>("/api/interpret").then((r) => setLlm(r.ok ? r.data.available : false)); }, []);

  const snap = (): Snap => ({ changed, overrides, chips, ovChips });
  const remember = (why: string) => { setHistory((h) => [...h, snap()]); cause.current = why; setApprovedAt(null); };

  async function onSay(sentence: string, quiet = false): Promise<boolean> {
    if (!res) return false;
    setSayBusy(true); setSayErr(null);
    const typical = Object.fromEntries(KEYS.map((k) => [COMPONENT_DESIGN_FIELD[k], res.components[k].neighbours.median_size]));
    const r = await call<InterpretResponse>("/api/interpret", { sentence, inputs, design: res.design, overrides, typical });
    setSayBusy(false);
    if (!r.ok) { setSayErr(r.error); return false; }
    const ovs = r.data.overrides ?? [];
    if (r.data.changes.length === 0 && ovs.length === 0) { if (!quiet) setSayErr("Nothing in that sentence changes the home."); return false; }
    remember(`After "${sentence}":`);
    const add: Partial<HomeInputs> = {};
    for (const c of r.data.changes) (add as Record<string, unknown>)[c.field] = c.to;
    setChanged((c) => ({ ...c, ...add }));
    setChips((c) => [...c.filter((x) => !r.data.changes.some((y) => y.field === x.field)), ...r.data.changes]);
    setOvChips((c) => [...c.filter((x) => !ovs.some((y) => y.field === x.field)), ...ovs]);
    if (ovs.length) setOverrides((o) => { const n = { ...o }; for (const v of ovs) n[v.field] = v.to; return n; });
    // In the open card the offer variants are the second beat: bring them into view once the new design lands.
    if (seed) setTimeout(() => document.querySelector(".s-variants")?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" }), 1400);
    // Tell the homeowner's lead, so their phone shows the updated design.
    if (leadRef.current && r.data.changes.length) call("/api/intake/step", { lead_id: leadRef.current, facts_so_far: add }).then((x) => { if (!x.ok) setSayErr(`Applied here; the homeowner's copy did not update: ${x.error}`); });
    return true;
  }

  // A fact chip changed in the open card: same path as a sentence, and the lead hears it.
  function onFact(f: keyof HomeInputs, v: unknown, label: string) {
    remember(`${label} changed:`);
    setChanged((c) => ({ ...c, [f]: v, ...(f === "has_ev" && v === true && !inputs.ev_annual_km ? { ev_annual_km: 15000 } : {}) }));
    if (leadRef.current) call("/api/intake/step", { lead_id: leadRef.current, facts_so_far: { [f]: v } });
  }

  function onUnchip(c: InterpretChange | InterpretOverride) {
    remember("Change removed.");
    if ((c as InterpretOverride).field in COMPONENT_FIELD_SET) {
      const o = c as InterpretOverride;
      setOvChips((x) => x.filter((y) => y !== o));
      setOverrides((x) => { const n = { ...x }; if (o.from === undefined) delete n[o.field]; else n[o.field] = o.from; return n; });
    } else {
      const ch = c as InterpretChange;
      setChips((x) => x.filter((y) => y !== ch));
      setChanged((x) => { const n = { ...x } as Record<string, unknown>; delete n[ch.field]; return n as Partial<HomeInputs>; });
    }
  }

  const setOverride = useCallback((f: keyof Design, v: OverrideValue | undefined) => {
    setHistory((h) => [...h, { changed, overrides, chips, ovChips }]); cause.current = "Changed by hand:"; setApprovedAt(null);
    setOverrides((o) => { const n = { ...o }; if (v === undefined) delete n[f]; else n[f] = v; return n; });
  }, [changed, overrides, chips, ovChips]);

  function onUndo() {
    const h = history[history.length - 1];
    if (!h) return;
    setHistory(history.slice(0, -1)); cause.current = "Undone:"; setApprovedAt(null);
    setChanged(h.changed); setOverrides(h.overrides); setChips(h.chips); setOvChips(h.ovChips);
  }

  function onApprove() {
    if (!res) return;
    const at = new Date();
    try { sessionStorage.setItem("marquee.approved", JSON.stringify({ inputs: pref === "expert" ? inputs : { ...inputs, preference: pref }, draft: drafted?.design ?? null, approved: res.design, at: at.toISOString() })); } catch { /* storage blocked: the stage still works */ }
    setApprovedAt(at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }));
    if (leadRef.current) onApproved?.(leadRef.current);
  }

  const onVariant = useCallback((v: Variant) => {
    if (!v.overrides) return;
    setHistory((h) => [...h, { changed, overrides, chips, ovChips }]); cause.current = `Switched to ${v.name}:`; setApprovedAt(null);
    setOverrides(v.overrides);
  }, [changed, overrides, chips, ovChips]);
  const flag = res ? pickFlag(res) : null;

  if (seed && read) return (
    <div className="st b-card-in">
      <TopBar lead={lead} read={read} inputs={inputs} roof={roof} onFact={onFact} setInstaller={setInstaller}
        question={question ?? null} answer={answer} onAnswer={setAnswer} askError={askErr} asking={question === undefined} liveAsking={live?.asking ?? null}
        pref={pref} setPref={setPref} res={res} overrides={overrides} setOverride={setOverride}
        canUndo={history.length > 0} onUndo={onUndo} approvedAt={approvedAt} onApprove={onApprove} />
      {err && <div className="error" role="alert"><span><span className="src">Engine said</span>{err}</span><button className="btn ghost" onClick={() => setRetry((x) => x + 1)}>Retry</button></div>}
      {res && <Plan res={res} prev={prev} inputs={inputs} write={write} writeBusy={writeBusy} flag={flag} variants={variants} onVariant={onVariant} busy={busy} answered={answer != null} roofNote={roof?.pending ? "Measuring the roof from Bavarian 3D data, about 10 s" : read && !read.inputs.address ? "No street given, roof assumed standard face" : undefined} bare />}
      {res && <Refine res={res} llm={llm} busy={sayBusy} error={sayErr} onSay={onSay} chips={chips} ovChips={ovChips} onUnchip={onUnchip}
        moved={moved} canUndo={history.length > 0} onUndo={onUndo} approvedAt={approvedAt} onApprove={onApprove} overrides={overrides} setOverride={setOverride} bare />}
    </div>
  );

  return (
    <div className="st">
      <div className="s-stage">
        <Lead lead={lead} setLead={setLead} read={read} busy={readBusy} error={readErr} onRead={doRead} onEdit={() => setRead(null)}
          inputs={inputs} changed={changed} setInstaller={setInstaller} roof={roof}
          question={question ?? null} answer={answer} onAnswer={setAnswer} askError={askErr} pref={pref} setPref={setPref} asking={!!read && question === undefined}
          call={VOICE && !read && !seed ? <Calls installer={installer} onLead={onCall} /> : null} />
        <div className="s-main">
          {err && <div className="error" role="alert"><span><span className="src">Engine said</span>{err}</span><button className="btn ghost" onClick={() => setRetry((x) => x + 1)}>Retry</button></div>}
          {res && <Plan res={res} prev={prev} inputs={inputs} write={write} writeBusy={writeBusy} flag={flag} variants={variants} onVariant={onVariant} busy={busy} answered={answer != null} roofNote={roof?.pending ? "Measuring the roof from Bavarian 3D data, about 10 s" : read && !read.inputs.address ? "No street given, roof assumed standard face" : undefined} />}
          {res && <Refine res={res} llm={llm} busy={sayBusy} error={sayErr} onSay={onSay} chips={chips} ovChips={ovChips} onUnchip={onUnchip}
            moved={moved} canUndo={history.length > 0} onUndo={onUndo} approvedAt={approvedAt} onApprove={onApprove} overrides={overrides} setOverride={setOverride} />}
        </div>
      </div>
    </div>
  );
}
