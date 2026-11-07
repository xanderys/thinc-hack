"use client";
// First frames for the 3D view: a picture of the scene as the planner last saw it settle (same camera as the
// landing view), kept per lead, design and frame shape, shown while the photo mesh streams and cross-faded away
// when the live house is sharp. Reusable for card thumbnails: snapshotOf(scene) returns a JPEG data URL.
// Kept in this browser (localStorage) and in the web server's memory (/api/snap), never in the repo or a database.
import type { SpatialScene } from "./scene";

type Inner = { renderer: { render: (s: unknown, c: unknown) => void; domElement: HTMLCanvasElement }; scene: unknown; camera: unknown };

// Renders the scene now and returns it as a JPEG data URL at most maxW pixels wide (null if the canvas is unreadable).
export function snapshotOf(sc: SpatialScene, maxW = 960, quality = 0.82): string | null {
  try {
    const { renderer, scene, camera } = sc as unknown as Inner;
    renderer.render(scene, camera); // read in the same task, so no preserveDrawingBuffer is needed
    const src = renderer.domElement, k = Math.min(1, maxW / Math.max(1, src.width));
    const c = document.createElement("canvas");
    c.width = Math.round(src.width * k); c.height = Math.round(src.height * k);
    const cx = c.getContext("2d");
    if (!cx || !c.width || !c.height) return null;
    cx.drawImage(src, 0, 0, c.width, c.height);
    return c.toDataURL("image/jpeg", quality);
  } catch { return null; }
}

// One key per lead, design and frame shape (a wide card and a phone frame the house differently).
export function snapKey(lead: string, design: string, aspect: number) {
  let h = 2166136261;
  for (let i = 0; i < design.length; i++) h = Math.imul(h ^ design.charCodeAt(i), 16777619);
  return `${lead}.${(h >>> 0).toString(36)}.${aspect >= 1.2 ? "w" : "n"}`;
}

const LS = (k: string) => `marquee.snap.${k}`;
export async function loadSnap(key: string, signal?: AbortSignal): Promise<string | null> {
  try { const v = window.localStorage.getItem(LS(key)); if (v) return v; } catch { /* storage off */ }
  try {
    const r = await fetch(`/api/snap?k=${encodeURIComponent(key)}`, { signal });
    return r.ok ? ((await r.json()) as { url?: string }).url ?? null : null;
  } catch { return null; }
}
export function saveSnap(key: string, url: string) {
  try { window.localStorage.setItem(LS(key), url); } catch { /* full or off: the server copy still helps */ }
  fetch(`/api/snap?k=${encodeURIComponent(key)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }) }).catch(() => {});
}
