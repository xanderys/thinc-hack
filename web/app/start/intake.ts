// Facts from the homeowner form and the call (ElevenLabs post-call data collection), merged, and mapped to the engine's HomeInputs (docs/api.md v1.7).
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
  bill_currency?: "EUR" | "GBP" | "other";
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
  address: string; // street and number, postcode, town (postcode alone is accepted)
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

/** Form answers stored with the conversation as dynamic variables (the agent's prompt does not reference them; the lead route reads them back). */
export function formVariables(a?: Partial<FormAnswers>, installer_id: InstallerId = "2a8ba8e2"): Record<string, string> {
  const v = (x?: string) => (x && x.trim() ? x.trim() : NOT_GIVEN);
  const eur = a?.bill_band ? BILL_EUR[a.bill_band] : undefined;
  return {
    installer_id,
    first_name: v(a?.first_name),
    address: v(a?.address),
    house_type: a?.house_type ? a.house_type : NOT_GIVEN,
    people: a?.people ?? NOT_GIVEN,
    monthly_bill_eur: eur ? String(eur) : NOT_GIVEN,
    kwh_estimate: eur ? String(kwhFromBill(eur)) : NOT_GIVEN,
    heating: a?.heating ?? NOT_GIVEN,
    ev: a?.ev ?? NOT_GIVEN,
    interests: a?.interests?.length ? a.interests.join(", ") : NOT_GIVEN,
  };
}

/** Roof lookup result from GET /api/roof (docs/api.md RoofResult; v1.6.1 fields optional). */
export interface RoofInfo {
  source: string; matched_address?: string; footprint_m2: number | null; roof_area_m2: number | null;
  usable_area_m2?: number | null; floor_area_m2?: number | null; storeys?: number | null;
}

/** "Hauptstr. 5" from "Hauptstr. 5, 85579 Neubiberg"; null when only a postcode was given. */
export function streetOf(address?: string) {
  const first = address?.split(",")[0]?.trim();
  return first && /[a-zA-ZäöüÄÖÜß]/.test(first) && /\d/.test(first) ? first : null;
}

const MULTI_UNIT_FOOTPRINT_M2 = 200; // larger footprints are treated as apartment buildings

export function isMultiUnit(a: Partial<FormAnswers>, roof?: RoofInfo | null) {
  return a.house_type === "apartment" || (!!roof?.footprint_m2 && roof.footprint_m2 > MULTI_UNIT_FOOTPRINT_M2);
}

// The installer the enquiry page belongs to. Placeholder names for the demo; never Reonic's brand.
export const INSTALLER_BRAND: Record<InstallerId, string> = { "2a8ba8e2": "Isarwerk Solar", "23c108b7": "Isarwerk Solar" };

/** The homeowner enquiry page (web/app/start). Only name and location are required; "unknown" is an explicit "don't know". */
export const HOME_FORM = {
  people: { "1": "1", "2": "2", "3": "3", "4": "4", "5": "5+", unknown: "Don't know" },
  heating: { Gas: "Gas", Oil: "Oil", Heatpump: "Heat pump", Electric: "Electric", Other: "Other", unknown: "Don't know" },
  ev: { now: "Have one", planned: "Planned", none: "No", unknown: "Don't know" },
  bill_band: { lt60: "Under 60", "60_100": "60 to 100", "100_150": "100 to 150", gt150: "Over 150", unknown: "Don't know" },
  roof: { south: "South", east_west: "East and west", north: "North", flat: "Flat", unknown: "Don't know" },
} as const;

export interface HomeAnswers {
  name: string;
  location: string; // address, or postcode alone
  phone?: string;   // optional, E.164
  people?: keyof typeof HOME_FORM.people;
  heating?: keyof typeof HOME_FORM.heating;
  ev?: keyof typeof HOME_FORM.ev;
  bill_band?: keyof typeof HOME_FORM.bill_band;
  roof?: keyof typeof HOME_FORM.roof;
}

const known = <T extends string>(x?: T) => (x && x !== "unknown" ? x : undefined);

/** Dynamic variables for the call (voice/README "Starting a call from another site"): all strings, unknowns left out. */
export function homeVariables(a: HomeAnswers, installer_id: InstallerId, roof?: RoofInfo | null, lead_id?: string | null): Record<string, string> {
  const bill = known(a.bill_band) as keyof typeof BILL_EUR | undefined;
  const eur = bill ? BILL_EUR[bill] : undefined;
  const multi = !!roof?.footprint_m2 && roof.footprint_m2 > MULTI_UNIT_FOOTPRINT_M2;
  const v: Record<string, string | undefined> = {
    customer_name: a.name.trim(),
    address_or_postcode: a.location.trim(),
    installer_id,
    lead_id: lead_id ?? undefined,
    people: known(a.people),
    monthly_bill_eur: eur ? String(eur) : undefined,
    kwh_estimate: eur ? String(kwhFromBill(eur)) : undefined,
    heating: known(a.heating),
    ev: known(a.ev),
    floor_area_m2: !multi && roof?.floor_area_m2 ? String(Math.round(roof.floor_area_m2)) : undefined,
    multi_unit: roof?.footprint_m2 ? String(multi) : undefined,
  };
  return Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined)) as Record<string, string>;
}

/** Rina's spoken first line: from the installer, greet by name, confirm the address. */
export function homeFirstMessage(a: HomeAnswers, installer_id: InstallerId) {
  return `Hi ${a.name.trim().split(/\s+/)[0]}, it's Rina from ${INSTALLER_BRAND[installer_id]}. Just to check, are you living at ${a.location.trim()}?`;
}

/** Sent once the call connects: what the enquiry gave, so Rina never asks it again. Unknown parts are left out. */
export function homeNote(a: HomeAnswers, installer_id: InstallerId, roof?: RoofInfo | null) {
  const v = homeVariables(a, installer_id, roof);
  const parts = [`name ${v.customer_name}`, `address ${v.address_or_postcode}`,
    v.people && `people ${v.people}`,
    v.monthly_bill_eur && `bill about ${v.monthly_bill_eur} EUR a month, about ${v.kwh_estimate} kWh a year`,
    v.heating && `heating ${v.heating}`, v.ev && `electric car ${v.ev}`,
    known(a.roof) && `roof faces ${HOME_FORM.roof[a.roof!].toLowerCase()}`,
    v.floor_area_m2 && `living space ${v.floor_area_m2} m2`, v.multi_unit && `multi-unit building ${v.multi_unit}`].filter(Boolean);
  return `Enquiry for ${INSTALLER_BRAND[installer_id]} (never ask these again): ${parts.join("; ")}. You call on behalf of ${INSTALLER_BRAND[installer_id]}. You have already asked whether they live at the address.`;
}

/** First line Rina says on a widget call, so she never asks for the address. */
export function firstMessage(a: Partial<FormAnswers>) {
  const name = a.first_name?.trim();
  const street = streetOf(a.address);
  return `Hi${name ? ` ${name}` : ""}, it's Rina from your installer. Just to check, you own the place ${street ? `at ${street}` : "you put in the form"}?`;
}

/** Start-of-call note with the form answers and what the address lookup found. */
export function formNote(a: Partial<FormAnswers>, roof?: RoofInfo | null) {
  const v = formVariables(a);
  const found = roof && roof.source !== "none" && roof.footprint_m2;
  const multi = isMultiUnit(a, roof);
  const building = !found
    ? "Building lookup: not found."
    : `Building lookup: found, ${multi ? "a multi-unit building" : "a single house"}, footprint about ${Math.round(roof!.footprint_m2!)} m2` +
      (roof!.roof_area_m2 ? `, roof about ${Math.round(roof!.roof_area_m2)} m2` : "") +
      (!multi && roof!.floor_area_m2 ? `, living space estimated at about ${Math.round(roof!.floor_area_m2)} m2 (do not ask living space)` : "") + ".";
  return `Form answers (never ask these again): address ${v.address}; house type ${v.house_type}; people ${v.people}; ` +
    `electricity bill about ${v.monthly_bill_eur} EUR a month, about ${v.kwh_estimate} kWh a year; heating ${v.heating}; ` +
    `electric car ${v.ev}; interested in ${v.interests}. ${building} You have already asked whether they own the place. ` +
    (multi ? "Next ask once which flat is theirs and roughly what floor." : "");
}

export type Source = "form" | "call" | "estimated";

/** Facts as the form gave them, read back from the dynamic variables stored with the conversation. */
export function factsFromVariables(d: Record<string, unknown>): Partial<IntakeFacts> {
  const g = (k: string) => (typeof d[k] === "string" && d[k] !== NOT_GIVEN ? (d[k] as string) : undefined);
  const heating = g("heating");
  const f: Partial<IntakeFacts> = {
    first_name: g("customer_name") ?? g("first_name"),
    address: g("address_or_postcode") ?? g("address") ?? g("postcode"),
    house_size_sqm: g("floor_area_m2") ? Number(g("floor_area_m2")) : undefined,
    property_type: (g("house_type") ?? (g("multi_unit") === "true" ? "apartment" : undefined)) as IntakeFacts["property_type"],
    num_inhabitants: g("people") ? Number(g("people")) : undefined,
    monthly_bill_eur: g("monthly_bill_eur") ? Number(g("monthly_bill_eur")) : undefined,
    annual_demand_kwh: g("kwh_estimate") ? Number(g("kwh_estimate")) : undefined,
    heating_type: heating === "Electric" ? "OtherNonRenewable" : heating === "Other" ? "Unknown" : (heating as IntakeFacts["heating_type"]),
    ev: g("ev") as IntakeFacts["ev"],
    interests: g("interests")?.split(", "),
  };
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined));
}

/** Call facts from the conversation's analysis.data_collection_results (voice/intake_fields.json). */
export function factsFromAnalysis(results: Record<string, { value?: unknown }> | undefined): Partial<IntakeFacts> | undefined {
  if (!results) return undefined;
  const f: Record<string, unknown> = {};
  for (const [k, r] of Object.entries(results)) {
    const v = r?.value;
    if (v === null || v === undefined || v === "") continue;
    f[k] = k === "estimated_fields" ? String(v).split(",").map((x) => x.trim()).filter(Boolean) : v;
  }
  if (!f.estimated_fields) f.estimated_fields = [];
  return f as Partial<IntakeFacts>;
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

// Roof direction as the engine's hourly simulation reads it (engine/app/hourly/sim.py: azimuth 180 is south, 0 north;
// flat roofs carry modules on 15 degree south racks, engine/app/layout.py FLAT_TILT).
const ROOF_FACTS: Record<Exclude<keyof typeof HOME_FORM.roof, "unknown">, Record<string, unknown>> = {
  south: { roof_azimuth_deg: 180 }, north: { roof_azimuth_deg: 0 },
  east_west: { roof_orientation: "east-west" }, flat: { roof_azimuth_deg: 180, roof_tilt_deg: 15 },
};

/** What the enquiry form states, as engine inputs for POST /api/leads (v1.9). "Don't know" stays out. */
export function homeFacts(a: HomeAnswers): Record<string, unknown> {
  const f: Record<string, unknown> = {};
  const p = known(a.people); if (p) f.num_inhabitants = Number(p);
  const h = known(a.heating); if (h) f.heating_type = h === "Electric" ? "OtherNonRenewable" : h === "Other" ? "Unknown" : h;
  const ev = known(a.ev); if (ev) { f.has_ev = ev !== "none"; if (ev !== "none") f.ev_annual_km = 12000; }
  const b = known(a.bill_band) as keyof typeof BILL_EUR | undefined; if (b) { f.annual_demand_kwh = kwhFromBill(BILL_EUR[b]); f.electricity_price_ct_kwh = PRICE_CT; }
  if (p === "4") f.load_profile = "FamilyOfFour";
  const r = known(a.roof); if (r) Object.assign(f, ROOF_FACTS[r as keyof typeof ROOF_FACTS]);
  return f;
}
