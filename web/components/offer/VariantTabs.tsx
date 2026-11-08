// Event for other lanes (the 3D scene): every tab pick dispatches on window
//   new CustomEvent("marquee:variant", { detail: { id, design } })
//   id: "expert" | "independence" | "payback" | "upfront" | "edit"; design: the variant's Design (five sizes).
// It fires before the card updates, so a listener can start its own transition in the same frame. Listen with
//   addEventListener("marquee:variant", (e) => { const { id, design } = (e as CustomEvent).detail; ... })
// The four offers a homeowner can choose between: glyph, name, one plain line, then the same figures in the same
// order for each (price estimate, break-even, what differs from the planners' pick). Planners' pick first, then by price.
// "Your edit" appears only when the design on screen matches none of the four.
import type { Design, Economics } from "@/lib/api";
import type { Variant as StageVariant } from "@/components/stage/Plan";
import { COLOUR, n1, n2 } from "./format";
import { sentence, variantFacts, type Fact } from "./facts";
import Glyph from "./Glyph";
import { VARIANT_LINE } from "@/lib/variants";
import s from "./offer.module.css";

export type RowKey = "expert" | "independence" | "payback" | "upfront" | "edit";
export type Row = { key: RowKey; name: string; line: string; design: Design; e: Economics | null; pick: StageVariant | null; selected: boolean; approved?: boolean };

const BY_NAME: Record<string, RowKey> = { "Most independence": "independence", "Best payback": "payback", "Lowest upfront cost": "upfront" };
const NAME: Record<RowKey, string> = { expert: "Planners' pick", independence: "Most independence", payback: "Best payback", upfront: "Lowest upfront cost", edit: "Your edit" };

// Stage folds identical offers into one entry with `also`; here every offer keeps its own row.
export function rowsOf(variants: StageVariant[]): Row[] {
  if (!variants.some((v) => [v.name, ...(v.also ?? [])].some((n) => BY_NAME[n]))) return [];
  const rows: Row[] = [];
  for (const v of variants) {
    if (!v?.design) continue;   // an offer still loading has no sizes to show yet
    for (const name of [v.name, ...(v.also ?? [])]) {
      if (name === "Best value") continue;
      const key: RowKey = name === "Current" ? "edit" : BY_NAME[name] ?? "expert";
      if (rows.some((r) => r.key === key)) continue;
      rows.push({ key, name: NAME[key], line: "", design: v.design, e: v.e, pick: key === "edit" ? null : v, selected: v.current });
    }
  }
  const price = (r: Row) => r.e?.capex_eur ?? Infinity;
  const caps = rows.filter((r) => r.key !== "edit").map(price), auts = rows.filter((r) => r.key !== "edit").map((r) => r.e?.autarky_share ?? 0);
  for (const r of rows) {
    // The shared line (lib/variants.ts), plus the planner-only comparison where it holds.
    const suffix = r.key === "independence" && price(r) >= Math.max(...caps) ? ", highest cost"
      : r.key === "upfront" && (r.e?.autarky_share ?? 0) <= Math.min(...auts) ? ", least of your own power" : "";
    r.line = VARIANT_LINE[r.key] + suffix;
    r.line = sentence(r.line);
  }
  const ORDER: RowKey[] = ["expert", "payback", "upfront", "independence", "edit"];
  return ORDER.flatMap((k) => rows.filter((r) => r.key === k));
}

export function SizeChips({ d: d0 }: { d: Partial<Design> | null | undefined }) {
  const d = d0 ?? {};
  const chips: { k: "pv" | "battery" | "wallbox" | "heatpump"; label: string; v: string }[] = [
    ...(d.pv_kwp ? [{ k: "pv" as const, label: "Solar", v: `${n2(d.pv_kwp)} kWp` }] : []),
    ...(d.battery_kwh ? [{ k: "battery" as const, label: "Battery", v: `${n1(d.battery_kwh)} kWh` }] : []),
    ...(d.wallbox_kw ? [{ k: "wallbox" as const, label: "Wallbox", v: `${n1(d.wallbox_kw)} kW` }] : []),
    ...(d.heatpump_kw ? [{ k: "heatpump" as const, label: "Heat pump", v: `${n1(d.heatpump_kw)} kW` }] : []),
  ];
  return (
    <span className={s.chips}>
      {chips.map((c) => (
        <span key={c.k} className={s.chip} data-k={c.k} aria-label={`${c.label} ${c.v}`}>
          <Glyph k={c.k} size={12} colour={c.k === "pv" ? "#8a5a00" : COLOUR[c.k]} />{c.v}
        </span>
      ))}
    </span>
  );
}

// Label then value, one column per figure; shared with the homeowner alternatives.
export function Facts({ items, className }: { items: Fact[]; className?: string }) {
  return (
    <dl className={`${s.facts} ${className ?? ""}`}>
      {items.map((f) => <div key={f.label}><dt>{f.label}</dt><dd>{f.value}{f.note && <em> {f.note}</em>}</dd></div>)}
    </dl>
  );
}

// The variant selector: one short row per offer (glyph, name, one line), the chosen one filled like a chip. Picking a
// row changes everything else on the card. Without onPick the rows are a read-only list (the homeowner's alternatives).
export const LINE: Record<RowKey, string> = VARIANT_LINE;
export function VariantRows({ rows, onPick, pending, label = "Offers" }: { rows: Pick<Row, "key" | "name" | "line" | "selected">[]; onPick?: (k: RowKey) => void; pending?: boolean; label?: string }) {
  if (!rows.length) return null;
  if (!onPick) return (
    <ul className={s.vrows} aria-label={label}>
      {rows.map((r) => <li key={r.key} className={s.vrow} data-k={r.key}><span className={s.vtGlyph}><Glyph k={r.key} size={18} /></span><span className={s.vtBody}><span className={s.vtName}>{r.name}</span><span className={s.vtLine}>{r.line}</span></span></li>)}
    </ul>
  );
  return (
    <div className={s.vrows} role="radiogroup" aria-label={label} data-pending={pending || undefined}>
      {rows.map((r) => (
        <button key={r.key} type="button" role="radio" aria-checked={r.selected} className={s.vrow} data-k={r.key} onClick={() => { if (!r.selected) onPick(r.key); }}>
          <span className={s.vtGlyph}><Glyph k={r.key} size={18} /></span>
          <span className={s.vtBody}><span className={s.vtName}>{r.name}</span><span className={s.vtLine}>{r.line}</span></span>
        </button>
      ))}
    </div>
  );
}

export default function VariantTabs({ rows, onPick, pending }: { rows: Row[]; onPick: (r: Row) => void; pending?: boolean }) {
  return (
    <VariantRows rows={rows} pending={pending} onPick={(k) => {
      const r = rows.find((x) => x.key === k);
      if (!r || !r.pick) return;
      dispatchEvent(new CustomEvent("marquee:variant", { detail: { id: r.key, design: r.design } }));
      onPick(r);
    }} />
  );
}
