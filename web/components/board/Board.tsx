"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import dynamic from "next/dynamic";
import type { Design, DesignResponse, Health, HomeInputs, Lead as LeadT, LeadRow, ReadResponse, RoofResult } from "@/lib/api";
import { designOf, refineOf } from "@/lib/engineCache";
import { call } from "@/lib/client";
import { HERO_LEAD } from "@/lib/demo";
import OpenSkeleton from "@/components/stage/Skeleton";
import type { Live, Seed } from "@/components/stage/Stage";
import { LEAD_LIVE, whatsappOrigin } from "@/lib/whatsapp";
import Agent from "@/components/agent/Agent";   // wraps the composer field (ComposerField) with the agent card
import AddSheet from "./AddSheet";
import HousePhoto from "./HousePhoto";
import ModelThumb from "./ModelThumb";
import GapChips from "./GapChips";
import { offerEur, qualify, VERDICT_ORDER, VERDICT_WORD, type Verdict } from "@/lib/qualify";
import { keepVerdict, recallVerdict, useRoofs } from "@/components/qualify/roof";
import { pastLine } from "@/lib/past";
import Blocking from "@/components/stage/Blocking";
import { ClientChevron } from "@/components/stage/clientCard";
import { reasonOf, VerdictChip } from "@/components/qualify/Verdict";

// The facts count is the verdict chip's tooltip, never part of the line.
const factsTip = (q: { facts?: { stated: number; total: number }; confidence_line?: string }) => `${q.facts ? `${q.facts.stated} of ${q.facts.total} facts stated` : q.confidence_line?.split(",")[0] ?? ""}. Estimates until the site visit.`.replace(/^\. /, "");
import qs from "@/components/qualify/qualify.module.css";
import { berlinStamp, berlinTime } from "@/lib/time";
import { undoLast, useCanUndo } from "@/lib/edits";
import { AgentLog, RunButton } from "@/components/autopilot/Autopilot"; // autopilot mount

// The open card's one Undo: in the header, visible without scrolling at every width; one kit edit at a time.
function HeaderUndo({ id }: { id: string }) {
  const can = useCanUndo(id);
  return <button type="button" className="b-undo" disabled={!can} onClick={() => undoLast(id)} title="Revert the last edit">Undo</button>;
}

const Stage = dynamic(() => import("@/components/stage/Stage"), { ssr: false });
const VOICE = process.env.NEXT_PUBLIC_VOICE === "1";

type Kept = NonNullable<ReturnType<typeof recallVerdict>>;
type Card = { id: string; name: string; place: string; status: LeadT["status"]; label?: string; updated: string; design?: Design; edited?: boolean; line: string; created?: string; decision?: LeadRow["decision"]; q: Kept | null };
/** What the lead stands on: the approved design and its economics once approved or signed, else the stored draft. */
const standing = (l: LeadT): DesignResponse => l.approved?.design ? { ...l.draft, design: l.approved.design, economics: l.approved.economics ?? l.draft.economics } : l.draft;

type Got = { at: string; d: Design; lead?: LeadT; res?: DesignResponse; edited?: boolean };
const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
const isPc = (x?: string | null) => !x || /^\s*\d{5}\s*$/.test(x);
type LiveRow = { lead_id?: string | null; status: string; started_at: number | null; customer_name?: string | null; address_or_postcode?: string | null };

const STATUS: Record<string, string> = { draft: "Draft", in_call: "On a call", done: "Draft", approved: "Complete", sent: "Sent", signed: "Signed", declined: "Declined", question: "Question" };
const DECIDED = new Set(["signed", "declined", "question"]);
const hm = (iso?: string | null) => iso ? berlinTime(iso) : "";
// Enquiry to decision, in the largest unit that reads well.
function span(from?: string | null, to?: string | null) {
  if (!from || !to) return "";
  const m = Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 60000));
  return m < 60 ? `${m} min` : m < 2880 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${Math.round(m / 1440)} days`;
}
const lineOf = (d?: Design, title?: string) => d
  ? [d.pv_kwp != null && `${d.pv_kwp.toLocaleString("en-GB", { maximumFractionDigits: 2 })} kWp`, d.battery_kwh != null && `${d.battery_kwh.toLocaleString("en-GB", { maximumFractionDigits: 2 })} kWh`, d.heatpump_kw != null && `${d.heatpump_kw} kW heat pump`, d.wallbox_kw != null && "wallbox"].filter(Boolean).join(" + ") || "Nothing to fit"
  : title?.split(": ").slice(1).join(": ") ?? "";

// The engine's current version, asked once per page.
let healthP: Promise<(Health & { rules_version?: string | null }) | null> | null = null;
const health = () => (healthP ??= call<Health & { rules_version?: string | null }>("/api/health").then((r) => r.ok ? r.data : null));

const APPROVED = "marquee.approved.ids";
const readApproved = (): Record<string, string> => { try { return JSON.parse(localStorage.getItem(APPROVED) ?? "{}"); } catch { return {}; } };

// Smooth spring, no bounce, for the expand; a crossfade under Reduce Motion (CSS).
function transition(fn: () => void) {
  const d = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (d.startViewTransition) d.startViewTransition(() => flushSync(fn)); else fn();
}

/** Seed for an opened card: what the paste said if this planner added it, else the lead's own facts. */
function seedOf(l: LeadT): Seed {
  let stored: { read: ReadResponse; text: string } | null = null;
  try { stored = JSON.parse(sessionStorage.getItem(`marquee.read.${l.lead_id}`) ?? "null"); } catch { /* storage blocked */ }
  // The lead's own facts win over the read stored at creation: they carry every change made since.
  const wa = whatsappOrigin(l);
  if (stored) return { leadId: l.lead_id, read: { ...stored.read, inputs: { ...stored.read.inputs, ...l.facts }, origin: { ...stored.read.origin, ...wa } }, text: stored.text, draft: l.draft, version: l.version ?? null, phone: l.phone ?? null, sources: l.sources, approved: l.approved ?? null, overrides: l.overrides ?? null };
  const place = l.address_or_postcode, pc = /^\d{5}$/.test(place.trim()) ? place.trim() : undefined;
  const inputs = { ...l.facts, ...(pc ? {} : { address: l.facts.address ?? place }) };
  const unknown = l.status === "draft" && l.next_question ? [l.next_question.field as keyof LeadT["facts"]] : [];
  return { leadId: l.lead_id, draft: l.draft, version: l.version ?? null, phone: l.phone ?? null, sources: l.sources, approved: l.approved ?? null, overrides: l.overrides ?? null, read: { inputs, found: [], unknown, postcode: pc, origin: wa, ...(l.status === "draft" ? {} : { source: "call" as const }) } };
}

export default function Board({ openId: initial }: { openId?: string }) {
  const [rows, setRows] = useState<LeadRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [designs, setDesigns] = useState<Record<string, Got>>({});
  const [live, setLive] = useState<Record<string, LiveRow>>({});
  const [approved, setApproved] = useState<Record<string, string>>({});
  const [openId, setOpenId] = useState<string | null>(initial ?? null);
  const [seed, setSeed] = useState<Seed | null>(null);
  const [seedErr, setSeedErr] = useState<string | null>(null);
  const [liveLead, setLiveLead] = useState<LeadT | null>(null);
  const [reload, setReload] = useState(0);
  const [staleNote, setStaleNote] = useState(false);
  const [adding, setAdding] = useState(false);
  const fetching = useRef(new Set<string>());
  const designsRef = useRef<Record<string, Got>>({});
  const [kept, setKept] = useState<Record<string, Kept>>({});

  useEffect(() => { setApproved(readApproved()); }, []);
  // A stale "On a call" must flip when the engine closes the call: refetch the list when the tab regains focus.
  useEffect(() => {
    const on = () => { if (document.visibilityState === "visible") setTick((t) => t + 1); };
    addEventListener("focus", on); document.addEventListener("visibilitychange", on);
    return () => { removeEventListener("focus", on); document.removeEventListener("visibilitychange", on); };
  }, []);
  // The composer lane announces a lead it just created: refetch the list so it shows at the top.
  useEffect(() => {
    const on = () => setTick((t) => t + 1);
    addEventListener("marquee:lead-created", on); return () => removeEventListener("marquee:lead-created", on);
  }, []);

  // Leads every 4 s; each card's design when its lead changes.
  useEffect(() => {
    let stop = false;
    const load = async () => {
      const r = await call<LeadRow[]>("/api/leads?limit=40");
      if (stop) return;
      if (!r.ok) { setErr(r.error); return; }
      setErr(null); setRows(r.data);
      for (const row of r.data) {
        const at = (row as LeadRow & { updated_at?: string }).updated_at ?? row.created_at ?? "";
        const seenSt = designsRef.current[row.lead_id]?.lead?.status;
        if (fetching.current.has(row.lead_id) || (designsRef.current[row.lead_id]?.at === at && (!seenSt || seenSt === row.status))) continue;
        fetching.current.add(row.lead_id);
        call<LeadT>(`/api/leads/${row.lead_id}`).then(async (g) => {
          if (!g.ok) { fetching.current.delete(row.lead_id); return; }
          // A draft stored by an earlier engine: show a fresh design for the lead's facts until the lead refreshes.
          let res = standing(g.data), d = res.design;
          // The stored draft first, so the verdict never waits on the redesign below.
          setDesigns((x) => { if (x[row.lead_id]?.lead) return x; const n = { ...x, [row.lead_id]: { at: "", d, lead: g.data, res } }; designsRef.current = n; return n; });
          // Kit edits kept on the lead: the card shows the design the planner page shows, the engine's refine for the stored overrides.
          const kit = g.data.overrides && Object.keys(g.data.overrides).length > 0 && !g.data.approved?.design ? g.data.overrides : null;
          if (kit) {
            // No lead_id in the body, so the call only reads: ask again when the engine is busy with the other cards.
            let f = await refineOf(g.data.facts, kit);
            for (let n = 0; !f.ok && n < 3; n++) { await new Promise((r) => setTimeout(r, 2000 * (n + 1))); f = await refineOf(g.data.facts, kit); }
            if (f.ok) { res = f.data; d = f.data.design; setDesigns((x) => { const n = { ...x, [row.lead_id]: { at: "", d, lead: g.data, res, edited: true } }; designsRef.current = n; return n; }); }
          }
          const h = await health();
          const dv = g.data.draft as DesignResponse & { rules_version?: string | null };
          // The engine stamps lead drafts with its rules version in model_version; either string means the draft is current.
          const current = !!h && (dv.model_version === h.model_version || dv.model_version === h.rules_version) && (dv.rules_version == null || dv.rules_version === h.rules_version);
          if (h && !current) {
            const f = await designOf(g.data.facts);
            if (f.ok && !g.data.approved?.design && !kit) { d = f.data.design; res = f.data; }
          }
          fetching.current.delete(row.lead_id);
          setDesigns((x) => { const n = { ...x, [row.lead_id]: { at, d, lead: g.data, res, edited: !!g.data.overrides && Object.keys(g.data.overrides).length > 0 && !g.data.approved?.design } }; designsRef.current = n; return n; });
        });
      }
    };
    load();
    const t = setInterval(load, 4000);
    return () => { stop = true; clearInterval(t); };
  }, [tick]);

  // Calls in progress, from the voice side, so a live call's card leads the board.
  useEffect(() => {
    if (!VOICE) return;
    let stop = false;
    const load = () => fetch("/start/leads", { cache: "no-store" }).then((r) => r.ok ? r.json() : []).then((b: LiveRow[]) => {
      if (stop) return;
      setLive(Object.fromEntries(b.filter((x) => x.status === "in_progress" && x.lead_id).map((x) => [x.lead_id!, x])));
    }).catch(() => {});
    load(); const t = setInterval(load, 3000);
    return () => { stop = true; clearInterval(t); };
  }, []);

  // Verdicts: the roof per street address (4 in flight), the last verdict per lead kept for the session so a reopen does not flicker.
  // The open lead's own address too: test leads and older leads are not on the list but their card still needs a verdict.
  const openAddr = liveLead && liveLead.lead_id === openId && !isPc(liveLead.address_or_postcode) ? liveLead.address_or_postcode : null;
  const roofs = useRoofs([...(rows ?? []).map((r) => isPc(r.address_or_postcode) ? null : r.address_or_postcode), openAddr]);
  useEffect(() => { setKept(Object.fromEntries((rows ?? []).map((r) => [r.lead_id, recallVerdict(r.lead_id)]).filter(([, v]) => v)) as Record<string, Kept>); }, [rows?.length]); // eslint-disable-line react-hooks/exhaustive-deps
  // A roof still being looked up after 10 s settles the verdict as Call first with its reason; it never stays on Checking.
  const firstSeen = useRef<Record<string, number>>({});
  const [clock, setClock] = useState(0);
  useEffect(() => { const t = setInterval(() => setClock(Date.now()), 2000); return () => clearInterval(t); }, []);
  const verdicts = useMemo(() => {
    const out: Record<string, Kept> = {};
    const now = Date.now();
    for (const r of rows ?? []) {
      const g = designs[r.lead_id];
      if (!g?.lead) continue;
      const pc = isPc(r.address_or_postcode);
      let roof = pc ? null : roofs[r.address_or_postcode!];
      firstSeen.current[r.lead_id] ??= now;
      if (!pc && roof === undefined) {
        if (now - firstSeen.current[r.lead_id] < 10_000) continue;
        roof = { pending: true } as RoofResult;
      }
      out[r.lead_id] = qualify({ ...g.lead, status: r.status, decision: r.decision ?? g.lead.decision }, g.res, roof);
    }
    return out;
  }, [rows, designs, roofs, clock]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { for (const [id, q] of Object.entries(verdicts)) keepVerdict(id, q); }, [verdicts]);

  const cards: Card[] = useMemo(() => {
    const out = (rows ?? []).map((r) => {
      const ext = r as LeadRow & { updated_at?: string };
      const d = designs[r.lead_id]?.d;
      return { id: r.lead_id, name: r.customer_name ?? r.title.split(",")[0], place: r.address_or_postcode ?? "", status: r.status, label: r.status_label, updated: ext.updated_at ?? r.created_at ?? "", design: d, edited: designs[r.lead_id]?.edited, line: lineOf(d, r.title), created: r.created_at, decision: r.decision, q: verdicts[r.lead_id] ?? kept[r.lead_id] ?? null };
    });
    const isLive = (c: Card) => !!live[c.id] || c.status === "in_call";
    return [...out.filter(isLive), ...out.filter((c) => !isLive(c))];
  }, [rows, designs, live, verdicts, kept]);

  // Opening a card loads its lead and seeds the planner view.
  useEffect(() => {
    setSeed(null); setSeedErr(null);
    if (!openId) return;
    let stop = false;
    call<LeadT>(`/api/leads/${openId}`).then((r) => { if (stop) return; if (r.ok) { setSeed(seedOf(r.data)); setLiveLead(r.data); } else setSeedErr(r.error); });
    return () => { stop = true; };
  }, [openId, reload]);

  // A write answered 409: the lead changed elsewhere. Reload it into the card and say so.
  useEffect(() => {
    const on = (e: Event) => { if ((e as CustomEvent).detail === openId) { setReload((n) => n + 1); setStaleNote(true); } };
    addEventListener("marquee:lead-stale", on); return () => removeEventListener("marquee:lead-stale", on);
  }, [openId]);
  useEffect(() => { if (!staleNote) return; const t = setTimeout(() => setStaleNote(false), 8000); return () => clearTimeout(t); }, [staleNote]);

  // The WhatsApp chip polls the lead while a conversation is open; each new version lands here like a call answer.
  useEffect(() => {
    const on = (e: Event) => {
      const l = (e as CustomEvent<LeadT>).detail;
      if (l?.lead_id === openId) setLiveLead((p) => p && p.lead_id === l.lead_id && (p.version ?? -1) > (l.version ?? -1) ? p : l);
      // The list row too, so the header chip and the board card read the lead's own status (Sent after a send).
      if (l?.lead_id && l.status) setRows((rs) => rs && rs.map((r) => (r.lead_id === l.lead_id ? { ...r, status: l.status, status_label: l.status_label ?? r.status_label } : r)));
    };
    addEventListener(LEAD_LIVE, on); return () => removeEventListener(LEAD_LIVE, on);
  }, [openId]);

  // Focus on the lead page re-reads the lead (status only; the planner view is not remounted).
  useEffect(() => {
    if (!openId) return;
    const on = () => { if (document.visibilityState === "visible") call<LeadT>(`/api/leads/${openId}`).then((r) => { if (r.ok) { setLiveLead((p) => p && (p.version ?? -1) > (r.data.version ?? -1) ? p : r.data); setRows((rs) => rs && rs.map((x) => x.lead_id === r.data.lead_id ? { ...x, status: r.data.status, status_label: r.data.status_label ?? x.status_label } : x)); } }); };
    addEventListener("focus", on); document.addEventListener("visibilitychange", on);
    return () => { removeEventListener("focus", on); document.removeEventListener("visibilitychange", on); };
  }, [openId]);

  // While the call runs, the open card keeps converging: poll the lead every 2.5 s until it is done.
  const calling = liveLead?.lead_id === openId && liveLead?.status === "in_call";
  useEffect(() => {
    if (!openId || !calling) return;
    const t = setInterval(() => call<LeadT>(`/api/leads/${openId}`).then((r) => { if (r.ok) setLiveLead(r.data); }), 2500);
    return () => clearInterval(t);
  }, [openId, calling]);
  const liveFeed: Live | null = useMemo(() => !liveLead || liveLead.lead_id !== openId || !liveLead.history.length && liveLead.status !== "in_call" ? null : {
    version: liveLead.version ?? null, step: liveLead.history.length, facts: liveLead.facts, changed: liveLead.history.at(-1)?.changed ?? [],
    asking: liveLead.status === "in_call" ? liveLead.next_question?.question ?? null : null,
    ...(liveLead.history.at(-1)?.source === "whatsapp" ? { via: "From WhatsApp:" } : {}), origin: whatsappOrigin(liveLead),
  }, [liveLead, openId]);

  const open = useCallback((id: string) => {
    history.pushState({ h: id }, "", `/h/${id}`);
    transition(() => setOpenId(id));
  }, []);
  const close = useCallback(() => {
    history.pushState({}, "", "/");
    transition(() => setOpenId(null));
  }, []);
  // The banner's back arrow (Masthead) closes the card the same way, with the card's transition.
  useEffect(() => {
    const on = (e: Event) => { e.preventDefault(); close(); };
    addEventListener("marquee:back", on); return () => removeEventListener("marquee:back", on);
  }, [close]);
  useEffect(() => {
    const on = () => { const m = location.pathname.match(/^\/h\/([^/]+)/); transition(() => setOpenId(m ? decodeURIComponent(m[1]) : null)); };
    addEventListener("popstate", on); return () => removeEventListener("popstate", on);
  }, []);
  useEffect(() => {
    if (!openId) return;
    const on = (e: KeyboardEvent) => { if (e.key === "Escape" && !/INPUT|TEXTAREA/.test((e.target as HTMLElement).tagName)) close(); };
    addEventListener("keydown", on); return () => removeEventListener("keydown", on);
  }, [openId, close]);

  const onApproved = useCallback((id: string) => {
    const a = { ...readApproved(), [id]: new Date().toISOString() };
    try { localStorage.setItem(APPROVED, JSON.stringify(a)); } catch { /* storage blocked */ }
    setApproved(a);
  }, []);

  // The open card's chain reports when the building is an apartment block (lib/building.ts).
  const [shared, setShared] = useState<{ id: string | null; reason: string } | null>(null);
  useEffect(() => {
    const on = (e: Event) => { const d = (e as CustomEvent<{ leadId: string | null; multi: boolean; reason: string }>).detail; setShared(d.multi ? { id: d.leadId, reason: d.reason } : null); };
    addEventListener("marquee:building", on); return () => removeEventListener("marquee:building", on);
  }, []);
  useEffect(() => { setShared(null); }, [openId]);

  const ll = liveLead?.lead_id === openId ? liveLead : null;   // test leads and old leads are not on the board list
  const listed = cards.find((c) => c.id === openId);
  // Off the list: the verdict from the lead's own facts, draft and roof (a roof unresolved after 10 s counts as pending).
  const offQ = (() => {
    if (listed || !ll) return null;
    const pc = isPc(ll.address_or_postcode);
    let roof = pc ? null : roofs[ll.address_or_postcode!];
    firstSeen.current[ll.lead_id] ??= Date.now();
    if (!pc && roof === undefined) {
      if (Date.now() - firstSeen.current[ll.lead_id] < 10_000) return null;
      roof = { pending: true } as RoofResult;
    }
    return qualify(ll, standing(ll), roof);
  })();
  const [cardNow, setCardNow] = useState<{ leadId: string; res: DesignResponse; changed: Partial<HomeInputs> } | null>(null);
  useEffect(() => {
    const on = (e: Event) => setCardNow((e as CustomEvent).detail);
    addEventListener("marquee:card-design", on); return () => removeEventListener("marquee:card-design", on);
  }, []);
  useEffect(() => { setCardNow(null); }, [openId]);
  // After an edit the header verdict comes from the design on screen and the lead's facts with the edits, not the list's cached draft.
  const nowQ = (() => {
    if (!ll || !cardNow || cardNow.leadId !== openId) return null;
    const pc = isPc(ll.address_or_postcode);
    const roof = pc ? null : roofs[ll.address_or_postcode!];
    if (!pc && roof === undefined) return null;
    return qualify({ ...ll, facts: { ...ll.facts, ...cardNow.changed } }, cardNow.res, roof);
  })();
  const baseCard = listed ?? (offQ ? { q: offQ } as Partial<Card> as Card : undefined);
  const openCard = nowQ && baseCard ? { ...baseCard, q: nowQ } : baseCard;

  // A big card needs a finished design and a built 3D roof model; every other lead is a short row.
  const big = (c: Card) => !!c.design && (!!live[c.id] || c.status === "in_call" || (!isPc(c.place) && roofs[c.place]?.capacity_source === "layout"));

  if (openId) return (
    <div className="b-open" style={{ viewTransitionName: `card-${openId}` }}>
      {seed && <Blocking leadId={openId} />}
      <div className={calling ? "b-open-h live" : "b-open-h"}>
        {calling && <span className="s-live-mesh" aria-hidden><i /><i /><i /></span>}
        <div className="b-open-lines">
          {/* Line one: the name, status chip right-aligned on desktop. Line two: the address. Line three: verdict and offer. */}
          <div className="b-l1">
            <h1>{openCard?.name ?? ll?.customer_name ?? seed?.read.inputs.address ?? "House"}</h1>
            {(() => {
              if (!openCard && !calling && !ll) return null;
              const base = openCard?.status ?? ll?.status ?? "draft";
              const st = calling ? "in_call" : DECIDED.has(base) || base === "approved" ? base : approved[openId] ? "approved" : base;
              return <span className={`b-st b-chip ${st}`}>{(st === base && (openCard?.label ?? ll?.status_label)) || STATUS[st]}{openCard && DECIDED.has(openCard.status) ? ` ${berlinStamp(openCard.decision?.decided_at)}` : ""}</span>;
            })()}
            <HeaderUndo id={openId} />
          </div>
          <p className="b-l2" title={openCard?.place ?? ll?.address_or_postcode ?? undefined}>{openCard?.place ?? ll?.address_or_postcode ?? <span className="b-skel b-skel-line" aria-hidden />}</p>
          <p className={`${qs.head} b-l3`}><VerdictChip verdict={openCard?.q?.verdict ?? null} tip={openCard?.q ? `${reasonOf(openCard.q)} ${factsTip(openCard.q)}`.trim() : undefined} /></p>
          {shared && <p className="b-shared" title={shared.reason}>Large building, check the address</p>}
          {ll && ll.draft?.design && !shared && (ll.draft.roof as { capacity_source?: string } | null | undefined)?.capacity_source === "typical house" && <p className="b-shared">Roof from typical house</p>}
        </div>
        <HousePhoto address={openCard?.place ?? seed?.read.inputs.address} className="b-head-photo" />
        {seed && <ClientChevron />}
      </div>
      {seedErr && <div className="error" role="alert"><span><span className="src">Engine said</span>{seedErr}</span><button className="btn ghost" onClick={() => { const id = openId; setOpenId(null); setTimeout(() => setOpenId(id), 0); }}>Retry</button></div>}
      {!seed && !seedErr && <OpenSkeleton />}
      {staleNote && <p className="b-shared" role="status">This lead changed elsewhere, reloaded.</p>}
      {seed && <Stage key={`${seed.leadId}:${reload}`} seed={seed} onApproved={onApproved} live={liveFeed} />}
    </div>
  );

  return (
    <div className="b-board">
      <RunButton /> {/* autopilot mount */}
      {err && <div className="error" role="alert"><span><span className="src">Engine said</span>{err}</span><button className="btn ghost" onClick={() => setTick((t) => t + 1)}>Retry</button></div>}
      <ul className={`b-grid ${qs.addRow}`}>
        <li>
          <button type="button" className="b-card b-add" onClick={() => setAdding(true)} aria-label="Add a house">
            <span className="b-plus" aria-hidden>+</span><span>Add a house</span>
          </button>
        </li>
        {rows && rows.length === 0 && <li className="s-quiet b-empty">No houses yet.</li>}
        {!rows && !err && [0, 1, 2].map((k) => <li key={k} aria-hidden="true"><span className="b-card b-skel" style={{ height: 120 }} /></li>)}
      </ul>
      {([...VERDICT_ORDER, null] as (Verdict | null)[]).map((v) => {
        const group = cards.filter((c) => (c.q?.verdict ?? null) === v);
        if (!group.length) return null;
        return (
          <section key={v ?? "checking"} className={qs.group} aria-label={v ? VERDICT_WORD[v] : "Checking"}>
            <h2 className={qs.gH}>{v ? VERDICT_WORD[v] : "Checking"} <span className={qs.count}>{group.length}</span></h2>
            <ul className="b-grid">
        {group.filter(big).map((c) => {
          const lv = live[c.id] || c.status === "in_call";
          const st = lv ? "in_call" : DECIDED.has(c.status) || c.status === "approved" ? c.status : approved[c.id] ? "approved" : c.status;
          const dec = DECIDED.has(c.status) ? c.decision : null;
          return (
            <li key={c.id} className="b-wrapcard">
              <button type="button" className={lv ? "b-card live" : "b-card"} style={{ viewTransitionName: `card-${c.id}` }} onClick={() => open(c.id)}>
                {lv && <span className="s-live-mesh" aria-hidden><i /><i /><i /></span>}
                <span className="b-top">{!dec && <span className={`b-st ${st}`}>{lv && <span className="dot" aria-hidden />}{st === c.status && c.label ? c.label : STATUS[st]}</span>}{c.q ? <VerdictChip verdict={c.q.verdict} tip={factsTip(c.q)} /> : !lv && <span className="b-skel b-skel-chip" aria-hidden />}</span>
                <span className="b-name">{c.name}</span>
                <span className="b-place">{c.place}</span>
                {c.design && !lv && <span className="b-house" aria-hidden><ModelThumb lead={designs[c.id]?.lead} design={c.design} /></span>}
                {!c.design && !lv && <span className="b-house b-skel b-skel-house" aria-hidden />}
                {c.edited && <span className="b-edited">Edited</span>}
                {c.design || lv ? <span className="b-line num">{c.line}</span> : <span className="b-skel b-skel-line" aria-hidden />}
                {c.q ? <span className={`${qs.cardValue} num`}>{offerEur(c.q.expected_offer_eur)}</span> : !lv && <span className="b-skel b-skel-line short" aria-hidden />}
                {c.q && c.q.verdict !== "visit" && !dec && <span className={qs.cardWhy}>{reasonOf(c.q)}</span>}
                {dec && <span className={`b-dec ${c.status}`}>{STATUS[c.status]} {berlinStamp(dec.decided_at)}{c.status === "signed" && span(c.created, dec.decided_at) ? `, ${span(c.created, dec.decided_at)} from enquiry` : ""}</span>}
                {dec && c.status === "signed" && pastLine(designs[c.id]?.lead?.facts.installer_id) && <span className="b-today">{pastLine(designs[c.id]?.lead?.facts.installer_id)}</span>}
                {dec && dec.matches_current === false && <span className="b-warn">Signed a different version than the one on file</span>}
              </button>
              <GapChips lead={designs[c.id]?.lead} address={c.place} onChanged={() => setTick((t) => t + 1)} />
            </li>
          );
        })}
            </ul>
            {group.some((c) => !big(c)) && <ul className="b-rows">
              {group.filter((c) => !big(c)).map((c) => (
                <li key={c.id} className="b-row">
                  <button type="button" className="b-rowmain" style={{ viewTransitionName: `card-${c.id}` }} onClick={() => open(c.id)}>
                    <span className="b-rname">{c.name}</span>
                    <span className="b-rplace">{c.place}</span>
                    {c.q ? <VerdictChip verdict={c.q.verdict} tip={factsTip(c.q)} /> : <span className="b-skel b-skel-chip" aria-hidden />}
                  </button>
                  <GapChips lead={designs[c.id]?.lead} address={c.place} onChanged={() => setTick((t) => t + 1)} />
                </li>
              ))}
            </ul>}
          </section>
        );
      })}
      <AgentLog /> {/* autopilot mount */}
      {adding && <AddSheet onClose={() => setAdding(false)} sample={HERO_LEAD} voice={VOICE}
        onCreated={(id) => { setAdding(false); setTick((t) => t + 1); open(id); }} />}
      {/* composer mount */}
      {/* agent mount */}<Agent />
    </div>
  );
}

