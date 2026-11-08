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
import WhatsAppClient from "@/components/whatsapp/WhatsAppClient";
import OpenSkeleton from "@/components/stage/Skeleton";
import type { Lead as LeadT, RoofResult, AskQuestion, AskResponse, Design, DesignResponse, HomeInputs, InstallerId, OverrideValue, Overrides, ReadResponse, RefineResponse } from "@/lib/api";
import { call, send } from "@/lib/client";
import { serialWrite } from "@/lib/leadQueue";
import { pushEdit, registerUndo, undoLast, useCanUndo } from "@/lib/edits";
import { designOf, refineOf, seedDesign } from "@/lib/engineCache";
import { breakEvenNote } from "@/lib/notes";
import { approveLead, matches, offerOf } from "@/lib/proposal";
import { HERO_LEAD } from "@/lib/demo";
import { DEFAULTS, KEYS, NAME, pickFlag, variantName } from "@/lib/stage";
import { COMPONENT_DESIGN_FIELD } from "@/lib/api";
import { berlinTime } from "@/lib/time";

const UNIT: Record<keyof Design, string> = { pv_kwp: "kWp", inverter_kw: "kW", battery_kwh: "kWh", heatpump_kw: "kW", wallbox_kw: "kW" };
type Snap = { changed: Partial<HomeInputs>; overrides: Overrides };

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

// A house opened from the board: the lead's id (refinements write back to it) and what was read.
export type Seed = { leadId: string; read: ReadResponse; text?: string; draft?: DesignResponse | null; version?: number | null; approved?: LeadT["approved"]; overrides?: Overrides | null; phone?: string | null; sources?: Record<string, string> };   // draft: shown at once, before the first design call returns
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
  // One write at a time per lead (lib/leadQueue): each takes the version the previous answer returned. A 409 re-reads the version
  // once and sends the write again; only a second 409 means the lead really changed elsewhere.
  function step(id: string, body: Record<string, unknown>, route: string, key: string) {
    return serialWrite(id, key, async () => {
      const go = () => send<{ version?: number }>("/api/intake/step", { lead_id: id, ...body, ...(baseVersion.current != null ? { base_version: baseVersion.current } : {}) }, route);
      let r = await go();
      if (r.status === 409) {
        const g = await call<LeadT>(`/api/leads/${id}`);
        if (g.ok && g.data.version != null) { baseVersion.current = g.data.version; r = await go(); }
      }
      if (r.ok && r.data?.version != null) baseVersion.current = r.data.version;
      return r;
    });
  }
  async function writeLead(route: string, facts: Partial<HomeInputs>): Promise<{ ok: boolean; error?: string }> {
    const id = leadRef.current;
    if (!id) return { ok: true };
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return { ok: false, error: "The tab is hidden; nothing was sent." };
    const r = await step(id, { facts_so_far: facts }, route, `facts:${Object.keys(facts).sort().join(",")}`);
    if (r.status === 409) { stale(id); return { ok: false }; }
    return r.ok ? { ok: true } : { ok: false, error: r.error };
  }
  // A kit choice (chooser, undo; never an offer tab) is written to the lead at once, so a reload and Approve see the same design.
  const persisted = useRef<Overrides>({});   // the kit edits as the lead stores them (set on open and on each write)
  async function writeKit(route: string, kit: Overrides) {
    const id = leadRef.current;
    if (!id) return;
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    const r = await step(id, { overrides: kit }, route, "kit");
    if (r.status === 409) { stale(id); return; }
    if (r.ok) persisted.current = kit;
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
    frozen.current = false; frozenAt.current = null;
    seedDraft.current = draft;   // the lead's stored draft answers the first design read (no call on open)
    const r = { data };
    setQuestion(undefined); setAnswer(undefined); setChanged({}); setOverrides({}); setRes(draft); setPrev(null); last.current = draft;
    setHistory([]); setMoved(null); setApprovedAt(null);
    setRead(r.data); setRoof(null);
    // An approved lead opens on what was approved: the same sizes and price as the homeowner's proposal.
    if (approved?.design && draft) {
      const d = approved.design;
      setOverrides(approved.overrides && Object.keys(approved.overrides).length ? approved.overrides : { pv_kwp: d.pv_kwp, battery_kwh: d.battery_kwh, wallbox_kw: d.wallbox_kw, heatpump_kw: d.heatpump_kw });
      // The frozen proposal, priced from its own figures (no live rates): the homeowner's page shows the same.
      const shown = { ...draft, rates: undefined, frozen: true, design: d, economics: approved.economics ?? { ...draft.economics, capex_eur: approved.investment_eur } };
      frozen.current = true;
      setRes(shown); last.current = shown;
    } else if (kit && Object.keys(kit).length) setOverrides(kit);   // the planner's kit edits, as the lead stores them
    persisted.current = !approved?.design && kit ? kit : {};
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
  const seedDraft = useRef<DesignResponse | null>(null);
  const frozen = useRef(false);   // a Complete lead opened as approved: no re-run until the planner changes something
  const frozenAt = useRef<string | null>(null);   // the facts and sizes it was frozen at
  const keyOf = (i: HomeInputs, o: Overrides) => JSON.stringify([i, Object.fromEntries(Object.entries(o).sort(([x], [y]) => x.localeCompare(y)))]);
  const keep = (k: string, r: DesignResponse | RefineResponse) => { const m = designs.current; m.delete(k); m.set(k, r); if (m.size > 32) m.delete(m.keys().next().value!); };

  // Design, or refine when the planner has fixed something.
  useEffect(() => {
    if (!ready) return;
    const ctl = new AbortController();
    const asked = inputs, why = cause.current, fixed = Object.keys(overrides).length > 0;
    const k = keyOf(inputs, overrides);
    // A Complete lead shows the proposal as it was approved and sent; the engine is asked again only after an edit.
    // It stays frozen only while the facts and the fixed sizes are exactly what the card opened with: any override write,
    // refine, size row, chooser or Apply moves them and unfreezes it to the live refine.
    if (frozen.current) {
      if (frozenAt.current == null) frozenAt.current = k;
      if (frozenAt.current === k && !cause.current) return;
    }
    frozen.current = false; frozenAt.current = null;
    const hit = designs.current.get(k);
    if (hit) { land({ ok: true, data: hit }, asked, why, fixed, null); return; }
    // A lead that opens on stored kit edits: its first figures come from the refine, so they shimmer until it lands
    // (a lead without overrides shows its design at once, those figures are final).
    if (cause.current || fixed) setPending((p) => p ?? Date.now());
    // A stored draft from before the engine named products (no skus) is read again once, so the rows can name them.
    // Only a full draft answers the design read: a slim one (the board list sends drafts without derivations) stays on
    // screen until the one design call brings the rule results the popovers show.
    if (seedDraft.current) { const sd = seedDraft.current as DesignResponse; if ("skus" in sd && sd.components?.pv?.derivation) seedDesign(inputs, sd); seedDraft.current = null; }   // the plain draft for these facts, also when opening on kit edits
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const lid = leadRef.current;
        const refine = () => call<RefineResponse>("/api/refine", { inputs, overrides, ...(lid && baseVersion.current != null ? { lead_id: lid, base_version: baseVersion.current } : {}) }, ctl.signal);
        // Opening on stored kit edits reads them like the board does (no lead id, one shared call); a refine that carries
        // the lead id and its version follows an actual edit only.
        // A kit edit (a tap on the model, the chooser) prices at once: its refine is one light call outside the lead's
        // write queue (on the engine a lead id only adds a staleness check, it stores nothing); the lead write that
        // persists the edit runs in the queue beside it, so the price no longer waits for it.
        const kitEdit = !!why?.startsWith("Changed by hand");
        const r = fixed ? await (lid && why && !kitEdit ? serialWrite(lid, "refine", async () => { let x = await refine(); if (!x.ok && x.status === 409) { const g = await call<LeadT>(`/api/leads/${lid}`); if (g.ok && g.data.version != null) { baseVersion.current = g.data.version; x = await refine(); } } return x; }) : refineOf(inputs, overrides, ctl.signal)) : await designOf(inputs, ctl.signal);
        if (r.ok) keep(k, r.data);
        land(r, asked, why, fixed, lid);
        setBusy(false);
      } catch { /* superseded */ }
    }, why?.startsWith("Changed by hand") ? 250 : 0);   // typed sizes wait 250 ms for the next key; taps go at once
    return () => { clearTimeout(t); ctl.abort(); };
  }, [ready, inputs, overrides, retry]); // eslint-disable-line react-hooks/exhaustive-deps

  // Each offer of the agent's draft is held in memory once the draft lands, so a tab switch never calls the engine.
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
          try { const r = await designOf(i, ctl.signal); if (!r.ok) return; keep(k0, r.data); base = r.data; } catch { return; }
        }
        if (ctl.signal.aborted) return;
        setDrafted(base);
      }
      // The engine sends every offer complete (design, economics, hash) inside the draft: each tab is built from it here,
      // with no call. Its layout, when the engine sends one (variant.layout), rides along; until then the layers grid lays it out.
      for (const v of base.variants ?? []) {
        const o: Overrides = v.key === "expert" ? {} : { pv_kwp: v.design.pv_kwp, battery_kwh: v.design.battery_kwh, wallbox_kw: v.design.wallbox_kw, heatpump_kw: v.design.heatpump_kw };
        const k = keyOf(i, o);
        if (designs.current.has(k)) continue;
        keep(k, v.key === "expert" ? base : { ...base, design: v.design, economics: v.economics, ...("layout" in v ? { layout: (v as { layout?: unknown }).layout } : {}), skus: (v as { skus?: unknown }).skus ?? sameSize((base as { skus?: Record<string, { size?: number; unit?: string }> }).skus, v.design) } as DesignResponse);
      }
    }, 300);   // after first paint
    return () => { clearTimeout(t); ctl.abort(); };
  }, [ready, drafted === null, inputs]); // eslint-disable-line react-hooks/exhaustive-deps

  // The draft's products that fit a variant's sizes (a variant without its own skus keeps only those).
  const sameSize = (skus: Record<string, { size?: number; unit?: string }> | undefined, d: Design) => {
    if (!skus) return undefined;
    const want: Record<string, number | null | undefined> = { inverter: d.inverter_kw, battery: d.battery_kwh, wallbox: d.wallbox_kw, heatpump: d.heatpump_kw };
    return Object.fromEntries(Object.entries(skus).filter(([k, s]) => k === "module" ? !!d.pv_kwp : want[k] != null && s.size === want[k]));
  };
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
          // A refine answers without derivations; the rule's own result depends on the facts, not on kit edits, so the
          // last design that carried them lends them (the popovers lead with the rule result, then the catalogue snap).
          const src = [before, drafted].find((x) => x?.components?.pv?.derivation);
          let data = r.data;
          if (src && data.components && !data.components.pv?.derivation) {
            const comps = { ...data.components } as DesignResponse["components"];
            (Object.keys(comps) as (keyof typeof comps)[]).forEach((k) => { if (comps[k] && !comps[k].derivation && src.components[k]?.derivation) comps[k] = { ...comps[k], derivation: src.components[k].derivation }; });
            data = { ...data, components: comps };
          }
          setPrev(before); last.current = data; setRes(data); setResIn(asked); setResCause(why); setErr(null); setPending(null);
          if (!fixed) setDrafted(data);
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
    refineOf(inputs, { ...overrides, battery_kwh: null }, ctl.signal)
      .then((r) => { if (r.ok) setPvOnly(r.data); }).catch(() => {});
    return () => ctl.abort();
  }, [res]); // eslint-disable-line react-hooks/exhaustive-deps

  const variants: Variant[] = useMemo(() => {
    if (!res) return [];
    // Engine v1.7: four offers the homeowner can choose between; the preference only reorders them.
    // The variants of the design on screen: refine returns them for the current facts and overrides (an EV sentence's
    // wallbox included), so the agent's earlier draft is only the fallback for an engine that sends none.
    // An offer still loading can come without its design: only offers with one are listed.
    const ev = (res.variants ?? drafted?.variants)?.filter((v) => !!v?.design);
    if (ev?.length) {
      const order = [...ev].sort((a, b) => (b.key === pref ? 1 : 0) - (a.key === pref ? 1 : 0));
      // After a sentence or a hand change the design on screen may match none of the offers: list it first as Current.
      const cur: Variant[] = order.some((v) => same(v.design, res.design)) ? [] : [{ name: "Current", tag: "Current", design: res.design, e: res.economics, note: "", current: true, overrides: null }];
      // An offer identical to an earlier row (Best value is often the planners' design) folds into that row as a tag.
      const rows: Variant[] = [...cur, ...order.map((v, n) => {
        const [name, how] = v.label.split(" (");
        return { name, tag: n === 0 ? "Preferred" : v.key === "expert" ? (how ? how.replace(/\)$/, "").replace(/^./, (c) => c.toUpperCase()).replace(" here ", " ") : "As planners design it") : "",
          design: v.design, e: v.economics, note: v.key === "expert" ? "" : breakEvenNote(v.note, v, ev), current: same(v.design, res.design),
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
    setChanged((c) => ({ ...c, [f]: v, ...(f === "has_ev" && v === true && !inputs.ev_annual_km ? { ev_annual_km: 12000 } : {}) }));
    void writeLead("hand-change", { [f]: v, ...(f === "has_ev" && v === true && !inputs.ev_annual_km ? { ev_annual_km: 12000 } : {}) } as Partial<HomeInputs>);
  }

  // Several kit fields as one edit (one history step, one lead write): the on-model layout sends pv_kwp with
  // layout_slots, the chosen slot ids the engine stores as they are.
  const setKit = useCallback((patch: Record<string, OverrideValue | string[] | undefined>) => {
    frozen.current = false; frozenAt.current = null;   // an edit always shows the live design
    if (leadRef.current) pushEdit(leadRef.current, overrides as Record<string, unknown>);
    cause.current = "Changed by hand:"; setApprovedAt(null);
    const n: Record<string, unknown> = { ...overrides };
    Object.entries(patch).forEach(([k, v]) => { if (v === undefined) delete n[k]; else n[k] = v; });
    setOverrides(n as Overrides); void writeKit("kit-edit", n as Overrides);
  }, [changed, overrides]); // eslint-disable-line react-hooks/exhaustive-deps
  const setOverride = useCallback((f: keyof Design, v: OverrideValue | undefined) => {
    frozen.current = false; frozenAt.current = null;   // an edit always shows the live design
    if (leadRef.current) pushEdit(leadRef.current, overrides as Record<string, unknown>);
    cause.current = "Changed by hand:"; setApprovedAt(null);
    const n = { ...overrides }; if (v === undefined) delete n[f]; else n[f] = v;
    setOverrides(n); void writeKit("kit-edit", n);
  }, [changed, overrides]); // eslint-disable-line react-hooks/exhaustive-deps

  // Kit edits (on-model, chooser, offer tabs) undo one at a time from the lead's edit stack (lib/edits.ts); fact
  // changes (answers, chips) keep their own history below.
  const editsCan = useCanUndo(leadRef.current ?? seed?.leadId ?? null);
  useEffect(() => {
    const id = leadRef.current ?? seed?.leadId;
    if (!id) return;
    return registerUndo(id, (prev) => {
      cause.current = "Undone:"; setApprovedAt(null); setOverrides(prev as Overrides);
      if (JSON.stringify(prev) !== JSON.stringify(persisted.current)) void writeKit("kit-undo", prev as Overrides);
    });
  }, [seed?.leadId]); // eslint-disable-line react-hooks/exhaustive-deps
  // Else this session's fact history, else a single stored kit edit (several stored ones are never undone at once).
  const canUndo = editsCan || history.length > 0 || Object.keys(overrides).length === 1;
  function onUndo() {
    if (leadRef.current && undoLast(leadRef.current)) return;
    const h = history[history.length - 1];
    // Opened on stored kit edits with nothing undone yet in this session: Undo reverts the stored edit.
    if (!h) {
      if (Object.keys(overrides).length !== 1) return;
      cause.current = "Undone:"; setApprovedAt(null); setOverrides({});
      if (Object.keys(persisted.current).length) void writeKit("kit-undo", {});
      return;
    }
    setHistory(history.slice(0, -1)); cause.current = "Undone:"; setApprovedAt(null);
    setChanged(h.changed); setOverrides(h.overrides);
    // Written only when it differs from what the lead stores (undoing a tab pick writes nothing; tabs never write).
    if (JSON.stringify(h.overrides) !== JSON.stringify(persisted.current)) void writeKit("kit-undo", h.overrides);
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
    const done = () => { setApprovedAt(berlinTime(at.toISOString())); if (leadRef.current) onApproved?.(leadRef.current); };
    const id = leadRef.current;
    if (!id) { done(); return null; }
    const screen = { design: res.design, capex: res.economics.capex_eur };
    // The draft the card holds carries every offer's design_hash: no read of the lead before saving (read only when it is missing).
    let held: { lead: LeadT; version: number | null } | null = drafted?.variants?.some((v) => v.design_hash) ? { lead: { draft: drafted } as unknown as LeadT, version: baseVersion.current } : null;
    if (!held) { const before = await call<LeadT>(`/api/leads/${encodeURIComponent(id)}`); if (!before.ok) return before.error; held = { lead: before.data, version: before.data.version ?? baseVersion.current }; }
    const offer = offerOf(held.lead, screen, typeof want === "string" ? want : null);
    const body = offer ? { variant: offer.key, design_hash: offer.hash } : { variant: "edit" as const, design: res.design, overrides };
    const r = await approveLead(id, body, held.version);
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
    if (leadRef.current) pushEdit(leadRef.current, overrides as Record<string, unknown>);
    cause.current = `Switched to ${v.name}:`; setApprovedAt(null);
    setOverrides(v.overrides);   // a tab is a view: nothing is written to the lead (the chooser, Undo and Approve write)
  }, [changed, overrides]); // eslint-disable-line react-hooks/exhaustive-deps
  const openRef = useRef<HTMLDivElement>(null);
  const flag = res ? pickFlag(res) : null;

  if (seed && read) return (
    <div className="st st-open b-card-in" ref={openRef}>
      <TopBar lead={lead} read={read} inputs={inputs} roof={roof} onFact={onFact} sources={seed?.sources} phone={phone} onPhone={seed ? onPhone : undefined} setInstaller={setInstaller}
        factsSlot={seed ? <WhatsAppClient leadId={leadRef.current ?? seed.leadId} phone={phone} /> : undefined}
        question={question ?? null} answer={answer} onAnswer={onAnswer} askError={askErr} asking={question === undefined} liveAsking={live?.asking ?? null}
        pref={pref} setPref={setPref} res={res} overrides={overrides} setOverride={setOverride}
        canUndo={canUndo} onUndo={onUndo} approvedAt={approvedAt} onApprove={onApprove} noDecide />
      {err && <div className="error" role="alert"><span><span className="src">Engine said</span>{err}</span><button className="btn ghost" onClick={() => setRetry((x) => x + 1)}>Retry</button></div>}
      {!res && <OpenSkeleton />}
      {res?.design && <Chain setKit={setKit} res={res} prev={prev} inputs={resIn ?? inputs} pending={pending} cause={resCause} leadId={leadRef.current} variants={variants} onVariant={onVariant} canUndo={canUndo} onUndo={onUndo} answered={answer != null} redraft={moved}
        decide={<Decide slim pref={pref} setPref={setPref} res={res} overrides={overrides} setOverride={setOverride} canUndo={canUndo} onUndo={onUndo} approvedAt={approvedAt} onApprove={onApprove} />} />}
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
          {res?.design && <Plan res={res} prev={prev} inputs={inputs} write={null} writeBusy={false} flag={flag} variants={variants} onVariant={onVariant} busy={busy} answered={answer != null} roofNote={roof?.pending ? <span className="b-skel b-skel-line" aria-hidden="true" style={{ display: "inline-block", width: 180, height: 12 }} /> : read && !read.inputs.address ? "No street given, standard roof face" : undefined} />}
          {res && <Refine res={res} moved={moved} canUndo={canUndo} onUndo={onUndo} approvedAt={approvedAt} onApprove={onApprove} overrides={overrides} setOverride={setOverride} />}
        </div>
      </div>
    </div>
  );
}
