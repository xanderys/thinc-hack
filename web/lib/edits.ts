// The planner's kit edits, one stack per lead: each on-model edit, chooser pick or offer tab pushes the overrides it
// replaced; Undo pops one and puts those back (the open card registers how, and writes them through the lead's write
// queue). The stack lives in memory for this page only: nothing from an earlier session can be applied.
import { useSyncExternalStore } from "react";

type Entry = { prev: Record<string, unknown>; at: number };
const stacks = new Map<string, Entry[]>();
const appliers = new Map<string, (prev: Record<string, unknown>) => void>();
const subs = new Set<() => void>();
// Overrides the lead already stores (a reload, another session): with no step left in this page's stack, Undo clears them.
const stored = new Map<string, boolean>();
export function setStoredEdits(lead: string, has: boolean) { if ((stored.get(lead) ?? false) !== has) { stored.set(lead, has); emit(); } }
const emit = () => subs.forEach((f) => f());

function get(lead: string): Entry[] {
  let s = stacks.get(lead);
  if (!s) { s = []; stacks.set(lead, s); }
  return s;
}
// Earlier builds kept the stack in sessionStorage: removed, never read.
function save(lead: string) { try { sessionStorage.removeItem(`marquee:edits:${lead}`); } catch { /* storage off */ } const s = get(lead); if (s.length > 50) s.splice(0, s.length - 50); }

// An edit replaced these overrides.
export function pushEdit(lead: string, prev: Record<string, unknown>) {
  get(lead).push({ prev: JSON.parse(JSON.stringify(prev)), at: Date.now() });
  save(lead); emit();
}
export function canUndo(lead: string | null | undefined): boolean { return !!lead && (get(lead).length > 0 || !!stored.get(lead)); }
// Puts back the overrides the last edit replaced. False when there is nothing to undo or no open card to apply it.
export function undoLast(lead: string): boolean {
  const s = get(lead), apply = appliers.get(lead);
  if (!apply) return false;
  if (!s.length) { if (!stored.get(lead)) return false; apply({}); return true; }   // stored edits only: clear them all
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
