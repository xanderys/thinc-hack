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
  // api v2.14: every position a module fits on a target face; placed marks the engine's own layout (a prefix).
  slots?: { id: string; face: string; corners: V3[]; placed: boolean }[];
  // Shade fields, when the engine sends them.
  shade?: number | null; shade_loss_share?: number | null; yield_shaded_kwh_per_kwp?: number | null;
  skip_reason?: string | null; skip?: string | null; shade_reason?: string | null;
}

export interface RoofModel {
  address: string; source?: string; textured?: boolean; licence?: string;
  model_url?: string; glb_url?: string; planes: RoofPlane[];
  neighbours?: number; triangles?: number; height_m?: number; footprint_m2?: number;
  envelope?: Envelope | null;
  plan?: Plan | null;
  sun_source?: string; layout?: { requested_kwp: number | null; panels: number; kwp: number; kwh_per_year: number; short_by_panels: number };
}

// Floor plan block (footprint, equipment, clearances, cable run). Points are local metres, x east, y north.
export type P2 = [number, number] | [number, number, number] | { x: number; y: number; z?: number };
export interface PlanItem { kind?: string; label?: string; note?: string; at?: P2; position?: P2; x?: number; y?: number; clearance_m?: number | null; radius_m?: number | null }
export interface Plan {
  outline: P2[]; edges?: { from?: P2; to?: P2; length_m: number; a?: P2; b?: P2 }[]; edge_lengths_m?: number[];
  floor_area_m2?: number | null; storeys?: number | null; orientation?: string | number | null;
  equipment?: PlanItem[]; markers?: PlanItem[]; clearances?: { at?: P2; center?: P2; centre?: P2; x?: number; y?: number; r_m?: number; radius_m?: number; label?: string; kind?: string; source?: string }[];
  net_floor_area_m2?: number | null;
  cable_run?: P2[] | { points?: P2[]; path?: P2[]; length_m?: number; label?: string } | null;
  rooms?: unknown; note?: string | null; notes?: string[] | string | null; sources?: unknown;
}
export const p2 = (p: P2 | undefined | null): [number, number] | null =>
  !p ? null : Array.isArray(p) ? [p[0], p[1]] : typeof p.x === "number" ? [p.x, p.y] : null;

// Winter heat loss per face (DIN EN 12831 design point), when the engine sends it.
export interface EnvelopeFace { kind: string; azimuth: number | null; area_m2: number; u_value: number; source?: string; loss_w: number }
export interface Envelope {
  faces: EnvelopeFace[]; ventilation_w: number; design_heat_load_kw: number; annual_heat_demand_kwh?: number;
  design_outdoor_c?: number; heatpump_kw?: number | null; thermal_bridges_w?: number; build_year?: number;
  design?: { inside_c?: number; outside_c?: number; air_changes_per_h?: number; volume_m3?: number }; sources?: (string | { key?: string; citation: string; url?: string })[];
}

export interface DayHour { h: number; pv_kw: number; load_kw: number; battery_kw: number; grid_kw: number; soc_kwh: number }

export interface FrontierPoint {
  kwp: number; kwh: number; capex_eur: number; npv_20y_eur: number; autarky_share: number;
  payback_years: number | null; chosen: boolean; label?: string; on_frontier?: boolean;
}

// The engine's own check that the roof, the design and the economics came from one run.
export interface Consistency {
  modules_on_roof?: number; modules_in_design?: number; pv_yield_kwh_used?: number; layout_kwh_per_year?: number;
  shaded?: boolean; battery_kwh_used?: number | null; heat_load_kw_used?: number | null; same_run_id?: string; design_economics_match?: boolean;
}

export interface Layers {
  planes: RoofModel | RoofPlane[];   // the engine sends the whole model object
  day: { date: string; hours: DayHour[] };
  night: { evening_kwh: number; night_hours: number; battery_kwh: number; htw_cap_kwh: number };
  frontier: FrontierPoint[];
  chosen: Design;
  objective: { name: string; sentence: string; sources: string[] };
  sources: { key: string; citation: string; url?: string }[];
  consistency?: Consistency;
  economics?: { capex_eur: number; annual_saving_eur: number; payback_years: number | null; self_consumption_share: number; autarky_share: number; break_even_year?: number | null; irr?: number | null; cashflow_cumulative_eur?: number[]; cashflow_yearly_eur?: number[]; annual?: { pv_yield_kwh: number; npv_20y_eur: number | null; [k: string]: unknown } };
  bars?: Bar[];        // v2.6, in chain order
  checks?: Check[];    // v2.6
  ev?: { annual_km: number; annual_kwh: number; home_share: number; kwh_per_night_typical: number; kw_needed: number; km_per_hour_at_11kw: number; charging_window: string; note_22kw?: string } | null;
}

// v2.6 working-shown bars and checks.
export type SourceTag = "lead" | "rina" | "address" | "default";
export interface Bar { key: "roof" | "heat_loss" | "day" | "charging"; title: string; total: number; unit: string; segments: { name: string; value: number; unit: string; source_tag: SourceTag; citation?: string }[]; sentence: string; sources: string[] }
// level (v2.7): "fail" is a real failure (red); "reference" is a published guide shown amber when outside; "info" is a tick with no verdict.
export interface Check { name: string; value: number | string; unit: string; pass: boolean; band: string; level?: string; message?: string; inside_band?: boolean; informational?: boolean; class?: string }

// The engine labels points with keys ("knee", "payback") or with words; show words.
const LABEL: Record<string, string> = { knee: "Recommended", payback: "Best payback", independence: "Most independence", upfront: "Lowest upfront cost", value: "Best 20-year value", npv: "Best 20-year value", expert: "As planners design it", chosen: "Recommended", recommended: "Recommended", best_value: "Best 20-year value", lowest_upfront: "Lowest upfront cost", best_payback: "Best payback", most_independence: "Most independence" };
export const labelOf = (p: FrontierPoint) => (p.label ? LABEL[p.label] ?? p.label : p.chosen ? "Recommended" : "");

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
