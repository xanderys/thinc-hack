"use client";
// View options for the 3D context, shared by the layers menu, the scene and the photo layer: the "White context"
// look (off by default: the real-world look), which picture lies on the ground, and how old the pictures are.
// A tiny store with no three.js in it, so the menu can live in the first paint.
import { useSyncExternalStore } from "react";

export type Ground = "google" | "bavaria";
export type Imagery = { dop20_flown?: string | null; lod2_stand?: string | null; source_note?: string | null };
type State = { white: boolean; ground: Ground; google: boolean; mesh: boolean; imagery: Imagery | null; credit: string };

let st: State = { white: false, ground: "google", google: false, mesh: false, imagery: null, credit: "" };
const subs = new Set<() => void>();
const set = (p: Partial<State>) => {
  const next = { ...st, ...p };
  if ((Object.keys(p) as (keyof State)[]).every((k) => next[k] === st[k])) return;
  st = next; subs.forEach((f) => f());
};

export const whiteOn = () => st.white;
export const viewOpts = () => st;
export const setWhite = (white: boolean) => set({ white });
export const setGround = (ground: Ground) => set({ ground });
// The Google satellite ground is ready (or gone), with its attribution line.
export const setGoogleGround = (google: boolean, credit = "") => set({ google, credit });
// The Google mesh is on screen (the house is Google imagery then).
export const setMesh = (mesh: boolean) => set({ mesh });
export const setImagery = (imagery: Imagery | null) => set({ imagery });
export function onWhite(f: () => void) { subs.add(f); return () => { subs.delete(f); }; }
export const useViewOpts = () => useSyncExternalStore(onWhite, viewOpts, viewOpts);

// One line per picture on screen, years only; nothing for a picture the engine has no date for.
// "Aerial photo flown 2023, building model 2021", "Google imagery, date not published".
export function imageryLines(o: State): string[] {
  const year = (d?: string | null) => (d && /\d{4}/.exec(d)?.[0]) || null;
  const googleGround = o.google && o.ground === "google";
  const f = googleGround && o.mesh ? null : year(o.imagery?.dop20_flown), l = year(o.imagery?.lod2_stand);
  const ours = [f && `Aerial photo flown ${f}`, l && `building model ${l}`].filter(Boolean).join(", ");
  return [ours ? ours.charAt(0).toUpperCase() + ours.slice(1) : "", googleGround || o.mesh ? "Google imagery, date not published" : ""].filter(Boolean);
}
