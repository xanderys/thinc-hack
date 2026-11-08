import { NextRequest, NextResponse } from "next/server";
import { callEngine, isMock } from "@/lib/engine";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// v2.14 WhatsApp copilot: the browser asks here, the intake secret stays on the server.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (isMock) return NextResponse.json({ error: "The mock engine cannot send WhatsApp messages." }, { status: 400 });
  if (!process.env.INTAKE_SECRET) return NextResponse.json({ error: "INTAKE_SECRET is not set on this server." }, { status: 500 });
  const text = await req.text();
  let body: unknown = {};
  if (text.trim()) try { body = JSON.parse(text); } catch { return NextResponse.json({ error: "Body is not JSON" }, { status: 400 }); }
  const out = await callEngine("POST", `/api/leads/${encodeURIComponent(id)}/whatsapp/ask`, new URLSearchParams(), body,
    { "X-Intake-Secret": process.env.INTAKE_SECRET, "X-Client-Route": "whatsapp-ask" });
  return NextResponse.json(out.body, { status: out.status });
}
