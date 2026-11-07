// The heat-loss split of the house by element, read from the envelope block of /api/explain/layers. The x-ray tint
// (components/spatial/xray.ts) and the bar (components/spatial/EnvelopeBar.tsx) both read elementsOf(), so they show
// the same numbers in the same colours: orange for the elements that lose most, blue for the least.
import type { Envelope } from "@/components/spatial/types";

export type ElementKey = "wall" | "window" | "floor" | "ceiling" | "roof" | "ventilation" | "bridges";
export interface Element { key: ElementKey; name: string; w: number; share: number; colour: string; note?: string | null }
// v2.7 engine block: elements[] (the tint and the bar both read share), constants, window share per face.
type EngElement = { element: string; label?: string; w: number; share?: number | null; note?: string | null };
type V27 = { elements?: EngElement[] | null; estimated_from?: string | null };
const ENG_KEY: Record<string, ElementKey> = { outer_wall: "wall", window: "window", floor: "floor", ceiling: "ceiling", roof: "roof", ventilation: "ventilation", thermal_bridges: "bridges" };

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
  const els = (env as Envelope & V27).elements;
  if (els?.length) {
    const tot = els.find((e) => e.element === "total")?.w ?? els.filter((e) => e.element !== "total").reduce((a, e) => a + (e.w || 0), 0);
    const rows = els.filter((e) => ENG_KEY[e.element]).map((e) => ({ key: ENG_KEY[e.element], name: e.label || NAMES[ENG_KEY[e.element]], w: e.w || 0, share: e.share ?? (tot ? (e.w || 0) / tot : 0), note: e.note ?? null }));
    const pos = rows.filter((r) => r.w > 0).map((r) => r.share);
    const lo = Math.min(...pos), hi = Math.max(...pos);
    const scale = (x: number) => lossRgb(hi > lo ? (x - lo) / (hi - lo) : 0.5);
    rows.sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key));
    return { list: rows.map((r) => ({ ...r, colour: `rgb(${scale(r.share).join(",")})` })), total: tot || 1, scale };
  }
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
type Extra = { window_share?: number | null; window_share_of_wall?: number | null; window_share_source?: string | null };

// "20 % of wall, typology assumption": windows are never measured, the source says so.
export function windowNote(env: Envelope): string | null {
  const f = env.faces.find((x) => (x as Extra).window_share != null || kindOf(x.kind) === "window") as (Envelope["faces"][0] & Extra) | undefined;
  if (!f) return null;
  const share = f.window_share ?? windowShare(env, f.azimuth ?? 0);
  return `${Math.round(share * 100)} % of wall, typology assumption`;
}
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
type Const = number | { value: number; unit?: string; label?: string; source?: string };
type Consts = { bivalence_c?: number | null; hot_water_kw_per_person?: number | null; constants?: { bivalence_c?: Const; hot_water_kw_per_person?: Const } };
const val = (c: Const | null | undefined) => (c == null ? null : typeof c === "number" ? c : c.value);
export function constantsOf(env: Envelope) {
  const e = env as Envelope & Consts;
  const src = (c: Const | undefined) => (c && typeof c === "object" ? c.source ?? null : null);
  return {
    bivalence_c: e.bivalence_c ?? val(e.constants?.bivalence_c) ?? -6,
    bivalence_source: src(e.constants?.bivalence_c),
    hot_water_kw_per_person: e.hot_water_kw_per_person ?? val(e.constants?.hot_water_kw_per_person) ?? 0.5,
    hot_water_source: src(e.constants?.hot_water_kw_per_person),
    design_outdoor_c: env.design?.outside_c ?? env.design_outdoor_c ?? -16,
  };
}
