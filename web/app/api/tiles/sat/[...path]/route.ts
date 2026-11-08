// Google 2D satellite tiles (Map Tiles API) for the ground under the house, through our server so the key never
// reaches the browser. Same key as the 3D tiles (GOOGLE_MAPS_KEY).
//   GET /api/tiles/sat/{z}/{x}/{y}                              → one 256 px JPEG tile
//   GET /api/tiles/sat/viewport?zoom=&north=&south=&east=&west= → { copyright, maxZoom } for that area
// A satellite session (createSession, mapType satellite) is made once and renewed before it expires; tiles are
// cached in memory for the life of the server process (64 MB cap).
import { NextRequest, NextResponse } from "next/server";
import { tilesKey } from "@/lib/tiles";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const GOOGLE = "https://tile.googleapis.com";
let session: { token: string; expiry: number } | null = null;
let pending: Promise<string> | null = null;

async function token(): Promise<string> {
  if (session && session.expiry - Date.now() > 10 * 60 * 1000) return session.token;
  pending ??= fetch(`${GOOGLE}/v1/createSession?key=${tilesKey()}`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ mapType: "satellite", language: "en-GB", region: "DE" }),
  }).then(async (r) => {
    const j = await r.json().catch(() => null) as { session?: string; expiry?: string; error?: { message?: string } } | null;
    if (!r.ok || !j?.session) throw new Error(j?.error?.message || `Google createSession answered ${r.status}`);
    session = { token: j.session, expiry: Number(j.expiry ?? 0) * 1000 || Date.now() + 3600e3 };
    return j.session;
  }).finally(() => { pending = null; });
  return pending;
}

const cache = new Map<string, Uint8Array>();
let bytes = 0;
const MAX = 64 * 1024 * 1024;

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  if (!tilesKey()) return NextResponse.json({ error: "No Google Maps key on the server." }, { status: 503 });
  const { path } = await ctx.params;
  try {
    const t = await token();
    if (path[0] === "viewport") {
      const q = req.nextUrl.searchParams, p = new URLSearchParams({ session: t, key: tilesKey() });
      for (const k of ["zoom", "north", "south", "east", "west"]) p.set(k, q.get(k) ?? "");
      const r = await fetch(`${GOOGLE}/tile/v1/viewport?${p}`);
      const j = await r.json().catch(() => null) as { copyright?: string; maxZoomRects?: { maxZoom: number; north: number; south: number; east: number; west: number }[]; error?: { message?: string } } | null;
      if (!r.ok || !j) return NextResponse.json({ error: j?.error?.message || `Google viewport answered ${r.status}` }, { status: 502 });
      const lat = (Number(q.get("north")) + Number(q.get("south"))) / 2, lon = (Number(q.get("east")) + Number(q.get("west"))) / 2;
      const maxZoom = Math.max(0, ...(j.maxZoomRects ?? []).filter((m) => m.south <= lat && lat <= m.north && m.west <= lon && lon <= m.east).map((m) => m.maxZoom));
      return NextResponse.json({ copyright: j.copyright ?? "", maxZoom }, { headers: { "cache-control": "private, max-age=3600" } });
    }
    const [z, x, y] = path.map(Number);
    if (path.length !== 3 || [z, x, y].some((n) => !Number.isInteger(n) || n < 0) || z > 22) return NextResponse.json({ error: "Expected /z/x/y." }, { status: 400 });
    const k = `${z}/${x}/${y}`;
    let body = cache.get(k);
    if (!body) {
      const r = await fetch(`${GOOGLE}/v1/2dtiles/${k}?session=${t}&key=${tilesKey()}`);
      if (!r.ok) return NextResponse.json({ error: `Google 2D tiles answered ${r.status}` }, { status: 502 });
      body = new Uint8Array(await r.arrayBuffer());
      cache.set(k, body); bytes += body.byteLength;
      for (const [key, v] of cache) { if (bytes <= MAX) break; cache.delete(key); bytes -= v.byteLength; }
    }
    return new NextResponse(body as BodyInit, { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=86400" } });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}
