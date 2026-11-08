import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { callEngine } from "@/lib/engine";

// The call's one fact writer: after each homeowner turn, Claude reads the answer against the question and returns only
// the facts it is sure of, in the engine's own names and types. Those go to the intake step with source "call".
export const dynamic = "force-dynamic";
export const maxDuration = 30;
const MODEL = "claude-haiku-5-5";
const YEAR = 2026;

const HEAT = ["Gas", "Oil", "Electric", "HeatPump", "District", "Wood", "OtherNonRenewable"] as const;
const ENGINE_HEAT: Record<(typeof HEAT)[number], string> = { Gas: "gas", Oil: "oil", Electric: "electric", HeatPump: "heat pump", District: "district", Wood: "OtherRenewable", OtherNonRenewable: "OtherNonRenewable" };
const FIELDS = {
  num_inhabitants: { type: "integer", description: "People living in the home, counting children (\"we're four, two kids\" is 4)." },
  annual_demand_kwh: { type: "integer", description: "Household electricity use in kWh a year. \"About 5,000 a year\" in answer to a usage question is 5000. A monthly bill in euros is not kWh: leave this null." },
  monthly_bill_eur: { type: "number", description: "Monthly electricity bill in euros, only if stated as money." },
  heating_type: { type: "string", enum: HEAT, description: "How the house is heated today. Gas boiler or Erdgas is Gas; oil or Heizöl is Oil; night storage or electric heaters is Electric; pellets or wood is Wood." },
  boiler_age_years: { type: "integer", description: `Age of the current boiler in years. If they give an install year or decade, it is ${YEAR} minus that year ("from the 80s" is ${YEAR} - 1985 = ${YEAR - 1985}).` },
  has_ev: { type: "boolean", description: "An electric car in the household now." },
  ev_planned: { type: "boolean", description: "An electric car planned (\"might get one next year\" is true)." },
  has_solar: { type: "boolean", description: "Solar panels already on the roof." },
  has_wallbox: { type: "boolean", description: "A wallbox (car charger) already installed." },
  house_built_year: { type: "integer", description: "Year the house was built; a decade is its middle year (1980s is 1985)." },
  heating_cost_per_year_eur: { type: "number", description: "Heating cost a year in euros." },
  electricity_price_ct_kwh: { type: "number", description: "Electricity price in cents per kWh." },
} as const;
type Field = keyof typeof FIELDS;
const NAMES = Object.keys(FIELDS) as Field[];

const tool = {
  name: "record_facts",
  description: "Record the facts the homeowner's latest answer states, with your confidence in each. Leave out anything not stated.",
  input_schema: {
    type: "object",
    properties: {
      facts: {
        type: "array",
        items: {
          type: "object",
          properties: {
            field: { type: "string", enum: NAMES },
            value: { anyOf: [{ type: "integer" }, { type: "number" }, { type: "boolean" }, { type: "string", enum: HEAT }] },
            confidence: { type: "string", enum: ["high", "medium", "low"], description: "high only when the answer states it plainly." },
          },
          required: ["field", "value", "confidence"],
        },
      },
    },
    required: ["facts"],
  },
};
const SYSTEM = `You read one turn of a phone call between Rina (an installer's assistant) and a homeowner, and record the facts the homeowner's latest answer states about their home, in these fields:
${NAMES.map((n) => `- ${n} (${FIELDS[n].type}): ${FIELDS[n].description}`).join("\n")}
Use the question for context: "about 5,000 a year" after a usage question is annual_demand_kwh 5000. A "no" to "any car now or planned?" is has_ev false and ev_planned false. Never guess: "I don't know", vague or off-topic answers record nothing. Always call record_facts, with an empty list if nothing is stated.`;

type Fact = { field: Field; value: unknown; confidence: string };
function clean(f: Fact): unknown {
  const spec = FIELDS[f.field];
  if (!spec) return undefined;
  if (spec.type === "boolean") return typeof f.value === "boolean" ? f.value : undefined;
  if (f.field === "heating_type") return HEAT.includes(f.value as (typeof HEAT)[number]) ? ENGINE_HEAT[f.value as (typeof HEAT)[number]] : undefined;
  const n = Number(f.value);
  if (!Number.isFinite(n) || n < 0) return undefined;
  if (f.field === "num_inhabitants" && (n < 1 || n > 12)) return undefined;
  if (f.field === "boiler_age_years" && n > 80) return undefined;
  return spec.type === "integer" ? Math.round(n) : n;
}
const n0 = (x: number) => Math.round(x).toLocaleString("en-GB");
const n2 = (x: number) => (Math.round(x * 100) / 100).toLocaleString("en-GB");

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "No ANTHROPIC_API_KEY on the server." }, { status: 503 });
  const b = await req.json().catch(() => null) as { lead_id?: string; question?: string; answer?: string; turns?: { role: string; text: string }[] } | null;
  const id = b?.lead_id;
  if (!id || !/^[\w-]+$/.test(id) || !b?.answer?.trim()) return NextResponse.json({ error: "lead_id and answer are needed." }, { status: 400 });
  const t0 = Date.now();
  const context = (b.turns ?? []).slice(-4).map((t) => `${t.role === "agent" ? "Rina" : "Homeowner"}: ${String(t.text).slice(0, 400)}`).join("\n");
  let facts: Fact[] = [];
  try {
    const msg = await new Anthropic().messages.create({
      model: MODEL, max_tokens: 600, system: SYSTEM,
      tools: [tool], tool_choice: { type: "tool", name: "record_facts" },
      messages: [{ role: "user", content: `Recent turns:\n${context}\n\nRina's question: ${String(b.question ?? "").slice(0, 400)}\nHomeowner's answer: ${b.answer.slice(0, 600)}` }],
    } as Anthropic.MessageCreateParamsNonStreaming);
    const use = msg.content.find((c) => c.type === "tool_use");
    facts = use && use.type === "tool_use" ? ((use.input as { facts?: Fact[] }).facts ?? []) : [];
  } catch (e) {
    const err = e as { status?: number; message?: string };
    return NextResponse.json({ error: `Claude API: ${err.message ?? String(e)}` }, { status: err.status && err.status >= 400 ? err.status : 502 });
  }
  const llm_ms = Date.now() - t0;
  const write: Record<string, unknown> = {};
  for (const f of facts) { if (f.confidence !== "high") continue; const v = clean(f); if (v !== undefined) write[f.field] = v; }
  console.info("call/extract", JSON.stringify({ lead_id: id, answer: b.answer.slice(0, 200), facts, write, llm_ms }).slice(0, 800));
  // Unclear answers write nothing; an empty step is never sent.
  if (!Object.keys(write).length) return NextResponse.json({ facts: {}, read: facts, llm_ms });
  const step = await callEngine("POST", "/api/intake/step", new URLSearchParams(), { lead_id: id, facts_so_far: write, source: "call" }, { "X-Client-Route": "call-extract" });
  const body = step.body as { draft?: { design?: Record<string, number | null>; economics?: { capex_eur?: number; autarky_share?: number } }; version?: number; dropped?: string[]; error?: string };
  if (step.status !== 200) return NextResponse.json({ error: body?.error ?? `The engine answered ${step.status}.`, facts: write, llm_ms }, { status: step.status });
  const d = body.draft?.design ?? {}, e = body.draft?.economics ?? {};
  const summary = [d.pv_kwp ? `${n2(d.pv_kwp)} kWp` : "no solar", d.battery_kwh ? `battery ${n2(d.battery_kwh)} kWh` : "no battery", ...(d.heatpump_kw ? [`heat pump ${n2(d.heatpump_kw)} kW`] : []), ...(d.wallbox_kw ? [`wallbox ${n2(d.wallbox_kw)} kW`] : []), ...(e.capex_eur != null ? [`€${n0(e.capex_eur)}`] : [])].join(", ");
  return NextResponse.json({ facts: write, read: facts, dropped: body.dropped ?? [], draft: body.draft, version: body.version, summary: `kit ${summary}`, llm_ms, total_ms: Date.now() - t0 });
}
