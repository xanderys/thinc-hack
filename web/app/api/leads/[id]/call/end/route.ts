import { NextRequest, NextResponse } from "next/server";
import { callEngine, isMock } from "@/lib/engine";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// The call UI ends a call (hangup or pagehide beacon): the engine closes "On a call". The secret stays on the server.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (isMock) return NextResponse.json({ error: "The mock engine has no calls to end." }, { status: 400 });
  if (!process.env.INTAKE_SECRET) return NextResponse.json({ error: "INTAKE_SECRET is not set on this server." }, { status: 500 });
  const text = await req.text();
  let body: unknown = {};
  if (text.trim()) try { body = JSON.parse(text); } catch { body = {}; }
  const out = await callEngine("POST", `/api/leads/${encodeURIComponent(id)}/call/end`, new URLSearchParams(), body,
    { "X-Intake-Secret": process.env.INTAKE_SECRET, "X-Client-Route": "call-end" });
  return NextResponse.json(out.body, { status: out.status });
}
