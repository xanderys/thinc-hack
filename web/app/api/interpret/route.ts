import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import type { Design, HomeInputs, InterpretChange, InterpretOverride, Overrides } from "@/lib/api";
import { structured } from "@/lib/llm";

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
Rules: change only what the sentence implies. Future plans count ("buys an EV next year" sets has_ev true and ev_annual_km to 15000 if no distance is given). A new household member adds about 1000 kWh to annual_demand_kwh. A heat pump they only consider is not a switch; replacing the boiler with one is (heating_type Heatpump). note is under 12 words, British English, says why. Return no changes if the sentence says nothing about the home.
components are planner decisions about the proposed system (pv, battery, heatpump, wallbox): "include" when they want one and the size is left to the engine, "none" when they rule it out, "bigger" or "smaller" for one size step, "set" with size when a size is named (kWp, kWh or kW). Replacing a gas or oil boiler with a heat pump sets heating_type to Heatpump and includes heatpump. Leave components empty when the sentence says nothing about the system.`;

// v2.14 WhatsApp copilot: the engine sends each client reply here with the facts it is still asking for.
type OpenFact = { field: string; label?: string; unit?: string; options?: unknown[] };
const WA_SYSTEM = `You read one WhatsApp reply from a homeowner to their solar installer and pull out the facts the installer asked for.
Return only facts the reply states or plainly implies; never guess, never fill a fact from typical values. A fact the reply touches but leaves vague goes in unclear, not in facts.
Numbers are plain numbers in the unit given for that fact (convert "4.2 MWh" to 4200 for kWh, "about 4,500" to 4500, a monthly figure to a yearly one only when the unit is yearly). Yes and no answers are booleans.
For a fact with options, the value is exactly one of the option values. Heating: gas boiler is Gas, oil is Oil, heat pump is Heatpump, district heating or electric heating is OtherNonRenewable, wood or pellets is OtherRenewable.
confidence is 0 to 1 for how sure you are of the facts as a whole. No prose.`;

function optionValues(o: OpenFact): unknown[] | null {
  if (Array.isArray(o.options) && o.options.length) return o.options.map((x) => (x && typeof x === "object" && "value" in x ? (x as { value: unknown }).value : x));
  if (o.field === "heating_type") return [...ENUMS.heating_type];
  if (o.field in ENUMS) return [...(ENUMS as Record<string, readonly string[]>)[o.field]];
  return null;
}

function coerce(o: OpenFact, v: unknown): unknown | undefined {
  if (v == null) return undefined;
  const opts = optionValues(o);
  if (opts) { const hit = opts.find((x) => x === v || String(x) === String(v)); return hit === undefined ? undefined : hit; }
  if ((BOOL as readonly string[]).includes(o.field)) { if (typeof v === "boolean") return v; if (v === "true" || v === "false") return v === "true"; return undefined; }
  if ((NUM as readonly string[]).includes(o.field) || typeof v === "number") {
    const n = typeof v === "number" ? v : Number(String(v).replace(/,/g, ""));
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  }
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

async function whatsapp(req: NextRequest, body: { lead_id?: string; text?: string; open_facts?: OpenFact[] }) {
  const secret = process.env.INTAKE_SECRET;
  if (!secret) return NextResponse.json({ error: "INTAKE_SECRET is not set on this server." }, { status: 500 });
  if (req.headers.get("x-intake-secret") !== secret) return NextResponse.json({ error: "Intake secret missing or wrong." }, { status: 401 });
  const text = typeof body.text === "string" ? body.text.trim() : "";
  const open = (Array.isArray(body.open_facts) ? body.open_facts : []).filter((o): o is OpenFact => !!o && typeof o.field === "string" && !!o.field);
  if (!open.length) return NextResponse.json({ facts: {}, confidence: 1, unclear: [] });
  if (!text) return NextResponse.json({ facts: {}, confidence: 0, unclear: open.map((o) => o.field) });

  const fields = open.map((o) => o.field);
  const schema = {
    type: "object", additionalProperties: false, required: ["facts", "confidence", "unclear"],
    properties: {
      facts: { type: "array", items: { type: "object", additionalProperties: false, required: ["field", "value"], properties: {
        field: { type: "string", enum: fields },
        value: { anyOf: [{ type: "number" }, { type: "boolean" }, { type: "string" }] },
      } } },
      confidence: { type: "number" },
      unclear: { type: "array", items: { type: "string", enum: fields } },
    },
  };
  const asked = open.map((o) => {
    const opts = optionValues(o);
    return `- ${o.field}${o.label ? ` (${o.label})` : ""}${o.unit ? `, unit ${o.unit}` : ""}${opts ? `, one of ${opts.map((x) => JSON.stringify(x)).join(", ")}` : ""}`;
  }).join("\n");
  const r = await structured<{ facts: { field: string; value: unknown }[]; confidence: number; unclear: string[] }>(WA_SYSTEM, `Facts asked for:\n${asked}\n\nReply:\n${text}`, schema, 2048);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });

  const facts: Record<string, unknown> = {};
  const unclear = new Set((r.data.unclear ?? []).filter((f) => fields.includes(f)));
  for (const f of r.data.facts ?? []) {
    const o = open.find((x) => x.field === f.field);
    if (!o || f.field in facts) continue;
    const v = coerce(o, f.value);
    if (v === undefined) { unclear.add(f.field); continue; }
    facts[f.field] = v; unclear.delete(f.field);
  }
  const c = Number(r.data.confidence);
  return NextResponse.json({ facts, confidence: Number.isFinite(c) ? Math.min(1, Math.max(0, c)) : 0, unclear: [...unclear] });
}

// Autopilot composer: a scrap, a pasted email or a voice transcript becomes the facts of a new lead. Nothing is guessed.
const CF = ["name", "address", "postcode", "num_inhabitants", "heating_type", "heating_stated", "has_ev", "ev_planned", "annual_demand_kwh", "phone", "note"] as const;
const composerSchema = {
  type: "object", additionalProperties: false, required: [...CF],
  properties: {
    name: { anyOf: [{ type: "string" }, { type: "null" }] },
    address: { anyOf: [{ type: "string" }, { type: "null" }] },
    postcode: { anyOf: [{ type: "string" }, { type: "null" }] },
    num_inhabitants: { anyOf: [{ type: "number" }, { type: "null" }] },
    heating_type: { anyOf: [{ type: "string", enum: [...ENUMS.heating_type] }, { type: "null" }] },
    heating_stated: { anyOf: [{ type: "string" }, { type: "null" }] },
    has_ev: { anyOf: [{ type: "boolean" }, { type: "null" }] },
    ev_planned: { anyOf: [{ type: "boolean" }, { type: "null" }] },
    annual_demand_kwh: { anyOf: [{ type: "number" }, { type: "null" }] },
    phone: { anyOf: [{ type: "string" }, { type: "null" }] },
    note: { anyOf: [{ type: "string" }, { type: "null" }] },
  },
};
const COMPOSER_SYSTEM = `You read one scrap of text from a solar installer's planner: a few words, a pasted customer email (German or English) or a voice transcript. You pull out a new lead's facts.
Return only what the text states or plainly implies; null for everything else. Never guess, never fill typical values.
name is the homeowner (the email's sender or signature, not the installer). address is street and house number plus town, as written. postcode is the 5 digit German postcode. num_inhabitants is the household size. annual_demand_kwh is yearly household electricity in kWh (convert MWh). phone is the homeowner's number as written.
Heating: heating_stated is the word as stated, capitalised ("Gas", "Oil", "Heat pump", "District", "Electric", "Wood"). heating_type is the kind sizing uses: gas is Gas, oil is Oil, heat pump is Heatpump, district or electric heating is OtherNonRenewable, wood or pellets is OtherRenewable.
has_ev is true when they own an electric car now. ev_planned is true when they plan to buy one (then has_ev is true as well). note is under 12 words, British English, anything else a planner should see, or null.`;

async function composer(body: { text?: string }) {
  const text = String(body.text ?? "").trim();
  if (!text) return NextResponse.json({ error: "Write a few words about the house first." }, { status: 400 });
  const r = await structured<Record<(typeof CF)[number], unknown>>(COMPOSER_SYSTEM, text.slice(0, 8000), composerSchema, 2048);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
  const out: Record<string, unknown> = {};
  for (const k of CF) {
    let v = r.data[k];
    if (v == null || v === "") continue;
    if (k === "num_inhabitants" || k === "annual_demand_kwh") { v = Number(v); if (!Number.isFinite(v as number) || (v as number) <= 0) continue; }
    else if (k === "has_ev" || k === "ev_planned") { if (typeof v !== "boolean") continue; }
    else if (k === "heating_type") { if (!(ENUMS.heating_type as readonly string[]).includes(String(v))) continue; }
    else if (k === "postcode") { const m = String(v).match(/\b\d{5}\b/); if (!m) continue; v = m[0]; }
    else v = String(v).trim();
    out[k] = v;
  }
  if (out.ev_planned === true) out.has_ev = true;
  return NextResponse.json(out);
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Body is not JSON" }, { status: 400 }); }
  if (body?.mode === "whatsapp") return whatsapp(req, body as Parameters<typeof whatsapp>[1]);
  if (body?.mode === "composer") return composer(body as { text?: string });
  return refine(body);
}

async function refine(body: Record<string, unknown>) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "No ANTHROPIC_API_KEY in web/.env.local, so sentences cannot be read. Sliders still work." }, { status: 503 });
  }
  let sentence: string, inputs: HomeInputs, design: Partial<Design> = {}, current: Overrides = {}, typical: Partial<Design> = {};
  ({ sentence, inputs, design = {}, overrides: current = {}, typical = {} } = body as { sentence: string; inputs: HomeInputs; design?: Partial<Design>; overrides?: Overrides; typical?: Partial<Design> });
  if (!sentence?.trim()) return NextResponse.json({ error: "Write a sentence first." }, { status: 400 });

  const client = new Anthropic();
  let raw: string;
  try {
    const msg = await client.messages.create({
      model: "claude-sonnet-5-5",
      max_tokens: 4096,
      thinking: { type: "between_tools" },
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
