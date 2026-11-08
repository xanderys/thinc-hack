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
  const menu = useRef<HTMLDivElement>(null);
  // Anchored to the button and kept on screen: up when the button sits in the lower half, its left edge moved so the
  // menu stays 12 px inside the viewport on both sides (at 390 it used to open half off the left edge).
  const [place, setPlace] = useState<{ left: number; up: boolean; maxH: number } | null>(null);
  useLayoutEffect(() => {
    if (!open) { setPlace(null); return; }
    const fit = () => {
      const b = box.current?.getBoundingClientRect(), mEl = menu.current;
      if (!b || !mEl) return;
      const vw = window.innerWidth, vh = window.innerHeight, M = 12, w = Math.min(mEl.offsetWidth, vw - 2 * M);
      const goUp = up ?? b.top > vh / 2;
      const want = b.right - w; // right edges aligned, as before
      const left = Math.max(M, Math.min(vw - M - w, want)) - b.left;
      setPlace({ left, up: goUp, maxH: Math.max(160, (goUp ? b.top : vh - b.bottom) - 18) });
    };
    fit();
    addEventListener("resize", fit);
    return () => removeEventListener("resize", fit);
  }, [open, up]);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    // Esc closes the menu and stops there (capture phase on window): the Proposed Design pass and the board never see it.
    const esc = (e: KeyboardEvent) => { if (e.key !== "Escape") return; e.stopImmediatePropagation(); e.preventDefault(); setOpen(false); };
    document.addEventListener("pointerdown", away); addEventListener("keydown", esc, true);
    return () => { document.removeEventListener("pointerdown", away); removeEventListener("keydown", esc, true); };
  }, [open]);
  const lines = imageryLines(o);
  return (
    <div className={m.wrap} ref={box}>
      <button type="button" className={className} aria-expanded={open} aria-pressed={open || !!heatmap?.on || o.white} onClick={() => setOpen((x) => !x)} title="Layers" aria-label="Layers">
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true"><path d="M10 2l8 4-8 4-8-4zM2 10l8 4 8-4M2 14l8 4 8-4" /></svg>
      </button>
      {open && (
        <div ref={menu} className={`${m.menu} ${(place?.up ?? up) ? m.up : ""}`} role="menu" aria-label="Layers" data-esc-first=""
          style={place ? { left: place.left, right: "auto", maxWidth: "calc(100vw - 24px)", maxHeight: place.maxH, overflowY: "auto" } : { visibility: "hidden" }}>
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
