"use client";
import { useSyncExternalStore } from "react";

// The client card's open state: the header (name, status, address, verdict) is drawn by the board, the facts by Facts.tsx,
// so the two share this one flag. Collapsed until the planner asks.
let open = false;
const subs = new Set<() => void>();
export const setClientCard = (v: boolean) => { if (v !== open) { open = v; subs.forEach((f) => f()); } };
export function useClientCard(): boolean {
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => open, () => false);
}

/** The chevron at the right of the card face. */
export function ClientChevron() {
  const o = useClientCard();
  return (
    <button type="button" className="cc-chev" aria-expanded={o} aria-controls="fq-body" aria-label={o ? "Hide client facts" : "Show client facts"} onClick={() => setClientCard(!o)}>
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 7.5 10 12.5 15 7.5" /></svg>
    </button>
  );
}
