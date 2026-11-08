import { NextRequest, NextResponse } from "next/server";
import { callEngine } from "@/lib/engine";

export const dynamic = "force-dynamic";

async function handle(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const enginePath = path[0] === "health" ? "/health" : `/api/${path.map(encodeURIComponent).join("/")}`;
  let body: unknown;
  if (req.method === "POST" || req.method === "PUT") {
    const text = await req.text();
    // PUT approve may come with no body (variant is optional).
    if (req.method === "PUT" && !text.trim()) body = {};
    else try { body = JSON.parse(text); } catch { return NextResponse.json({ error: "Body is not JSON" }, { status: 400 }); }
  }
  const route = req.headers.get("x-client-route");
  const out = await callEngine(req.method, enginePath, req.nextUrl.searchParams, body, route ? { "X-Client-Route": route.slice(0, 80) } : undefined);
  return NextResponse.json(out.body, { status: out.status });
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;   // v2.5 approve
