// Reonic's published PV rule of thumb against the planners and this design (engine `rule_of_thumb_comparison`).
// The engine owns the numbers; key names are matched loosely so a renamed field still renders.
type Rot = Record<string, unknown> | null | undefined;
const f1 = (x: number) => x.toLocaleString("en-GB", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
function pick(r: Record<string, unknown>, re: RegExp): number | null {
  for (const [k, v0] of Object.entries(r)) {
    // /eval sends planners per installer: { all, <installer>: n }
    const v = v0 && typeof v0 === "object" ? (v0 as Record<string, unknown>).all : v0;
    if (re.test(k) && typeof v === "number" && isFinite(v)) return v;
  }
  return null;
}
export function rotLine(r: Rot): string | null {
  if (!r || typeof r !== "object") return null;
  const reonic = pick(r, /reonic|textbook|rule/i), planners = pick(r, /planner|installer|expert/i), design = pick(r, /design|this|ours/i);
  if (reonic == null && planners == null) return null;
  const parts = [`Reonic's rule of thumb: ${f1(reonic ?? 1)} kWp per 1,000 kWh.`];
  if (planners != null) parts.push(`Your planners: ${f1(planners)}.`);
  if (design != null) parts.push(`This design: ${f1(design)}.`);
  return parts.join(" ");
}
export function findRot(...xs: unknown[]): Rot {
  for (const x of xs) {
    const r = (x as { rule_of_thumb_comparison?: Rot } | null | undefined)?.rule_of_thumb_comparison;
    if (r) return r;
  }
  return null;
}
