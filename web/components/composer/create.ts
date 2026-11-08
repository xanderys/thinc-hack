import { call, send } from "@/lib/client";

export type Facts = Partial<{ name: string; address: string; postcode: string; num_inhabitants: number; heating_type: string; heating_stated: string; has_ev: boolean; ev_planned: boolean; annual_demand_kwh: number; phone: string; note: string }>;
export type Source = "email" | "planner" | "voice";
export type Created =
  | { ok: true; lead_id: string; name: string; place: string }
  | { ok: false; ask: true; facts: Facts }
  | { ok: false; ask?: false; src: string; msg: string };

export const sourceOf = (t: string): Source => (t.length > 200 || /\b(From:|Betreff|Subject)/i.test(t) ? "email" : "planner");
const errOf = (e: string) => e.replace(/^\{?"?detail"?:\s*/, "");

// Rina's lines come from fixed templates, never from the model.
export const REPLY = {
  roof: (a: string) => `Got it, measuring the roof at ${a}.`,
  ready: (n: string) => `Draft ready for ${n}.`,
  ask: "Got it. Which address?",
};

/** Read a scrap, email or transcript, create a test lead and run the first intake step. `kept` carries facts from an earlier scrap that lacked an address. */
export async function createLeadFromText(text: string, source: Source, opts: { kept?: Facts | null; onRoof?: (place: string) => void } = {}): Promise<Created> {
  const read = await call<Facts>("/api/interpret", { mode: "composer", text });
  if (!read.ok) return { ok: false, src: "Reader said", msg: read.error };
  const f: Facts = { ...(opts.kept ?? {}), ...read.data };
  const place = f.address ?? f.postcode;
  if (!place) return { ok: false, ask: true, facts: f };
  const name = f.name?.trim() || place;
  opts.onRoof?.(place);
  const made = await send<{ lead_id: string }>("/api/leads", { customer_name: name, address_or_postcode: place, installer_id: "2a8ba8e2", source: "form", test: true, ...(f.phone ? { phone: f.phone } : {}) }, "composer-lead");
  if (!made.ok) return { ok: false, src: "Engine said", msg: errOf(made.error) };
  const id = made.data.lead_id;
  const facts: Record<string, unknown> = { customer_name: name };
  for (const k of ["address", "postcode", "num_inhabitants", "heating_type", "heating_stated", "has_ev", "ev_planned", "annual_demand_kwh"] as const) if (f[k] !== undefined) facts[k] = f[k];
  let step = await send("/api/intake/step", { lead_id: id, facts_so_far: facts, source }, "composer-step");
  // The engine's documented sources are whatsapp, call, form, planner: an older engine refuses email and voice.
  if (!step.ok && step.status === 422 && source !== "planner") step = await send("/api/intake/step", { lead_id: id, facts_so_far: facts, source: "planner" }, "composer-step");
  if (!step.ok) return { ok: false, src: "Engine said", msg: errOf(step.error) };
  dispatchEvent(new CustomEvent("marquee:lead-created", { detail: id }));
  return { ok: true, lead_id: id, name, place };
}

/** Clip to text: WalaoFlow first (16 kHz mono PCM), the engine's speech to text when it is unreachable. */
export async function transcribe(blob: Blob): Promise<{ text: string } | { error: string }> {
  let last = "";
  try {
    const res = await fetch("/api/leads/dictate", { method: "POST", headers: { "content-type": "application/octet-stream" }, body: await pcm16k(blob) });
    const j = await res.json().catch(() => ({}));
    if (res.ok && typeof j.text === "string" && j.text.trim()) return { text: j.text.trim() };
    last = j.error ?? `${res.status} ${res.statusText}`;
  } catch (e) { last = (e as Error).message; }
  const fd = new FormData(); fd.append("audio", blob, "voice.webm");
  try {
    const res = await fetch("/api/leads/transcribe", { method: "POST", body: fd });
    const j = await res.json().catch(() => ({ error: `${res.status} ${res.statusText}` }));
    if (res.ok && typeof j.text === "string" && j.text.trim()) return { text: j.text.trim() };
    last = typeof j.error === "string" ? j.error : typeof j.detail === "string" ? j.detail : `${res.status} ${res.statusText}`;
  } catch (e) { last = (e as Error).message; }
  return { error: last || "Nothing was heard." };
}

async function pcm16k(blob: Blob): Promise<ArrayBuffer> {
  const ctx = new AudioContext();
  try {
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    const off = new OfflineAudioContext(1, Math.max(1, Math.ceil(buf.duration * 16000)), 16000);
    const src = off.createBufferSource(); src.buffer = buf; src.connect(off.destination); src.start();
    const f = (await off.startRendering()).getChannelData(0);
    const out = new Int16Array(f.length);
    for (let i = 0; i < f.length; i++) out[i] = Math.max(-1, Math.min(1, f[i])) * 0x7fff;
    return out.buffer;
  } finally { void ctx.close(); }
}

