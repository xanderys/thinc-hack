"use client";
// Whether the planner picked the Google photo mesh for the 3D view (off by default: the Bavarian LoD2 model),
// remembered for the browser session, and why it went off if it could not show. No three.js in here, so the
// layers menu can read it in the first paint. Nothing streams until want is true.
import { useSyncExternalStore } from "react";

type State = { want: boolean; note: string };
const KEY = "marquee.photoMesh";
const read = (): boolean => { try { return typeof window !== "undefined" && window.sessionStorage.getItem(KEY) === "1"; } catch { return false; } };

let st: State = { want: false, note: "" };
let loaded = false;
const subs = new Set<() => void>();
const get = () => { if (!loaded && typeof window !== "undefined") { loaded = true; st = { ...st, want: read() }; } return st; };
const set = (p: Partial<State>) => {
  const cur = get(), next = { ...cur, ...p };
  if (next.want === cur.want && next.note === cur.note) return;
  st = next; subs.forEach((f) => f());
};
const SERVER: State = { want: false, note: "" };

export const meshWanted = () => get().want;
export function setMeshWanted(want: boolean) {
  try { window.sessionStorage.setItem(KEY, want ? "1" : "0"); } catch { /* private mode: this page only */ }
  set({ want, note: "" });
}
// The mesh could not show: switch the option off and say why, in the source's words.
export function meshOff(note: string) {
  try { window.sessionStorage.setItem(KEY, "0"); } catch { /* ignore */ }
  set({ want: false, note });
}
const sub = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const useMeshPref = () => useSyncExternalStore(sub, get, () => SERVER);
