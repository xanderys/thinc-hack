// Facts from the submit_intake tool, and their mapping to the engine's HomeInputs (docs/api.md v1.7).

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
