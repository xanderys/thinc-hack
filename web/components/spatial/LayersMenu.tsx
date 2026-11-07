"use client";
// The layers menu on the model toolbar: sun heatmap (on the hero card), White context, the ground picture, and
// how old the pictures on screen are. Options live in whiteMode.ts so the scene and photo layer follow them.
import { useEffect, useRef, useState } from "react";
import { imageryLines, setGround, setWhite, useViewOpts } from "./whiteMode";
import m from "./LayersMenu.module.css";

type Props = { className?: string; up?: boolean; heatmap?: { on: boolean; set: (on: boolean) => void } };

export default function LayersMenu({ className, up, heatmap }: Props) {
  const [open, setOpen] = useState(false);
  const o = useViewOpts();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", away); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  const lines = imageryLines(o);
  return (
    <div className={m.wrap} ref={box}>
      <button type="button" className={className} aria-expanded={open} aria-pressed={open || !!heatmap?.on || o.white} onClick={() => setOpen((x) => !x)} title="Layers" aria-label="Layers">
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true"><path d="M10 2l8 4-8 4-8-4zM2 10l8 4 8-4M2 14l8 4 8-4" /></svg>
      </button>
      {open && (
        <div className={`${m.menu} ${up ? m.up : ""}`} role="menu" aria-label="Layers">
          {heatmap && <label className={m.row}><input type="checkbox" checked={heatmap.on} onChange={(e) => heatmap.set(e.target.checked)} />Sun heatmap</label>}
          <label className={m.row}><input type="checkbox" checked={o.white} onChange={(e) => setWhite(e.target.checked)} />White context</label>
          {o.google && (
            <div className={m.ground} role="group" aria-label="Ground">
              <span>Ground</span>
              <button type="button" aria-pressed={o.ground === "google"} onClick={() => setGround("google")}>Google</button>
              <button type="button" aria-pressed={o.ground === "bavaria"} onClick={() => setGround("bavaria")}>Bavaria</button>
            </div>
          )}
          {lines.map((l) => <p key={l} className={m.age}>{l}</p>)}
        </div>
      )}
    </div>
  );
}
