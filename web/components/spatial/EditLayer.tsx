"use client";
// On-model editing for the planner: the controls sit on the house, only for the selected system.
// Panels: a glass "+" on every empty slot (its dotted frame drawn by the scene), a tap on a module takes it off.
// Battery, wallbox, heat pump: tap the unit for its size (a popover on the model), or the "+" on its dotted outline
// when the design has none. Every target is at least 44 px. The scene animates modules and units in and out
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
const ADD: Record<Unit, number> = { battery: 5, wallbox: 11, heatpump: 8 };
const UNIT: Record<Unit, string> = { battery: "kWh", wallbox: "kW", heatpump: "kW" };
const NAME: Record<Unit, string> = { battery: "battery", wallbox: "wallbox", heatpump: "heat pump" };
const fmt = (x: number) => x.toLocaleString("en-GB", { maximumFractionDigits: 1 });

type Props = {
  scene: SpatialScene; sys: Sys | null; faces: FaceSlots[]; design: Design;
  onToggle: (plane: string, i: number) => void;
  onSet: (f: keyof Design, v: OverrideValue) => void;
};

export default function EditLayer({ scene, sys, faces, design, onToggle, onSet }: Props) {
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
      root.querySelectorAll<HTMLElement>("[data-at]").forEach((el) => {
        const at = JSON.parse(el.dataset.at!) as V3, n = el.dataset.n ? (JSON.parse(el.dataset.n) as V3) : null;
        const q = scene.screenOf(at);
        const show = q.ok && (!n || scene.facing(n, at)) && q.x > -20 && q.y > -20 && q.x < root.clientWidth + 20 && q.y < root.clientHeight + 20;
        el.style.visibility = show ? "visible" : "hidden";
        el.style.transform = `translate(${q.x.toFixed(1)}px, ${q.y.toFixed(1)}px)`;
      });
      const u = root.querySelector<HTMLElement>("[data-unit]");
      if (u && unit) {
        const b = scene.unitBox(unit);
        if (b) {
          const c = b.getCenter(b.min.clone()), q = scene.screenOf(c);
          u.style.visibility = q.ok ? "visible" : "hidden";
          u.style.transform = `translate(${q.x.toFixed(1)}px, ${q.y.toFixed(1)}px)`;
          const pop = root.querySelector<HTMLElement>("[data-pop]");
          if (pop) {
            const w = pop.offsetWidth, h = pop.offsetHeight, W = root.clientWidth, H = root.clientHeight;
            const x = Math.max(8, Math.min(W - w - 8, q.x - w / 2)), y = q.y - h - 34 > 8 ? q.y - h - 34 : Math.min(H - h - 8, q.y + 34);
            pop.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px)`;
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
      {slots.map((sl) => (
        <button key={sl.id} type="button" className={sl.placed ? s.module : s.plus} data-at={JSON.stringify(sl.c)} data-n={JSON.stringify(sl.n)}
          aria-label={sl.placed ? "Remove this module" : "Add a module here"} onClick={() => onToggle(sl.plane, sl.i)}>
          <span aria-hidden="true">{sl.placed ? "" : "+"}</span>
        </button>
      ))}
      {unit && (has ? (
        <button type="button" data-unit="" className={s.unit} aria-haspopup="dialog" aria-expanded={open} aria-label={`Change the ${NAME[unit]} size`} onClick={() => setOpen((x) => !x)}>
          <span>{fmt(v)} {UNIT[unit]}</span>
        </button>
      ) : (
        <button type="button" data-unit="" className={s.plus} aria-label={`Add a ${NAME[unit]}`} onClick={() => { onSet(FIELD[unit], ADD[unit]); setOpen(true); }}>
          <span aria-hidden="true">+</span>
        </button>
      ))}
      {unit && open && has && (
        <div data-pop="" className={s.pop} role="dialog" aria-label={`${NAME[unit][0].toUpperCase()}${NAME[unit].slice(1)} size`}>
          {unit === "wallbox" ? (
            <div className={s.seg} role="radiogroup" aria-label="Wallbox power">
              {steps.map((x) => <button key={x} type="button" role="radio" aria-checked={x === v} onClick={() => set(x)}>{x} kW</button>)}
            </div>
          ) : (
            <div className={s.step}>
              <button type="button" aria-label="Smaller" disabled={at === 0 && unit !== "battery"} onClick={() => set(at === 0 ? null : steps[at - 1])}>−</button>
              <b aria-live="polite">{fmt(v)} {UNIT[unit]}</b>
              <button type="button" aria-label="Larger" disabled={at === steps.length - 1} onClick={() => set(steps[Math.min(steps.length - 1, at + 1)])}>+</button>
            </div>
          )}
          {unit === "battery" && (
            <div className={s.seg} role="radiogroup" aria-label="Battery size">
              <button type="button" role="radio" aria-checked={!v} onClick={() => set(null)}>None</button>
              {steps.map((x) => <button key={x} type="button" role="radio" aria-checked={x === v} onClick={() => set(x)}>{x}</button>)}
            </div>
          )}
          {unit !== "battery" && <button type="button" className={s.remove} onClick={() => set(null)}>Remove</button>}
        </div>
      )}
    </div>
  );
}
