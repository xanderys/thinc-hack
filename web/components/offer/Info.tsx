// The small "i" of the calculation cards (same button, same popover look) for one figure on the offer. The popover
// opens under the button; Esc or a press outside closes it first, before the Proposed Design pass hears Esc.
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import s from "./offer.module.css";

export default function Info({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => { if (e.key !== "Escape") return; e.stopImmediatePropagation(); e.preventDefault(); setOpen(false); };
    const out = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    addEventListener("keydown", esc, true); addEventListener("pointerdown", out, true);
    return () => { removeEventListener("keydown", esc, true); removeEventListener("pointerdown", out, true); };
  }, [open]);
  return (
    <span ref={root} className={s.info}>
      <button type="button" className="sc-i" aria-expanded={open} aria-controls={id} aria-label={label} onClick={(e) => { e.stopPropagation(); setOpen((x) => !x); }}>
        <svg width="14" height="14" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="8.3" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M10 9v5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /><circle cx="10" cy="6.2" r="1.1" fill="currentColor" /></svg>
      </button>
      {open && <span id={id} className={s.infoPop} role="dialog" aria-label={label} data-esc-first>{children}</span>}
    </span>
  );
}

// Label then value rows inside a popover.
export function InfoRows({ rows }: { rows: { label: string; value: string }[] }) {
  return <dl className={s.infoRows}>{rows.map((r) => <div key={r.label}><dt>{r.label}</dt>{r.value && <dd>{r.value}</dd>}</div>)}</dl>;
}
