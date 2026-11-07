import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import type { HomeInputs, InterpretChange } from "@/lib/api";

export const dynamic = "force-dynamic";

const NUM = ["annual_demand_kwh", "num_inhabitants", "house_size_sqm", "house_built_year", "ev_annual_km", "heating_cost_per_year_eur", "heating_demand_kwh", "electricity_price_ct_kwh", "existing_solar_kwp", "existing_storage_kwh"] as const;
const BOOL = ["has_ev", "has_wallbox", "has_solar", "has_storage"] as const;
const ENUMS = {
  installer_id: ["2a8ba8e2", "23c108b7"],
  load_profile: ["H0", "FamilyOfFour", "HomeOfficeOnePerson", "FullTimeOnePerson", "SeniorOnePerson", "PartTimeOnePerson"],
  heating_type: ["Gas", "Oil", "Heatpump", "OtherNonRenewable", "OtherRenewable", "Unknown"],
} as const;
const FIELDS = [...NUM, ...BOOL, ...Object.keys(ENUMS)];

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["changes"],
  properties: {
    changes: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["field", "value", "note"],
        properties: {
          field: { type: "string", enum: FIELDS },
          value: { anyOf: [{ type: "number" }, { type: "boolean" }, { type: "string" }] },
          note: { type: "string" },
        },
      },
    },
  },
};

const SYSTEM = `You map one sentence from a solar installer's planner to changes in a German single-family home's inputs.
Fields: annual_demand_kwh (household electricity per year, excluding heat pump and EV), num_inhabitants, house_size_sqm, house_built_year, has_ev, ev_annual_km, has_wallbox (already installed), heating_type (${ENUMS.heating_type.join(", ")}), heating_cost_per_year_eur, heating_demand_kwh, electricity_price_ct_kwh, has_solar, existing_solar_kwp, has_storage, existing_storage_kwh, load_profile (${ENUMS.load_profile.join(", ")}), installer_id.
Rules: change only what the sentence implies. Future plans count ("buys an EV next year" sets has_ev true and ev_annual_km to 12000 if no distance is given). A new household member adds about 1000 kWh to annual_demand_kwh. A heat pump the family plans is not existing heating: leave heating_type unless they already switched. note is under 12 words, British English, says why. Return no changes if the sentence says nothing about the home.`;

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "No ANTHROPIC_API_KEY in web/.env.local, so sentences cannot be read. Sliders still work." }, { status: 503 });
  }
  let sentence: string, inputs: HomeInputs;
  try { ({ sentence, inputs } = await req.json()); } catch { return NextResponse.json({ error: "Body is not JSON" }, { status: 400 }); }
  if (!sentence?.trim()) return NextResponse.json({ error: "Write a sentence first." }, { status: 400 });

  const client = new Anthropic();
  let raw: string;
  try {
    const msg = await client.messages.create({
      model: "claude-sonnet-5-5",
      max_tokens: 1024,
      system: SYSTEM,
      messages: [{ role: "user", content: `Current inputs: ${JSON.stringify(inputs)}\nSentence: ${sentence}` }],
      output_config: { format: { type: "json_schema", schema } },
    } as Anthropic.MessageCreateParamsNonStreaming);
    const block = msg.content.find((b) => b.type === "text");
    raw = block && block.type === "text" ? block.text : "";
  } catch (e) {
    const err = e as { status?: number; message?: string };
    return NextResponse.json({ error: `Claude API: ${err.message ?? String(e)}` }, { status: err.status && err.status >= 400 ? err.status : 502 });
  }

  let parsed: { changes: { field: string; value: unknown; note: string }[] };
  try { parsed = JSON.parse(raw); } catch { return NextResponse.json({ error: `Claude returned something that is not JSON: ${raw.slice(0, 200)}` }, { status: 502 }); }

  const next: HomeInputs = { ...inputs };
  const changes: InterpretChange[] = [];
  for (const c of parsed.changes ?? []) {
    const f = c.field as keyof HomeInputs;
    let v: unknown = c.value;
    if ((NUM as readonly string[]).includes(f)) { v = Number(v); if (!Number.isFinite(v as number)) continue; }
    else if ((BOOL as readonly string[]).includes(f)) { if (typeof v === "string") v = v === "true"; if (typeof v !== "boolean") continue; }
    else if (f in ENUMS) { if (!(ENUMS as Record<string, readonly string[]>)[f].includes(String(v))) continue; }
    else continue;
    if (next[f] === v) continue;
    changes.push({ field: f, from: next[f] ?? null, to: v, note: c.note });
    (next as unknown as Record<string, unknown>)[f] = v;
  }
  return NextResponse.json({ changes, inputs: next });
}

export async function GET() {
  return NextResponse.json({ available: Boolean(process.env.ANTHROPIC_API_KEY) });
}
