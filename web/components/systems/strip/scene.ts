"use client";
// The three scene hooks the units lane exposes (scene.setBatteryFill(0..1), scene.setCarCharge(0..1),
// scene.setXrayHour(h)). The scene is reached through window.__marqueeScene; until it carries the method, the call
// is a no-op and the same value goes out as a "marquee:scene-day" event the scene can listen for instead.
export type Flow = { pv_kw: number; battery_kw: number; house_kw: number; grid_kw: number; car_kw: number };
type SceneDay = { setBatteryFill?: (x: number) => void; setCarCharge?: (x: number) => void; setXrayHour?: (h: number | null) => void; setFlow?: (f: Flow) => void; setOutdoorTemp?: (c: number) => void };
export function sceneDay<K extends keyof SceneDay>(name: K, v: number | Flow | null) {
  if (typeof window === "undefined") return;
  const sc = (window as unknown as { __marqueeScene?: SceneDay }).__marqueeScene;
  try { (sc?.[name] as ((x: unknown) => void) | undefined)?.(v); } catch { /* a scene mid-teardown: the next scrub sets it again */ }
  window.dispatchEvent(new CustomEvent("marquee:scene-day", { detail: { name, value: v } }));
}

// The hour's energy flows for the scene (hourly kWh equal average kW). battery: + charging, - discharging;
// grid: + import, - export. Arithmetic on the engine's hourly series only.
export function flowAt(d: { solar_kwh: number[]; load_kwh: number[]; battery: { charge_kwh: number[]; discharge_kwh: number[] } | null; wallbox: { charging_kwh: number[] } | null }, h: number): Flow {
  const pv = d.solar_kwh[h] ?? 0, house = d.load_kwh[h] ?? 0, car = d.wallbox?.charging_kwh[h] ?? 0;
  const bat = d.battery ? (d.battery.charge_kwh[h] ?? 0) - (d.battery.discharge_kwh[h] ?? 0) : 0;
  return { pv_kw: pv, battery_kw: bat, house_kw: house, car_kw: car, grid_kw: house + car + Math.max(bat, 0) - pv - Math.max(-bat, 0) };
}
