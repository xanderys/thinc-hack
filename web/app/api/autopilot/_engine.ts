import "server-only";
import { ENGINE_URL } from "@/lib/engine";

// Autopilot calls carry the intake secret; it never leaves the server.
export async function ap(method: "GET" | "POST", path: string, body?: unknown, timeoutMs = 30000): Promise<Response> {
  if (!process.env.INTAKE_SECRET) return Response.json({ error: "INTAKE_SECRET is not set on this server." }, { status: 500 });
  try {
    return await fetch(`${ENGINE_URL}${path}`, {
      method, cache: "no-store", signal: AbortSignal.timeout(timeoutMs),
      headers: { "X-Intake-Secret": process.env.INTAKE_SECRET, "X-Client-Route": "autopilot", ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    return Response.json({ error: `Engine unreachable at ${ENGINE_URL}: ${(e as Error).message}` }, { status: 502 });
  }
}

// A JSON answer passed on as JSON, with the engine's own words on failure.
export async function json(res: Response): Promise<Response> {
  const text = await res.text();
  let body: unknown;
  try { body = JSON.parse(text); } catch { body = { error: text.trim() || `Engine answered ${res.status}` }; }
  if (!res.ok && !(body as { error?: unknown })?.error) body = { error: (body as { detail?: string })?.detail ?? `Engine answered ${res.status}` };
  return Response.json(body, { status: res.status });
}
