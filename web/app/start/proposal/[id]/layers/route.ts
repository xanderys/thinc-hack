import { NextRequest, NextResponse } from "next/server";
import { callEngine } from "@/lib/engine";

// The homeowner's view of the layers behind its canvas: a GET that computes nothing it was not asked for and never
// writes. The lead's own facts and approved design go to the engine's read-only explain call, server side, and the
// answer is kept per lead version, so a reload costs no second computation.
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const cache = new Map<string, unknown>();

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[\w-]+$/.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const lead = await callEngine("GET", `/api/leads/${id}`, new URLSearchParams());
  if (lead.status !== 200) return NextResponse.json(lead.body, { status: lead.status });
  const l = lead.body as { status?: string; version?: number; facts?: Record<string, unknown>; address_or_postcode?: string; approved?: { design?: unknown }; draft?: { design?: unknown } };
  if (!["approved", "sent", "signed", "declined", "question"].includes(l.status ?? "")) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const design = l.approved?.design ?? l.draft?.design;
  const key = `${id}:${l.version ?? 0}:${JSON.stringify(design)}`;
  const hit = cache.get(key);
  if (hit) return NextResponse.json(hit);
  const out = await callEngine("POST", "/api/explain/layers", new URLSearchParams(), { inputs: { ...(l.facts ?? {}), address: l.address_or_postcode }, design, lead_id: id });
  if (out.status === 200) { if (cache.size > 200) cache.clear(); cache.set(key, out.body); }
  return NextResponse.json(out.body, { status: out.status });
}
