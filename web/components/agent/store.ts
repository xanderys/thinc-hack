"use client";
// One global thread for the copilot: it survives every remount (board, lead page, card or circle).
import { useSyncExternalStore } from "react";
import type { CopilotContext } from "./context";

export type Op = { lead_id: string; name: string; action: string; overrides?: Record<string, unknown>; facts?: Record<string, unknown> };
export type Row = { lead_id: string; name: string; what: string; price_from: number | null; price_to: number | null; autarky_from: number | null; autarky_to: number | null; verdict_from: string; verdict_to: string; kwp_from?: number | null; kwp_to?: number | null; kwh_from?: number | null; kwh_to?: number | null; payback_from?: number | null; payback_to?: number | null };
export type Proposal = { title: string; ops: Op[]; rows: Row[]; refused: string[]; unchanged?: string[]; said: string; state: "open" | "applying" | "applied" | "undoing" | "undone"; results: { lead_id: string; name: string; ok: boolean; msg?: string; what?: string }[]; undo?: Op[] };
export type Item = { id: number; who: "you" | "agent"; text: string; pending?: boolean; err?: { src: string; msg: string }; proposals?: Proposal[] };

let items: Item[] = [], busy = false, seq = 0;
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
  const history = [...items, you].filter((x) => x.text.trim() && !x.err).map((x) => ({ role: x.who === "you" ? "user" : "assistant", content: x.text }));
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
  patch(me.id, (x) => ({ ...x, pending: false, text: x.text.trim() })); busy = false; emit();
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
