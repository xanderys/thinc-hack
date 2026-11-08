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
    r.line = {
      expert: "what planners here fit to homes like this",
      independence: price(r) >= Math.max(...caps) ? "most of your own power, highest cost" : "most of your own power",
      payback: "earns its cost back soonest",
      upfront: (r.e?.autarky_share ?? 0) <= Math.min(...auts) ? "smallest outlay, least of your own power" : "smallest outlay",
      edit: "as you changed it",
    }[r.key];
    r.line = sentence(r.line);
  }
  const four = rows.filter((r) => r.key !== "edit");
  return [...four.filter((r) => r.key === "expert"), ...four.filter((r) => r.key !== "expert").sort((a, b) => price(a) - price(b)), ...rows.filter((r) => r.key === "edit")];
}

export function SizeChips({ d }: { d: Partial<Design> }) {
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

export default function VariantTabs({ rows, onPick, pending }: { rows: Row[]; onPick: (r: Row) => void; pending?: boolean }) {
  if (!rows.length) return null;
  const ref = rows.find((r) => r.key === "expert")?.design ?? null;
  return (
    <div className={s.vtabs} role="radiogroup" aria-label="Offers" data-pending={pending || undefined}>
      {rows.map((r) => (
        <button key={r.key} type="button" role="radio" aria-checked={r.selected} className={s.vtab} data-k={r.key}
          onClick={() => { if (r.selected || !r.pick) return; dispatchEvent(new CustomEvent("marquee:variant", { detail: { id: r.key, design: r.design } })); onPick(r); }}>
          <span className={s.vtGlyph}><Glyph k={r.key} size={18} /></span>
          <span className={s.vtBody}>
            <span className={s.vtName}>{r.name}{r.approved && <span className={s.vtMark}>Complete</span>}</span>
            <span className={s.vtLine}>{r.line}</span>
            <Facts items={variantFacts(r.e, r.design, r.key === "expert" ? null : ref)} />
          </span>
        </button>
      ))}
    </div>
  );
}
