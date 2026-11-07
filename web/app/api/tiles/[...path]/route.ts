// Google Photorealistic 3D Tiles proxy. The browser never sees the key.
//   GET /api/tiles/status?address=...   → { mode: "google" | "off", root, anchor, error? }; also warms that address
//   GET /api/tiles/warm?address=...     → walks the tile tree down to the house into the server cache
//   GET /api/tiles/v1/3dtiles/root.json → Google's root with child URIs rewritten to this proxy
//   GET /api/tiles/v1/<path>?session=.. → one tile or nested tileset
import { NextRequest, NextResponse } from "next/server";
import { callEngine } from "@/lib/engine";
import { anchorOf, getRoot, getTile, tilesKey, TilesError, warm, type Anchor } from "@/lib/tiles";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HERO = "Katharinenstraße 5, 82008 Unterhaching";
const anchors = new Map<string, Promise<Anchor | null>>();

function anchorFor(address: string) {
  let a = anchors.get(address);
  if (!a) {
    a = callEngine("GET", "/api/roof/model", new URLSearchParams({ address })).then((out) => {
      const o = (out.body as { origin_utm32?: [number, number, number] } | null)?.origin_utm32;
      return out.status === 200 && Array.isArray(o) && o.length === 3 ? anchorOf(o) : null;
    });
    a.then((x) => { if (!x) anchors.delete(address); }, () => anchors.delete(address));
    anchors.set(address, a);
  }
  return a;
}

const warmAddress = (address: string) => anchorFor(address).then((a) => (a ? warm(address, a) : null));

// The first request to this route in a server process (the card's status call on mount) fetches Google's root
// at once, so the cold start happens before anyone taps Photo; then the hero house's tiles are warmed.
if (tilesKey() && process.env.NEXT_PHASE !== "phase-production-build") {
  getRoot().catch(() => {});
  warmAddress(HERO).catch(() => {});
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const address = req.nextUrl.searchParams.get("address") || HERO;
  try {
    if (path[0] === "status") {
      if (!tilesKey()) return NextResponse.json({ mode: "off", error: "No Google Maps key on the server" });
      const [anchor] = await Promise.all([anchorFor(address), getRoot()]);
      if (!anchor) return NextResponse.json({ mode: "off", error: "No house model at this address" });
      warmAddress(address).catch(() => {});
      return NextResponse.json({ mode: "google", root: "/api/tiles/v1/3dtiles/root.json", anchor });
    }
    if (path[0] === "warm") {
      if (!tilesKey()) return NextResponse.json({ error: "No Google Maps key on the server" }, { status: 503 });
      const r = await warmAddress(address);
      return r ? NextResponse.json({ address, ...r }) : NextResponse.json({ error: "No house model at this address" }, { status: 404 });
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
