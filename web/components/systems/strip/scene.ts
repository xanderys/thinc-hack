"use client";
// The three scene hooks the units lane exposes (scene.setBatteryFill(0..1), scene.setCarCharge(0..1),
// scene.setXrayHour(h)). The scene is reached through window.__marqueeScene; until it carries the method, the call
// is a no-op and the same value goes out as a "marquee:scene-day" event the scene can listen for instead.
type SceneDay = { setBatteryFill?: (x: number) => void; setCarCharge?: (x: number) => void; setXrayHour?: (h: number | null) => void };
export function sceneDay<K extends keyof SceneDay>(name: K, v: number | null) {
  if (typeof window === "undefined") return;
  const sc = (window as unknown as { __marqueeScene?: SceneDay }).__marqueeScene;
  try { (sc?.[name] as ((x: number | null) => void) | undefined)?.(v); } catch { /* a scene mid-teardown: the next scrub sets it again */ }
  window.dispatchEvent(new CustomEvent("marquee:scene-day", { detail: { name, value: v } }));
}
