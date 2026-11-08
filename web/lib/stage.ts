// Pure helpers for the stage. Every number here comes from the engine or the lead.
import { COMPONENT_DESIGN_FIELD, INSTALLER_NAME, type ComponentKey, type Design, type DesignResponse, type HeatingType, type HomeInputs } from "./api";

export const KEYS: ComponentKey[] = ["pv", "battery", "heatpump", "wallbox"];
export const NAME: Record<ComponentKey, string> = { pv: "Solar", battery: "Battery", heatpump: "Heat pump", wallbox: "Wallbox" };
export const HEATING_WORD: Record<HeatingType, string> = { Gas: "Gas", Oil: "Oil", Heatpump: "Heat pump", OtherNonRenewable: "Other, fossil", OtherRenewable: "Other, renewable", Unknown: "Not known" };

export const DEFAULTS: HomeInputs = {
  installer_id: "2a8ba8e2", annual_demand_kwh: 4500, load_profile: "H0", has_ev: false, has_wallbox: false,
  heating_type: "Unknown", has_solar: false, has_storage: false,
};

export const n0 = (x: number) => Math.round(x).toLocaleString("en-GB");
export const n2 = (x: number) => x.toLocaleString("en-GB", { maximumFractionDigits: 2 });
export const pct = (x: number) => `${Math.round(x * 100)}`;

export function size(d: Design, k: ComponentKey) { return d[COMPONENT_DESIGN_FIELD[k]]; }

// Plain facts for /api/write. Formatted the way they should be read back.
export function buildFacts(i: HomeInputs, r: DesignResponse): string[] {
  const d = r.design, e = r.economics, f: string[] = [];
  const home = [`${n0(i.annual_demand_kwh)} kWh a year of household electricity`];
  if (i.heating_type !== "Unknown") home.push(`${HEATING_WORD[i.heating_type].toLowerCase()} heating`);
  if (i.num_inhabitants) home.push(`${i.num_inhabitants} people`);
  f.push(`The home: ${home.join(", ")}.`);
  if (i.has_ev) f.push(`An electric car is planned${i.ev_annual_km ? `, driving ${n0(i.ev_annual_km)} km a year` : ""}.`);
  f.push(`Design style of ${INSTALLER_NAME[i.installer_id]}.`);
  const part = (k: ComponentKey, u: string) => { const v = size(d, k); return v == null ? `no ${NAME[k].toLowerCase()}` : `${NAME[k].toLowerCase()} ${n2(v)} ${u}`; };
  f.push(`Proposal: ${part("pv", "kWp")}${d.inverter_kw ? ` with a ${n2(d.inverter_kw)} kW inverter` : ""}, ${part("battery", "kWh")}, ${part("heatpump", "kW")}, ${part("wallbox", "kW")}.`);
  for (const k of KEYS) {
    const c = r.components[k], took = Math.round(c.neighbours.share_included * c.neighbours.n);
    const who = k === "heatpump" && i.heating_type !== "Unknown" ? `${HEATING_WORD[i.heating_type].toLowerCase()} homes` : "homes";
    f.push(c.decision === "none" && took === 0 ? `${NAME[k]}: not offered; similar ${who} here did not get one.` : `${NAME[k]}: ${c.reason}`);
  }
  f.push(`Sizing: the way ${INSTALLER_NAME[i.installer_id]} sizes family homes like this one.`);
  // Ratios such as kWp per 1,000 kWh read as jargon; the roof line and real warnings stay.
  for (const p of r.plausibility) if (p.level === "warn" || !/per 1,000 kWh|per kWp/.test(p.message)) f.push(p.message);
  const a = e.annual;
  f.push(`Estimates: ${a ? `solar yield ${n0(a.pv_yield_kwh)} kWh a year, ` : ""}autarky ${pct(e.autarky_share)}%, investment ${n0(e.capex_eur)} EUR, saving ${n0(e.annual_saving_eur)} EUR a year${e.payback_years != null ? `, payback ${n2(e.payback_years)} years` : ""}.`);
  return f;
}

// One thing for a human to check: a real warning, else an included component under 0.5 confidence, else nothing.
export function pickFlag(r: DesignResponse): string | null {
  const warn = r.plausibility.find((p) => p.level === "warn");
  if (warn) return warn.message;
  const inc = KEYS.filter((k) => r.components[k].decision === "include").sort((a, b) => r.components[a].confidence - r.components[b].confidence);
  if (inc[0] && r.components[inc[0]].confidence < 0.5) return `the ${NAME[inc[0]].toLowerCase()} size. ${evidence(r, inc[0], null)}`;
  return null;
}

export function evidence(r: DesignResponse, k: ComponentKey, installer: HomeInputs["installer_id"] | null): string {
  const c = r.components[k], nb = c.neighbours, took = Math.round(nb.share_included * nb.n);
  const who = installer ? `similar homes from ${INSTALLER_NAME[installer]}` : "similar homes";
  if (took === 0) return `None of ${nb.n} ${who} chose one.`;
  const range = nb.p25 != null && nb.p75 != null ? (nb.p25 === nb.p75 ? `, most at ${n2(nb.p25)} ${c.unit}` : `, most between ${n2(nb.p25)} and ${n2(nb.p75)} ${c.unit}`) : "";
  return `${took} of ${nb.n} ${who} chose one${range}.`;
}

export function variantName(d: Design, base?: Design): string {
  const pv = d.pv_kwp != null, bat = d.battery_kwh != null;
  if (!pv) return bat ? "Storage only" : "No solar";
  if (!bat) return "PV only";
  if (base && base.battery_kwh != null && d.battery_kwh !== base.battery_kwh) return d.battery_kwh! > base.battery_kwh ? "PV + larger storage" : "PV + smaller storage";
  if (base && base.pv_kwp != null && d.pv_kwp !== base.pv_kwp) return d.pv_kwp! > base.pv_kwp ? "Larger PV + storage" : "Smaller PV + storage";
  return "PV + storage";
}

export function designLine(d: Design): string {
  const p: string[] = [];
  if (d.pv_kwp != null) p.push(`${n2(d.pv_kwp)} kWp`);
  if (d.battery_kwh != null) p.push(`${n2(d.battery_kwh)} kWh`);
  if (d.heatpump_kw != null) p.push(`${n2(d.heatpump_kw)} kW heat pump`);
  if (d.wallbox_kw != null) p.push(`${n2(d.wallbox_kw)} kW wallbox`);
  return p.join(", ") || "Nothing";
}

export const QUESTION: Partial<Record<keyof HomeInputs, string>> = {
  annual_demand_kwh: "How much electricity does the house use a year?",
  heating_type: "What heats the house?",
  has_ev: "Is an electric car coming?",
  heating_demand_kwh: "How much heat does the house use a year?",
  has_solar: "Is there solar on the roof already?",
};

export function optionLabel(field: keyof HomeInputs, v: unknown): string {
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return n0(v);
  if (field === "heating_type") return HEATING_WORD[v as HeatingType] ?? String(v);
  return String(v);
}

// Engine sentences name installers by id; the planner sees names.
export function named(s: string): string {
  return s.replace(/installer (2a8ba8e2|23c108b7)/gi, (_, id: keyof typeof INSTALLER_NAME) => INSTALLER_NAME[id]);
}
// The same text with no installer named (the check page: homes from both installers in the data pack).
export const unnamed = (s: string) => s.replace(/installer (2a8ba8e2|23c108b7)/gi, "the installer");
