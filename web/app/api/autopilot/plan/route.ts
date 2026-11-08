import { NextRequest } from "next/server";
import { ap } from "../_engine";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// How many WhatsApps a real run would send: a dry run of the same queue (no waiting), counting its sends and new asks.
export async function POST(req: NextRequest) {
  let body: { lead_ids?: unknown; mock?: unknown };
  try { body = await req.json(); } catch { body = {}; }
  if (process.env.AUTOPILOT_MOCK === "1" || (body.mock === true && process.env.VERCEL_ENV !== "production")) return Response.json({ n: 3 });
  const out: { dry: true; wait_s: 0; lead_ids?: string[] } = { dry: true, wait_s: 0 };
  if (Array.isArray(body.lead_ids)) out.lead_ids = body.lead_ids.filter((x): x is string => typeof x === "string");
  const res = await ap("POST", "/api/autopilot/run", out, 55000);
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    let error = text.trim() || `Engine answered ${res.status}`;
    try { const j = JSON.parse(text); error = j.error ?? j.detail ?? error; } catch { /* plain text */ }
    return Response.json({ error }, { status: res.status >= 400 ? res.status : 502 });
  }
  let n = 0;
  for (const raw of text.split("\n")) {
    const line = raw.trim().replace(/^data:\s*/, "");
    if (!line.startsWith("{")) continue;
    try {
      const e = JSON.parse(line) as { step?: string; state?: string; text?: string };
      if (e.step === "summary" && e.state === "error") return Response.json({ error: e.text ?? "Autopilot is already running" }, { status: 409 });
      if (e.state === "done" && (e.step === "send" || (e.step === "ask" && !/^Already asked/.test(e.text ?? "")))) n++;
    } catch { /* not an event */ }
  }
  return Response.json({ n });
}
