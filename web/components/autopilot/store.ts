"use client";
// One autopilot run for the page: the button starts it, the log panel reads it. Events per docs/briefs/autopilot.md.
import { useSyncExternalStore } from "react";
import { LEAD_LIVE } from "@/lib/whatsapp";

export type Step = "read" | "measure" | "ask" | "draft" | "send" | "needs_you" | "summary";
export type ApEvent = {
  at: string; lead_id: string | null; name: string | null; step: Step | string; text: string; glyph?: string;
  state: "active" | "done" | "needs_you" | "error"; summary?: { sent: number; needs_you: number; asked: number };
};
export type Run = { phase: "idle" | "running" | "done" | "error"; events: ApEvent[]; error: string | null; open: boolean };

let run: Run = { phase: "idle", events: [], error: null, open: false };
const subs = new Set<() => void>();
const set = (p: Partial<Run>) => { run = { ...run, ...p }; subs.forEach((f) => f()); };
export const useRun = () => useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f); }, () => run, () => run);
export const closeLog = () => set({ open: false });

// The board's rows follow the run: the lead is read again on draft, send and needs_you and handed to the board.
const REFETCH = new Set(["draft", "send", "needs_you"]);
async function refetch(id: string) {
  try {
    const r = await fetch(`/api/leads/${encodeURIComponent(id)}`, { cache: "no-store" });
    if (r.ok) dispatchEvent(new CustomEvent(LEAD_LIVE, { detail: await r.json() }));
  } catch { /* the board's own poll picks it up */ }
}

let ctl: AbortController | null = null;
export async function startRun(body: { lead_ids?: string[]; dry?: boolean; mock?: boolean; wait_s?: number }) {
  if (run.phase === "running") return;
  ctl = new AbortController();
  set({ phase: "running", events: [], error: null, open: true });
  try {
    const res = await fetch("/api/autopilot/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: ctl.signal });
    if (!res.ok || !res.body) {
      const j = await res.json().catch(() => null) as { error?: string } | null;
      set({ phase: "error", error: j?.error ?? `Autopilot answered ${res.status}` }); return;
    }
    const rd = res.body.getReader(), dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await rd.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n"); buf = lines.pop() ?? "";
      for (const raw of lines) take(raw);
    }
    take(buf);
    set({ phase: run.error ? "error" : "done" });
  } catch (e) {
    if ((e as Error).name !== "AbortError") set({ phase: "error", error: (e as Error).message });
  }
}

function take(raw: string) {
  const line = raw.trim().replace(/^data:\s*/, "");
  if (!line || line.startsWith(":") || /^(event|id|retry):/.test(line)) return;
  let ev: ApEvent & { error?: string };
  try { ev = JSON.parse(line); } catch { return; }
  if (ev.error && !ev.step) { set({ error: ev.error }); return; }
  // One line per lead and step: an "active" line becomes its "done" line in place.
  const i = run.events.findIndex((x) => x.lead_id === ev.lead_id && x.step === ev.step && x.state === "active");
  const events = i >= 0 ? run.events.map((x, j) => (j === i ? ev : x)) : [...run.events, ev];
  set({ events });
  if (ev.lead_id && REFETCH.has(ev.step) && ev.state !== "active") refetch(ev.lead_id);
}
