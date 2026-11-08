// Copy normalisers for the offer surfaces (planner card and homeowner page): engine sentences start with a capital,
// case-context words never reach product copy, and each variant reduces to the figures that drive the choice.
import type { Design, Economics } from "@/lib/api";
import type { Check } from "@/components/spatial/types";
import { eur, n0, n1, pc } from "./format";

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
export function differs(d: Partial<Design>, ref: Partial<Design> | null): string | null {
  if (!ref) return null;
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
export function variantFacts(e: Economics | null | undefined, d: Partial<Design>, ref: Partial<Design> | null): Fact[] {
  const out: Fact[] = [];
  if (e) {
    out.push({ label: "Price", value: eur(e.capex_eur), note: "estimate" });
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
