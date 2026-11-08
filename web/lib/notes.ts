import type { Variant } from "./api";

// The engine's variant notes say "pays back 1.2 years sooner" from the exact payback; the tiles show the break-even year.
// Say the same thing the tiles say: the difference of the two break-even years, against the planners' design.
export function breakEvenNote(note: string | undefined, v: Variant, all: Variant[]): string | undefined {
  if (!note || !/pays back/i.test(note)) return note;
  const base = all.find((x) => x.key === "expert")?.economics.break_even_year, mine = v.economics.break_even_year;
  if (base == null || mine == null) return note.replace(/,? pays back [\d.]+ years? (sooner|later)/i, "");
  const d = mine - base;
  const tail = d === 0 ? "breaks even in the same year" : `breaks even ${Math.abs(d)} ${Math.abs(d) === 1 ? "year" : "years"} ${d < 0 ? "sooner" : "later"}`;
  return note.replace(/pays back [\d.]+ years? (sooner|later)/i, tail);
}
