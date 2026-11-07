// Google Photorealistic 3D Tiles proxy. The browser never sees the key. The mesh path makes no engine calls: the house origin comes
// from the client (the layers response it already has), so the mesh path never adds load to the engine.
//   GET /api/tiles/status?o=E,N,Z     → { mode: "google" | "off", root, anchor, warm, error? }; warms that origin's tiles
//   GET /api/tiles/status?address=..  → the same, anchor looked up once on the engine (satellite ground only)
//   GET /api/tiles/warm?o=E,N,Z       → walks the tile tree down to the house into the server cache
//   GET /api/tiles/v1/3dtiles/root.json → Google's root with child URIs rewritten to this proxy
//   GET /api/tiles/v1/<path>?session=.. → one tile or nested tileset
import { NextRequest, NextResponse } from "next/server";
import { callEngine } from "@/lib/engine";
import { anchorOf, getRoot, getTile, tilesKey, TilesError, warm, type Anchor } from "@/lib/tiles";
import { isOrigin } from "@/lib/tilesGeo";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// The hero house (Katharinenstraße 5, 82008 Unterhaching): the engine's origin_utm32 for building DEBY_LOD2_5087420.
const HERO: [number, number, number] = [694694.81, 5326608.41, 559.0];
const originOf = (q: string | null) => { const o = q?.split(",").map(Number); return isOrigin(o) ? o : null; };
// The satellite ground (satGround.ts) only has an address: one engine lookup per address per server process,
// cached, never on the mesh path and never warming. The mesh passes ?o= and needs no engine.
const byAddress = new Map<string, Promise<Anchor | null>>();
function anchorForAddress(address: string) {
  let a = byAddress.get(address);
  if (!a) {
    a = callEngine("GET", "/api/roof/model", new URLSearchParams({ address })).then((out) => {
      const o = (out.body as { origin_utm32?: unknown } | null)?.origin_utm32;
      return out.status === 200 && isOrigin(o) ? anchorOf(o) : null;
    }, () => null);
    a.then((x) => { if (!x) byAddress.delete(address); });
    byAddress.set(address, a);
  }
  return a;
}
const warmOrigin = (o: [number, number, number]) => warm(o.map((x) => x.toFixed(1)).join(","), anchorOf(o));

// The first request to this route in a server process (the card's status call on mount) fetches Google's root
// at once, so the cold start happens before the 3D view needs it; then the hero house's tiles are warmed.
if (tilesKey() && process.env.NEXT_PHASE !== "phase-production-build") {
  getRoot().catch(() => {});
  warmOrigin(HERO).catch(() => {});
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const origin = originOf(req.nextUrl.searchParams.get("o"));
  try {
    if (path[0] === "status") {
      if (!tilesKey()) return NextResponse.json({ mode: "off", error: "No Google Maps key on the server" });
      await getRoot();
      let warmNow = false;
      if (origin) {
        const run = warmOrigin(origin); run.catch(() => {});
        warmNow = await Promise.race([run.then(() => true, () => false), new Promise<boolean>((r) => setTimeout(() => r(false), 30))]);
      }
      const address = req.nextUrl.searchParams.get("address");
      const anchor = origin ? anchorOf(origin) : address ? await anchorForAddress(address) : null;
      return NextResponse.json({ mode: "google", root: "/api/tiles/v1/3dtiles/root.json", anchor, warm: warmNow });
    }
    if (path[0] === "warm") {
      if (!tilesKey()) return NextResponse.json({ error: "No Google Maps key on the server" }, { status: 503 });
      const r = await warmOrigin(origin ?? HERO);
      return NextResponse.json(r);
    }
    if (path[0] !== "v1") return NextResponse.json({ error: "Unknown tiles route" }, { status: 404 });
    const rest = path.slice(1).join("/");
    if (rest === "3dtiles/root.json") {
      const r = await getRoot();
      return new NextResponse(r.json, { headers: { "content-type": "application/json", "cache-control": "no-store" } });
    }
    const h = await getTile(rest, req.nextUrl.searchParams.get("session"));
    return new NextResponse(h.body as BodyInit, { headers: { "content-type": h.type, "cache-control": "private, max-age=3600" } });
  } catch (e) {
    const status = e instanceof TilesError ? e.status : 502;
    if (path[0] === "status") return NextResponse.json({ mode: "off", error: (e as Error).message });
    return NextResponse.json({ error: (e as Error).message }, { status });
  }
}
