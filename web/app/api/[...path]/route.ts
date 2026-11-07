import { NextRequest, NextResponse } from "next/server";
import { callEngine } from "@/lib/engine";

export const dynamic = "force-dynamic";

async function handle(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const enginePath = path[0] === "health" ? "/health" : `/api/${path.map(encodeURIComponent).join("/")}`;
  let body: unknown;
  if (req.method === "POST") {
    try { body = await req.json(); } catch { return NextResponse.json({ error: "Body is not JSON" }, { status: 400 }); }
  }
  const out = await callEngine(req.method, enginePath, req.nextUrl.searchParams, body);
  return NextResponse.json(out.body, { status: out.status });
}

export const GET = handle;
export const POST = handle;
