"use client";
// The autopilot runs in the copilot thread: a confirm card first (real runs), then one thread entry per engine event,
// then the summary as the agent's reply. The board's toolbar glyph and the "Run autopilot" chip both fire
// marquee:run-autopilot. Events per docs/briefs/autopilot.md.
import { LEAD_LIVE } from "@/lib/whatsapp";
import { itemOf, push, update, type ApEntry } from "@/components/agent/store";

export type ApEvent = {
  at: string; lead_id: string | null; name: string | null; step: string; text: string; glyph?: string;
  state: "active" | "done" | "needs_you" | "error"; summary?: { sent: number; needs_you: number; asked: number };
};
type Body = { lead_ids?: string[]; dry?: boolean; mock?: boolean; wait_s?: number; confirm?: boolean };

// ?dry=1 runs without sending; ?mock=1 plays the scripted run (off production only); ?confirm=1 forces the confirm card.
export function flags(): Body {
  const q = new URLSearchParams(location.search), ids = q.get("leads")?.split(",").filter(Boolean), w = q.get("wait");
  return { ...(q.get("dry") === "1" ? { dry: true } : {}), ...(q.get("mock") === "1" ? { mock: true } : {}), ...(ids?.length ? { lead_ids: ids } : {}), ...(w != null && /^\d+$/.test(w) ? { wait_s: Number(w) } : {}), ...(q.get("confirm") === "1" ? { confirm: true } : {}) };
}

let running = false, confirmId: number | null = null, pending: Body | null = null, mock = false;
export const isRunning = () => running || confirmId != null;

const REFETCH = new Set(["draft", "send", "needs_you"]);
async function refetch(id: string) {
  if (mock || id.startsWith("mock-")) return;
  try {
    const r = await fetch(`/api/leads/${encodeURIComponent(id)}`, { cache: "no-store" });
    const l = r.ok ? await r.json() : null;
    if (l?.lead_id === id) dispatchEvent(new CustomEvent(LEAD_LIVE, { detail: l }));
  } catch { /* the board's own poll picks it up */ }
}
const setConfirm = (f: (c: Extract<ApEntry, { kind: "confirm" }>) => Extract<ApEntry, { kind: "confirm" }>) => {
  if (confirmId == null) return;
  update(confirmId, (x) => (x.ap?.kind === "confirm" ? { ...x, ap: f(x.ap) } : x));
};

/** The glyph and the chip: a real run asks first in the thread; dry and mock runs start at once. */
export async function askRun(body: Body = flags()) {
  if (isRunning()) return;
  const { confirm, ...rest } = body;
  if ((rest.dry || rest.mock) && !confirm) { void startRun(rest); return; }
  pending = rest;
  confirmId = push({ who: "agent", text: "", ap: { kind: "confirm", n: null, state: "open" } });
  try {
    const r = await fetch("/api/autopilot/plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...(rest.lead_ids ? { lead_ids: rest.lead_ids } : {}), ...(rest.mock ? { mock: true } : {}) }) });
    const b = await r.json().catch(() => null) as { n?: number; error?: string } | null;
    if (r.ok && typeof b?.n === "number") { const n = b.n; setConfirm((c) => ({ ...c, n })); }
    else { const err = b?.error ?? `Autopilot answered ${r.status}`; setConfirm((c) => ({ ...c, state: "error", err })); confirmId = null; pending = null; }
  } catch (e) { const err = (e as Error).message; setConfirm((c) => ({ ...c, state: "error", err })); confirmId = null; pending = null; }
}
export function confirmRun() {
  if (confirmId == null || !pending) return;
  setConfirm((c) => ({ ...c, state: "running" }));
  const b = pending; pending = null; confirmId = null;
  void startRun(b);
}
export function cancelRun() {
  setConfirm((c) => ({ ...c, state: "cancelled" }));
  confirmId = null; pending = null;
}

async function startRun(body: Body) {
  if (running) return;
  running = true; mock = body.mock === true;
  const steps = new Map<string, number>();   // lead + step -> its thread entry, so "active" becomes "done" in place
  const seen: { id: string | null; name: string; out: "sent" | "needs_you" | "asked" | null; why?: string }[] = [];
  let summary: ApEvent | null = null, error: string | null = null;
  const take = (raw: string) => {
    const line = raw.trim().replace(/^data:\s*/, "");
    if (!line.startsWith("{")) return;
    let ev: ApEvent & { error?: string };
    try { ev = JSON.parse(line); } catch { return; }
    if (ev.error && !ev.step) { error = ev.error; return; }
    if (ev.step === "summary") { if (ev.state === "error") error = ev.text; else summary = ev; return; }
    const name = ev.name ?? "";
    const key = `${ev.lead_id}:${ev.step}`, at = steps.get(key), ap: ApEntry = { kind: "step", lead_id: ev.lead_id, name, step: ev.step, text: ev.text, state: ev.state };
    if (at != null && itemOf(at)?.ap?.kind === "step" && (itemOf(at)!.ap as { state: string }).state === "active") update(at, (x) => ({ ...x, ap }));
    else steps.set(key, push({ who: "event", text: "", ap }));
    if (ev.state !== "active") {
      let s = seen.find((x) => x.id === ev.lead_id);
      if (!s) { s = { id: ev.lead_id, name, out: null }; seen.push(s); }
      if (ev.step === "send") s.out = "sent";
      else if (ev.state === "needs_you" || ev.step === "needs_you") { s.out = "needs_you"; s.why = ev.text; }
      else if (ev.step === "ask" && s.out !== "sent") s.out = "asked";
      if (ev.lead_id && REFETCH.has(ev.step)) void refetch(ev.lead_id);
    }
  };
  try {
    const res = await fetch("/api/autopilot/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok || !res.body) {
      const j = await res.json().catch(() => null) as { error?: string } | null;
      error = j?.error ?? `Autopilot answered ${res.status}`;
    } else {
      const rd = res.body.getReader(), dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await rd.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const ls = buf.split("\n"); buf = ls.pop() ?? "";
        ls.forEach(take);
      }
      take(buf);
    }
  } catch (e) { error = (e as Error).message; }
  running = false;
  // The summary is the agent's reply: its first line, then what needs the planner, highlighted, one chip per lead.
  const chip = (s: { id: string | null; name: string }) => (s.id ? `[[lead: ${s.name}|${s.id}]]` : s.name);
  const needs = seen.filter((s) => s.out === "needs_you"), sent = seen.filter((s) => s.out === "sent");
  const lines: string[] = [];
  const sum = summary as ApEvent | null;
  if (sum) lines.push(sum.text);
  for (const s of needs) lines.push(`- ${chip(s)} ==${(s.why ?? "Needs you").replace(/^Needs you:\s*/i, "")}==`);
  if (sent.length) lines.push(`- ${sent.map(chip).join(" ")} [[ok: Sent]]`);
  if (lines.length || error) push({ who: "agent", text: lines.join("\n"), ...(error ? { err: { src: "Engine said", msg: error } } : {}) });
}

if (typeof window !== "undefined") {
  const w = window as Window & { __mqAutopilot?: boolean };
  if (!w.__mqAutopilot) { w.__mqAutopilot = true; addEventListener("marquee:run-autopilot", () => void askRun()); }
}
