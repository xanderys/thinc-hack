// Plain labels and values for engine fields, shared by the agent's server tools and the thread. Never a raw field name.
const HEAT: Record<string, string> = { Gas: "gas", Oil: "oil", Heatpump: "heat pump", OtherNonRenewable: "district or electric", OtherRenewable: "wood or pellets", Unknown: "not known" };
const PROFILE: Record<string, string> = { H0: "standard household", FamilyOfFour: "family of four", HomeOfficeOnePerson: "one person, home office", FullTimeOnePerson: "one person, full time", SeniorOnePerson: "one senior", PartTimeOnePerson: "one person, part time" };
const n0 = (x: number) => Math.round(x).toLocaleString("en-GB");
const yes = (v: unknown) => (v === true ? "yes" : v === false ? "no" : String(v));

export const FIELD_LABEL: Record<string, string> = {
  annual_demand_kwh: "Yearly use", num_inhabitants: "Household", heating_type: "Heating", heating_stated: "Heating", heating_demand_kwh: "Heating use",
  heating_cost_per_year_eur: "Heating bill", boiler_age_years: "Boiler", has_ev: "Electric car", ev_planned: "Electric car planned", ev_annual_km: "Car mileage",
  has_wallbox: "Wallbox", has_solar: "Existing solar", existing_solar_kwp: "Existing solar size", has_storage: "Existing battery", existing_storage_kwh: "Existing battery size",
  house_size_sqm: "Living area", house_built_year: "Built", electricity_price_ct_kwh: "Electricity price", monthly_bill_eur: "Monthly bill", load_profile: "Household type",
  preference: "What matters most", phone: "Phone", address: "Address", postcode: "Postcode", customer_name: "Name", home_office: "Home office",
  pv_kwp: "Solar", battery_kwh: "Battery", heatpump_kw: "Heat pump", wallbox_kw: "Wallbox", inverter_kw: "Inverter",
};
export const fieldLabel = (k: string) => FIELD_LABEL[k] ?? k.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

export function fieldValue(k: string, v: unknown): string {
  if (v == null || v === "") return "not known";
  const x = typeof v === "number" ? v : Number.NaN;
  switch (k) {
    case "annual_demand_kwh": case "heating_demand_kwh": return `${n0(x)} kWh${k === "heating_demand_kwh" ? " a year" : ""}`;
    case "num_inhabitants": return `${n0(x)} ${x === 1 ? "person" : "people"}`;
    case "heating_type": return HEAT[String(v)] ?? String(v).toLowerCase();
    case "heating_stated": return String(v).toLowerCase();
    case "heating_cost_per_year_eur": return `€${n0(x)} a year`;
    case "monthly_bill_eur": return `€${n0(x)} a month`;
    case "boiler_age_years": return `${n0(x)} years old`;
    case "ev_annual_km": return `about ${n0(x)} km a year`;
    case "existing_solar_kwp": case "pv_kwp": return `${Math.round(x * 100) / 100} kWp`;
    case "existing_storage_kwh": case "battery_kwh": return `${Math.round(x * 10) / 10} kWh`;
    case "heatpump_kw": case "wallbox_kw": case "inverter_kw": return `${Math.round(x * 10) / 10} kW`;
    case "house_size_sqm": return `${n0(x)} m²`;
    case "house_built_year": return String(Math.round(x));
    case "electricity_price_ct_kwh": return `${Math.round(x * 10) / 10} ct/kWh`;
    case "load_profile": return PROFILE[String(v)] ?? String(v);
    default: return yes(v);
  }
}
/** "Electric car: yes", "Yearly use: 5,000 kWh", "Boiler: 40 years old". The car's mileage joins the car line. */
export function factLines(values: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(values)) {
    if (k === "ev_annual_km" && "has_ev" in values) continue;
    if (k === "has_ev" && values.ev_annual_km != null) { out.push(`${fieldLabel(k)}: ${fieldValue(k, v)}, ${fieldValue("ev_annual_km", values.ev_annual_km)}`); continue; }
    out.push(`${fieldLabel(k)}: ${fieldValue(k, v)}`);
  }
  return out;
}
