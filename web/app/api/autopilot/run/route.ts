import { NextRequest } from "next/server";
import { ap } from "../_engine";
import { mockRun } from "./mock";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST {lead_ids?, dry?} → the engine's event stream, passed through as it arrives.
// A local mock run (AUTOPILOT_MOCK=1, or {mock: true} off production) for UI checks without the engine.
export async function POST(req: NextRequest) {
  let body: { lead_ids?: unknown; dry?: unknown; mock?: unknown; wait_s?: unknown };
  try { body = await req.json(); } catch { body = {}; }
  const out: { lead_ids?: string[]; dry?: boolean; wait_s?: number } = {};
  if (Array.isArray(body.lead_ids)) out.lead_ids = body.lead_ids.filter((x): x is string => typeof x === "string");
  if (body.dry === true) out.dry = true;
  if (typeof body.wait_s === "number" && body.wait_s >= 0) out.wait_s = Math.min(body.wait_s, 240);
  const sse = { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no" };
  if (process.env.AUTOPILOT_MOCK === "1" || (body.mock === true && process.env.VERCEL_ENV !== "production")) return new Response(mockRun(), { headers: sse });
  const res = await ap("POST", "/api/autopilot/run", out, 290000);
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    let error = text.trim() || `Engine answered ${res.status}`;
    try { const j = JSON.parse(text); error = j.error ?? j.detail ?? error; } catch { /* plain text */ }
    if (res.status === 404) error = "The engine has no autopilot yet.";
    return Response.json({ error }, { status: res.status >= 400 ? res.status : 502 });
  }
  return new Response(res.body, { headers: sse });
}
