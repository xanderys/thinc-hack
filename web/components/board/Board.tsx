"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import dynamic from "next/dynamic";
import type { Design, DesignResponse, Health, Lead as LeadT, LeadRow, ReadResponse } from "@/lib/api";
import { call } from "@/lib/client";
import { HERO_LEAD } from "@/lib/demo";
import House from "@/components/stage/House";
import type { Live, Seed } from "@/components/stage/Stage";
import AddSheet from "./AddSheet";

const Stage = dynamic(() => import("@/components/stage/Stage"), { ssr: false });
const VOICE = process.env.NEXT_PUBLIC_VOICE === "1";

type Card = { id: string; name: string; place: string; status: LeadT["status"]; updated: string; design?: Design; line: string };
type LiveRow = { lead_id?: string | null; status: string; started_at: number | null; customer_name?: string | null; address_or_postcode?: string | null };

const STATUS: Record<string, string> = { draft: "Draft", in_call: "On a call", done: "First design ready", approved: "Approved" };
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
  if (stored) return { leadId: l.lead_id, read: stored.read, text: stored.text };
  const place = l.address_or_postcode, pc = /^\d{5}$/.test(place.trim()) ? place.trim() : undefined;
  const inputs = { ...l.facts, ...(pc ? {} : { address: l.facts.address ?? place }) };
  const unknown = l.status === "draft" && l.next_question ? [l.next_question.field as keyof LeadT["facts"]] : [];
  return { leadId: l.lead_id, read: { inputs, found: [], unknown, postcode: pc, ...(l.status === "draft" ? {} : { source: "call" as const }) } };
}

export default function Board({ openId: initial }: { openId?: string }) {
  const [rows, setRows] = useState<LeadRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [designs, setDesigns] = useState<Record<string, { at: string; d: Design }>>({});
  const [live, setLive] = useState<Record<string, LiveRow>>({});
  const [approved, setApproved] = useState<Record<string, string>>({});
  const [openId, setOpenId] = useState<string | null>(initial ?? null);
  const [seed, setSeed] = useState<Seed | null>(null);
  const [seedErr, setSeedErr] = useState<string | null>(null);
  const [liveLead, setLiveLead] = useState<LeadT | null>(null);
  const [adding, setAdding] = useState(false);
  const fetching = useRef(new Set<string>());
  const designsRef = useRef<Record<string, { at: string; d: Design }>>({});

  useEffect(() => { setApproved(readApproved()); }, []);

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
        if (fetching.current.has(row.lead_id) || designsRef.current[row.lead_id]?.at === at) continue;
        fetching.current.add(row.lead_id);
        call<LeadT>(`/api/leads/${row.lead_id}`).then(async (g) => {
          if (!g.ok) { fetching.current.delete(row.lead_id); return; }
          // A draft stored by an earlier engine: show a fresh design for the lead's facts until the lead refreshes.
          let d = g.data.draft.design;
          const h = await health();
          const dv = g.data.draft as DesignResponse & { rules_version?: string | null };
          if (h && (dv.model_version !== h.model_version || (dv.rules_version != null && dv.rules_version !== h.rules_version))) {
            const f = await call<DesignResponse>("/api/design", { inputs: g.data.facts });
            if (f.ok) d = f.data.design;
          }
          fetching.current.delete(row.lead_id);
          setDesigns((x) => { const n = { ...x, [row.lead_id]: { at, d } }; designsRef.current = n; return n; });
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

  const cards: Card[] = useMemo(() => {
    const out = (rows ?? []).map((r) => {
      const ext = r as LeadRow & { updated_at?: string };
      const d = designs[r.lead_id]?.d;
      return { id: r.lead_id, name: r.customer_name ?? r.title.split(",")[0], place: r.address_or_postcode ?? "", status: r.status, updated: ext.updated_at ?? r.created_at ?? "", design: d, line: lineOf(d, r.title) };
    });
    const isLive = (c: Card) => !!live[c.id] || c.status === "in_call";
    return [...out.filter(isLive), ...out.filter((c) => !isLive(c))];
  }, [rows, designs, live]);

  // Opening a card loads its lead and seeds the planner view.
  useEffect(() => {
    setSeed(null); setSeedErr(null);
    if (!openId) return;
    let stop = false;
    call<LeadT>(`/api/leads/${openId}`).then((r) => { if (stop) return; if (r.ok) { setSeed(seedOf(r.data)); setLiveLead(r.data); } else setSeedErr(r.error); });
    return () => { stop = true; };
  }, [openId]);

  // While the call runs, the open card keeps converging: poll the lead every 2.5 s until it is done.
  const calling = liveLead?.lead_id === openId && liveLead?.status === "in_call";
  useEffect(() => {
    if (!openId || !calling) return;
    const t = setInterval(() => call<LeadT>(`/api/leads/${openId}`).then((r) => { if (r.ok) setLiveLead(r.data); }), 2500);
    return () => clearInterval(t);
  }, [openId, calling]);
  const liveFeed: Live | null = useMemo(() => !liveLead || liveLead.lead_id !== openId || !liveLead.history.length && liveLead.status !== "in_call" ? null : {
    step: liveLead.history.length, facts: liveLead.facts, changed: liveLead.history.at(-1)?.changed ?? [],
    asking: liveLead.status === "in_call" ? liveLead.next_question?.question ?? null : null,
  }, [liveLead, openId]);

  const open = useCallback((id: string) => {
    history.pushState({ h: id }, "", `/h/${id}`);
    transition(() => setOpenId(id));
  }, []);
  const close = useCallback(() => {
    history.pushState({}, "", "/");
    transition(() => setOpenId(null));
  }, []);
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

  const openCard = cards.find((c) => c.id === openId);

  if (openId) return (
    <div className="b-open" style={{ viewTransitionName: `card-${openId}` }}>
      <div className={calling ? "b-open-h live" : "b-open-h"}>
        {calling && <span className="s-live-mesh" aria-hidden><i /><i /><i /></span>}
        <button type="button" className="b-close" onClick={close} aria-label="Close, back to the board">Close</button>
        <div>
          <h1>{openCard?.name ?? seed?.read.inputs.address ?? "House"}</h1>
          <p>{[openCard?.place, calling ? STATUS.in_call : openCard && (approved[openCard.id] ? STATUS.approved : STATUS[openCard.status])].filter(Boolean).join(" · ")}</p>
        </div>
      </div>
      {seedErr && <div className="error" role="alert"><span><span className="src">Engine said</span>{seedErr}</span><button className="btn ghost" onClick={() => { const id = openId; setOpenId(null); setTimeout(() => setOpenId(id), 0); }}>Retry</button></div>}
      {!seed && !seedErr && <p className="s-quiet s-wait">Opening the house</p>}
      {seed && <Stage key={seed.leadId} seed={seed} onApproved={onApproved} live={liveFeed} />}
    </div>
  );

  return (
    <div className="b-board">
      {err && <div className="error" role="alert"><span><span className="src">Engine said</span>{err}</span><button className="btn ghost" onClick={() => setTick((t) => t + 1)}>Retry</button></div>}
      <ul className="b-grid">
        <li>
          <button type="button" className="b-card b-add" onClick={() => setAdding(true)} aria-label="Add a house">
            <span className="b-plus" aria-hidden>+</span><span>Add a house</span>
          </button>
        </li>
        {cards.map((c) => {
          const lv = live[c.id] || c.status === "in_call";
          const st = approved[c.id] ? "approved" : lv ? "in_call" : c.status;
          return (
            <li key={c.id}>
              <button type="button" className={lv ? "b-card live" : "b-card"} style={{ viewTransitionName: `card-${c.id}` }} onClick={() => open(c.id)}>
                {lv && <span className="s-live-mesh" aria-hidden><i /><i /><i /></span>}
                <span className="b-top"><span className={`b-st ${st}`}>{lv && <span className="dot" aria-hidden />}{STATUS[st]}</span></span>
                <span className="b-name">{c.name}</span>
                <span className="b-place">{c.place}</span>
                {c.design && !lv && <span className="b-house" aria-hidden><House design={c.design} /></span>}
                <span className="b-line num">{c.line}</span>
              </button>
            </li>
          );
        })}
        {rows && rows.length === 0 && <li className="s-quiet b-empty">No houses yet.</li>}
        {!rows && !err && <li className="s-quiet s-wait b-empty">Loading houses</li>}
      </ul>
      {adding && <AddSheet onClose={() => setAdding(false)} sample={HERO_LEAD} voice={VOICE}
        onCreated={(id) => { setAdding(false); setTick((t) => t + 1); open(id); }} />}
    </div>
  );
}
