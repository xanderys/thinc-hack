// Lead qualification: is this lead worth a planner's afternoon on site? One pure rule over what the web already has.
// The rule in plain words, with sources: docs/qualification.md. Every number here is an estimate until the site visit.
import type { DesignResponse, HomeInputs, Lead, RoofResult } from "./api";
import { isMultiUnit } from "./building";

export type Verdict = "visit" | "call_first" | "decline";
export type FactSource = "stated" | "measured" | "estimated";
export type FactField = "address" | "annual_use" | "people" | "floor_area" | "build_year" | "heating_type" | "heating_bill" | "ev" | "preference";

export interface Qualification {
  verdict: Verdict;
  sentence: string;                       // "Priority: Worth a visit: the roof fits 10.35 kWp ..." (verdict word, then reason)
  reason: string;                         // a planner's sentence plus the value: "Worth a visit: the roof fits 10.35 kWp and pays back in 10 years. Expected offer about €14,600."
  facts: { stated: number; total: number; list: { field: FactField | "roof"; source: FactSource }[] };   // roof is listed, never counted
  expected_offer_eur: number | null;      // draft investment, rounded to 100 EUR; null on Decline
  confidence_line: string;                // "7 of 9 facts stated, roof measured from the address, consumption from the bill"
  confirm_on_site: string[];
}

export const VERDICT_WORD: Record<Verdict, string> = { visit: "Priority", call_first: "Call first", decline: "Decline" };
export const VERDICT_ORDER: Verdict[] = ["visit", "call_first", "decline"];

export const DEFAULT_ANNUAL_KWH = 4500;   // the engine's default when the lead gives no use
export const MIN_KWP = 3;                 // under this the roof cannot carry a system worth an offer
export const MAX_PAYBACK_YEARS = 20;
const MODULE_KWP = 0.45;                  // the engine's standard module (450 W)

type LeadLike = Pick<Lead, "status" | "facts" | "address_or_postcode"> & Partial<Pick<Lead, "history" | "decision">>;

const n2 = (x: number) => (Math.round(x * 100) / 100).toLocaleString("en-GB");
const n1 = (x: number) => (Math.round(x * 10) / 10).toLocaleString("en-GB");
const n0 = (x: number) => Math.round(x).toLocaleString("en-GB");
export const offerEur = (x: number | null) => x == null ? "No offer" : `${n0(x)} EUR, estimate`;

const isPostcode = (s: string | undefined | null) => !!s && /^\s*\d{5}\s*$/.test(s);
// A roof face is usable when it is flat enough to tilt panels on, or not facing north (more than 60 degrees off north).
const offNorth = (az: number) => { const a = ((az % 360) + 360) % 360; return Math.min(a, 360 - a); };
const usableFace = (s: { azimuth: number | null; pitch: number | null }) => s.azimuth == null || (s.pitch ?? 0) < 10 || offNorth(s.azimuth) > 60;
const measuredRoof = (r: RoofResult | null | undefined): r is RoofResult => !!r && !r.pending && (r.source === "lod2" || r.source === "google-solar" || r.source === "osm");

export function qualify(lead: LeadLike, design: DesignResponse | null | undefined, roof: RoofResult | null | undefined): Qualification {
  const f = lead.facts as HomeInputs & { postcode?: string | null };
  const asked = new Set((lead.history ?? []).map((h) => h.field));
  const hasStreet = !!f.address && !isPostcode(f.address) || (!!lead.address_or_postcode && !isPostcode(lead.address_or_postcode));
  const fromBill = asked.has("monthly_bill_eur");
  const useStated = f.annual_demand_kwh !== DEFAULT_ANNUAL_KWH || asked.has("annual_demand_kwh") || fromBill;

  const list: Qualification["facts"]["list"] = [
    { field: "address", source: hasStreet ? "stated" : "estimated" },
    { field: "annual_use", source: useStated ? "stated" : "estimated" },
    { field: "people", source: f.num_inhabitants ? "stated" : "estimated" },
    { field: "floor_area", source: f.house_size_sqm ? "stated" : "estimated" },
    { field: "build_year", source: f.house_built_year ? "stated" : "estimated" },
    { field: "heating_type", source: f.heating_type && f.heating_type !== "Unknown" ? "stated" : "estimated" },
    { field: "heating_bill", source: f.heating_cost_per_year_eur != null ? "stated" : "estimated" },
    { field: "ev", source: f.has_ev || f.ev_annual_km != null || asked.has("ev") || asked.has("has_ev") ? "stated" : "estimated" },
    { field: "preference", source: f.preference || asked.has("preference") ? "stated" : "estimated" },
  ];
  const stated = list.filter((x) => x.source === "stated").length, total = list.length;
  list.push({ field: "roof", source: measuredRoof(roof) && roof.confidence === "measured" ? "measured" : "estimated" });

  const d = design?.design, e = design?.economics;
  const capex = e && d?.pv_kwp ? Math.round(e.capex_eur / 100) * 100 : null;
  const payback = e?.payback_years ?? null;

  const roofWords = !hasStreet ? "roof not measured"
    : roof?.pending ? "roof being measured"
    : measuredRoof(roof) ? (roof.confidence === "measured" ? "roof measured from the address" : "roof estimated from the footprint")
    : roof ? "roof not found at the address" : "roof being looked up";
  const useWords = fromBill ? "consumption from the bill" : useStated ? "consumption stated" : `consumption assumed at ${n0(DEFAULT_ANNUAL_KWH)} kWh`;
  const confidence_line = `${stated} of ${total} facts stated, ${roofWords}, ${useWords}`;

  const confirm_on_site = [
    hasStreet && measuredRoof(roof) ? "roof condition and shade (estimate from the surface model)" : "roof size, condition and shade (not measured yet)",
    "meter and grid connection",
    ...(d?.battery_kwh ? ["battery location"] : []),
    ...(d?.heatpump_kw ? ["heat pump location and the radiators"] : []),
    ...(d?.wallbox_kw ? ["wallbox cable route"] : []),
  ];

  const out = (verdict: Verdict, why: string): Qualification => ({
    verdict, reason: why, sentence: `${VERDICT_WORD[verdict]}: ${why}`, facts: { stated, total, list }, expected_offer_eur: verdict === "decline" ? null : capex, confidence_line, confirm_on_site,
  });

  // 1. The homeowner said no.
  if (lead.status === "declined" || lead.decision?.action === "decline") {
    const at = lead.decision?.decided_at ? new Date(lead.decision.decided_at) : null;
    return out("decline", at && !isNaN(+at) ? `Declined by the homeowner on ${at.getDate()} ${at.toLocaleString("en-GB", { month: "short" })}.` : "Declined by the homeowner.");
  }
  // 2. A flat in a block: the roof is shared, a single-family design does not apply.
  if (hasStreet && measuredRoof(roof) && isMultiUnit(roof, f).multi) return out("call_first", "One call first: is this a house or a flat? A shared roof needs a different design.");
  // 3. The roof cannot carry a system (only when it was really looked up at a street address).
  if (hasStreet && measuredRoof(roof)) {
    if (roof.segments.length > 0 && !roof.segments.some(usableFace)) return out("decline", "Not worth a visit: the roof faces north only.");
    // max_kwp already counts only the usable faces (the engine leaves north faces out of usable_area_m2). The sentence
    // quotes the laid-out design (the engine caps the design at the modules the layout places); the area maximum only
    // when there is no design.
    if (roof.max_kwp != null && roof.max_kwp < MIN_KWP) {
      const kwp = d?.pv_kwp ?? null, mods = kwp ? Math.round(kwp / MODULE_KWP) : 0;
      return out("decline", kwp
        ? `Not worth a visit: the roof fits only ${mods === 1 ? "one module" : `${mods} modules`}, ${n2(kwp)} kWp.`
        : `Not worth a visit: the roof fits only ${n1(roof.max_kwp)} kWp.`);
    }
  }
  // 4. One fact would change the design: the roof first, since everything sits on it.
  if (!hasStreet) return out("call_first", "One call first: the roof is not measured, ask for the address.");
  if (roof?.pending || roof === undefined) return out("call_first", "One call first: the roof is still being measured.");
  if (!measuredRoof(roof)) return out("call_first", "One call first: no building found at this address, confirm it.");
  // 5. No system that pays back.
  if (!d?.pv_kwp) return out("decline", "Not worth a visit: no system fits this home.");
  if (payback == null || payback > MAX_PAYBACK_YEARS) return out("decline", `Not worth a visit: it would not pay back within ${MAX_PAYBACK_YEARS} years.`);
  // 6. The other facts that move the design.
  if (!useStated) return out("call_first", "One call first: annual use is the default, ask for the bill.");
  if ((!f.heating_type || f.heating_type === "Unknown") && f.heating_cost_per_year_eur != null)
    return out("call_first", "One call first: the heating type is unknown, ask what heats the house.");
  return out("visit", `Worth a visit: the roof fits ${n2(d.pv_kwp)} kWp and pays back in ${Math.round(payback)} years.${capex ? ` Expected offer about €${n0(capex)}.` : ""}`);
}
