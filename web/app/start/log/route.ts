import { NextRequest, NextResponse } from "next/server";

// record_fact payloads from the call screen, for reading a call back afterwards (server log only; no phone, no secret).
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (b) console.info("record_fact", JSON.stringify({ at: new Date().toISOString(), lead_id: b.lead_id, raw: b.raw, field: b.field, value: b.value, outcome: b.outcome }).slice(0, 600));
  return new NextResponse(null, { status: 204 });
}
