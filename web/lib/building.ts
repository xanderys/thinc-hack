// Is the building at this address bigger than one household's home? A flat in an apartment block shares its roof
// and its envelope, so a single-family PV, battery and heat pump design does not apply to it.
// Signals, strongest first: a Zensus dwellings-per-building figure, the LoD2 footprint over 300 m2, a tall block,
// and the building's floor area (footprint times storeys from the LoD2 height at about 3 m a storey) against the
// floor area the lead gave (or 40 m2 a person, else 140 m2) by more than 2.5 times.
// Used by the planner card and by the qualify step (web/lib/qualify.ts) to ask "is this a house or a flat?".
import type { HomeInputs } from "./api";

export type BuildingShape = {
  footprint_m2?: number | null; height_m?: number | null;
  plan?: { floor_area_m2?: number | null; storeys?: number | null } | null;
  dwellings?: number | null; zensus_dwellings?: number | null; dwellings_per_building?: number | null;
};
export type MultiUnit = { multi: boolean; reason: string; footprint_m2: number | null; storeys: number | null; building_m2: number | null; stated_m2: number };

const STOREY_M = 3, ROOF_M = 2.5;
const n0 = (x: number) => Math.round(x).toLocaleString("en-GB");

export function isMultiUnit(model: BuildingShape | null | undefined, inputs: Partial<HomeInputs> | null | undefined): MultiUnit {
  const people = inputs?.num_inhabitants ?? null;
  const stated = inputs?.house_size_sqm ?? (people ? people * 40 : 140);
  const fp = model?.footprint_m2 ?? model?.plan?.floor_area_m2 ?? null;
  const h = model?.height_m ?? null;
  // The LoD2 height runs to the ridge; take a roof off before counting storeys.
  const storeys = h != null ? Math.max(1, Math.round(Math.max(STOREY_M, h - ROOF_M) / STOREY_M)) : model?.plan?.storeys ?? null;
  const area = fp != null && storeys != null ? fp * storeys : null;
  const out = (multi: boolean, reason: string): MultiUnit => ({ multi, reason, footprint_m2: fp, storeys, building_m2: area, stated_m2: stated });
  const dw = model?.dwellings_per_building ?? model?.zensus_dwellings ?? model?.dwellings ?? null;
  if (dw != null && dw >= 3) return out(true, `Zensus counts ${n0(dw)} dwellings in this building`);
  if (dw != null && dw <= 2) return out(false, `Zensus counts ${n0(dw)} dwelling${dw === 1 ? "" : "s"} in this building`);
  if (fp != null && fp > 300) return out(true, `Footprint ${n0(fp)} m², over 300 m²`);
  if (h != null && h >= 14) return out(true, `Building ${n0(h)} m tall, about ${storeys} storeys`);
  if (area != null && area > 2.5 * stated) return out(true, `Building about ${n0(area)} m² over ${storeys} storeys, ${(area / stated).toFixed(1)} times the ${n0(stated)} m² home`);
  if (fp == null) return out(false, "No building model");
  return out(false, `Building about ${n0(area ?? fp)} m², in line with a ${n0(stated)} m² home`);
}
