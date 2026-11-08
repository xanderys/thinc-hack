// Copy normalisers for the offer surfaces (planner card and homeowner page): engine sentences start with a capital,
// case-context words never reach product copy, and each variant reduces to the figures that drive the choice.
import type { Design, Economics } from "@/lib/api";
import type { Check } from "@/components/spatial/types";
import { eur, n0, n1, n2, pc } from "./format";

export const sentence = (x: string) => { const t = x.trim(); return t ? t.charAt(0).toUpperCase() + t.slice(1) : t; };

// Evaluation language belongs on the Check page only.
const CASE = /\b(reonic\b[^,.;]*\b(guide|band|rule)s?|guide|textbook|rule of thumb|senior planners?|experts?'?|bands?)\b/i;
export const hasCaseWords = (x: string | null | undefined) => !!x && CASE.test(x);
// Drops any clause carrying case words; null when nothing useful is left.
export function scrub(x: string | null | undefined): string | null {
  if (!x) return null;
  const kept = x.split(/(?<=[.;])\s+|,\s+|:\s+/).filter((c) => c.trim() && !hasCaseWords(c));
  const out = kept.join(", ").replace(/[,;:.]\s*$/, "").trim();
  return out ? sentence(out) : null;
}

const MODULE_KWP = 0.45;
const modulesOf = (kwp: number | null | undefined) => (kwp ? Math.round(kwp / MODULE_KWP) : 0);

// Rough euros per unit, only to rank changes when more than two differ (never shown).
const WEIGHT = { module: 560, kwh: 450, wallbox: 1100, heatpump: 32000 };
const plural = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;

// Every component that differs from the planners' pick, in Angebot order (modules, storage, wallbox, heat pump),
// capped at the two with the largest price effect; the first word of each later item in lower case.
export function differs(d: Partial<Design> | null | undefined, ref: Partial<Design> | null): string | null {
  if (!ref || !d) return null;
  const out: { text: string; cost: number }[] = [];
  const m = modulesOf(d.pv_kwp) - modulesOf(ref.pv_kwp);
  if (m) out.push({ cost: Math.abs(m) * WEIGHT.module, text: !d.pv_kwp ? "No solar" : !ref.pv_kwp ? `+${plural(m, "module", "modules")}` : m > 0 ? `${plural(m, "more module", "more modules")}` : `${plural(-m, "fewer module", "fewer modules")}` });
  const b = d.battery_kwh ?? 0, rb = ref.battery_kwh ?? 0;
  if (Math.abs(b - rb) >= 0.5) out.push({ cost: Math.abs(b - rb) * WEIGHT.kwh, text: !b ? "No battery" : !rb ? `+${n1(b)} kWh battery` : b > rb ? `+${n1(b - rb)} kWh battery` : `${n1(rb - b)} kWh less battery` });
  const w = d.wallbox_kw ?? 0, rw = ref.wallbox_kw ?? 0;
  if (!!w !== !!rw) out.push({ cost: WEIGHT.wallbox, text: w ? "Adds a wallbox" : "No wallbox" });
  else if (w && Math.abs(w - rw) >= 0.5) out.push({ cost: WEIGHT.wallbox / 4, text: w > rw ? `${n1(w)} kW wallbox, up from ${n1(rw)}` : `${n1(w)} kW wallbox, down from ${n1(rw)}` });
  const h = d.heatpump_kw ?? 0, rh = ref.heatpump_kw ?? 0;
  if (!!h !== !!rh) out.push({ cost: WEIGHT.heatpump, text: h ? "Adds a heat pump" : "No heat pump" });
  else if (h && Math.abs(h - rh) >= 0.5) out.push({ cost: Math.abs(h - rh) * 1500, text: h > rh ? `+${n1(h - rh)} kW heat pump` : `${n1(rh - h)} kW smaller heat pump` });
  if (!out.length) return "Same kit";
  const keep = out.length > 2 ? new Set([...out].sort((x, y) => y.cost - x.cost).slice(0, 2)) : new Set(out);
  return out.filter((x) => keep.has(x)).map((x, i) => (i ? x.text.charAt(0).toLowerCase() + x.text.slice(1) : x.text)).join(", ");
}

export const breakEvenOf = (e: Economics | null | undefined): number | null =>
  e ? ((e as { break_even_year?: number | null }).break_even_year ?? e.payback_years ?? null) : null;

export type Fact = { label: string; value: string; note?: string };
// Price, break-even, and the difference from the planners' pick (for the pick itself, none). Same shape everywhere.
export function variantFacts(e: Economics | null | undefined, d0: Partial<Design> | null | undefined, ref: Partial<Design> | null): Fact[] {
  const d = d0 ?? {};
  const out: Fact[] = [];
  if (e) {
    out.push({ label: "Price", value: eur(e.capex_eur) });
    const be = breakEvenOf(e);
    out.push({ label: "Break-even", value: be == null ? "20+ years" : `${n0(be)} years` });
  }
  out.push({ label: "Change", value: differs(d, ref) ?? "none, the planners' pick" });
  return out;
}

// Engine checks (sizing and economics) as product copy, for the "i" popovers on the offer and the calculation cards.
// The value with its unit: "129 %", "23 modules", "9.6 years".
export const checkValue = (c: Check): string => c.value == null ? "" : typeof c.value !== "number" ? String(c.value)
  : c.unit === "share" ? pc(c.value) : c.unit === "%" ? `${n0(c.value)} %` : `${c.value >= 100 ? n0(c.value) : n1(c.value)}${c.unit && c.unit.length < 8 ? ` ${c.unit}` : ""}`;
// One line, label then value, case words dropped; null when nothing is left to show. The battery sizing reference
// reads "Battery 0.51 kWh per kWh of daily use".
export function checkLine(c: Check): { label: string; value: string } | null {
  const ref = c.level === "reference" || (!c.level && /battery per daily/i.test(c.name));
  if (ref) { const m = scrub(c.message) ?? `Battery ${n1(Number(c.value))} kWh per kWh of daily use`; return { label: m, value: "" }; }
  const label = scrub(c.name);
  return label ? { label, value: checkValue(c) } : null;
}
export const findCheck = (checks: Check[] | null | undefined, name: RegExp) => (checks ?? []).find((c) => name.test(c.name)) ?? null;

const euros = (x: string) => Number(x.replace(/,/g, ""));

// SKUs (engine v2.15): the product behind each part, read from the design response wherever the engine puts it
// (skus.<part>, design.skus.<part> or components.<c>.sku). Absent on an older engine: the rows keep their generic names.
export type SkuPart = "module" | "inverter" | "battery" | "wallbox" | "heatpump";
export type Sku = { brand: string; name: string; size?: number; unit?: string; share?: number; modules?: number; brands?: ({ brand: string; share?: number } | string)[] };
const COMP_OF: Record<SkuPart, string[]> = { module: ["pv", "module"], inverter: ["inverter"], battery: ["battery"], wallbox: ["wallbox"], heatpump: ["heatpump"] };
export function skusOf(r: unknown): Partial<Record<SkuPart, Sku>> {
  const o = (r ?? {}) as { skus?: Record<string, Sku>; design?: { skus?: Record<string, Sku> }; components?: Record<string, { sku?: Sku } | undefined> };
  const out: Partial<Record<SkuPart, Sku>> = {};
  (Object.keys(COMP_OF) as SkuPart[]).forEach((p) => {
    const top = o.skus ?? o.design?.skus;   // when the engine sends skus, they are the whole answer
    const s = top ? top[p] : COMP_OF[p].map((c) => o.components?.[c]?.sku).find(Boolean);
    if (s && typeof s.brand === "string" && typeof s.name === "string") out[p] = s;
  });
  return out;
}
// "Huawei Battery 10kWh" -> "Huawei Battery": the size is shown beside it in the lighter colour.
// Modules read short on a row ("Sunpro TOPCon"); the full product name stays in the rate card.
const TECH = /\b(TOPCon|PERC|HJT|IBC|Bifacial)\b/i;
export const skuShort = (s: Sku, part: SkuPart) => part === "module" ? `${s.brand}${TECH.exec(s.name) ? ` ${TECH.exec(s.name)![1]}` : ""}` : skuName(s);
export const skuName = (s: Sku) => { const n = s.name.replace(/\s*\d+(?:[.,]\d+)?\s*(?:x\s*\d+\s*)?(?:kWh|kWp|kW|Wp|W)\b/gi, "").replace(/\s{2,}/g, " ").trim(); return n.toLowerCase().startsWith(s.brand.toLowerCase()) ? n : `${s.brand} ${n}`; };
// The brands the data has for this part and size, most common first.
export const brandsOf = (s: Sku | undefined): string[] => {
  if (!s?.brands?.length) return [];
  const xs = s.brands.map((b) => (typeof b === "string" ? { brand: b, share: 0 } : { brand: b.brand, share: b.share ?? 0 }));
  return [...new Map(xs.sort((a, b) => b.share - a.share).map((x) => [x.brand, x])).keys()];
};
export const years = (n: number) => `${n0(n)} ${Math.round(n) === 1 ? "year" : "years"}`;

// The kit sheet as an invoice: one price per row, the total the exact sum of the rows. Rates come from the engine's
// own rates block (v2.15: per kWp, per kWh, fixed costs) or, on an older response, its assumption sentence. The data
// has no prices: every figure is the engine's market model, shown as an estimate.
export type Rates = { pv_fixed_eur?: number; pv_eur_per_kwp?: number; battery_eur_per_kwh?: number; wallbox_fixed_eur?: number; heatpump_net_eur?: number; lines?: { item: string; eur: number }[]; total_eur?: number };
export type RowKey2 = "pv" | "inv" | "bat" | "wb" | "hp" | "inst";
export type Invoice = { price: Partial<Record<RowKey2, number | "included">>; calc: string[]; total: number };
export function invoiceOf(d: Partial<Design>, rates: Rates | null | undefined, assumptions: string[] | null | undefined, capex: number | null | undefined, modules?: number | null, names: { pv?: string; bat?: string } = {}): Invoice | null {
  const text = (assumptions ?? []).join(" ");
  const pvM = /PV €([\d,]+) plus €([\d,]+) per kWp/i.exec(text), batM = /battery €([\d,]+) per kWh/i.exec(text);
  const fixed = rates?.pv_fixed_eur ?? (pvM ? euros(pvM[1]) : null), perKwp = rates?.pv_eur_per_kwp ?? (pvM ? euros(pvM[2]) : null);
  const perKwh = rates?.battery_eur_per_kwh ?? (batM ? euros(batM[1]) : null);
  if (perKwp == null && perKwh == null) return null;
  const price: Invoice["price"] = {}, calc: string[] = [];
  if (d.pv_kwp && perKwp != null) {
    const eur = Math.round(d.pv_kwp * perKwp), n = modules && modules > 0 ? modules : null;
    price.pv = eur; calc.push(`${names.pv ? `${names.pv}: ` : ""}${n ? `${n} modules, ` : ""}${n2(d.pv_kwp)} kWp × €${n0(perKwp)}/kWp = €${n0(eur)}`);
  }
  if (d.inverter_kw) price.inv = "included";
  if (d.battery_kwh && perKwh != null) { const eur = Math.round(d.battery_kwh * perKwh); price.bat = eur; calc.push(`${names.bat ? `${names.bat}: ` : ""}${n1(d.battery_kwh)} kWh × €${n0(perKwh)}/kWh = €${n0(eur)}`); }
  const line = (k: string) => rates?.lines?.find((l) => l.item === k)?.eur;
  if (d.wallbox_kw) { const eur = line("wallbox") ?? rates?.wallbox_fixed_eur; if (eur != null) { price.wb = Math.round(eur); calc.push(`wallbox €${n0(eur)}`); } }
  if (d.heatpump_kw) { const eur = line("heatpump") ?? rates?.heatpump_net_eur; if (eur != null) { price.hp = Math.round(eur); calc.push(`heat pump €${n0(eur)} after subsidy`); } }
  if (d.pv_kwp && fixed != null) { price.inst = Math.round(fixed); calc.push(`fixed per system €${n0(fixed)}`); }
  let total = Object.values(price).reduce<number>((x, v) => x + (typeof v === "number" ? v : 0), 0);
  // An older response without prices for a wallbox or heat pump: their share of the engine's total, so nothing is left out.
  const missing = (["wb", "hp"] as const).filter((k) => (k === "wb" ? d.wallbox_kw : d.heatpump_kw) && price[k] == null);
  if (missing.length === 1 && capex != null && capex > total) { const eur = Math.round(capex - total); price[missing[0]] = eur; calc.push(`${missing[0] === "wb" ? "wallbox" : "heat pump"} €${n0(eur)}`); total += eur; }
  return { price, calc, total };
}
// The investment as one number everywhere (tiles, pass, total): the sum of the rows where the engine sends rates.
// The investment as one number everywhere (tiles, pass, kit total): the invoice total for the design on screen, from the
// engine's unit rates (so a chooser edit moves every figure together); the engine's capex where it sends no rates.
export const investmentOf = (r: { design?: Partial<Design>; rates?: Rates | null; economics: { capex_eur: number; assumptions?: string[] } } | null | undefined) =>
  !r || !r.economics ? 0 : (r.design ? invoiceOf(r.design, r.rates, r.economics.assumptions, r.economics.capex_eur)?.total : undefined) ?? r.economics.capex_eur;
