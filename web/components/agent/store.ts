"use client";
// One global thread for the copilot: it survives every remount (board, lead page, card or circle).
import { useSyncExternalStore } from "react";
import type { CopilotContext } from "./context";
import { suggest, type Suggestion, type SuggestLead, type SuggestRow } from "./suggest";

export type Op = { lead_id: string; name: string; action: string; overrides?: Record<string, unknown>; facts?: Record<string, unknown> };
export type Row = { lead_id: string; name: string; what: string; price_from: number | null; price_to: number | null; autarky_from: number | null; autarky_to: number | null; verdict_from: string; verdict_to: string; kwp_from?: number | null; kwp_to?: number | null; kwh_from?: number | null; kwh_to?: number | null; payback_from?: number | null; payback_to?: number | null };
export type Proposal = { title: string; ops: Op[]; rows: Row[]; refused: string[]; unchanged?: string[]; said: string; state: "open" | "applying" | "applied" | "undoing" | "undone"; results: { lead_id: string; name: string; ok: boolean; msg?: string; what?: string }[]; undo?: Op[] };
export type Item = { id: number; who: "you" | "agent" | "event"; text: string; pending?: boolean; err?: { src: string; msg: string }; proposals?: Proposal[] };

let items: Item[] = [], busy = false, seq = 0;
// For the shell's circle: a dot when a suggestion waits, a tooltip with the last answer's first line. Read by polling.
export let pendingSuggestion = false;
export let lastFirstLine = "";
export const getPendingSuggestion = () => pendingSuggestion;
export const getLastFirstLine = () => lastFirstLine;
export function setPendingSuggestion(v: boolean) { pendingSuggestion = v; }

// Suggestions, computed here from the screen's lead id and a direct read of that lead (or the board), never from a
// component's fetch: the same screen always gives the same chips, and pendingSuggestion is set in the same step.
export let suggestions: Suggestion[] = [];
let sugKey = "";
const sugSubs = new Set<() => void>();
async function getJson<T>(url: string): Promise<T | null> {
  for (let n = 0; n < 3; n++) {
    try { const r = await fetch(url, { cache: "no-store" }); if (r.ok) return await r.json() as T; } catch { /* try again */ }
    await new Promise((r) => setTimeout(r, 800 * (n + 1)));
  }
  return null;
}
const leadOnScreen = () => { const m = location.pathname.match(/^\/h\/([^/]+)/); return m ? decodeURIComponent(m[1]) : undefined; };
export async function refreshSuggestions() {
  const leadId = leadOnScreen(), key = leadId ?? "board";
  sugKey = key;
  let next: Suggestion[] | null = null;
  if (leadId) { const l = await getJson<SuggestLead>(`/api/leads/${encodeURIComponent(leadId)}`); if (l) next = suggest({ leadId, name: l.customer_name }, l); }
  else { const rows = await getJson<SuggestRow[]>("/api/leads?limit=40"); if (rows) next = suggest({}, null, Array.isArray(rows) ? rows : []); }
  if (next === null || sugKey !== key) return;   // a failed read keeps the last chips; a newer screen wins
  suggestions = next; pendingSuggestion = next.length > 0; sugSubs.forEach((f) => f());
}
export function useSuggestions(): Suggestion[] {
  return useSyncExternalStore((f) => { sugSubs.add(f); return () => { sugSubs.delete(f); }; }, () => suggestions, () => suggestions);
}
if (typeof window !== "undefined") {
  let last: string | null = null;
  const tick = () => { const k = leadOnScreen() ?? "board"; if (k !== last) { last = k; suggestions = []; pendingSuggestion = false; sugSubs.forEach((f) => f()); void refreshSuggestions(); } };
  setInterval(tick, 300); addEventListener("popstate", tick); setTimeout(tick, 0);
  setInterval(() => void refreshSuggestions(), 15000);
  addEventListener("marquee:lead-stale", () => void refreshSuggestions());
}

// Every Apply and Undo is kept in the thread as an event the agent reads back ("what did I change?").
const berlin = () => new Date().toLocaleTimeString("en-GB", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit" });
const n = (x: number | null | undefined, u: string, d = 2) => (x == null ? "none" : `${Math.round(x * 10 ** d) / 10 ** d} ${u}`);
const eur = (x: number | null | undefined) => (x == null ? "" : `€${Math.round(x).toLocaleString("en-GB")}`);
function logEvent(p: Proposal, undo: boolean, results: Proposal["results"]) {
  const at = berlin();
  for (const r of p.rows) {
    const res = results.find((x) => x.lead_id === r.lead_id); if (!res?.ok) continue;
    const parts: string[] = [];
    if (r.kwp_from !== r.kwp_to) parts.push(`solar ${n(r.kwp_from, "kWp")} to ${n(r.kwp_to, "kWp")}`);
    if (r.kwh_from !== r.kwh_to) parts.push(`battery ${n(r.kwh_from, "kWh", 1)} to ${n(r.kwh_to, "kWh", 1)}`);
    if (r.price_from !== r.price_to) parts.push(`price ${eur(r.price_from)} to ${eur(r.price_to)}`);
    const text = undo
      ? `Undone at ${at} on [[lead: ${r.name}|${r.lead_id}]]: ${r.what} (back to ${parts.length ? parts.map((x) => x.replace(/^(\w+) (.+) to (.+)$/, "$1 $2")).join(", ") : "the earlier values"}).`
      : `Applied at ${at} on [[lead: ${r.name}|${r.lead_id}]]: ${r.what}${parts.length ? ` (${parts.join(", ")})` : ""}.`;
    set((xs) => [...xs, { id: ++seq, who: "event", text }]);
  }
}
const plain = (t: string) => t.replace(/\[\[lead:\s*([^|\]]+)\|[^\]]+\]\]/g, "$1").replace(/\[\[(ok|warn|fail):\s*([^\]]+)\]\]/g, "$2").replace(/==|\*\*|`/g, "").trim();
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());
const set = (f: (xs: Item[]) => Item[]) => { items = f(items); emit(); };
const patch = (id: number, f: (x: Item) => Item) => set((xs) => xs.map((x) => (x.id === id ? f(x) : x)));
const patchP = (id: number, pi: number, f: (p: Proposal) => Proposal) => patch(id, (x) => ({ ...x, proposals: x.proposals!.map((p, j) => (j === pi ? f(p) : p)) }));
const mine = new Set<string>();

export function useThread() {
  const xs = useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => items, () => items);
  const b = useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => busy, () => false);
  return { items: xs, busy: b };
}
export function note(text: string) { set((xs) => [...xs, { id: ++seq, who: "agent", text }]); }

async function* lines(res: Response) {
  const r = res.body!.getReader(); const dec = new TextDecoder(); let buf = "";
  for (;;) {
    const { value, done } = await r.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let n; while ((n = buf.indexOf("\n")) >= 0) { const l = buf.slice(0, n); buf = buf.slice(n + 1); if (l.trim()) yield JSON.parse(l) as Record<string, unknown>; }
  }
}

export async function ask(q: string, ctx: CopilotContext) {
  if (busy) return;
  const you: Item = { id: ++seq, who: "you", text: q };
  const me: Item = { id: ++seq, who: "agent", text: "", pending: true, proposals: [] };
  const history = [...items, you].filter((x) => x.text.trim() && !x.err).map((x) => ({ role: x.who === "you" ? "user" : x.who === "event" ? "event" : "assistant", content: x.text }));
  set((xs) => [...xs, you, me]); busy = true; emit();
  try {
    const res = await fetch("/api/agent", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: history, test: new URLSearchParams(location.search).get("test") === "1", context: ctx.leadId ? { lead_id: ctx.leadId, name: ctx.name } : undefined }) });
    if (!res.ok || !res.body) { const j = await res.json().catch(() => ({})); throw new Error(j.error ?? `${res.status} ${res.statusText}`); }
    let turn = "";   // a turn that ends in tool calls is narration: its text is dropped when the tools start
    for await (const e of lines(res)) {
      if (e.t === "text") { turn += String(e.d); const t = turn; patch(me.id, (x) => ({ ...x, text: t })); }
      else if (e.t === "tools") { turn = ""; patch(me.id, (x) => ({ ...x, text: "" })); }
      else if (e.t === "propose") patch(me.id, (x) => ({ ...x, proposals: [...(x.proposals ?? []), { ...(e as unknown as Proposal), said: q + (ctx.leadId ? ` [${ctx.leadId}]` : ""), state: "open", results: [] }] }));
      else if (e.t === "created") { mine.add(String(e.lead_id)); dispatchEvent(new CustomEvent("marquee:lead-created", { detail: e.lead_id })); }
      else if (e.t === "error") patch(me.id, (x) => ({ ...x, err: { src: String(e.src), msg: String(e.msg) } }));
    }
  } catch (e) { patch(me.id, (x) => ({ ...x, err: { src: "Agent said", msg: (e as Error).message } })); }
  patch(me.id, (x) => ({ ...x, pending: false, text: x.text.trim() }));
  const done = items.find((x) => x.id === me.id); if (done?.text) lastFirstLine = plain(done.text.split("\n").find((l) => l.trim()) ?? "");
  busy = false; emit();
}

export async function run(id: number, pi: number, p: Proposal, undo: boolean) {
  patchP(id, pi, (x) => ({ ...x, state: undo ? "undoing" : "applying", results: [] }));
  try {
    const res = await fetch("/api/agent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(undo ? { undo: p.undo } : { apply: p.ops, said: p.said }) });
    if (!res.ok || !res.body) throw new Error(`${res.status} ${res.statusText}`);
    for await (const e of lines(res)) {
      if (e.t === "result") patchP(id, pi, (x) => ({ ...x, results: [...x.results, e as unknown as Proposal["results"][number]] }));
      else if (e.t === "applied" && !undo) patchP(id, pi, (x) => ({ ...x, undo: e.undo as Op[] }));
    }
    patchP(id, pi, (x) => ({ ...x, state: undo ? "undone" : "applied" }));
    const done = items.find((x) => x.id === id)?.proposals?.[pi]; if (done) logEvent(done, undo, done.results);
    void refreshSuggestions();
    // The open lead page refetches when its lead changes.
    for (const o of p.ops) dispatchEvent(new CustomEvent("marquee:lead-stale", { detail: o.lead_id }));
  } catch (e) { patchP(id, pi, (x) => ({ ...x, state: undo ? "applied" : "open", results: [{ lead_id: "", name: "Agent said", ok: false, msg: (e as Error).message }] })); }
}

// A lead the composer created on its own lands in the thread as its chip.
if (typeof window !== "undefined") {
  addEventListener("marquee:lead-created", async (e: Event) => {
    const id = String((e as CustomEvent).detail ?? ""); if (!id || mine.has(id)) return;
    const r = await fetch(`/api/leads/${encodeURIComponent(id)}`).then((x) => x.json()).catch(() => null);
    note(`[[ok: New lead]] [[lead: ${r?.customer_name ?? id}|${id}]]`);
  });
}
