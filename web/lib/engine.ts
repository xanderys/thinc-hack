import "server-only";
import { mockApprove, mockCreateLead, mockDecision, mockGetLead, mockListLeads, mockPriors, mockStep } from "./mockLeads";
import { mockAsk, mockDesign, mockEval, mockHealth, mockInbox, mockProject, mockProjects, mockRefine, mockValidate } from "./mock";

export const ENGINE_URL = process.env.ENGINE_URL || "http://localhost:8000";
export const isMock = ENGINE_URL === "mock";

type Out = { status: number; body: unknown };

function mock(method: string, path: string, search: URLSearchParams, body: any): Out {
  const ok = (b: unknown): Out => ({ status: 200, body: b });
  if (path === "/health") return ok(mockHealth());
  if (path === "/api/design" && method === "POST") return ok(mockDesign(body.inputs));
  if (path === "/api/refine" && method === "POST") return ok(mockRefine(body.inputs, body.overrides));
  if (path === "/api/validate" && method === "POST") return ok(mockValidate(body.inputs, body.design));
  if (path === "/api/projects") return ok(mockProjects(Number(search.get("limit") ?? 50)));
  if (path.startsWith("/api/projects/")) {
    const p = mockProject(decodeURIComponent(path.slice("/api/projects/".length)));
    return p ? ok(p) : { status: 404, body: { error: "Project not found" } };
  }
  if (path === "/api/eval") return ok(mockEval());
  if (path === "/api/ask" && method === "POST") return ok(mockAsk(body.inputs, body.unknown));
  if (path === "/api/inbox") return ok(mockInbox(Number(search.get("limit") ?? 20)));
  return { status: 404, body: { error: `Mock has no route ${method} ${path}` } };
}

// v1.9 leads against a stand-in until the engine serves them (LEADS_MOCK=1, local only).
const leadsMock = process.env.LEADS_MOCK === "1";
function mockLeads(method: string, path: string, search: URLSearchParams, body: any): Out | null {
  if (path === "/api/leads" && method === "POST") return { status: 200, body: mockCreateLead(body) };
  if (path === "/api/leads") return { status: 200, body: mockListLeads(Number(search.get("limit") ?? 20)) };
  const v25 = path.match(/^\/api\/leads\/([^/]+)\/(approve|decision)$/);   // v2.5
  if (v25 && v25[2] === "approve" && method === "PUT") return mockApprove(decodeURIComponent(v25[1]), body);
  if (v25 && v25[2] === "decision" && method === "POST") return mockDecision(decodeURIComponent(v25[1]), body);
  if (path.startsWith("/api/leads/")) { const l = mockGetLead(decodeURIComponent(path.slice("/api/leads/".length))); return l ? { status: 200, body: l } : { status: 404, body: { error: "Lead not found" } }; }
  if (path === "/api/intake/priors") return { status: 200, body: mockPriors() };
  if (path === "/api/intake/step" && method === "POST") { const r = mockStep(body); return r ? { status: 200, body: r } : { status: 404, body: { error: "Lead not found" } }; }
  return null;
}

export async function callEngine(method: string, path: string, search: URLSearchParams, body?: unknown): Promise<Out> {
  if (isMock || leadsMock) { const m = mockLeads(method, path, search, body); if (m) return m; }
  if (isMock) return mock(method, path, search, body);
  const qs = search.toString();
  try {
    const res = await fetch(`${ENGINE_URL}${path}${qs ? `?${qs}` : ""}`, {
      method,
      headers: {
        ...(body ? { "content-type": "application/json" } : {}),
        // v1.9: reading leads needs the intake secret; server-side only, never sent to the browser.
        // v2.5: approve also needs it; the homeowner's decision POST goes through without it.
        ...(((method === "GET" && path.startsWith("/api/leads")) || (method === "POST" && path === "/api/intake/step") || (method === "PUT" && /^\/api\/leads\/[^/]+\/approve$/.test(path))) && process.env.INTAKE_SECRET ? { "X-Intake-Secret": process.env.INTAKE_SECRET } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(20000),
    });
    const text = await res.text();
    let parsed: unknown;
    const fallback = `Engine answered ${res.status}${res.statusText ? ` ${res.statusText}` : ""}${res.status === 502 ? ", it may be restarting (about 35 s)" : ""}.`;
    try { parsed = JSON.parse(text); } catch { parsed = { error: text.trim() || fallback }; }
    if (!res.ok && !(parsed && typeof parsed === "object" && (parsed as { error?: unknown }).error)) parsed = { error: text.trim() || fallback };
    return { status: res.status, body: parsed };
  } catch (e) {
    return { status: 502, body: { error: `Engine unreachable at ${ENGINE_URL}: ${(e as Error).message}` } };
  }
}
