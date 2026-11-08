"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Lead, { type Pref } from "@/components/stage/Lead";
import dynamic from "next/dynamic";
import type { CallLead } from "@/components/stage/Calls";
const Calls = dynamic(() => import("@/components/stage/Calls"), { ssr: false });
const VOICE = process.env.NEXT_PUBLIC_VOICE === "1";
import Plan, { type Variant } from "@/components/stage/Plan";
import Chain from "@/components/chain/Chain";
import Refine, { type Moved } from "@/components/stage/Refine";
import TopBar, { Decide } from "@/components/stage/TopBar";
import OpenSkeleton from "@/components/stage/Skeleton";
import type { Lead as LeadT, RoofResult, AskQuestion, AskResponse, Design, DesignResponse, HomeInputs, InstallerId, OverrideValue, Overrides, ReadResponse, RefineResponse } from "@/lib/api";
import { call, send } from "@/lib/client";
import { approveLead, matches, offerOf } from "@/lib/proposal";
import { HERO_LEAD } from "@/lib/demo";
import { DEFAULTS, KEYS, NAME, pickFlag, variantName } from "@/lib/stage";
import { COMPONENT_DESIGN_FIELD } from "@/lib/api";

const UNIT: Record<keyof Design, string> = { pv_kwp: "kWp", inverter_kw: "kW", battery_kwh: "kWh", heatpump_kw: "kW", wallbox_kw: "kW" };
type Snap = { changed: Partial<HomeInputs>; overrides: Overrides };

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// A house opened from the board: the lead's id (refinements write back to it) and what was read.
export type Seed = { leadId: string; read: ReadResponse; text?: string; draft?: DesignResponse | null; version?: number | null; approved?: LeadT["approved"]; overrides?: Overrides | null; phone?: string | null };   // draft: shown at once, before the first design call returns
// While Rina's call runs: the lead's facts so far, the step count, what the last answer changed and what she is asking.
export type Live = { version?: number | null; step: number; facts: Partial<HomeInputs>; changed: { component: string; why: string }[]; asking: string | null; via?: string; origin?: Record<string, "whatsapp"> };

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
  const [pvOnly, setPvOnly] = useState<RefineResponse | null>(null);
  const [pref, setPref] = useState<Pref>("expert");
  const last = useRef<DesignResponse | null>(null);
  const cause = useRef<string | null>(null);
  // An edit puts the numbers in a pending state at once; they settle when the engine answers.
  // The lead's phone (E.164): not a design input, so it never joins the facts the design runs on.
  const [phone, setPhone] = useState<string | null>(seed?.phone ?? null);
  useEffect(() => { setPhone(seed?.phone ?? null); }, [seed?.leadId, seed?.phone]);
  async function onPhone(v: string) {
    const was = phone; setPhone(v);
    const x = await writeLead("phone-edit", { phone: v } as unknown as Partial<HomeInputs>);
    if (!x.ok) { setPhone(was); if (x.error) setAskErr(`The phone number was not saved: ${x.error}`); }
  }
  const [pending, setPending] = useState<number | null>(null);
  // A design call past about 3 s is a roof being fetched, not a failure: say so quietly instead of showing an error.
  const [slow, setSlow] = useState(false);
  const [resIn, setResIn] = useState<HomeInputs | null>(null);   // the facts the design on screen was drawn from
  const [resCause, setResCause] = useState<string | null>(null);
  // The homeowner's lead when the stage was opened from a call: refinements write back to it.
  const leadRef = useRef<string | null>(null);
  const [moved, setMoved] = useState<Moved | null>(null);
  const [history, setHistory] = useState<Snap[]>([]);
  const [approvedAt, setApprovedAt] = useState<string | null>(null);

  const inputs: HomeInputs = useMemo(() => {
    const base: HomeInputs = { ...DEFAULTS, ...(read?.inputs ?? {}), installer_id: installer };
    if (question && answer !== undefined) (base as unknown as Record<string, unknown>)[question.field] = answer;
    const out: HomeInputs = { ...base, ...changed };
    // With a street address every call carries it, so design, variants and layers come from the same engine run as
    // the lead's own draft (the roof result alone drops the module layout and its variants). Postcode only: the roof result.
    if (!out.address && roof && roof.source !== "none" && !roof.pending) out.roof = roof;
    return out;
  }, [read, installer, question, answer, changed, roof]);
  // The open card designs at once: an unanswered question uses the engine's default for that fact, so a hand change
  // never waits on it (it used to: edits on a card with an open question only moved the layers numbers).
  const ready = !!read && question !== undefined && (!!seed || question === null || answer !== undefined);
  // Writes to the lead happen only on an explicit action (an answer tap, Apply, a fact chip, Listening, Approve), never
  // from an effect or a view change. Each carries the lead version the card was showing; a 409 means the lead changed
  // elsewhere, and the board reloads it.
  const baseVersion = useRef<number | null>(seed?.version ?? null);
  async function writeLead(route: string, facts: Partial<HomeInputs>): Promise<{ ok: boolean; error?: string }> {
    const id = leadRef.current;
    if (!id) return { ok: true };
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return { ok: false, error: "The tab is hidden; nothing was sent." };
    const r = await send<{ version?: number }>("/api/intake/step", { lead_id: id, facts_so_far: facts, ...(baseVersion.current != null ? { base_version: baseVersion.current } : {}) }, route);
    if (r.status === 409) { stale(id); return { ok: false }; }
    if (r.ok && r.data?.version != null) baseVersion.current = r.data.version;
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  }
  // A kit choice (chooser, undo; never an offer tab) is written to the lead at once, so a reload and Approve see the same design.
  async function writeKit(route: string, kit: Overrides) {
    const id = leadRef.current;
    if (!id) return;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    const r = await send<{ version?: number }>("/api/intake/step", { lead_id: id, overrides: kit, ...(baseVersion.current != null ? { base_version: baseVersion.current } : {}) }, route);
    if (r.status === 409) { stale(id); return; }
    if (r.ok && r.data?.version != null) baseVersion.current = r.data.version;
    if (!r.ok) setErr(`The change was not saved: ${r.error}`);
  }
  const stale = (id: string) => window.dispatchEvent(new CustomEvent("marquee:lead-stale", { detail: id }));
  const onAnswer = (v: unknown) => {
    setAnswer(v);
    if (question && v !== undefined) void writeLead("question-answer", { [question.field]: v } as Partial<HomeInputs>);
  };

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
    begin(seed.read, seed.leadId, seed.draft ?? null, seed.approved ?? null, seed.overrides ?? null);
  }, [seed?.leadId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Each answer from the call: the facts move, the design reruns, and what moved carries the engine's why.
  const liveWhy = useRef<{ component: string; why: string }[] | null>(null);
  const liveSeen = useRef(false);
  useEffect(() => {
    if (!live || !read) return;
    // A call that already ended is part of the lead as it opens: its facts apply quietly (no redraft stamp, no
    // moved stages, the card still lands on Offer). Only answers arriving while the card is open redraft in place.
    const replay = !liveSeen.current && live.asking == null;
    liveSeen.current = true;
    if (live.version != null) baseVersion.current = live.version;
    const { installer_id: _i, ...facts } = live.facts as Partial<HomeInputs> & { installer_id?: string }; void _i;
    // Facts a WhatsApp reply stated carry that origin, so their chips can say so.
    const tagged = Object.entries(live.origin ?? {}).filter(([k, v]) => read.origin?.[k] !== v);
    if (Object.entries(facts).every(([k, v]) => JSON.stringify((read.inputs as Record<string, unknown>)[k]) === JSON.stringify(v))) {
      if (tagged.length) setRead((r) => r && { ...r, origin: { ...r.origin, ...live.origin } });
      return;
    }
    cause.current = replay ? null : live.via ?? "From the call:"; liveWhy.current = replay ? null : live.changed;
    setRead((r) => r && { ...r, inputs: { ...r.inputs, ...facts }, ...(tagged.length ? { origin: { ...r.origin, ...live.origin } } : {}) });
  }, [live?.step]); // eslint-disable-line react-hooks/exhaustive-deps

  async function begin(data: ReadResponse, leadId?: string, draft: DesignResponse | null = null, approved: LeadT["approved"] = null, kit: Overrides | null = null) {
    if (leadId) leadRef.current = leadId; else if (data.source !== "call") leadRef.current = null;
    const r = { data };
    setQuestion(undefined); setAnswer(undefined); setChanged({}); setOverrides({}); setRes(draft); setPrev(null); last.current = draft;
    setHistory([]); setMoved(null); setApprovedAt(null);
    setRead(r.data); setRoof(null);
    // An approved lead opens on what was approved: the same sizes and price as the homeowner's proposal.
    if (approved?.design && draft) {
      const d = approved.design;
      setOverrides(approved.overrides && Object.keys(approved.overrides).length ? approved.overrides : { pv_kwp: d.pv_kwp, battery_kwh: d.battery_kwh, wallbox_kw: d.wallbox_kw, heatpump_kw: d.heatpump_kw });
      const shown = { ...draft, design: d, economics: approved.economics ?? { ...draft.economics, capex_eur: approved.investment_eur } };
      setRes(shown); last.current = shown;
    } else if (kit && Object.keys(kit).length) setOverrides(kit);   // the planner's kit edits, as the lead stores them
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

  useEffect(() => {
    if (!busy) { setSlow(false); return; }
    const t = setTimeout(() => setSlow(true), 3000);
    return () => clearTimeout(t);
  }, [busy]);

  // Every design the card has seen, keyed by the facts and the fixed sizes (not the lead version: a kit write bumps the
  // version without changing any variant). A variant tab whose design is here switches at once, with no pending state.
  const designs = useRef(new Map<string, DesignResponse | RefineResponse>());
  const keyOf = (i: HomeInputs, o: Overrides) => JSON.stringify([i, Object.fromEntries(Object.entries(o).sort(([x], [y]) => x.localeCompare(y)))]);
  const keep = (k: string, r: DesignResponse | RefineResponse) => { const m = designs.current; m.delete(k); m.set(k, r); if (m.size > 32) m.delete(m.keys().next().value!); };

  // Design, or refine when the planner has fixed something.
  useEffect(() => {
    if (!ready) return;
    const ctl = new AbortController();
    const asked = inputs, why = cause.current, fixed = Object.keys(overrides).length > 0;
    const k = keyOf(inputs, overrides);
    const hit = designs.current.get(k);
    if (hit) { land({ ok: true, data: hit }, asked, why, fixed, null); return; }
    if (cause.current) setPending((p) => p ?? Date.now());
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const lid = leadRef.current;
        const r = fixed ? await call<RefineResponse>("/api/refine", { inputs, overrides, ...(lid && baseVersion.current != null ? { lead_id: lid, base_version: baseVersion.current } : {}) }, ctl.signal) : await call<DesignResponse>("/api/design", { inputs }, ctl.signal);
        if (r.ok) keep(k, r.data);
        land(r, asked, why, fixed, lid);
        setBusy(false);
      } catch { /* superseded */ }
    }, why?.startsWith("Changed by hand") ? 250 : 0);   // typed sizes wait 250 ms for the next key; taps go at once
    return () => { clearTimeout(t); ctl.abort(); };
  }, [ready, inputs, overrides, retry]); // eslint-disable-line react-hooks/exhaustive-deps

  // Each offer of the agent's draft is fetched once in the background after the draft lands, so a tab switch reads
  // from memory. Runs one request at a time and stops when the facts change.
  // A lead that opens on stored kit edits starts from a refine, so the plain draft is fetched here first.
  useEffect(() => {
    if (!ready) return;
    const ctl = new AbortController(), i = inputs;
    const t = setTimeout(async () => {
      let base: DesignResponse | null = drafted;
      if (!base) {
        const k0 = keyOf(i, {});
        base = (designs.current.get(k0) as DesignResponse | undefined) ?? null;
        if (!base) {
          try { const r = await call<DesignResponse>("/api/design", { inputs: i }, ctl.signal); if (!r.ok) return; keep(k0, r.data); base = r.data; } catch { return; }
        }
        if (ctl.signal.aborted) return;
        setDrafted(base);
      }
      for (const v of base.variants ?? []) {
        if (ctl.signal.aborted) return;
        const o: Overrides = v.key === "expert" ? {} : { pv_kwp: v.design.pv_kwp, battery_kwh: v.design.battery_kwh, wallbox_kw: v.design.wallbox_kw, heatpump_kw: v.design.heatpump_kw };
        const k = keyOf(i, o);
        if (designs.current.has(k)) continue;
        try {
          const r = Object.keys(o).length ? await call<RefineResponse>("/api/refine", { inputs: i, overrides: o }, ctl.signal) : await call<DesignResponse>("/api/design", { inputs: i }, ctl.signal);
          if (r.ok) keep(k, r.data);
        } catch { return; }
      }
    }, 300);   // after first paint
    return () => { clearTimeout(t); ctl.abort(); };
  }, [ready, drafted === null, inputs]); // eslint-disable-line react-hooks/exhaustive-deps

  // One path for a design that arrived, from the engine or from memory.
  function land(r: { ok: true; data: DesignResponse | RefineResponse } | { ok: false; error: string; status?: number }, asked: HomeInputs, why: string | null, fixed: boolean, lid: string | null) {
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
          setPrev(before); last.current = r.data; setRes(r.data); setResIn(asked); setResCause(why); setErr(null); setPending(null);
          if (!fixed) setDrafted(r.data);
        } else if (r.status === 409 && lid && fixed) stale(lid); else { setErr(r.error); setPending(null); }
  }

  useEffect(() => {
    if (!err?.includes("restarting")) return;
    const t = setTimeout(() => setRetry((x) => x + 1), 8000);
    return () => clearTimeout(t);
  }, [err, retry]);

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
    // The variants of the design on screen: refine returns them for the current facts and overrides (an EV sentence's
    // wallbox included), so the agent's earlier draft is only the fallback for an engine that sends none.
    const ev = res.variants ?? drafted?.variants;
    if (ev?.length) {
      const order = [...ev].sort((a, b) => (b.key === pref ? 1 : 0) - (a.key === pref ? 1 : 0));
      // After a sentence or a hand change the design on screen may match none of the offers: list it first as Current.
      const cur: Variant[] = order.some((v) => same(v.design, res.design)) ? [] : [{ name: "Current", tag: "Current", design: res.design, e: res.economics, note: "", current: true, overrides: null }];
      // An offer identical to an earlier row (Best value is often the planners' design) folds into that row as a tag.
      const rows: Variant[] = [...cur, ...order.map((v, n) => {
        const [name, how] = v.label.split(" (");
        return { name, tag: n === 0 ? "Preferred" : v.key === "expert" ? (how ? how.replace(/\)$/, "").replace(/^./, (c) => c.toUpperCase()).replace(" here ", " ") : "As planners design it") : "",
          design: v.design, e: v.economics, note: v.key === "expert" ? "" : v.note, current: same(v.design, res.design),
          overrides: v.key === "expert" ? {} : { pv_kwp: v.design.pv_kwp, battery_kwh: v.design.battery_kwh, wallbox_kw: v.design.wallbox_kw, heatpump_kw: v.design.heatpump_kw } };
      })];
      const out: Variant[] = [];
      rows.forEach((v) => {
        const twin = out.find((w) => same(w.design, v.design));
        if (twin) twin.also = [...(twin.also ?? []), v.name];
        else out.push({ ...v });
      });
      return out;
    }
    const fixed = Object.keys(overrides).length > 0;
    const out: Variant[] = [{ name: variantName(res.design), tag: fixed ? "Chosen" : "", design: res.design, e: res.economics, overrides: null, current: true }];
    if (fixed && drafted && !same(drafted.design, res.design)) out.push({ name: variantName(drafted.design, res.design), tag: "Agent's draft", design: drafted.design, e: drafted.economics, overrides: {}, current: false });
    const o = res.optimum;
    if (o && !same(o.design, res.design)) out.push({ name: variantName(o.design, res.design), tag: "Earns most", design: o.design, e: o.economics, overrides: { ...overrides, pv_kwp: o.design.pv_kwp, battery_kwh: o.design.battery_kwh }, current: false });
    if (res.design.battery_kwh != null) out.push({ name: "PV only", tag: "Cheapest", design: pvOnly?.design ?? { ...res.design, battery_kwh: null }, e: pvOnly?.economics ?? null, overrides: { ...overrides, battery_kwh: null }, current: false });
    return out.filter((v, k) => out.findIndex((w) => w.name === v.name) === k);
  }, [res, drafted, pvOnly, overrides, pref]);

  // The card header's verdict follows the design on screen: after a kit change, an override or a fact edit it is read again from it.
  useEffect(() => {
    if (!res || !resIn || !leadRef.current) return;
    dispatchEvent(new CustomEvent("marquee:card-design", { detail: { leadId: leadRef.current, res, changed } }));
  }, [res]); // eslint-disable-line react-hooks/exhaustive-deps

  const snap = (): Snap => ({ changed, overrides });
  const remember = (why: string) => { setHistory((h) => [...h, snap()]); cause.current = why; setApprovedAt(null); };

  // A fact chip changed in the open card: same path as a sentence, and the lead hears it.
  function onFact(f: keyof HomeInputs, v: unknown, label: string) {
    remember(`${label} changed:`);
    setChanged((c) => ({ ...c, [f]: v, ...(f === "has_ev" && v === true && !inputs.ev_annual_km ? { ev_annual_km: 15000 } : {}) }));
    void writeLead("hand-change", { [f]: v, ...(f === "has_ev" && v === true && !inputs.ev_annual_km ? { ev_annual_km: 15000 } : {}) } as Partial<HomeInputs>);
  }

  const setOverride = useCallback((f: keyof Design, v: OverrideValue | undefined) => {
    setHistory((h) => [...h, { changed, overrides }]); cause.current = "Changed by hand:"; setApprovedAt(null);
    const n = { ...overrides }; if (v === undefined) delete n[f]; else n[f] = v;
    setOverrides(n); void writeKit("kit-edit", n);
  }, [changed, overrides]); // eslint-disable-line react-hooks/exhaustive-deps

  function onUndo() {
    const h = history[history.length - 1];
    if (!h) return;
    setHistory(history.slice(0, -1)); cause.current = "Undone:"; setApprovedAt(null);
    setChanged(h.changed); setOverrides(h.overrides);
    if (JSON.stringify(h.overrides) !== JSON.stringify(overrides)) void writeKit("kit-undo", h.overrides);
    // The lead hears the undo too, so a reload shows what the screen shows: each fact the undone step moved goes back
    // to its earlier value (the earlier change, else the lead's own fact or the default).
    const base: Record<string, unknown> = { ...DEFAULTS, ...(read?.inputs ?? {}) };
    if (question && answer !== undefined) base[question.field] = answer;
    const now = changed as Record<string, unknown>, was = h.changed as Record<string, unknown>, back: Record<string, unknown> = {};
    for (const k of new Set([...Object.keys(now), ...Object.keys(was)])) {
      if (now[k] === was[k]) continue;
      const v = k in was ? was[k] : base[k];
      if (v !== undefined && v !== null) back[k] = v;
    }
    const id = leadRef.current;
    if (id && Object.keys(back).length) void writeLead("undo", back as Partial<HomeInputs>).then(async (x) => {
      if (!x.ok) { if (x.error) setErr(`Undone here; the lead did not update: ${x.error}`); return; }
      // The facts on screen come from the engine, not from the local snapshot: read the lead again and redraw from it.
      const r = await call<LeadT>(`/api/leads/${id}`);
      if (!r.ok) { setErr(`Undone, but the lead could not be read back: ${r.error}`); return; }
      if (leadRef.current !== id) return;
      if (r.data.version != null) baseVersion.current = r.data.version;
      const facts = r.data.facts as unknown as Record<string, unknown>;
      cause.current = "Undone:";
      setRead((cur) => cur && { ...cur, inputs: { ...cur.inputs, ...Object.fromEntries(Object.entries(facts).filter(([k, v]) => v !== null && v !== undefined && k !== "installer_id")) } as HomeInputs });
      setChanged({});
    });
  }

  // Approve releases exactly the design on screen (engine v2.11). A marked offer goes as its key with the lead's own
  // design_hash for it; anything else goes as "edit" with the design and the overrides, which the engine re-runs and
  // stores. The lead is read again afterwards and Approved shows only when the stored approval equals the screen.
  const MISMATCH = "Approval did not match the design on screen, try again";
  async function onApprove(want?: unknown): Promise<string | null> {
    if (!res) return null;
    const at = new Date();
    try { sessionStorage.setItem("marquee.approved", JSON.stringify({ lead_id: leadRef.current, inputs: pref === "expert" ? inputs : { ...inputs, preference: pref }, draft: drafted?.design ?? null, approved: res.design, at: at.toISOString() })); } catch { /* storage blocked: the stage still works */ }
    const done = () => { setApprovedAt(at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })); if (leadRef.current) onApproved?.(leadRef.current); };
    const id = leadRef.current;
    if (!id) { done(); return null; }
    const screen = { design: res.design, capex: res.economics.capex_eur };
    const before = await call<LeadT>(`/api/leads/${encodeURIComponent(id)}`);
    if (!before.ok) return before.error;
    const offer = offerOf(before.data, screen, typeof want === "string" ? want : null);
    const body = offer ? { variant: offer.key, design_hash: offer.hash } : { variant: "edit" as const, design: res.design, overrides };
    const r = await approveLead(id, body, before.data.version ?? baseVersion.current);
    if (!r.ok) { if (r.status === 409) stale(id); return r.status === 409 ? `${MISMATCH} (${r.error})` : r.error; }
    const v = (r.data as { version?: number }).version; if (v != null) baseVersion.current = v;
    const after = await call<LeadT>(`/api/leads/${encodeURIComponent(id)}`);
    if (!after.ok) return after.error;
    if (after.data.version != null) baseVersion.current = after.data.version;
    const got = after.data.approved;
    if (after.data.status !== "approved" || !got || !matches({ design: got.design, capex: got.investment_eur }, screen)) return MISMATCH;
    setErr(null); done(); return null;
  }

  const onVariant = useCallback((v: Variant) => {
    if (!v.overrides) return;
    setHistory((h) => [...h, { changed, overrides }]); cause.current = `Switched to ${v.name}:`; setApprovedAt(null);
    setOverrides(v.overrides);   // a tab is a view: nothing is written to the lead (the chooser, Undo and Approve write)
  }, [changed, overrides]); // eslint-disable-line react-hooks/exhaustive-deps
  const openRef = useRef<HTMLDivElement>(null);
  const flag = res ? pickFlag(res) : null;

  if (seed && read) return (
    <div className="st st-open b-card-in" ref={openRef}>
      <TopBar lead={lead} read={read} inputs={inputs} roof={roof} onFact={onFact} phone={phone} onPhone={seed ? onPhone : undefined} setInstaller={setInstaller}
        question={question ?? null} answer={answer} onAnswer={onAnswer} askError={askErr} asking={question === undefined} liveAsking={live?.asking ?? null}
        pref={pref} setPref={setPref} res={res} overrides={overrides} setOverride={setOverride}
        canUndo={history.length > 0} onUndo={onUndo} approvedAt={approvedAt} onApprove={onApprove} noDecide />
      {err && <div className="error" role="alert"><span><span className="src">Engine said</span>{err}</span><button className="btn ghost" onClick={() => setRetry((x) => x + 1)}>Retry</button></div>}
      {slow && !roof?.pending && !err && <p className="s-roof" role="status">Measuring the roof</p>}
      {roof?.pending && <p className="s-roof">Measuring the roof from Bavarian 3D data, about 10 s</p>}
      {!res && <OpenSkeleton />}
      {res && <Chain res={res} prev={prev} inputs={resIn ?? inputs} pending={pending} cause={resCause} leadId={leadRef.current} variants={variants} onVariant={onVariant} canUndo={history.length > 0} onUndo={onUndo} answered={answer != null} redraft={moved}
        decide={<Decide slim pref={pref} setPref={setPref} res={res} overrides={overrides} setOverride={setOverride} canUndo={history.length > 0} onUndo={onUndo} approvedAt={approvedAt} onApprove={onApprove} />} />}
    </div>
  );

  return (
    <div className="st">
      <div className="s-stage">
        <Lead lead={lead} setLead={setLead} read={read} busy={readBusy} error={readErr} onRead={doRead} onEdit={() => setRead(null)}
          inputs={inputs} changed={changed} setInstaller={setInstaller} roof={roof}
          question={question ?? null} answer={answer} onAnswer={onAnswer} askError={askErr} pref={pref} setPref={setPref} asking={!!read && question === undefined}
          call={VOICE && !read && !seed ? <Calls installer={installer} onLead={onCall} /> : null} />
        <div className="s-main">
          {err && <div className="error" role="alert"><span><span className="src">Engine said</span>{err}</span><button className="btn ghost" onClick={() => setRetry((x) => x + 1)}>Retry</button></div>}
          {res && <Plan res={res} prev={prev} inputs={inputs} write={null} writeBusy={false} flag={flag} variants={variants} onVariant={onVariant} busy={busy} answered={answer != null} roofNote={roof?.pending ? "Measuring the roof from Bavarian 3D data, about 10 s" : read && !read.inputs.address ? "No street given, roof assumed standard face" : undefined} />}
          {res && <Refine res={res} moved={moved} canUndo={history.length > 0} onUndo={onUndo} approvedAt={approvedAt} onApprove={onApprove} overrides={overrides} setOverride={setOverride} />}
        </div>
      </div>
    </div>
  );
}
