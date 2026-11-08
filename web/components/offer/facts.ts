// Copy normalisers for the offer surfaces (planner card and homeowner page): engine sentences start with a capital,
// case-context words never reach product copy, and each variant reduces to the figures that drive the choice.
import type { Design, Economics } from "@/lib/api";
import { eur, n0, n1 } from "./format";

export const sentence = (x: string) => { const t = x.trim(); return t ? t.charAt(0).toUpperCase() + t.slice(1) : t; };

// Evaluation language belongs on the Check page only.
const CASE = /\b(inside |outside |above |below |within )?(reonic'?s? (guide|band|rule)|textbook|rule of thumb|senior planners?|experts?'?|bands?)\b/i;
export const hasCaseWords = (x: string | null | undefined) => !!x && CASE.test(x);
// Drops any clause carrying case words; null when nothing useful is left.
export function scrub(x: string | null | undefined): string | null {
  if (!x) return null;
  const kept = x.split(/(?<=[.;])\s+|,\s+|:\s+/).filter((c) => c.trim() && !hasCaseWords(c));
  const out = kept.join(", ").replace(/[,;:]\s*$/, "").trim();
  return out ? sentence(out) : null;
}

const MODULE_KWP = 0.45;
const modulesOf = (kwp: number | null | undefined) => (kwp ? Math.round(kwp / MODULE_KWP) : 0);

// The one thing a variant changes against the planners' pick, battery first, then modules, then the loads.
export function differs(d: Partial<Design>, ref: Partial<Design> | null): string | null {
  if (!ref) return null;
  const b = d.battery_kwh ?? 0, rb = ref.battery_kwh ?? 0;
  if (Math.abs(b - rb) >= 0.5) return !b ? "No battery" : !rb ? `+${n1(b)} kWh battery` : b > rb ? `+${n1(b - rb)} kWh battery` : `${n1(rb - b)} kWh less battery`;
  const m = modulesOf(d.pv_kwp) - modulesOf(ref.pv_kwp);
  if (m) return !d.pv_kwp ? "No solar" : m > 0 ? `${m} more modules` : `${-m} fewer modules`;
  if (!!d.wallbox_kw !== !!ref.wallbox_kw) return d.wallbox_kw ? "Adds a wallbox" : "No wallbox";
  if (!!d.heatpump_kw !== !!ref.heatpump_kw) return d.heatpump_kw ? "Adds a heat pump" : "No heat pump";
  return "Same kit";
}

export const breakEvenOf = (e: Economics | null | undefined): number | null =>
  e ? ((e as { break_even_year?: number | null }).break_even_year ?? e.payback_years ?? null) : null;

export type Fact = { label: string; value: string; note?: string };
// Price, break-even, and the difference from the planners' pick (left out for the pick itself). Same order everywhere.
export function variantFacts(e: Economics | null | undefined, d: Partial<Design>, ref: Partial<Design> | null): Fact[] {
  const out: Fact[] = [];
  if (e) {
    out.push({ label: "Price", value: eur(e.capex_eur), note: "estimate" });
    const be = breakEvenOf(e);
    out.push({ label: "Break-even", value: be == null ? "20+ years" : `${n0(be)} years` });
  }
  const diff = differs(d, ref);
  if (diff) out.push({ label: "Change", value: diff });
  return out;
}
