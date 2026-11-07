import { NextResponse, type NextRequest } from "next/server";

// The homeowner site is this same code deployed with HOMEOWNER_SITE=1: / shows the enquiry page and
// every planner route (pages, engine proxy, LLM routes, the planner's lead list) answers 404.
export function middleware(req: NextRequest) {
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
  if ((p === "/api/write" || p === "/api/explain/layers") && req.method === "POST") return NextResponse.next();
  if (p === "/spatial-demo/glb" && req.method === "GET") return NextResponse.next();
  return new NextResponse("Not found", { status: 404 });
}

export const config = { matcher: ["/((?!_next/|favicon\\.ico|.*\\.(?:woff2?|ttf|png|jpg|svg|ico|webmanifest)$).*)"] };
