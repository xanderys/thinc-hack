import { NextResponse, type NextRequest } from "next/server";

// The homeowner site is this same code deployed with HOMEOWNER_SITE=1: / shows the enquiry page and
// every planner route (pages, engine proxy, LLM routes, the planner's lead list) answers 404.
// The homeowner host opens the LLM and layers routes only for a lead the planner has released.
const RELEASED = new Set(["approved", "sent", "signed", "declined", "question"]);
const hits = new Map<string, number[]>();
function limited(ip: string) {
  const now = Date.now(), h = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  h.push(now); hits.set(ip, h);
  if (hits.size > 5000) hits.clear();
  return h.length > 10;
}
// A lead still on its call: the homeowner's call screen draws its scene and sends what Rina hears.
const CALLING = new Set(["draft", "in_call"]);
// A lead's status, kept 30 s per lead so each fact on a call costs no extra round trip.
const seen = new Map<string, { st: string | null; at: number }>();
async function statusOf(id: string | null, origin: string): Promise<string | null> {
  if (!id || !/^[\w-]+$/.test(id)) return null;
  const hit = seen.get(id);
  if (hit && Date.now() - hit.at < 30_000) return hit.st;
  const st = await statusFresh(id, origin);
  if (seen.size > 2000) seen.clear();
  if (st) seen.set(id, { st, at: Date.now() });
  return st;
}
async function statusFresh(id: string, origin: string): Promise<string | null> {
  // Through this app's own proxy, which adds the intake secret server side.
  const r = await fetch(`${origin}/api/leads/${id}`, { cache: "no-store" }).catch(() => null);
  if (!r?.ok) return null;
  const l = await r.json().catch(() => null);
  return typeof l?.status === "string" ? l.status : null;
}
const bodyOf = (req: NextRequest) => req.clone().json().catch(() => null) as Promise<Record<string, unknown> | null>;
async function released(req: NextRequest, alsoCalling = false) {
  const b = await bodyOf(req);
  const lid = typeof b?.lead_id === "string" && /^[\w-]+$/.test(b.lead_id) ? b.lead_id : null;
  const st = lid ? await statusFresh(lid, req.nextUrl.origin) : null;   // a release must open at once, so never the cache here
  return !!st && (RELEASED.has(st) || (alsoCalling && CALLING.has(st)));
}
// record_fact on the call screen: 20 facts a minute per lead.
const factHits = new Map<string, number[]>();
function factLimited(id: string) {
  const now = Date.now(), h = (factHits.get(id) ?? []).filter((t) => now - t < 60_000);
  h.push(now); factHits.set(id, h);
  if (factHits.size > 5000) factHits.clear();
  return h.length > 20;
}
const FACT_FIELDS = new Set(["annual_demand_kwh", "num_inhabitants", "heating_type", "boiler_age_years", "has_ev", "ev_planned", "house_built_year", "has_solar", "heating_demand_kwh", "has_wallbox", "heating_cost_per_year_eur", "electricity_price_ct_kwh"]);

const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#071b71"/><path d="M4 22 L22 8 L28 8 L10 22Z" fill="#ffc043"/></svg>`;

export async function middleware(req: NextRequest) {
  // A preflight on any path answers 204 instead of the 400 a missing OPTIONS handler gives.
  if (req.method === "OPTIONS") return new NextResponse(null, { status: 204, headers: { allow: "GET, POST, PUT, OPTIONS", "access-control-max-age": "600" } });
  if (req.nextUrl.pathname === "/favicon.ico") return new NextResponse(ICON, { headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=86400" } });
  if (process.env.HOMEOWNER_SITE !== "1") return NextResponse.next();
  const p = req.nextUrl.pathname;
  if (p === "/") { const u = req.nextUrl.clone(); u.pathname = "/start"; return NextResponse.rewrite(u); }
  if (p === "/start" || p === "/start/roof" || (p === "/start/log" && req.method === "POST")) return NextResponse.next();
  // The enquiry creates its lead and waits for the first design; the lead list stays planner-only.
  if (p === "/api/leads" && req.method === "POST") return NextResponse.next();
  if (/^\/api\/leads\/[\w-]+$/.test(p) && req.method === "GET") return NextResponse.next();
  // v2.5: the proposal page, its one-sentence lines, the house view and the homeowner's decision. Approve stays planner-only.
  if (/^\/start\/proposal\/[\w-]+$/.test(p)) return NextResponse.next();
  if (/^\/start\/proposal\/[\w-]+\/layers$/.test(p) && req.method === "GET") return NextResponse.next();
  if (/^\/api\/leads\/[\w-]+\/decision$/.test(p) && req.method === "POST") return NextResponse.next();
  if ((p === "/api/write" || p === "/api/explain/layers") && req.method === "POST") {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
    if (limited(ip)) return new NextResponse(JSON.stringify({ error: "Too many requests; try again in a minute." }), { status: 429, headers: { "content-type": "application/json" } });
    if (await released(req, p === "/api/explain/layers")) return NextResponse.next();
    return new NextResponse("Not found", { status: 404 });
  }
  // Claude's reading of a homeowner answer on the call: only while the lead is on its call, 30 a minute per lead.
  if (p === "/api/call/extract" && req.method === "POST") {
    const b = await bodyOf(req), id = typeof b?.lead_id === "string" ? b.lead_id : null;
    if (!id || typeof b?.answer !== "string") return new NextResponse("Not found", { status: 404 });
    if (factLimited(id)) return new NextResponse(JSON.stringify({ error: "Too many answers; try again in a minute." }), { status: 429, headers: { "content-type": "application/json" } });
    if (CALLING.has((await statusOf(id, req.nextUrl.origin)) ?? "")) return NextResponse.next();
    return new NextResponse("Not found", { status: 404 });
  }
  // A fact heard on the call: only call facts, only the record_fact fields, only while the lead is on its call.
  if (p === "/api/intake/step" && req.method === "POST") {
    const b = await bodyOf(req), id = typeof b?.lead_id === "string" ? b.lead_id : null;
    const facts = b?.facts_so_far && typeof b.facts_so_far === "object" ? Object.keys(b.facts_so_far as object) : [];
    const shapeOk = !!b && Object.keys(b).every((k) => k === "lead_id" || k === "facts_so_far" || k === "source") && b.source === "call" && facts.length > 0 && facts.every((f) => FACT_FIELDS.has(f));
    if (!id || !shapeOk) return new NextResponse("Not found", { status: 404 });
    if (factLimited(id)) return new NextResponse(JSON.stringify({ error: "Too many facts; try again in a minute." }), { status: 429, headers: { "content-type": "application/json" } });
    if (CALLING.has((await statusOf(id, req.nextUrl.origin)) ?? "")) return NextResponse.next();
    return new NextResponse("Not found", { status: 404 });
  }
  if ((p === "/api/health" || p === "/api/version") && req.method === "GET") return NextResponse.next();
  if (p === "/spatial-demo/glb" && req.method === "GET") return NextResponse.next();
  // Satellite ground, photo mesh and house photo: read-only Google proxies (no engine calls, the key stays server side).
  if ((/^\/api\/tiles\//.test(p) || p === "/api/photo") && req.method === "GET") return NextResponse.next();
  // Read-only roof model and shading through the engine proxy, for the 3D strip.
  if ((p === "/api/roof/model" || p === "/api/roof/model/file" || p === "/api/roof/shading") && req.method === "GET") return NextResponse.next();
  return new NextResponse("Not found", { status: 404 });
}

export const config = { matcher: ["/((?!_next/|.*\\.(?:woff2?|ttf|png|jpg|svg|webmanifest)$).*)"] };
