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
  canNone: boolean; glyph: string;
  onChoose: (f: LineField, v: OverrideValue | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: PointerEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    // Capture phase on window: Esc closes the chooser and stops there, so the board's Esc (close the lead) never runs.
    const esc = (e: KeyboardEvent) => { if (e.key !== "Escape") return; e.stopPropagation(); e.preventDefault(); setOpen(false); };
    addEventListener("pointerdown", off); addEventListener("keydown", esc, true);
    return () => { removeEventListener("pointerdown", off); removeEventListener("keydown", esc, true); };
  }, [open]);
  const fmt = (v: number) => `${unit === "kWp" ? n2(v) : n1(v)} ${unit}`;
  const locked = set !== undefined;
  const pick = (v: OverrideValue | undefined) => { setOpen(false); if (v === undefined && !fixed) return; if (locked && v === set) return; onChoose(field, v); };
  return (
    <div className={s.line} ref={ref} data-open={open || undefined}>
      <button type="button" className={s.lineBtn} aria-expanded={open} onClick={() => setOpen((x) => !x)}>
        <Glyph k={glyph} size={15} />
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
