import { NextResponse } from "next/server";
import { ENGINE_URL, isMock } from "@/lib/engine";

export const dynamic = "force-dynamic";

type Row = { lead_id: string; customer_name?: string; pinned?: boolean };
type Lead = { customer_name?: string; draft?: { design?: { pv_kwp?: number | null; battery_kwh?: number | null }; economics?: { capex_eur?: number | null } } };

const num = (x: number | null | undefined) => (x == null || x === 0 ? "none" : (Math.round(x * 100) / 100).toLocaleString("en-GB"));

// Engine reset on every pinned lead; the secret stays on the server.
async function engine(method: string, path: string): Promise<{ ok: boolean; body: any }> {
  try {
    const res = await fetch(`${ENGINE_URL}${path}`, {
      method, cache: "no-store", signal: AbortSignal.timeout(30000),
      headers: { "X-Intake-Secret": process.env.INTAKE_SECRET ?? "", "X-Client-Route": "check reset demo leads" },
    });
    const text = await res.text();
    let body: any; try { body = JSON.parse(text); } catch { body = { error: text.trim() || `Engine answered ${res.status}` }; }
    if (!res.ok && !body?.error) body = { error: `Engine answered ${res.status}` };
    return { ok: res.ok, body };
  } catch (e) {
    return { ok: false, body: { error: `Engine unreachable at ${ENGINE_URL}: ${(e as Error).message}` } };
  }
}

// Optional body {only: [ids]} narrows the reset to those pinned leads (used to test without touching the hero).
export async function POST(req: Request) {
  const only: string[] | null = await req.json().then((b) => Array.isArray(b?.only) ? b.only : null).catch(() => null);
  if (isMock) return NextResponse.json({ error: "The mock engine has no demo leads to reset." }, { status: 400 });
  if (!process.env.INTAKE_SECRET) return NextResponse.json({ error: "INTAKE_SECRET is not set on this server." }, { status: 500 });
  const list = await engine("GET", "/api/leads?limit=200&include_test=1");
  if (!list.ok) return NextResponse.json({ error: list.body.error }, { status: 502 });
  const pinned = (Array.isArray(list.body) ? list.body : list.body?.leads ?? []).filter((r: Row) => r.pinned && (!only || only.includes(r.lead_id))) as Row[];
  if (!pinned.length) return NextResponse.json({ error: "No lead is pinned." }, { status: 404 });
  const lines: { lead_id: string; ok: boolean; line: string }[] = [];
  for (const r of pinned) {
    const name = r.customer_name || r.lead_id;
    const reset = await engine("PUT", `/api/leads/${encodeURIComponent(r.lead_id)}/reset`);
    if (!reset.ok) { lines.push({ lead_id: r.lead_id, ok: false, line: `${name}: ${reset.body.error}` }); continue; }
    const back = await engine("GET", `/api/leads/${encodeURIComponent(r.lead_id)}`);
    if (!back.ok) { lines.push({ lead_id: r.lead_id, ok: false, line: `${name}: reset, but reading it back failed: ${back.body.error}` }); continue; }
    const l = back.body as Lead, d = l.draft?.design, capex = l.draft?.economics?.capex_eur;
    lines.push({ lead_id: r.lead_id, ok: true, line: `${l.customer_name || name}: reset to ${num(d?.pv_kwp)} / ${num(d?.battery_kwh)}${capex ? `, €${Math.round(capex).toLocaleString("en-GB")}` : ""}` });
  }
  return NextResponse.json({ lines });
}
