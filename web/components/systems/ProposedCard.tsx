"use client";
// The offer, tucked like a Wallet pass: "Proposed Design" and the three headline figures. Tap or drag and it springs
// open to the full Offer panel (bounce 0, release velocity kept; a crossfade under Reduce Motion). The same card on
// every width: full width over the page on a phone, 520 px centred over the model above the sentence bar on desktop,
// where a clip hides the tucked body. Approve stays pinned at the bottom of the open card. While tucked, a change above shimmers the figures until the engine answers, then lights the ones that moved.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import Num from "@/components/offer/Num";
import "./systems.css";

type Fig = { k: "kwp" | "kwh" | "price"; v: string };
type Props = {
  kwp?: number | null; kwh?: number | null; price?: number;
  pending: boolean; side?: "bottom"; children: ReactNode; id?: string | null;
  title?: string; figs?: Fig[]; lift?: number;   // the homeowner page reuses the pass for its sign card, stacked above the safe area by lift px
  none?: string | null;   // no design applies to this building: no figures, this line, and Approve disabled
  undo?: { can: boolean; run: () => void };   // open card: Undo in the header row, one edit at a time
  labels?: Partial<Record<Fig["k"], string>>;   // tile labels other than Solar, Battery, Investment (a shared building)
};

const n = (x: number, d: number) => (Math.round(x * 10 ** d) / 10 ** d).toLocaleString("en-GB");
const OMEGA = (2 * Math.PI) / 0.5;   // Apple's smooth spring, 0.5 s, bounce 0 (critically damped)

function useReduce() {
  const [r, setR] = useState(false);
  useEffect(() => { const m = matchMedia("(prefers-reduced-motion: reduce)"); setR(m.matches); const f = () => setR(m.matches); m.addEventListener("change", f); return () => m.removeEventListener("change", f); }, []);
  return r;
}

export default function ProposedCard({ kwp, kwh, price = 0, pending, children, id, none: noneIn, title = "Proposed Design", figs: figsIn, lift = 0, undo, labels }: Props) {
  // A drafted design always shows; the "no design" line is only for a lead with nothing drafted.
  const none = kwp || kwh ? null : noneIn;
  const side = "bottom" as const;
  const reduce = useReduce();
  const [open, setOpen] = useState(false);
  const figs: Fig[] = figsIn ?? [
    { k: "kwp", v: kwp ? `${n(kwp, 2)} kWp` : "No solar" },
    { k: "kwh", v: kwh ? `${n(kwh, 1)} kWh` : "No battery" },
    { k: "price", v: `€${Math.round(price).toLocaleString("en-GB")}` },
  ];

  // A figure that moves springs to its new value and lights once (Num); no render of the pass is needed for it.

  // Spring state: pos 0 is open, max is tucked; written straight to the transform each frame.
  const root = useRef<HTMLDivElement>(null), mover = useRef<HTMLDivElement>(null), scrim = useRef<HTMLDivElement>(null);
  const st = useRef({ pos: 0, vel: 0, max: 0, goal: 0, raf: 0, init: false });
  const paint = useCallback(() => {
    const s = st.current, el = mover.current;
    if (!el) return;
    el.style.transform = side === "bottom" ? `translate3d(0, ${s.pos}px, 0)` : `translate3d(${s.pos}px, 0, 0)`;
    const t = s.max ? 1 - s.pos / s.max : 0;   // 0 tucked, 1 open
    if (scrim.current) { scrim.current.style.opacity = String(Math.max(0, Math.min(1, t))); scrim.current.style.pointerEvents = t > 0.05 ? "auto" : "none"; }
    root.current?.style.setProperty("--open", String(Math.max(0, Math.min(1, t))));
  }, [side]);
  const run = useCallback(() => {
    const s = st.current;
    cancelAnimationFrame(s.raf);
    let t0 = performance.now();
    const tick = (t: number) => {
      const dt = Math.min(0.032, (t - t0) / 1000); t0 = t;
      // Exact step of a critically damped spring; a retarget keeps the current velocity.
      const e0 = s.pos - s.goal, k = Math.exp(-OMEGA * dt), c = s.vel + OMEGA * e0, et = e0 + c * dt;
      s.vel = (c - OMEGA * et) * k; s.pos = s.goal + et * k;
      if (Math.abs(s.pos - s.goal) < 0.5 && Math.abs(s.vel) < 5) { s.pos = s.goal; s.vel = 0; paint(); return; }
      paint(); s.raf = requestAnimationFrame(tick);
    };
    s.raf = requestAnimationFrame(tick);
  }, [paint]);
  const to = useCallback((o: boolean, vel?: number) => {
    const s = st.current;
    s.goal = o ? 0 : s.max;
    if (vel != null) s.vel = vel;
    setOpen(o);
    if (reduce) { cancelAnimationFrame(s.raf); s.pos = s.goal; s.vel = 0; paint(); return; }
    run();
  }, [reduce, run, paint]);

  // Travel: the card's height less the pass on a phone; the panel's width plus the gap on desktop.
  useLayoutEffect(() => {
    const el = mover.current, r = root.current;
    if (!el || !r) return;
    // The peek is the tucked pass: measured only while tucked, because the open pass drops its figure line.
    let tuckedPeek = 0;
    const measure = () => {
      const s = st.current;
      if (!r.classList.contains("pc-open") || !tuckedPeek) tuckedPeek = r.querySelector<HTMLElement>(".pc-pass")?.getBoundingClientRect().height ?? 72;
      const peek = tuckedPeek;
      document.documentElement.style.setProperty("--pc-peek", `${Math.round(peek)}px`);
      const max = side === "bottom" ? Math.max(0, el.getBoundingClientRect().height - peek) : el.getBoundingClientRect().width + 24;
      const wasTucked = !s.init || s.goal === s.max;
      s.max = max; s.init = true;
      if (wasTucked) { s.goal = max; if (!s.raf || s.pos > max) s.pos = max; }
      paint();
    };
    measure();
    const ro = new ResizeObserver(measure); ro.observe(el); ro.observe(r);
    return () => { ro.disconnect(); document.documentElement.style.removeProperty("--pc-peek"); };
  }, [side, paint]);
  useEffect(() => () => cancelAnimationFrame(st.current.raf), []);
  // Esc, capture phase on window from mount: an open pass tucks; a tucked pass swallows it, so Esc never closes the lead
  // (the chevron is the way back). A kit chooser registers its own capture handler earlier and closes first; an open
  // menu marked data-esc-first (Layers) gets the Esc instead.
  const openNow = useRef(open); openNow.current = open;
  const toRef = useRef(to); toRef.current = to;
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key !== "Escape" || document.querySelector("[data-esc-first]")) return; e.stopPropagation(); e.preventDefault(); if (openNow.current) toRef.current(false); };
    addEventListener("keydown", esc, true);
    return () => removeEventListener("keydown", esc, true);
  }, []);
  // The page stays still under an open pass (no scroll behind it on iOS); a tucked pass leaves the page alone.
  useEffect(() => {
    if (!open) return;
    const b = document.body.style, was = b.overflow;
    b.overflow = "hidden";
    return () => { b.overflow = was; };
  }, [open]);

  // Drag on the pass: 1:1 after 10 px, then the release velocity projects where it lands (Apple's 0.998 rate).
  const drag = useRef<{ x: number; y: number; p0: number; on: boolean; hist: { t: number; p: number }[]; id: number } | null>(null);
  const moved = useRef(false);
  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const s = st.current;
    cancelAnimationFrame(s.raf); s.raf = 0;
    drag.current = { x: e.clientX, y: e.clientY, p0: s.pos, on: false, hist: [], id: e.pointerId };
    moved.current = false;
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current, s = st.current;
    if (!d || d.id !== e.pointerId) return;
    const delta = side === "bottom" ? e.clientY - d.y : e.clientX - d.x;
    if (!d.on) {
      if (Math.abs(delta) < 10) return;
      d.on = true; moved.current = true;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
    const raw = d.p0 + delta;
    // Past either end the card rubber-bands instead of stopping dead.
    s.pos = raw < 0 ? -Math.pow(-raw, 0.7) : raw > s.max ? s.max + Math.pow(raw - s.max, 0.7) : raw;
    d.hist.push({ t: e.timeStamp, p: s.pos }); if (d.hist.length > 6) d.hist.shift();
    paint();
  };
  const onUp = (e: React.PointerEvent) => {
    const d = drag.current, s = st.current;
    drag.current = null;
    if (!d) return;
    if (!d.on) { if (!s.raf && s.pos !== s.goal) run(); return; }
    const h = d.hist, a = h[0], b = h[h.length - 1];
    const v = a && b && b.t > a.t ? ((b.p - a.p) / (b.t - a.t)) * 1000 : 0;   // px per second
    const land = s.pos + (v / 1000) * (0.998 / (1 - 0.998));
    to(land < s.max / 2, v);
    void e;
  };

  // The standard three (solar, battery, investment) show as the card's first tile row, tucked and open alike; any
  // other figures (the homeowner's sign card) stay one inline line.
  const TILE: Record<Fig["k"], string> = { kwp: "Solar", kwh: "Battery", price: "Investment" };
  const tiles = labels ? figs.length > 0 : figs.length === 3 && figs.every((f, i) => f.k === (["kwp", "kwh", "price"] as const)[i]);
  const tile = (f: Fig) => (
    <span key={f.k} className="pc-tile"><span className="pc-tl">{labels?.[f.k] ?? TILE[f.k]}</span>
      {pending ? <b className="pc-skel" aria-hidden="true">{f.v}</b> : <b><Num v={f.v} lit /></b>}</span>
  );
  const figure = (f: Fig) => pending
    ? <span key={f.k} className="pc-fig pc-skel" aria-hidden="true">{f.v}</span>
    : <span key={f.k} className="pc-fig"><Num v={f.v} lit /></span>;   // springs to the new figure and lights briefly

  return (
    <div ref={root} className={`pc pc-${side}${open ? " pc-open" : ""}${reduce ? " pc-reduce" : ""}${tiles && !none ? " pc-has-tiles" : ""}`} style={lift ? ({ ["--pc-lift" as string]: `${lift}px` }) : undefined}>
      {<div ref={scrim} className="pc-scrim" onClick={() => to(false)} aria-hidden="true" />}
      {/* The tucked pass's footprint on the model, fixed whether the pass is open or not: the house frames above it. */}
      <div className="pc-cover" data-cover aria-hidden="true" />
      <div className="pc-clip"><div ref={mover} className="pc-card" role="region" aria-label={title}>
        <button type="button" className="pc-pass" aria-expanded={open} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
          onClick={() => { if (moved.current) { moved.current = false; return; } to(!open); }}>
          <span className="pc-grip" aria-hidden="true" />
          <span className="pc-h">{title}</span>
          {none ? <span className="pc-none">{none}</span> : tiles
            ? <span className="pc-figs pc-tiles" aria-live="polite" aria-busy={pending}>{figs.map(tile)}</span>
            : <span className="pc-figs" aria-live="polite" aria-busy={pending}>{figs.map(figure)}</span>}
          <svg className="pc-chev" width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 12.5l5-5 5 5" />
          </svg>
        </button>
        {undo && open && <button type="button" className="pc-undo" disabled={!undo.can} onClick={undo.run} title="Revert the last edit">Undo</button>}
        <div className="pc-body" inert={!open} aria-hidden={!open || undefined}>
          {none ? (
            <div className="pc-nobody">
              <p>{none}</p>
              <button type="button" className="btn" disabled>Complete</button>
            </div>
          ) : children}
        </div>
      </div></div>
    </div>
  );
}
