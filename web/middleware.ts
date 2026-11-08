import { NextResponse, type NextRequest } from "next/server";

// The homeowner site is this same code deployed with HOMEOWNER_SITE=1: / shows the enquiry page and
// every planner route (pages, engine proxy, LLM routes, the planner's lead list) answers 404.
// The homeowner host opens the LLM and layers routes only for a lead the planner has released.
const RELEASED = new Set(["approved", "signed", "declined", "question"]);
const hits = new Map<string, number[]>();
function limited(ip: string) {
  const now = Date.now(), h = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  h.push(now); hits.set(ip, h);
  if (hits.size > 5000) hits.clear();
  return h.length > 10;
}
async function released(req: NextRequest) {
  const id = await req.clone().json().then((b) => (typeof b?.lead_id === "string" ? b.lead_id : null)).catch(() => null);
  if (!id || !/^[\w-]+$/.test(id)) return false;
  // Through this app's own proxy, which adds the intake secret server side.
  const r = await fetch(`${req.nextUrl.origin}/api/leads/${id}`, { cache: "no-store" }).catch(() => null);
  if (!r?.ok) return false;
  const l = await r.json().catch(() => null);
  return RELEASED.has(l?.status);
}

export async function middleware(req: NextRequest) {
  if (process.env.HOMEOWNER_SITE !== "1") return NextResponse.next();
  const p = req.nextUrl.pathname;
  if (p === "/") { const u = req.nextUrl.clone(); u.pathname = "/start"; return NextResponse.rewrite(u); }
  if (p === "/start" || p === "/start/roof") return NextResponse.next();
  // The enquiry creates its lead and waits for the first design; the lead list stays planner-only.
  if (p === "/api/leads" && req.method === "POST") return NextResponse.next();
  if (/^\/api\/leads\/[\w-]+$/.test(p) && req.method === "GET") return NextResponse.next();
  // v2.5: the proposal page, its one-sentence lines, the house view and the homeowner's decision. Approve stays planner-only.
  if (/^\/start\/proposal\/[\w-]+$/.test(p)) return NextResponse.next();
  if (/^\/api\/leads\/[\w-]+\/decision$/.test(p) && req.method === "POST") return NextResponse.next();
  if ((p === "/api/write" || p === "/api/explain/layers") && req.method === "POST") {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
    if (limited(ip)) return new NextResponse(JSON.stringify({ error: "Too many requests; try again in a minute." }), { status: 429, headers: { "content-type": "application/json" } });
    if (await released(req)) return NextResponse.next();
    return new NextResponse("Not found", { status: 404 });
  }
  if (p === "/spatial-demo/glb" && req.method === "GET") return NextResponse.next();
  // Satellite ground, photo mesh and house photo: read-only Google proxies (no engine calls, the key stays server side).
  if ((/^\/api\/tiles\//.test(p) || p === "/api/photo") && req.method === "GET") return NextResponse.next();
  // Read-only roof model and shading through the engine proxy, for the 3D strip.
  if ((p === "/api/roof/model" || p === "/api/roof/model/file" || p === "/api/roof/shading") && req.method === "GET") return NextResponse.next();
  return new NextResponse("Not found", { status: 404 });
}

export const config = { matcher: ["/((?!_next/|favicon\\.ico|.*\\.(?:woff2?|ttf|png|jpg|svg|ico|webmanifest)$).*)"] };
