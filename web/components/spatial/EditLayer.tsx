"use client";
// On-model editing for the planner: the controls sit on the house, only for the selected system.
// Panels: a glass "+" on every empty slot (its dotted frame drawn by the scene), a tap on a module takes it off.
// Battery, wallbox, heat pump: tap the unit for its size (a popover on the model), or the "+" on its dotted outline
// when the design has none (the heat pump's "+" lets the engine size it). Every target is at least 44 px. The scene animates modules and units in and out
// (0.25 s spring, bounce 0); Reduce Motion keeps the fades only. The homeowner page never mounts this.
import { useEffect, useMemo, useRef, useState } from "react";
import type { Design, OverrideValue } from "@/lib/api";
import type { SpatialScene } from "./scene";
import type { FaceSlots } from "./editing";
import type { V3 } from "./types";
import s from "./EditLayer.module.css";

type Sys = "panels" | "battery" | "wallbox" | "heatpump";
type Unit = "battery" | "wallbox" | "heatpump";
const FIELD: Record<Unit, keyof Design> = { battery: "battery_kwh", wallbox: "wallbox_kw", heatpump: "heatpump_kw" };
const STEPS: Record<Unit, number[]> = { battery: [5, 7, 10, 15], wallbox: [11, 22], heatpump: [4, 6, 8, 10, 12, 14, 16] };
// What "+" asks for: the smallest battery, the usual 11 kW wallbox; the heat pump is sized by the engine ("include",
// as the chooser does), and the stepper then shows the kW it chose.
const ADD: Record<Unit, OverrideValue> = { battery: 5, wallbox: 11, heatpump: "include" };
const UNIT: Record<Unit, string> = { battery: "kWh", wallbox: "kW", heatpump: "kW" };
const NAME: Record<Unit, string> = { battery: "battery", wallbox: "wallbox", heatpump: "heat pump" };
const LEAD = 10; // px of leader between a unit and its pill
const fmt = (x: number) => x.toLocaleString("en-GB", { maximumFractionDigits: 1 });

type Props = {
  scene: SpatialScene; sys: Sys | null; faces: FaceSlots[]; design: Design;
  onToggle: (plane: string, i: number) => void;
  onSet: (f: keyof Design, v: OverrideValue) => void;
  sizing?: Unit | null;   // a "+" on its way to the engine: the pill reads "sizing" until the design lands
};

export default function EditLayer({ scene, sys, faces, design, onToggle, onSet, sizing }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const unit: Unit | null = sys === "battery" || sys === "wallbox" || sys === "heatpump" ? sys : null;
  const has = unit ? !!design[FIELD[unit]] : false;

  // Slot controls: every slot on a target face, placed or empty.
  const slots = useMemo(() => (sys !== "panels" ? [] : faces.flatMap((f) => f.slots.map((sl) => ({ ...sl, placed: f.placed.includes(sl.i) })))), [faces, sys]);

  // The scene draws the dotted frames and the ghost unit for what is on screen here.
  useEffect(() => {
    scene.setSlotFrames(sys === "panels" ? slots.filter((x) => !x.placed).map((x) => x.corners) : null);
    scene.setGhost(unit && !has ? unit : null);
    return () => { scene.setSlotFrames(null); scene.setGhost(null); };
  }, [scene, sys, slots, unit, has]);
  useEffect(() => setOpen(false), [sys]);

  // Every frame: each control follows its anchor on screen; one on a face turned away, or off screen, hides.
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const root = box.current;
      if (!root) return;
      // The face pills win: a "+" whose 24 px circle overlaps a visible pill hides (pills live in the scene's overlay).
      const rr = root.getBoundingClientRect();
      const pills = [...(root.parentElement?.querySelectorAll<HTMLElement>(".sp-label") ?? [])].filter((e) => e.style.visibility !== "hidden").map((e) => { const b = e.getBoundingClientRect(); return { x0: b.left - rr.left - 12, x1: b.right - rr.left + 12, y0: b.top - rr.top - 12, y1: b.bottom - rr.top + 12 }; });
      root.querySelectorAll<HTMLElement>("[data-at]").forEach((el) => {
        const at = JSON.parse(el.dataset.at!) as V3, n = el.dataset.n ? (JSON.parse(el.dataset.n) as V3) : null;
        const q = scene.screenOf(at);
        const under = el.classList.contains(s.mark) && pills.some((r) => q.x > r.x0 && q.x < r.x1 && q.y > r.y0 && q.y < r.y1);
        const show = q.ok && !under && (!n || scene.facing(n, at)) && q.x > -20 && q.y > -20 && q.x < root.clientWidth + 20 && q.y < root.clientHeight + 20;
        el.style.visibility = show ? "visible" : "hidden";
        el.style.transform = `translate(${q.x.toFixed(1)}px, ${q.y.toFixed(1)}px)`;
      });
      root.querySelectorAll<SVGPolygonElement>("polygon[data-c]").forEach((el) => {
        const cs = JSON.parse(el.dataset.c!) as V3[], n = JSON.parse(el.dataset.n!) as V3, mid = JSON.parse(el.dataset.mid!) as V3;
        const q = cs.map((v) => scene.screenOf(v));
        const show = q.every((p) => p.ok) && scene.facing(n, mid);
        el.style.display = show ? "" : "none";
        if (show) el.setAttribute("points", q.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" "));
      });
      const u = root.querySelector<HTMLElement>("[data-unit]");
      if (u && unit) {
        const b = scene.unitBox(unit);
        if (b) {
          // Beside the unit, never over it: the pill sits a 10 px leader right of the unit's box on screen (left when
          // the right runs out of room), centred on its height; the popover's chip row follows on the same side.
          const W = root.clientWidth, H = root.clientHeight;
          let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, ok = true;
          for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) {
            const q = scene.screenOf(b.min.clone().set(x, y, z));
            ok = ok && q.ok; x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); y0 = Math.min(y0, q.y); y1 = Math.max(y1, q.y);
          }
          const pw = u.offsetWidth, my = (y0 + y1) / 2, pop = root.querySelector<HTMLElement>("[data-pop]");
          const popW = pop ? pop.offsetWidth + 6 : 0;
          const right = x1 + LEAD + pw + popW <= W - 8;
          const px = right ? x1 + LEAD : x0 - LEAD - pw;
          u.dataset.side = right ? "r" : "l";
          u.style.visibility = ok ? "visible" : "hidden";
          u.style.transform = `translate(${px.toFixed(1)}px, ${my.toFixed(1)}px)`;
          if (pop) {
            const h = pop.offsetHeight, x = right ? px + pw + 6 : px - popW;
            pop.style.transform = `translate(${Math.max(8, x).toFixed(0)}px, ${Math.max(8, Math.min(H - h - 8, my - h / 2)).toFixed(0)}px)`;
          }
        }
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [scene, unit, slots, open, has]);

  // A tap elsewhere or Esc closes the size popover.
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!box.current?.querySelector("[data-pop]")?.contains(e.target as Node) && !box.current?.querySelector("[data-unit]")?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopImmediatePropagation(); setOpen(false); } };
    document.addEventListener("pointerdown", away); addEventListener("keydown", esc, true);
    return () => { document.removeEventListener("pointerdown", away); removeEventListener("keydown", esc, true); };
  }, [open]);

  if (!sys) return null;
  const v = unit ? (design[FIELD[unit]] as number | null | undefined) ?? 0 : 0;
  const steps = unit ? STEPS[unit] : [];
  const at = steps.reduce((b, x, k) => (Math.abs(x - v) < Math.abs(steps[b] - v) ? k : b), 0);
  const set = (x: number | null) => { if (unit) onSet(FIELD[unit], x); if (x === null) setOpen(false); };

  return (
    <div ref={box} className={s.layer} data-edit-layer="">
      {/* Each slot's target is its own footprint on screen (plus a 1.5 px margin), so neighbours never overlap and a tap
          lands on the module or slot under the finger. The "+" marks only the empty ones and takes no taps. */}
      {slots.length > 0 && (
        <svg className={s.hits} aria-label="Module slots">
          {slots.map((sl) => (
            <polygon key={sl.id} data-c={JSON.stringify(sl.corners)} data-n={JSON.stringify(sl.n)} data-mid={JSON.stringify(sl.c)}
              className={sl.placed ? s.hitMod : s.hitSlot} role="button" tabIndex={0} data-slot={sl.id}
              aria-label={sl.placed ? "Remove this module" : "Add a module here"}
              onClick={() => onToggle(sl.plane, sl.i)} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(sl.plane, sl.i); } }} />
          ))}
        </svg>
      )}
      {slots.filter((sl) => !sl.placed).map((sl) => (
        <span key={sl.id} className={s.mark} data-at={JSON.stringify(sl.c)} data-n={JSON.stringify(sl.n)} aria-hidden="true"><span>+</span></span>
      ))}
      {unit && sizing === unit && !has ? (
        <span data-unit="" className={`${s.unit} b-skel-pill`} aria-busy="true" aria-label={`Sizing the ${NAME[unit]}`}><span className="b-skel" aria-hidden="true" /></span>
      ) : unit && (has ? (
        <button type="button" data-unit="" className={s.unit} aria-haspopup="true" aria-expanded={open} aria-label={`Change the ${NAME[unit]} size`} onClick={() => setOpen((x) => !x)}>
          <span>{fmt(v)} {UNIT[unit]}</span>
        </button>
      ) : (
        <button type="button" data-unit="" className={s.plus} aria-label={`Add a ${NAME[unit]}`} onClick={() => { onSet(FIELD[unit], ADD[unit]); setOpen(true); }}>
          <span aria-hidden="true">+</span>
        </button>
      ))}
      {unit && open && has && (
        // A compact glass chip row next to the pill: two other sizes and a small Remove, never a dialog over the house.
        <div data-pop="" className={s.pop} role="group" aria-label={`${NAME[unit][0].toUpperCase()}${NAME[unit].slice(1)} size`}>
          {(unit === "wallbox" ? steps : steps.filter((_, k) => k !== at).sort((x, y) => Math.abs(steps.indexOf(x) - at) - Math.abs(steps.indexOf(y) - at)).slice(0, 2).sort((x, y) => x - y)).map((x) => (
            <button key={x} type="button" className={s.chip} aria-pressed={x === v} onClick={() => set(x)}>{fmt(x)} {UNIT[unit]}</button>
          ))}
          <button type="button" className={s.remove} onClick={() => set(null)}>Remove</button>
        </div>
      )}
    </div>
  );
}
