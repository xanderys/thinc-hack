"use client";
// Finger or mouse signature on a modest canvas, exported as a PNG data URL well under 200 KB.
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

export type SignatureHandle = { clear: () => void; png: () => string | null };

const Signature = forwardRef<SignatureHandle, { onInk: (inked: boolean) => void; labelledBy?: string }>(function Signature({ onInk, labelledBy }, ref) {
  const cv = useRef<HTMLCanvasElement>(null);
  const last = useRef<{ x: number; y: number } | null>(null);
  const inked = useRef(false);

  // Backing store at up to 2x the CSS size, capped at 720 px wide: a stroke PNG stays in the tens of KB.
  useEffect(() => {
    const c = cv.current!;
    const fit = () => {
      const r = c.getBoundingClientRect(), s = Math.min(2, window.devicePixelRatio || 1, 720 / Math.max(1, r.width));
      if (c.width === Math.round(r.width * s)) return;
      c.width = Math.round(r.width * s); c.height = Math.round(r.height * s);
      const g = c.getContext("2d")!;
      g.scale(s, s); g.lineCap = "round"; g.lineJoin = "round"; g.lineWidth = 2.4; g.strokeStyle = "#1b1d20";
      inked.current = false; onInk(false);
    };
    fit();
    const ro = new ResizeObserver(fit); ro.observe(c);
    return () => ro.disconnect();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const at = (ev: React.PointerEvent) => { const r = cv.current!.getBoundingClientRect(); return { x: ev.clientX - r.left, y: ev.clientY - r.top }; };
  const down = (ev: React.PointerEvent) => {
    ev.preventDefault(); cv.current!.setPointerCapture(ev.pointerId);
    last.current = at(ev);
    const g = cv.current!.getContext("2d")!, p = last.current;
    g.beginPath(); g.arc(p.x, p.y, 1.2, 0, Math.PI * 2); g.fillStyle = "#1b1d20"; g.fill();
  };
  const move = (ev: React.PointerEvent) => {
    if (!last.current) return;
    const g = cv.current!.getContext("2d")!, p = at(ev);
    g.beginPath(); g.moveTo(last.current.x, last.current.y); g.lineTo(p.x, p.y); g.stroke();
    last.current = p;
    if (!inked.current) { inked.current = true; onInk(true); }
  };
  const up = () => { last.current = null; };

  useImperativeHandle(ref, () => ({
    clear: () => { const c = cv.current!; c.getContext("2d")!.clearRect(0, 0, c.width, c.height); inked.current = false; onInk(false); },
    png: () => (inked.current ? cv.current!.toDataURL("image/png") : null),
  }));

  return (
    <canvas ref={cv} className="pp-canvas" role="img" aria-labelledby={labelledBy}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={up} />
  );
});

export default Signature;
