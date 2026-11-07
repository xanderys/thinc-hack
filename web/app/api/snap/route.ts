// First-frame pictures of the 3D view (components/spatial/snapshot.ts), held in this server process's memory only:
// 64 at most, 600 KB each, a day each. GET ?k= → { url } or 404; POST ?k= { url: "data:image/jpeg;base64,..." }.
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX = 64, SIZE = 600_000, TTL = 24 * 3600_000;
const store = new Map<string, { url: string; at: number }>();
const keyOf = (req: NextRequest) => { const k = req.nextUrl.searchParams.get("k") ?? ""; return /^[\w.-]{3,120}$/.test(k) ? k : null; };

export async function GET(req: NextRequest) {
  const k = keyOf(req), v = k ? store.get(k) : undefined;
  if (!v || Date.now() - v.at > TTL) return NextResponse.json({ error: "No picture yet" }, { status: 404 });
  return NextResponse.json({ url: v.url }, { headers: { "cache-control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const k = keyOf(req);
  const body = (await req.json().catch(() => null)) as { url?: unknown } | null;
  const url = typeof body?.url === "string" ? body.url : "";
  if (!k || !url.startsWith("data:image/jpeg;base64,") || url.length > SIZE) return NextResponse.json({ error: "Not a picture this route keeps" }, { status: 400 });
  store.delete(k); store.set(k, { url, at: Date.now() });
  while (store.size > MAX) store.delete(store.keys().next().value as string);
  return NextResponse.json({ ok: true });
}
