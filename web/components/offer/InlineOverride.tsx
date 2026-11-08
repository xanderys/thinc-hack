// One component line of the offer. Tapping it opens a small chooser: let the engine decide, none, or one of the
// installer's package sizes. A choice re-runs the design through the same path as a sentence (overrides on
// /api/refine with base_version); a line the planner set carries a lock and "set by you".
import { useEffect, useRef, useState } from "react";
import type { Design, OverrideValue } from "@/lib/api";
import { n1, n2 } from "./format";
import Glyph from "./Glyph";
import s from "./offer.module.css";

export type LineField = Exclude<keyof Design, never>;

export default function InlineOverride({ field, text, unit, sizes, current, set, fixed, canNone, onChoose, glyph }: {
  field: LineField; text: string; unit: string; sizes: number[]; current: number | null;
  set: OverrideValue | undefined;   // what the planner chose here by hand (lock and "set by you")
  fixed: boolean;                   // any override on this field, a variant's included
  canNone: boolean; glyph?: string;   // omitted inside the kit sheet, where the row already shows the part
  onChoose: (f: LineField, v: OverrideValue | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    addEventListener("pointerdown", off);
    return () => removeEventListener("pointerdown", off);
  }, [open]);
  // Esc closes the chooser and stops there: neither the Proposed Design pass nor the board (close the lead) sees it.
  // Registered once on mount, capture phase on window, so it runs before handlers added when the pass opens.
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key !== "Escape" || !openRef.current) return; e.stopImmediatePropagation(); e.preventDefault(); setOpen(false); };
    addEventListener("keydown", esc, true);
    return () => removeEventListener("keydown", esc, true);
  }, []);
  const fmt = (v: number) => `${unit === "kWp" ? n2(v) : n1(v)} ${unit}`;
  const locked = set !== undefined;
  const pick = (v: OverrideValue | undefined) => { setOpen(false); if (v === undefined && !fixed) return; if (locked && v === set) return; onChoose(field, v); };
  return (
    <div className={s.line} ref={ref} data-open={open || undefined}>
      <button type="button" className={s.lineBtn} aria-expanded={open} onClick={() => setOpen((x) => !x)}>
        {glyph && <Glyph k={glyph} size={15} />}
        <span className={s.lineText}>{text}</span>
        {locked && <span className={s.set}><Glyph k="lock" size={12} />set by you</span>}
      </button>
      {open && (
        <div className={s.chooser} role="menu" aria-label={text}>
          <button type="button" role="menuitemradio" aria-checked={!locked} onClick={() => pick(undefined)}>Let the engine decide</button>
          {canNone && <button type="button" role="menuitemradio" aria-checked={locked && set === null} onClick={() => pick(null)}>None</button>}
          {sizes.map((v) => (
            <button key={v} type="button" role="menuitemradio" aria-checked={locked && set === v} data-now={!locked && v === current ? "" : undefined} onClick={() => pick(v)}>{fmt(v)}</button>
          ))}
        </div>
      )}
    </div>
  );
}
