"use client";
// The layers menu on the model toolbar: sun heatmap (on the hero card), White context, Solid walls, the ground picture, and
// how old the pictures on screen are. Options live in whiteMode.ts so the scene and photo layer follow them.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { imageryLines, licenceLine, setGround, setSolid, setWhite, useViewOpts } from "./whiteMode";
import { setMeshWanted, useMeshPref } from "./meshPref";
import m from "./LayersMenu.module.css";

type Props = { className?: string; up?: boolean; heatmap?: { on: boolean; set: (on: boolean) => void } };

export default function LayersMenu({ className, up, heatmap }: Props) {
  const [open, setOpen] = useState(false);
  const o = useViewOpts();
  const mesh = useMeshPref();
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    // Esc closes the menu and stops there (capture phase on window): the Proposed Design pass and the board never see it.
    const esc = (e: KeyboardEvent) => { if (e.key !== "Escape") return; e.stopImmediatePropagation(); e.preventDefault(); setOpen(false); };
    document.addEventListener("pointerdown", away); addEventListener("keydown", esc, true);
    return () => { document.removeEventListener("pointerdown", away); removeEventListener("keydown", esc, true); };
  }, [open]);
  // Opens on the side with room inside the model's frame (its nearest clipping box), never clipped at the canvas edge;
  // \`up\` is the preferred side, and the menu scrolls if neither side fits it whole.
  const menu = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{ up: boolean; max: number } | null>(null);
  useLayoutEffect(() => {
    if (!open) { setFit(null); return; }
    const btn = box.current, m = menu.current;
    if (!btn || !m) return;
    let clip: HTMLElement | null = btn.parentElement;
    while (clip && clip !== document.body && getComputedStyle(clip).overflow === "visible" && getComputedStyle(clip).overflowY === "visible") clip = clip.parentElement;
    const c = (clip ?? document.body).getBoundingClientRect(), b = btn.getBoundingClientRect(), h = m.scrollHeight;
    const above = b.top - Math.max(c.top, 0) - 12, below = Math.min(c.bottom, innerHeight) - b.bottom - 12;
    const goUp = up ? above >= h || above >= below : !(below >= h || below >= above);
    setFit({ up: goUp, max: Math.max(120, goUp ? above : below) });
  }, [open, up]);
  const lines = imageryLines(o);
  return (
    <div className={m.wrap} ref={box}>
      <button type="button" className={className} aria-expanded={open} aria-pressed={open || !!heatmap?.on || o.white} onClick={() => setOpen((x) => !x)} title="Layers" aria-label="Layers">
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true"><path d="M10 2l8 4-8 4-8-4zM2 10l8 4 8-4M2 14l8 4 8-4" /></svg>
      </button>
      {open && (
        <div ref={menu} className={`${m.menu} ${(fit ? fit.up : up) ? m.up : ""}`} style={fit ? { maxHeight: fit.max, overflowY: "auto" } : { visibility: "hidden" }} role="menu" aria-label="Layers" data-esc-first="">
          {heatmap && <label className={m.row}><input type="checkbox" checked={heatmap.on} onChange={(e) => heatmap.set(e.target.checked)} />Sun heatmap</label>}
          <label className={m.row}><input type="checkbox" checked={o.white} onChange={(e) => setWhite(e.target.checked)} />Surrounding buildings</label>
          <label className={m.row}><input type="checkbox" checked={o.solid} onChange={(e) => setSolid(e.target.checked)} />Solid walls</label>
          <label className={m.row}><input type="checkbox" checked={mesh.want} onChange={(e) => setMeshWanted(e.target.checked)} />Photo 3D</label>
          {mesh.note && <p className={m.age}>{mesh.note}</p>}
          {o.google && (
            <div className={m.ground} role="group" aria-label="Ground">
              <span>Ground</span>
              <button type="button" aria-pressed={o.ground === "google"} onClick={() => setGround("google")}>Google</button>
              <button type="button" aria-pressed={o.ground === "bavaria"} onClick={() => setGround("bavaria")}>Bavaria</button>
            </div>
          )}
          {lines.map((l) => <p key={l} className={m.age}>{l}</p>)}
          <p className={m.licence}>{licenceLine(o)}</p>
        </div>
      )}
    </div>
  );
}
