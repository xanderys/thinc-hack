"use client";
// Roof lookups for qualification: one per address per page, at most 4 in flight, a pending roof asked again every 3 s.
import { useEffect, useState } from "react";
import type { RoofResult } from "@/lib/api";
import { call } from "@/lib/client";
import type { Qualification, Verdict } from "@/lib/qualify";

const cache = new Map<string, RoofResult | null>();   // null: the lookup failed; the verdict waits
const subs = new Map<string, Set<() => void>>();
const queue: string[] = [];
const busy = new Set<string>();
const tries = new Map<string, number>();
const MAX = 4;

const notify = (a: string) => subs.get(a)?.forEach((f) => f());

function pump() {
  while (busy.size < MAX && queue.length) {
    const a = queue.shift()!;
    if (busy.has(a)) continue;
    busy.add(a);
    call<RoofResult>(`/api/roof?address=${encodeURIComponent(a)}`).then((r) => {
      busy.delete(a);
      const n = (tries.get(a) ?? 0) + 1; tries.set(a, n);
      if (r.ok) { cache.set(a, r.data); if (r.data.pending && n < 20) setTimeout(() => { queue.push(a); pump(); }, 3000); }
      else if (!cache.has(a)) cache.set(a, null);
      notify(a); pump();
    });
  }
}

export function roofOf(address: string | null | undefined): RoofResult | null | undefined {
  return address ? cache.get(address) : undefined;
}

/** The roof for an address: undefined while it is being looked up, null if the lookup failed. */
export function useRoofs(addresses: (string | null | undefined)[]): Record<string, RoofResult | null | undefined> {
  const [, tick] = useState(0);
  const key = addresses.filter(Boolean).join("|");
  useEffect(() => {
    const list = [...new Set(addresses.filter((a): a is string => !!a))];
    const f = () => tick((x) => x + 1);
    for (const a of list) {
      if (!subs.has(a)) subs.set(a, new Set());
      subs.get(a)!.add(f);
      if (!cache.has(a) && !busy.has(a) && !queue.includes(a)) queue.push(a);
    }
    pump();
    return () => { for (const a of list) subs.get(a)?.delete(f); };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  return Object.fromEntries(addresses.filter((a): a is string => !!a).map((a) => [a, cache.get(a)]));
}

// The last verdict per lead, so a card reopened in the same session shows it at once instead of Checking.
type Kept = Pick<Qualification, "verdict" | "sentence" | "expected_offer_eur" | "confidence_line">;
export function recallVerdict(id: string): Kept | null {
  try { return JSON.parse(sessionStorage.getItem(`marquee.verdict.${id}`) ?? "null"); } catch { return null; }
}
export function keepVerdict(id: string, q: Kept) {
  try {
    const was = sessionStorage.getItem(`marquee.verdict.${id}`), now = JSON.stringify({ verdict: q.verdict, sentence: q.sentence, expected_offer_eur: q.expected_offer_eur, confidence_line: q.confidence_line });
    if (was !== now) sessionStorage.setItem(`marquee.verdict.${id}`, now);
  } catch { /* storage blocked: the verdict is computed again */ }
}
export type { Verdict };
