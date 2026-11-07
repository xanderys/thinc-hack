// Per-module shading from GET /api/roof/shading (docs/shading.md). One fetch per address and kWp, shared by the scene
// (tints) and the chip (card, scrubber). Pending, 404 and errors all give null: the UI stays as it was.
import { useEffect, useSyncExternalStore } from "react";

export interface ShadeModule { plane_id: string; index: number; annual_share: number; monthly_share: number[]; hourly: (number | null)[][]; loss_kwh_year: number }
export interface ShadePlane { id: string; edges_m: number[]; modules: number; shade_share: number; loss_kwh_year: number }
export interface Shading {
  status: "ready"; address: string; modules: ShadeModule[]; planes: ShadePlane[];
  total: { shade_share: number; loss_kwh_year: number; modules?: number }; source: string;
}
// null: across the year; else the 15th of month m (1 to 12) at h:30.
export type ShadeAt = { m: number; h: number } | null;

type State = { data: Map<string, Shading | null>; on: boolean; at: ShadeAt };
let state: State = { data: new Map(), on: false, at: null };
const subs = new Set<() => void>();
const emit = (s: Partial<State>) => { state = { ...state, ...s }; subs.forEach((f) => f()); };
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
const inflight = new Map<string, Promise<void>>();

export const shadeKey = (address?: string | null, kwp?: number | null) => (address ? `${address.trim().toLowerCase()}|${kwp ?? ""}` : "");

function load(address: string, kwp: number | null | undefined) {
  const k = shadeKey(address, kwp);
  if (state.data.has(k) || inflight.has(k)) return;
  const q = new URLSearchParams({ address, ...(kwp ? { kwp: String(kwp) } : {}) });
  const p = (async () => {
    // Pending while the engine computes (a few seconds once the house model is built); give up quietly after 2 min.
    for (let i = 0; i < 40; i++) {
      try {
        const r = await fetch(`/api/roof/shading?${q}`);
        if (!r.ok) break;
        const b = await r.json();
        if (b?.status === "ready" && Array.isArray(b.modules)) { emit({ data: new Map(state.data).set(k, b as Shading) }); return; }
        if (b?.status !== "pending") break;
      } catch { break; }
      await new Promise((res) => setTimeout(res, 3000));
    }
    emit({ data: new Map(state.data).set(k, null) });
  })().finally(() => inflight.delete(k));
  inflight.set(k, p);
}

export function useShading(address?: string | null, kwp?: number | null): Shading | null {
  useEffect(() => { if (address) load(address, kwp); }, [address, kwp]);
  return useSyncExternalStore(subscribe, () => state.data.get(shadeKey(address, kwp)) ?? null, () => null);
}

export function useShadeView(): { on: boolean; at: ShadeAt } {
  const on = useSyncExternalStore(subscribe, () => state.on, () => false);
  const at = useSyncExternalStore(subscribe, () => state.at, () => null);
  return { on, at };
}
export const setShadeOn = (on: boolean) => emit({ on, ...(on ? {} : { at: null }) });
export const setShadeAt = (at: ShadeAt) => emit({ at });

// Green at full sun, amber at 80%, red at 60% or less.
const STOPS: [number, [number, number, number]][] = [[0.6, [218, 30, 40]], [0.8, [245, 179, 66]], [1, [36, 161, 72]]];
export function shadeRgb(share: number): [number, number, number] {
  const x = Math.max(0.6, Math.min(1, share));
  for (let i = 1; i < STOPS.length; i++) {
    const [a, ca] = STOPS[i - 1], [b, cb] = STOPS[i];
    if (x <= b) { const t = (x - a) / (b - a); return [0, 1, 2].map((j) => Math.round(ca[j] + (cb[j] - ca[j]) * t)) as [number, number, number]; }
  }
  return STOPS[STOPS.length - 1][1];
}
export const shadeCss = (share: number) => `rgb(${shadeRgb(share).join(",")})`;
export const SHADE_GRADIENT = "linear-gradient(90deg, rgb(218,30,40), rgb(245,179,66) 50%, rgb(36,161,72))";

// The share a module shows at this moment (null: no direct sun on it then).
export const shareAt = (m: ShadeModule, at: ShadeAt): number | null => (at ? m.hourly[at.m - 1]?.[at.h] ?? null : m.annual_share);

// Sunrise to sunset hours of a month, from the hours any module has the sun on it.
export function dayHours(d: Shading, m: number): [number, number] {
  let lo = 24, hi = -1;
  d.modules.forEach((x) => x.hourly[m - 1]?.forEach((v, h) => { if (v != null) { lo = Math.min(lo, h); hi = Math.max(hi, h); } }));
  return hi < 0 ? [8, 16] : [lo, hi];
}
