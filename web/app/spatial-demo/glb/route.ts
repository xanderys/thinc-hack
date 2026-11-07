// Binary pass-through for the house model (.glb). The JSON proxy at /api/[...path] parses text,
// which breaks binary files, so the glb comes through here.
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address");
  if (!address) return NextResponse.json({ error: "No address" }, { status: 400 });
  const base = process.env.ENGINE_URL || "http://localhost:8000";
  if (base === "mock") return NextResponse.json({ error: "The mock engine has no house models" }, { status: 404 });
  try {
    const res = await fetch(`${base}/api/roof/model/file?address=${encodeURIComponent(address)}`, { signal: AbortSignal.timeout(30000), cache: "no-store" });
    if (!res.ok) {
      const t = await res.text();
      let msg = t.trim() || `Engine answered ${res.status}`;
      try { msg = JSON.parse(t).error || msg; } catch {}
      return NextResponse.json({ error: msg }, { status: res.status });
    }
    return new NextResponse(res.body, {
      status: 200,
      headers: { "content-type": "model/gltf-binary", "cache-control": "public, max-age=86400" },
    });
  } catch (e) {
    return NextResponse.json({ error: `Engine not reachable: ${(e as Error).message}` }, { status: 502 });
  }
}
