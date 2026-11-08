import { NextRequest, NextResponse } from "next/server";
import { callEngine } from "@/lib/engine";
import { mockDay } from "@/components/systems/strip/fixture";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// v2.18 typical day: the browser asks here, the intake secret stays on the server. ?mockday=1 answers from a fixture
// on preview and local builds only, so the cards can be checked before the engine serves the route.
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const q = new URLSearchParams(req.nextUrl.searchParams);
  const day = q.get("day") === "winter" ? "winter" : "summer";
  if (q.get("mockday") === "1" && process.env.VERCEL_ENV !== "production") {
    const num = (k: string) => (q.get(k) ? Number(q.get(k)) : undefined);
    return NextResponse.json(mockDay(day, { battery_kwh: num("battery_kwh"), wallbox_kw: num("wallbox_kw"), heatpump_kw: num("heatpump_kw") }));
  }
  q.delete("mockday");
  // Local runs can point the day at a second engine (DAY_ENGINE_URL) while the rest reads the usual one.
  if (process.env.DAY_ENGINE_URL && process.env.VERCEL_ENV !== "production") {
    try {
      const r = await fetch(`${process.env.DAY_ENGINE_URL}/api/leads/${encodeURIComponent(id)}/day?${q}`, { headers: process.env.INTAKE_SECRET ? { "X-Intake-Secret": process.env.INTAKE_SECRET } : {}, cache: "no-store", signal: AbortSignal.timeout(20000) });
      return NextResponse.json(await r.json().catch(() => ({ error: `${r.status} ${r.statusText}` })), { status: r.status });
    } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 502 }); }
  }
  const out = await callEngine("GET", `/api/leads/${encodeURIComponent(id)}/day`, q, undefined,
    process.env.INTAKE_SECRET ? { "X-Intake-Secret": process.env.INTAKE_SECRET } : undefined);
  return NextResponse.json(out.body, { status: out.status });
}
