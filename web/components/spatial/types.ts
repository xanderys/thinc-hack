// Shapes from docs/api.md v2.1 (GET /api/roof/model) and v2.3 (POST /api/explain/layers).
import type { Design } from "@/lib/api";

export type V3 = [number, number, number];
// The engine sends each module as its four corners in local metres (x east, y north, z up);
// the contract also allows a plane-local rectangle. Both are accepted.
export type PanelRect = V3[] | { x: number; y: number; w: number; h: number; angle: number };

export interface RoofPlane {
  id: string; polygon: V3[]; pitch: number; azimuth: number | null; area_m2: number;
  is_target: boolean; yield_kwh_per_kwp: number; sun: number; max_panels: number;
  fits_panels?: number; chosen_panels: PanelRect[];
  // Shade fields, when the engine sends them.
  shade?: number | null; shade_loss_share?: number | null; yield_shaded_kwh_per_kwp?: number | null;
  skip_reason?: string | null; skip?: string | null;
}

export interface RoofModel {
  address: string; source?: string; textured?: boolean; licence?: string;
  model_url?: string; glb_url?: string; planes: RoofPlane[];
  neighbours?: number; triangles?: number; height_m?: number; footprint_m2?: number;
  envelope?: Envelope | null;
  sun_source?: string; layout?: { requested_kwp: number | null; panels: number; kwp: number; kwh_per_year: number; short_by_panels: number };
}

// Winter heat loss per face (DIN EN 12831 design point), when the engine sends it.
export interface EnvelopeFace { kind: string; azimuth: number | null; area_m2: number; u_value: number; source?: string; loss_w: number }
export interface Envelope {
  faces: EnvelopeFace[]; ventilation_w: number; design_heat_load_kw: number; annual_heat_demand_kwh?: number;
  design_outdoor_c?: number; heatpump_kw?: number | null; sources?: (string | { key?: string; citation: string; url?: string })[];
}

export interface DayHour { h: number; pv_kw: number; load_kw: number; battery_kw: number; grid_kw: number; soc_kwh: number }

export interface FrontierPoint {
  kwp: number; kwh: number; capex_eur: number; npv_20y_eur: number; autarky_share: number;
  payback_years: number | null; chosen: boolean; label?: string;
}

export interface Layers {
  planes: RoofModel | RoofPlane[];   // the engine sends the whole model object
  day: { date: string; hours: DayHour[] };
  night: { evening_kwh: number; night_hours: number; battery_kwh: number; htw_cap_kwh: number };
  frontier: FrontierPoint[];
  chosen: Design;
  objective: { name: string; sentence: string; sources: string[] };
  sources: { key: string; citation: string; url?: string }[];
  economics?: { capex_eur: number; annual_saving_eur: number; payback_years: number | null; self_consumption_share: number; autarky_share: number; annual?: { pv_yield_kwh: number; npv_20y_eur: number | null; [k: string]: unknown } };
}

export const planesOf = (x: RoofModel | RoofPlane[] | undefined | null): RoofPlane[] => (!x ? [] : Array.isArray(x) ? x : x.planes ?? []);

// Flows of one hour, all >= 0 kW. Engine signs: battery_kw > 0 discharges to the home, < 0 charges; grid_kw > 0 imports, < 0 exports.
export interface Flows { pvHome: number; pvBatt: number; pvGrid: number; battHome: number; gridHome: number }

export function flowsOf(x: DayHour): Flows {
  return {
    pvHome: Math.min(x.pv_kw, x.load_kw),
    pvBatt: Math.max(-x.battery_kw, 0),
    pvGrid: Math.max(-x.grid_kw, 0),
    battHome: Math.max(x.battery_kw, 0),
    gridHome: Math.max(x.grid_kw, 0),
  };
}

export function lerpHour(hours: DayHour[], t: number): DayHour {
  const n = hours.length;
  if (!n) return { h: 0, pv_kw: 0, load_kw: 0, battery_kw: 0, grid_kw: 0, soc_kwh: 0 };
  const i = Math.max(0, Math.min(n - 1, Math.floor(t))), j = Math.min(n - 1, i + 1), f = Math.max(0, Math.min(1, t - i));
  const a = hours[i], b = hours[j], m = (k: keyof DayHour) => a[k] + (b[k] - a[k]) * f;
  return { h: m("h"), pv_kw: m("pv_kw"), load_kw: m("load_kw"), battery_kw: m("battery_kw"), grid_kw: m("grid_kw"), soc_kwh: m("soc_kwh") };
}
