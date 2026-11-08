// The planner's kit edits, one stack per lead: each on-model edit, chooser pick or offer tab pushes the overrides it
// replaced; Undo pops one and puts those back (the open card registers how, and writes them through the lead's write
// queue). The stack lives for the browser tab (sessionStorage), so a reload or a re-opened card still undoes one step.
import { useSyncExternalStore } from "react";

type Entry = { prev: Record<string, unknown>; at: number };
const KEY = (lead: string) => `marquee:edits:${lead}`;
const stacks = new Map<string, Entry[]>();
const appliers = new Map<string, (prev: Record<string, unknown>) => void>();
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

function get(lead: string): Entry[] {
  let s = stacks.get(lead);
  if (!s) {
    try { s = JSON.parse(sessionStorage.getItem(KEY(lead)) || "[]") as Entry[]; } catch { s = []; }
    stacks.set(lead, s);
  }
  return s;
}
function save(lead: string) { try { sessionStorage.setItem(KEY(lead), JSON.stringify(get(lead).slice(-50))); } catch { /* private mode: this tab only */ } }

// An edit replaced these overrides.
export function pushEdit(lead: string, prev: Record<string, unknown>) {
  get(lead).push({ prev: JSON.parse(JSON.stringify(prev)), at: Date.now() });
  save(lead); emit();
}
export function canUndo(lead: string | null | undefined): boolean { return !!lead && get(lead).length > 0; }
// Puts back the overrides the last edit replaced. False when there is nothing to undo or no open card to apply it.
export function undoLast(lead: string): boolean {
  const s = get(lead), apply = appliers.get(lead);
  if (!s.length || !apply) return false;
  const e = s.pop()!;
  save(lead); emit();
  apply(e.prev);
  return true;
}
export function clearEdits(lead: string) { stacks.set(lead, []); save(lead); emit(); }
// The open card for this lead: how to apply a previous set of overrides. Returns the unregister.
export function registerUndo(lead: string, apply: (prev: Record<string, unknown>) => void) {
  appliers.set(lead, apply);
  return () => { if (appliers.get(lead) === apply) appliers.delete(lead); };
}
export function onEdits(f: () => void) { subs.add(f); return () => { subs.delete(f); }; }
// For a button: whether Undo has a step for this lead, kept current.
export function useCanUndo(lead: string | null | undefined): boolean {
  return useSyncExternalStore(onEdits, () => canUndo(lead), () => false);
}
