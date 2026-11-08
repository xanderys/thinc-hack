// Is the building at this address bigger than one household's home? A flat in an apartment block shares its roof
// and its envelope, so a single-family PV, battery and heat pump design does not apply to it.
// Signals, strongest first: the measured LoD2 geometry (the engine's geometry.large_building: footprint 300 m2 or
// more, 4 or more storeys, or 12 m or more; else the footprint over 300 m2 or a block 14 m tall), then the building's
// floor area (footprint times storeys from the LoD2 height at about 3 m a storey) against the floor area the lead
// gave (or 40 m2 a person, else 140 m2) by more than 2.5 times, and the Zensus dwellings class last: measured
// geometry outranks a census cell (a 1,742 m2 footprint once passed as single-family on "1 dwelling").
// Multi-unit only adds the shared-roof notice and the single-family tags; the house view and the design stay.
// Only the engine's large_building flag or Zensus 3 or more dwellings mark a building multi-unit; a missing class is unknown, never multi-unit.
// Used by the planner card and by the qualify step (web/lib/qualify.ts) to ask "is this a house or a flat?".
import type { HomeInputs } from "./api";

export type BuildingShape = {
  footprint_m2?: number | null; height_m?: number | null; storeys?: number | null; dwellings_class?: string | null;
  geometry?: { footprint_m2?: number | null; storeys?: number | null; height_m?: number | null; large_building?: boolean | null; note?: string | null } | null;
  plan?: { floor_area_m2?: number | null; storeys?: number | null } | null;
  dwellings?: number | null; zensus_dwellings?: number | null; dwellings_per_building?: number | null;
};
export type MultiUnit = { multi: boolean; reason: string; footprint_m2: number | null; storeys: number | null; building_m2: number | null; stated_m2: number };

const STOREY_M = 3, ROOF_M = 2.5;
const n0 = (x: number) => Math.round(x).toLocaleString("en-GB");

export function isMultiUnit(model: BuildingShape | null | undefined, inputs: Partial<HomeInputs> | null | undefined): MultiUnit {
  const people = inputs?.num_inhabitants ?? null;
  // A stated size over 100 m2 a person is usually the whole building's floor area (read from the model), not the
  // household's; then the household is taken at 40 m2 a person.
  const given = inputs?.house_size_sqm ?? null;
  const stated = given != null && !(people && given / people > 100) ? given : people ? people * 40 : 140;
  const g = model?.geometry ?? null;
  const fp = g?.footprint_m2 ?? model?.footprint_m2 ?? model?.plan?.floor_area_m2 ?? null;
  const h = g?.height_m ?? model?.height_m ?? null;
  // The LoD2 height runs to the ridge; take a roof off before counting storeys.
  const storeys = h != null ? Math.max(1, Math.round(Math.max(STOREY_M, h - ROOF_M) / STOREY_M)) : model?.storeys ?? model?.plan?.storeys ?? null;
  const area = fp != null && storeys != null ? fp * storeys : null;
  const out = (multi: boolean, reason: string): MultiUnit => ({ multi, reason, footprint_m2: fp, storeys, building_m2: area, stated_m2: stated });
  const dwc = model?.dwellings_class?.match(/\d+/);   // Zensus 2022 class, e.g. "3 to 6 dwellings"
  const dw = model?.dwellings_per_building ?? model?.zensus_dwellings ?? model?.dwellings ?? (dwc ? Number(dwc[0]) : null);
  if (g?.large_building) return out(true, fp != null && fp >= 300 ? `Footprint ${n0(fp)} m², a large building` : h != null ? `Building ${n0(h)} m tall, a large building` : "A large building in the 3D model");
  if (dw != null && dw >= 3) return out(true, `Zensus counts ${n0(dw)} dwellings in this building`);
  if (dw != null && dw <= 2 && fp != null) return out(false, `Zensus counts ${n0(dw)} dwelling${dw === 1 ? "" : "s"}; building about ${n0(area ?? fp)} m²`);
  if (dw != null && dw <= 2) return out(false, `Zensus counts ${n0(dw)} dwelling${dw === 1 ? "" : "s"} in this building`);
  if (fp == null) return out(false, "No building model");
  return out(false, `Building about ${n0(area ?? fp)} m², in line with a ${n0(stated)} m² home`);
}

// The design's kind: the engine's design.kind (or the response's kind) when it sends one, else the multi-unit flag above.
// A shared building gets the whole-roof potential, a balcony system and the wallbox, never a flat-level kit.
export type DesignKind = "shared_building" | "single_family";
export type RoofPotential = { kwp?: number | null; modules?: number | null; kwh_year?: number | null; label?: string | null; model?: string | null; price_eur_whole_roof?: number | null };
export type Balcony = { inverter_w?: number | null; kwp?: number | null; kwh_year?: number | null; price_eur?: number | null; source?: string | null };
type KindCarrier = { kind?: string | null; design?: { kind?: string | null; roof_potential?: RoofPotential | null; balcony?: Balcony | null } | null; roof_potential?: RoofPotential | null; balcony?: Balcony | null; roof?: { max_kwp?: number | null; max_panels?: number | null } | null } | null | undefined;
export function designKind(res: KindCarrier, model?: BuildingShape | null, inputs?: Partial<HomeInputs> | null): DesignKind {
  const k = res?.design?.kind ?? res?.kind;
  if (k === "shared_building" || k === "single_family") return k;
  return model && isMultiUnit(model, inputs).multi ? "shared_building" : "single_family";
}
// The whole-roof potential and the balcony system, from the engine only; the fallback is the engine's own roof maximum.
export function sharedOf(res: KindCarrier): { roof: RoofPotential | null; balcony: Balcony | null } {
  const roof = res?.design?.roof_potential ?? res?.roof_potential ?? (res?.roof?.max_kwp ? { kwp: res.roof.max_kwp, modules: res.roof.max_panels ?? null } : null);
  return { roof, balcony: res?.design?.balcony ?? res?.balcony ?? null };
}
