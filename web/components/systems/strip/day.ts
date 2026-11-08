"use client";
// The typical day behind the Battery, Wallbox and Heat pump cards: GET /api/leads/{id}/day (engine v2.18), through the
// web route that keeps the intake secret server-side. One request per lead, day and sizes, shared by every card and
// remount; failures are not kept, so a retry asks again. ?mockday=1 on a non-production build reads a fixture instead.
import { useEffect, useState } from "react";
import { call } from "@/lib/client";

export type Season = "summer" | "winter";
type BySize<T> = Record<string, T>;
export type DayBattery = { kwh: number; soc: number[]; charge_kwh: number[]; discharge_kwh: number[]; hours_after_sunset_covered: number; self_sufficiency_share: number; ladder?: number[]; by_size?: BySize<{ hours_after_sunset_covered: number; self_sufficiency_share: number }> };
export type DayWallbox = { kw: number; ev_kwh_year: number; charging_kwh: number[]; solar_share_of_charging: number; full_charge_hours: number; ladder?: number[]; by_size?: BySize<{ solar_share_of_charging: number; full_charge_hours: number }> };
export type DayHeatpump = { kw: number; heat_demand_kwh: number[]; outdoor_temp_c: number[]; heat_load_kw: number; heating_kwh_year: number; electricity_kwh_year: number; cop: number; cost_eur_year: number; boiler_cost_eur_year: number; ladder?: number[]; by_size?: BySize<{ electricity_kwh_year: number; cost_eur_year: number }> };
export type Day = { day: Season; hours: number; solar_kwh: number[]; load_kwh: number[]; battery: DayBattery | null; wallbox: DayWallbox | null; heatpump: DayHeatpump | null; sunrise_h: number; sunset_h: number };
export type Sizes = { battery_kwh?: number | null; wallbox_kw?: number | null; heatpump_kw?: number | null };

// by_size keys arrive as JSON strings ("9" or "9.0"): the entry whose number matches the size.
export function atSize<T>(m: BySize<T> | undefined, size: number | null | undefined): T | null {
  if (!m || size == null) return null;
  const k = Object.keys(m).find((x) => Math.abs(Number(x) - size) < 0.01);
  return k ? m[k] : null;
}

const memo = new Map<string, Promise<Day | string>>();
// Read once at load: the lead page rewrites its URL, so the flag is kept for the tab's session.
const mockOn = () => {
  if (typeof window === "undefined") return false;
  try {
    if (new URLSearchParams(location.search).get("mockday") === "1") sessionStorage.setItem("marquee.mockday", "1");
    return sessionStorage.getItem("marquee.mockday") === "1";
  } catch { return false; }
};
if (typeof window !== "undefined") mockOn();

function fetchDay(lead: string, day: Season, sizes: Sizes, key: string): Promise<Day | string> {
  const q = new URLSearchParams({ day });
  (["battery_kwh", "wallbox_kw", "heatpump_kw"] as const).forEach((k) => { const v = sizes[k]; if (v != null && v > 0) q.set(k, String(v)); });
  if (mockOn()) q.set("mockday", "1");
  const id = lead + "|" + q.toString() + "|" + key;
  let p = memo.get(id);
  if (!p) {
    p = call<Day>(`/api/leads/${encodeURIComponent(lead)}/day?${q}`).then((r) => (r.ok ? r.data : r.error));
    memo.set(id, p);
    if (memo.size > 48) memo.delete(memo.keys().next().value!);
    p.then((r) => { if (typeof r === "string") memo.delete(id); });
  }
  return p;
}

// The day for these sizes. While a new size loads, the last day stays on screen (the figures move from by_size at
// once); data is null only before the first answer, which is when the strip shimmers.
export function useDay(lead: string | null | undefined, day: Season, sizes: Sizes, version: string, tries = 0) {
  const [data, setData] = useState<Day | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = JSON.stringify([lead, day, sizes.battery_kwh ?? 0, sizes.wallbox_kw ?? 0, sizes.heatpump_kw ?? 0, version, tries]);
  useEffect(() => {
    if (!lead) return;
    let live = true;
    setError(null);
    fetchDay(lead, day, sizes, version).then((r) => { if (!live) return; if (typeof r === "string") setError(r); else setData(r); });
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const fits = data && data.day === day ? data : null;
  return { data: fits, error };
}
