import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import type { Design, HomeInputs, InterpretChange, InterpretOverride, Overrides } from "@/lib/api";

export const dynamic = "force-dynamic";

const NUM = ["annual_demand_kwh", "num_inhabitants", "house_size_sqm", "house_built_year", "ev_annual_km", "heating_cost_per_year_eur", "heating_demand_kwh", "electricity_price_ct_kwh", "existing_solar_kwp", "existing_storage_kwh"] as const;
const BOOL = ["has_ev", "has_wallbox", "has_solar", "has_storage"] as const;
const ENUMS = {
  installer_id: ["2a8ba8e2", "23c108b7"],
  load_profile: ["H0", "FamilyOfFour", "HomeOfficeOnePerson", "FullTimeOnePerson", "SeniorOnePerson", "PartTimeOnePerson"],
  heating_type: ["Gas", "Oil", "Heatpump", "OtherNonRenewable", "OtherRenewable", "Unknown"],
} as const;
const FIELDS = [...NUM, ...BOOL, ...Object.keys(ENUMS)];
const COMP: Record<string, keyof Design> = { pv: "pv_kwp", battery: "battery_kwh", heatpump: "heatpump_kw", wallbox: "wallbox_kw" };
// Size steps used for "bigger" and "smaller"; the engine re-sizes everything else.
const STEPS: Record<keyof Design, number[]> = {
  pv_kwp: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 25, 30],
  battery_kwh: [5, 7, 8, 9, 10, 12, 13, 15, 18, 20, 25, 30],
  heatpump_kw: [5.5, 7.5, 9, 10.5, 12.5, 14, 16],
  wallbox_kw: [11, 22],
  inverter_kw: [3, 4, 5, 6, 8, 10, 12, 15, 20],
};

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["changes", "components"],
  properties: {
    components: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["component", "action", "size", "note"],
        properties: {
          component: { type: "string", enum: Object.keys(COMP) },
          action: { type: "string", enum: ["include", "none", "bigger", "smaller", "set"] },
          size: { anyOf: [{ type: "number" }, { type: "null" }] },
          note: { type: "string" },
        },
      },
    },
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
Rules: change only what the sentence implies. Future plans count ("buys an EV next year" sets has_ev true and ev_annual_km to 12000 if no distance is given). A new household member adds about 1000 kWh to annual_demand_kwh. A heat pump they only consider is not a switch; replacing the boiler with one is (heating_type Heatpump). note is under 12 words, British English, says why. Return no changes if the sentence says nothing about the home.
components are planner decisions about the proposed system (pv, battery, heatpump, wallbox): "include" when they want one and the size is left to the engine, "none" when they rule it out, "bigger" or "smaller" for one size step, "set" with size when a size is named (kWp, kWh or kW). Replacing a gas or oil boiler with a heat pump sets heating_type to Heatpump and includes heatpump. Leave components empty when the sentence says nothing about the system.`;

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "No ANTHROPIC_API_KEY in web/.env.local, so sentences cannot be read. Sliders still work." }, { status: 503 });
  }
  let sentence: string, inputs: HomeInputs, design: Partial<Design> = {}, current: Overrides = {}, typical: Partial<Design> = {};
  try { ({ sentence, inputs, design = {}, overrides: current = {}, typical = {} } = await req.json()); } catch { return NextResponse.json({ error: "Body is not JSON" }, { status: 400 }); }
  if (!sentence?.trim()) return NextResponse.json({ error: "Write a sentence first." }, { status: 400 });

  const client = new Anthropic();
  let raw: string;
  try {
    const msg = await client.messages.create({
      model: "claude-sonnet-5-5",
      max_tokens: 1024,
      system: SYSTEM,
      messages: [{ role: "user", content: `Current inputs: ${JSON.stringify(inputs)}\nCurrent design: ${JSON.stringify(design)}\nSentence: ${sentence}` }],
      output_config: { format: { type: "json_schema", schema } },
    } as Anthropic.MessageCreateParamsNonStreaming);
    const block = msg.content.find((b) => b.type === "text");
    raw = block && block.type === "text" ? block.text : "";
  } catch (e) {
    const err = e as { status?: number; message?: string };
    return NextResponse.json({ error: `Claude API: ${err.message ?? String(e)}` }, { status: err.status && err.status >= 400 ? err.status : 502 });
  }

  let parsed: { changes: { field: string; value: unknown; note: string }[]; components?: { component: string; action: string; size: number | null; note: string }[] };
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
  const overrides: InterpretOverride[] = [];
  for (const c of parsed.components ?? []) {
    const f = COMP[c.component];
    if (!f) continue;
    const now = typeof current[f] === "number" ? current[f] as number : design[f] ?? null;
    let to: number | null | "include";
    if (c.action === "include") to = "include";
    else if (c.action === "none") to = null;
    else if (c.action === "set" && typeof c.size === "number" && c.size > 0) to = c.size;
    else if (c.action === "bigger") to = now == null ? typical[f] ?? STEPS[f][0] : STEPS[f].find((x) => x > now + 1e-9) ?? STEPS[f][STEPS[f].length - 1];
    else if (c.action === "smaller") to = now == null ? null : [...STEPS[f]].reverse().find((x) => x < now - 1e-9) ?? null;
    else continue;
    overrides.push({ field: f, from: f in current ? current[f] : undefined, to, note: c.note });
  }
  return NextResponse.json({ changes, inputs: next, overrides });
}

export async function GET() {
  return NextResponse.json({ available: Boolean(process.env.ANTHROPIC_API_KEY) });
}
