// Facts from the homeowner form and the submit_intake tool, merged, and mapped to the engine's HomeInputs (docs/api.md v1.7).
// Shared by web/app/start (widget, lead route) and voice/MarqueeCall.tsx.

export interface IntakeFacts {
  summary: string;
  estimated_fields: string[];
  is_owner?: boolean;
  address?: string;
  num_inhabitants?: number;
  home_office?: boolean;
  property_type?: "detached" | "semi_detached" | "terraced" | "apartment" | "other";
  house_size_sqm?: number;
  house_built_year?: number;
  monthly_bill_eur?: number;
  annual_demand_kwh?: number;
  heating_type?: "Gas" | "Oil" | "Heatpump" | "OtherNonRenewable" | "OtherRenewable" | "Unknown";
  heating_age?: "under_20" | "over_20" | "unknown";
  heating_cost_per_year_eur?: number;
  heating_demand_kwh?: number;
  ev?: "now" | "planned" | "none";
  ev_planned_when?: string;
  ev_annual_km?: number;
  has_solar?: boolean;
  existing_solar_kwp?: number;
  has_storage?: boolean;
  existing_storage_kwh?: number;
  has_wallbox?: boolean;
  preference?: "independence" | "payback" | "upfront";
  timeline?: string;
  budget_monthly_eur?: number;
  budget?: string;
  interests?: string[];
  first_name?: string;
  notes?: string;
}

export type InstallerId = "2a8ba8e2" | "23c108b7";

const PRICE_CT = 37; // assumed when only the monthly bill is known
const BY_PEOPLE: Record<number, number> = { 1: 1800, 2: 2500, 3: 3500, 4: 4500 };

export function toHomeInputs(f: IntakeFacts, installer_id: InstallerId, address?: string) {
  const people = f.num_inhabitants;
  const fromBill = f.monthly_bill_eur ? Math.round((f.monthly_bill_eur * 12 * 100) / PRICE_CT) : undefined;
  const fromPeople = people ? BY_PEOPLE[Math.min(people, 4)] + Math.max(0, people - 4) * 1000 : undefined;
  const annual_demand_kwh = f.annual_demand_kwh ?? fromBill ?? fromPeople ?? 4500;
  const price = f.monthly_bill_eur && f.annual_demand_kwh && !f.estimated_fields.includes("annual_demand_kwh")
    ? Math.min(50, Math.max(25, Math.round((f.monthly_bill_eur * 1200) / f.annual_demand_kwh)))
    : f.monthly_bill_eur ? PRICE_CT : undefined;
  const has_ev = f.ev === "now" || f.ev === "planned"; // design for the demand the home will have
  const load_profile = people === 1 && f.home_office ? "HomeOfficeOnePerson" : people === 4 ? "FamilyOfFour" : "H0";
  const inputs = {
    installer_id,
    annual_demand_kwh,
    load_profile,
    num_inhabitants: people,
    house_size_sqm: f.house_size_sqm,
    house_built_year: f.house_built_year,
    has_ev,
    ev_annual_km: has_ev ? f.ev_annual_km ?? 12000 : undefined,
    has_wallbox: !!f.has_wallbox,
    heating_type: f.heating_type ?? "Unknown",
    heating_cost_per_year_eur: f.heating_cost_per_year_eur,
    heating_demand_kwh: f.heating_demand_kwh,
    electricity_price_ct_kwh: price,
    has_solar: !!f.has_solar,
    existing_solar_kwp: f.has_solar ? f.existing_solar_kwp : undefined,
    has_storage: !!f.has_storage,
    existing_storage_kwh: f.has_storage ? f.existing_storage_kwh : undefined,
    address,
    preference: f.preference,
  };
  return Object.fromEntries(Object.entries(inputs).filter(([, v]) => v !== undefined));
}

// Homeowner form (web/app/start). Values are sent to the agent as dynamic variables, so they are all strings.
export const FORM = {
  house_type: { detached: "Detached", semi_detached: "Semi", terraced: "Terrace", apartment: "Flat" },
  people: { "1": "1", "2": "2", "3": "3", "4": "4", "5": "5+" },
  bill_band: { lt60: "Under 60", "60_100": "60 to 100", "100_150": "100 to 150", gt150: "Over 150" },
  heating: { Gas: "Gas", Oil: "Oil", Heatpump: "Heat pump", Electric: "Electric", Other: "Other" },
  ev: { now: "Have one", planned: "Planned", none: "No" },
  interests: { solar: "Solar", battery: "Battery", heatpump: "Heat pump", charger: "Charger" },
} as const;

export interface FormAnswers {
  first_name?: string;
  postcode: string;
  house_type: keyof typeof FORM.house_type;
  people: keyof typeof FORM.people;
  bill_band: keyof typeof FORM.bill_band;
  heating: keyof typeof FORM.heating;
  ev: keyof typeof FORM.ev;
  interests: (keyof typeof FORM.interests)[];
}

const BILL_EUR = { lt60: 50, "60_100": 80, "100_150": 125, gt150: 180 } as const;
export const NOT_GIVEN = "not given";

const kwhFromBill = (eur: number) => Math.round((eur * 12 * 100) / PRICE_CT / 100) * 100;

/** Dynamic variables for the agent. The planner-side call (no form) sends the same keys as NOT_GIVEN. */
export function formVariables(a?: Partial<FormAnswers>, installer_id: InstallerId = "2a8ba8e2"): Record<string, string> {
  const v = (x?: string) => (x && x.trim() ? x.trim() : NOT_GIVEN);
  const eur = a?.bill_band ? BILL_EUR[a.bill_band] : undefined;
  return {
    installer_id,
    first_name: v(a?.first_name) === NOT_GIVEN ? "there" : v(a?.first_name),
    postcode: v(a?.postcode),
    house_type: a?.house_type ? a.house_type : NOT_GIVEN,
    people: a?.people ?? NOT_GIVEN,
    monthly_bill_eur: eur ? String(eur) : NOT_GIVEN,
    kwh_estimate: eur ? String(kwhFromBill(eur)) : NOT_GIVEN,
    heating: a?.heating ?? NOT_GIVEN,
    ev: a?.ev ?? NOT_GIVEN,
    interests: a?.interests?.length ? a.interests.join(", ") : NOT_GIVEN,
    first_question: a?.postcode ? "Roughly how big is the house inside, and when was it built?" : "Which postcode is the house in?",
  };
}

export type Source = "form" | "call" | "estimated";

/** Facts as the form gave them, read back from the dynamic variables stored with the conversation. */
export function factsFromVariables(d: Record<string, unknown>): Partial<IntakeFacts> {
  const g = (k: string) => (typeof d[k] === "string" && d[k] !== NOT_GIVEN ? (d[k] as string) : undefined);
  const heating = g("heating");
  const f: Partial<IntakeFacts> = {
    first_name: g("first_name") === "there" ? undefined : g("first_name"),
    address: g("postcode"),
    property_type: g("house_type") as IntakeFacts["property_type"],
    num_inhabitants: g("people") ? Number(g("people")) : undefined,
    monthly_bill_eur: g("monthly_bill_eur") ? Number(g("monthly_bill_eur")) : undefined,
    annual_demand_kwh: g("kwh_estimate") ? Number(g("kwh_estimate")) : undefined,
    heating_type: heating === "Electric" ? "OtherNonRenewable" : heating === "Other" ? "Unknown" : (heating as IntakeFacts["heating_type"]),
    ev: g("ev") as IntakeFacts["ev"],
    interests: g("interests")?.split(", "),
  };
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined));
}

/** Call facts win over form facts (the homeowner may correct the form). Each field is marked form, call or estimated. */
export function mergeIntake(form: Partial<IntakeFacts>, call?: Partial<IntakeFacts>) {
  const estimated = new Set(call?.estimated_fields ?? []);
  estimated.add("annual_demand_kwh"); // from the bill band unless the homeowner said a kWh figure
  const facts = { ...form, ...(call ?? {}) } as IntakeFacts;
  facts.estimated_fields = [...estimated];
  facts.summary = call?.summary ?? "Form only: the call ended before the recap.";
  const sources: Record<string, Source> = {};
  for (const k of Object.keys(facts)) {
    if (k === "summary" || k === "estimated_fields") continue;
    const fromForm = k in form && (!call || !(k in call) || JSON.stringify(call[k as keyof IntakeFacts]) === JSON.stringify(form[k as keyof IntakeFacts]));
    sources[k] = estimated.has(k) ? "estimated" : fromForm ? "form" : "call";
  }
  if (call?.annual_demand_kwh !== undefined && !call.estimated_fields?.includes("annual_demand_kwh")) sources.annual_demand_kwh = "call";
  return { facts, sources };
}
