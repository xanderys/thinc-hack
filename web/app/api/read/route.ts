import { NextRequest, NextResponse } from "next/server";
import type { HomeInputs, ReadFact, ReadResponse } from "@/lib/api";
import { structured } from "@/lib/llm";
import { CACHED_READ, HERO_LEAD } from "@/lib/demo";

export const dynamic = "force-dynamic";

const NUM = ["annual_demand_kwh", "num_inhabitants", "house_size_sqm", "house_built_year", "ev_annual_km", "heating_cost_per_year_eur", "heating_demand_kwh", "electricity_price_ct_kwh", "existing_solar_kwp", "existing_storage_kwh", "monthly_bill_eur"] as const;
const BOOL = ["has_ev", "has_wallbox", "has_solar", "has_storage"] as const;
const TEXT = ["address", "wants"] as const;
const ENUMS: Record<string, readonly string[]> = {
  load_profile: ["H0", "FamilyOfFour", "HomeOfficeOnePerson", "FullTimeOnePerson", "SeniorOnePerson", "PartTimeOnePerson"],
  heating_type: ["Gas", "Oil", "Heatpump", "OtherNonRenewable", "OtherRenewable"],
};
// Facts the engine can ask about when the lead does not state them.
const ASKABLE: (keyof HomeInputs)[] = ["annual_demand_kwh", "heating_type", "has_ev", "heating_demand_kwh", "has_solar"];

const schema = {
  type: "object", additionalProperties: false, required: ["facts"],
  properties: {
    facts: {
      type: "array",
      items: {
        type: "object", additionalProperties: false, required: ["field", "value", "quote"],
        properties: {
          field: { type: "string", enum: [...NUM, ...BOOL, ...TEXT, ...Object.keys(ENUMS)] },
          value: { anyOf: [{ type: "number" }, { type: "boolean" }, { type: "string" }] },
          quote: { type: "string" },
        },
      },
    },
  },
};

const SYSTEM = `You read an email from a homeowner to a German solar installer and extract only the facts it states about the home.
Fields: address (street, number, postcode and town as written), wants (what the homeowner asks the installer for, in their words), monthly_bill_eur (electricity bill or advance payment per month in euros, only when stated per month), annual_demand_kwh (household electricity per year), num_inhabitants, house_size_sqm, house_built_year, has_ev, ev_annual_km, has_wallbox, heating_type (${ENUMS.heating_type.join(", ")}), heating_cost_per_year_eur, heating_demand_kwh, electricity_price_ct_kwh, has_solar, existing_solar_kwp, has_storage, existing_storage_kwh, load_profile (FamilyOfFour for a family of four, otherwise only when the household is described exactly).
Rules: quote is the shortest exact span copied character for character from the email that states the fact. A stated absence is a fact ("no electric car yet" sets has_ev false). Never guess or infer a value the email does not state, and never propose system sizes. Euros per kWh become cents (0.37 is 37).`;

const norm = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();

export async function POST(req: NextRequest) {
  let lead: string;
  try { ({ lead } = await req.json()); } catch { return NextResponse.json({ error: "Body is not JSON" }, { status: 400 }); }
  if (!lead?.trim()) return NextResponse.json({ error: "Paste a lead first." }, { status: 400 });

  const r = await structured<{ facts: { field: string; value: unknown; quote: string }[] }>(SYSTEM, lead, schema);
  if (!r.ok) {
    if (CACHED_READ && norm(lead) === norm(HERO_LEAD)) return NextResponse.json({ ...CACHED_READ, cached: true });
    return NextResponse.json({ error: r.error }, { status: r.status });
  }

  const hay = norm(lead);
  const inputs: Partial<HomeInputs> = {};
  const found: ReadFact[] = [];
  for (const f of r.data.facts ?? []) {
    const field = f.field as keyof HomeInputs;
    if (!f.quote?.trim() || !hay.includes(norm(f.quote))) continue;   // unquoted facts are dropped
    let v: unknown = f.value;
    if ((NUM as readonly string[]).includes(field)) { v = Number(v); if (!Number.isFinite(v as number) || (v as number) < 0) continue; }
    else if ((BOOL as readonly string[]).includes(field)) { if (typeof v === "string") v = v === "true"; if (typeof v !== "boolean") continue; }
    else if (field in ENUMS) { if (!ENUMS[field].includes(String(v))) continue; }
    else if ((TEXT as readonly string[]).includes(field)) { if (typeof v !== "string" || !v.trim()) continue; v = v.trim(); }
    else continue;
    if (field in inputs || found.some((x) => x.field === f.field)) continue;
    // "wants" stays a quoted fact for the planner; the engine never sees it.
    if (f.field !== "wants" && f.field !== "monthly_bill_eur") (inputs as Record<string, unknown>)[field] = v;
    found.push({ field: f.field as ReadFact["field"], value: v, quote: f.quote.trim() });
  }
  // A monthly bill stands in for annual use, at the stated tariff or 37 ct.
  const bill = found.find((x) => (x.field as string) === "monthly_bill_eur");
  if (bill && inputs.annual_demand_kwh == null) {
    const kwh = Math.round((Number(bill.value) * 12) / ((inputs.electricity_price_ct_kwh ?? 37) / 100) / 100) * 100;
    if (kwh > 0) { inputs.annual_demand_kwh = kwh; found.push({ field: "annual_demand_kwh", value: kwh, quote: bill.quote }); }
  }
  // A stated heating bill stands in for heat demand; homeowners rarely know the kWh.
  const unknown = ASKABLE.filter((k) => !(k in inputs) && !(k === "heating_demand_kwh" && "heating_cost_per_year_eur" in inputs));
  return NextResponse.json({ inputs, found, unknown } satisfies ReadResponse);
}
