// The heat-loss split of the house by element, read from the envelope block of /api/explain/layers. The x-ray tint
// (components/spatial/xray.ts) and the bar (components/spatial/EnvelopeBar.tsx) both read elementsOf(), so they show
// the same numbers in the same colours: orange for the elements that lose most, blue for the least.
import type { Envelope } from "@/components/spatial/types";

export type ElementKey = "wall" | "window" | "floor" | "ceiling" | "roof" | "ventilation" | "bridges";
export interface Element { key: ElementKey; name: string; w: number; share: number; colour: string }

const NAMES: Record<ElementKey, string> = {
  wall: "Outer walls", window: "Windows", floor: "Floor", ceiling: "Ceiling", roof: "Roof", ventilation: "Ventilation", bridges: "Thermal bridges",
};
const ORDER: ElementKey[] = ["wall", "window", "floor", "ceiling", "roof", "ventilation", "bridges"];

export const kindOf = (kind: string): ElementKey | null =>
  /window|door/i.test(kind) ? "window" : /wall/i.test(kind) ? "wall" : /ceiling/i.test(kind) ? "ceiling" : /roof/i.test(kind) ? "roof" : /floor|ground|base/i.test(kind) ? "floor" : null;

// Blue small, orange large (Reonic's heat-loss grammar), through a pale middle.
const STOPS: [number, number, number][] = [[61, 111, 224], [233, 228, 218], [232, 115, 12]];
export function lossRgb(t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, t)) * 2, i = Math.min(1, Math.floor(x)), f = x - i;
  return [0, 1, 2].map((j) => Math.round(STOPS[i][j] + (STOPS[i + 1][j] - STOPS[i][j]) * f)) as [number, number, number];
}
export const LOSS_GRADIENT = "linear-gradient(90deg, rgb(61,111,224), rgb(233,228,218) 50%, rgb(232,115,12))";

export function elementsOf(env: Envelope): { list: Element[]; total: number; scale: (share: number) => [number, number, number] } {
  const w: Partial<Record<ElementKey, number>> = {};
  env.faces.forEach((f) => { const k = kindOf(f.kind); if (k) w[k] = (w[k] ?? 0) + (f.loss_w || 0); });
  if (env.ventilation_w) w.ventilation = env.ventilation_w;
  if (env.thermal_bridges_w) w.bridges = env.thermal_bridges_w;
  const total = Object.values(w).reduce((a, b) => a + (b ?? 0), 0) || 1;
  const shares = ORDER.filter((k) => (w[k] ?? 0) > 0).map((k) => (w[k] as number) / total);
  const lo = Math.min(...shares), hi = Math.max(...shares);
  const scale = (s: number) => lossRgb(hi > lo ? (s - lo) / (hi - lo) : 0.5);
  const list = ORDER.filter((k) => (w[k] ?? 0) > 0).map((k) => {
    const share = (w[k] as number) / total;
    return { key: k, name: NAMES[k], w: w[k] as number, share, colour: `rgb(${scale(share).join(",")})` };
  });
  return { list, total, scale };
}

// Window share of the wall at this azimuth: the engine's own per-face figure when it sends one, else window area over
// wall plus window area on that side, else 20 %.
type Extra = { window_share?: number | null; window_share_of_wall?: number | null };
export function windowShare(env: Envelope, az: number): number {
  const near = (a: number | null) => a != null && Math.abs(((a - az + 540) % 360) - 180) < 23;
  const wall = env.faces.find((f) => kindOf(f.kind) === "wall" && near(f.azimuth)) as (Envelope["faces"][0] & Extra) | undefined;
  const win = env.faces.find((f) => kindOf(f.kind) === "window" && near(f.azimuth)) as (Envelope["faces"][0] & Extra) | undefined;
  const given = wall?.window_share ?? wall?.window_share_of_wall ?? win?.window_share ?? win?.window_share_of_wall;
  if (given != null && given >= 0 && given < 1) return given;
  if (win && wall && win.area_m2 + wall.area_m2 > 0) return win.area_m2 / (win.area_m2 + wall.area_m2);
  return win ? 0.2 : 0;
}

// Named constants, read from the engine when present.
type Consts = { bivalence_c?: number | null; hot_water_kw_per_person?: number | null; constants?: { bivalence_c?: number; hot_water_kw_per_person?: number } };
export function constantsOf(env: Envelope) {
  const e = env as Envelope & Consts;
  return {
    bivalence_c: e.bivalence_c ?? e.constants?.bivalence_c ?? -6,
    hot_water_kw_per_person: e.hot_water_kw_per_person ?? e.constants?.hot_water_kw_per_person ?? 0.5,
    design_outdoor_c: env.design?.outside_c ?? env.design_outdoor_c ?? -16,
  };
}

// Multi-unit buildings get no x-ray. Stub until web/lib/building.ts (isMultiUnit) is on origin/web.
type RoofLike = { floor_area_confidence?: string | null; dwellings_class?: number | null; notes?: string[] | null } | null | undefined;
export function isMultiUnit(roof: RoofLike): boolean {
  if (!roof) return false;
  if ((roof.dwellings_class ?? 0) >= 3) return true;
  return /average flat size/i.test(roof.floor_area_confidence ?? "") || (roof.notes ?? []).some((n) => /whole-building|average flat size/i.test(n));
}
