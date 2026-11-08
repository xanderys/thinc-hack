import { NextRequest, NextResponse } from "next/server";
import { callEngine, isMock } from "@/lib/engine";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// v2.14 WhatsApp copilot: the browser asks here, the intake secret stays on the server.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (isMock) return NextResponse.json({ error: "The mock engine cannot send WhatsApp messages." }, { status: 400 });
  if (!process.env.INTAKE_SECRET) return NextResponse.json({ error: "INTAKE_SECRET is not set on this server." }, { status: 500 });
  const demo = await demoFill(id);
  if (demo) return demo;
  const text = await req.text();
  let body: unknown = {};
  if (text.trim()) try { body = JSON.parse(text); } catch { return NextResponse.json({ error: "Body is not JSON" }, { status: 400 }); }
  const out = await callEngine("POST", `/api/leads/${encodeURIComponent(id)}/whatsapp/ask`, new URLSearchParams(), body,
    { "X-Intake-Secret": process.env.INTAKE_SECRET, "X-Client-Route": "whatsapp-ask" });
  return NextResponse.json(out.body, { status: out.status });
}

// Demo shortcut (Xander, 8 Nov): on a lead named "Katrin Huber" that is not the pinned hero, Ask sends no WhatsApp.
// It fills the facts the hero's homeowner stated, as if she had replied, so the stage demo needs no long call.
const HERO = "db67b84935";
const FIELDS = ["installer_id", "annual_demand_kwh", "load_profile", "num_inhabitants", "house_size_sqm", "house_built_year",
  "has_ev", "has_wallbox", "heating_type", "heating_cost_per_year_eur", "electricity_price_ct_kwh", "has_solar"];
type L = { customer_name?: string; facts?: Record<string, unknown> };
async function demoFill(id: string): Promise<NextResponse | null> {
  if (id === HERO) return null;
  const lead = await callEngine("GET", `/api/leads/${encodeURIComponent(id)}`, new URLSearchParams());
  const name = String((lead.body as L)?.customer_name ?? "").trim().toLowerCase();
  if (lead.status !== 200 || name !== "katrin huber") return null;
  const hero = await callEngine("GET", `/api/leads/${HERO}`, new URLSearchParams());
  const hf = (hero.body as L)?.facts ?? {};
  const write: Record<string, unknown> = {};
  for (const k of FIELDS) if (hf[k] != null && hf[k] !== "") write[k] = hf[k];
  await new Promise((r) => setTimeout(r, 1200));
  let step = await callEngine("POST", "/api/intake/step", new URLSearchParams(), { lead_id: id, facts_so_far: write, source: "whatsapp" }, { "X-Client-Route": "demo-ask" });
  if (step.status >= 400) step = await callEngine("POST", "/api/intake/step", new URLSearchParams(), { lead_id: id, facts_so_far: write }, { "X-Client-Route": "demo-ask" });
  return NextResponse.json(step.status < 400 ? { ok: true, demo: true, filled: Object.keys(write) } : step.body, { status: step.status < 400 ? 200 : step.status });
}
