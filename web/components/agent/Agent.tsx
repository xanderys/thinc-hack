"use client";
// Interim container for the board until the copilot shell (web/components/copilot) mounts Thread itself.
import { useEffect, useRef, useState } from "react";
import Composer from "@/components/composer/Composer";
import { openLead } from "./Blocks";
import { useCopilotContext } from "./context";
import Thread from "./Thread";
import s from "./agent.module.css";

export default function Agent() {
  const [open, setOpen] = useState(false);
  const [drag, setDrag] = useState(0);
  const ctx = useCopilotContext();
  const dragFrom = useRef<{ y: number; t: number } | null>(null);
  const comp = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!open) return; const k = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); }; addEventListener("keydown", k); return () => removeEventListener("keydown", k); }, [open]);
  // The card's field unmounts on close; give the board back the composer dock's height.
  useEffect(() => {
    if (open) return;
    const id = requestAnimationFrame(() => { const dock = comp.current?.querySelector("form")?.parentElement; if (dock) document.documentElement.style.setProperty("--composer-h", `${Math.ceil(dock.getBoundingClientRect().height)}px`); });
    return () => cancelAnimationFrame(id);
  }, [open]);

  const chev = (down: boolean) => <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={down ? "M4.5 7 9 11.5 13.5 7" : "M4.5 11 9 6.5l4.5 4.5"} /></svg>;
  const onDown = (e: React.PointerEvent) => { e.currentTarget.setPointerCapture(e.pointerId); dragFrom.current = { y: e.clientY, t: performance.now() }; };
  const onMove = (e: React.PointerEvent) => { if (dragFrom.current) setDrag(Math.max(0, e.clientY - dragFrom.current.y)); };
  const onUp = (e: React.PointerEvent) => {
    const f = dragFrom.current; dragFrom.current = null; if (!f) return;
    const dy = e.clientY - f.y, v = dy / Math.max(1, performance.now() - f.t);
    if (dy > 90 || v > 0.6) setOpen(false);
    setDrag(0);
  };

  return (
    <>
      {/* Collapsed: the composer as its lane built it, with the expand chevron on its line. */}
      <div ref={comp} style={open ? { visibility: "hidden" } : undefined}><Composer /></div>
      {!open && <button type="button" className={`${s.chev} ${s.chevDock}`} aria-label="Expand" aria-expanded={false} onClick={() => setOpen(true)}>{chev(false)}</button>}
      <div className={`${s.scrim} ${open ? s.scrimOn : ""}`} onClick={() => setOpen(false)} aria-hidden />
      <section className={`${s.card} ${open ? s.cardOn : ""} ${drag ? s.dragging : ""}`} style={drag ? { transform: `translateY(${drag}px)` } : undefined} aria-hidden={!open} aria-label="Agent">
        <div className={s.handle} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} role="button" aria-label="Drag down to collapse" tabIndex={-1}><span /></div>
        {ctx.leadId && <div className={s.ctx}><button type="button" className={s.chip} onClick={() => openLead(ctx.leadId!)}>{ctx.name ?? ctx.leadId}</button></div>}
        {open && <Thread onLead={(id) => { setOpen(false); openLead(id); }}
          trailing={<button type="button" className={`${s.chev}`} aria-label="Collapse" aria-expanded onClick={() => setOpen(false)}>{chev(true)}</button>} />}
      </section>
    </>
  );
}
