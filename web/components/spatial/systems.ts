// Per-system layers on the model, driven by one call: scene.setSystem("panels" | "battery" | "wallbox" | "heatpump" | null).
// Panels: the sun path over the house, the sun where the shading scrubber says (noon when it says nothing).
// Battery: energy flowing roof to battery to house across a looping day (dots along pipes in the component colours).
// Wallbox: the car arrives at the drive, the cable reaches it, and it charges overnight (dots from the house to the
// wallbox to the car).
// Heat pump: the envelope x-ray (xray.ts). Each system flies to its stage pose; the kit never changes (the panels,
// their count and the design stay exactly as they are). Nothing here calls the engine.
// Motion: the day clock runs linearly in a loop (a progress loop, the one place linear belongs); the car arrives on
// the scene's critically damped spring (0.6 s, bounce 0). Reduce Motion: a still frame at 13:00 (battery) or
// 23:00 (wallbox), dots evenly spaced and still, the car already parked.
import * as THREE from "three";
import { POSES, springStep, type Pose } from "./camera";
import type { ShadeAt } from "@/lib/shading";
import type { Envelope } from "./types";
import { CAR, CAR_PORT, WALLBOX, WALLBOX_OUTLET, cable, car } from "./kitMeshes";

export type System = "panels" | "battery" | "wallbox" | "heatpump";

const SOLAR = new THREE.Color("#E8730C"), BATT = new THREE.Color("#24a148"), EV = new THREE.Color("#1c71ef"), GRID = new THREE.Color("#4A4C55");
const PIPE = "#9a978f";
const DAY_S = 14;        // seconds for one looping day in the battery view
const DOTS = 14;         // dots per pipe
const DOT_R = 0.32;      // metres: about 6 px at the storage pose

type V = THREE.Vector3;
type Host = {
  scene: THREE.Scene; box: THREE.Box3; anchors: { roof: V; home: V; batt: V; grid: V };
  sunGroup: THREE.Group; sunDot: THREE.Mesh; kit: THREE.Group; batteryBox: THREE.Object3D; wallbox: THREE.Object3D | null; wbOn: boolean;
  panels: THREE.Group; opts: { reduce?: boolean }; shade: { at?: ShadeAt };
  sunPos: (h: number) => V; flyTo: (p: Pose) => void; xray: { set: (e: Envelope | null) => unknown };
  setLabels: (l: unknown[]) => void;
};

// A smooth day: solar from 06:00 to 20:00 peaking at 13:00; the house uses a little all day, more at breakfast and
// in the evening. Units are shares of the solar peak; only the shape matters on screen.
const bump = (h: number, c: number, w: number) => Math.exp(-(((h - c) / w) ** 2));
const pvAt = (h: number) => Math.max(0, Math.sin((Math.PI * (h - 6)) / 14));
const loadAt = (h: number) => 0.18 + 0.35 * bump(h, 7.5, 1.2) + 0.55 * bump(h, 19.5, 1.8);

class Pipe {
  readonly line: THREE.Line;
  readonly dots: THREE.InstancedMesh;
  private u = 0;
  constructor(private curve: THREE.Curve<V>, color: THREE.Color, r = DOT_R) {
    const g = new THREE.BufferGeometry().setFromPoints(curve.getPoints(48));
    this.line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: PIPE, transparent: true, opacity: 0.55 }));
    this.dots = new THREE.InstancedMesh(new THREE.SphereGeometry(r, 10, 8), new THREE.MeshBasicMaterial({ color }), DOTS);
    this.dots.frustumCulled = false;
    this.step(0, 0);
  }
  // rate: 0 (nothing flows, dots hidden) to 1 (full flow, dots travel the pipe in about 2.5 s).
  step(dt: number, rate: number, still = false) {
    if (!still) this.u = (this.u + (dt * rate) / 2.5) % 1;
    const m = new THREE.Matrix4(), s = rate > 0.04 ? 0.55 + 0.45 * Math.min(1, rate) : 0;
    for (let i = 0; i < DOTS; i++) {
      const p = this.curve.getPointAt((this.u + i / DOTS) % 1);
      m.makeScale(s, s, s).setPosition(p);
      this.dots.setMatrixAt(i, m);
    }
    this.dots.instanceMatrix.needsUpdate = true;
  }
  dispose() { this.line.geometry.dispose(); (this.line.material as THREE.Material).dispose(); this.dots.geometry.dispose(); (this.dots.material as THREE.Material).dispose(); }
}

function straight(a: V, b: V, y = 0.35): THREE.CurvePath<V> {
  const p = new THREE.CurvePath<V>();
  const pts = [a.clone(), new THREE.Vector3(a.x, y, a.z), new THREE.Vector3(b.x, y, b.z), b.clone()];
  for (let i = 0; i < pts.length - 1; i++) if (pts[i].distanceTo(pts[i + 1]) > 1e-3) p.add(new THREE.LineCurve3(pts[i], pts[i + 1]));
  return p;
}

export class Systems {
  sys: System | null = null;
  private g = new THREE.Group();
  private battery = new THREE.Group();
  private charge = new THREE.Group();
  private pipes: Partial<Record<"pvHome" | "pvBatt" | "battHome" | "gridBox" | "boxCar", Pipe>> = {};
  private car = new THREE.Group();
  private plug: THREE.Mesh | null = null; // the charging cable from the wallbox to the parked car
  private carAt = new THREE.Vector3(); private carV = new THREE.Vector3(); private carGoal = new THREE.Vector3();
  private carMoving = false;
  private h = 6; private soc = 0.2;
  private env: Envelope | null = null;

  constructor(private host: Host) {
    this.g.add(this.battery, this.charge, this.car);
    this.g.visible = true; this.battery.visible = false; this.charge.visible = false; this.car.visible = false;
    host.scene.add(this.g);
  }

  setEnvelope(env: Envelope | null) { this.env = env; if (this.sys === "heatpump") this.host.setLabels(this.host.xray.set(env) as unknown[]); }

  // The house changed (a new model): rebuild the pipes and the car's parking spot from the new anchors.
  rebuild() {
    this.onTop = false; // new panel meshes: override() applies the Heat pump draw order again
    Object.values(this.pipes).forEach((p) => p?.dispose());
    this.pipes = {};
    this.battery.clear(); this.charge.clear(); // the car is disposed and rebuilt below
    const { anchors: A, box } = this.host;
    if (box.isEmpty()) return;
    const home = A.home.clone().setY(0.6);
    const mk = (k: keyof Systems["pipes"], c: THREE.Curve<V>, col: THREE.Color, into: THREE.Group, r = DOT_R) => { const p = new Pipe(c, col, r); this.pipes[k] = p; into.add(p.line, p.dots); return p; };
    // Inside the glass: the battery stands against the inner face of the south wall, so the flows run down inside
    // the house at the battery's depth, beside it, and into the top of its tower; nothing runs outside at ground level.
    const bb = this.host.batteryBox ? new THREE.Box3().setFromObject(this.host.batteryBox) : null;
    const top = bb && !bb.isEmpty() ? bb.max.y : 1.5, zIn = A.batt.z, bx = A.batt.x;
    const eave = Math.max(box.min.y + 2.5, A.roof.y - 2), side = bx - 0.75; // left of the tower: the inverter hangs on its right
    const line = (pts: V[]) => { const c = new THREE.CurvePath<V>(); for (let i = 0; i < pts.length - 1; i++) if (pts[i].distanceTo(pts[i + 1]) > 1e-3) c.add(new THREE.LineCurve3(pts[i], pts[i + 1])); return c; };
    const Q = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    const homeIn = Q(home.x, 0.6, zIn);
    mk("pvHome", line([A.roof.clone(), Q(home.x, eave, zIn), homeIn]), SOLAR, this.battery);
    mk("pvBatt", line([A.roof.clone(), Q(side, eave, zIn), Q(side, top + 0.45, zIn), Q(bx, top + 0.45, zIn), Q(bx, top + 0.1, zIn)]), SOLAR, this.battery);
    mk("battHome", line([Q(side, 0.75, zIn), homeIn.clone().setY(0.75), homeIn]), BATT, this.battery);

    // The car (kitMeshes.ts): a low-poly hatchback parked on the drive beside the wallbox, nose to the north, its
    // charging flap level with the wall unit. The cable runs from the unit down the wall and across to the flap.
    this.car.traverse((o) => { const m = o as THREE.Mesh; m.geometry?.dispose(); (m.material as THREE.Material | undefined)?.dispose?.(); });
    this.car.clear();
    this.car.add(car());
    const wbObj = this.host.wallbox;
    wbObj?.updateWorldMatrix(true, false);
    const out = wbObj ? WALLBOX_OUTLET.clone().applyMatrix4(wbObj.matrixWorld) : new THREE.Vector3(box.max.x + 0.1, 1.05, box.max.z - 1.5);
    this.carGoal.set(out.x + 0.9 + CAR.w / 2, 0, out.z - CAR_PORT.z);
    const port = this.carGoal.clone().add(CAR_PORT);
    // Power reaches the unit from inside: the house pipe stops in the wall behind it, and the car's dots run along
    // the cable itself, small enough to sit on it, starting below the unit, so nothing covers the wallbox.
    const P = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    const c = wbObj ? wbObj.position : out, behind = P(c.x - WALLBOX.d / 2 - 0.2, c.y + WALLBOX.h / 2, c.z); // inside, behind the unit
    mk("gridBox", straight(A.home.clone().setY(1.2).setX(box.max.x - 0.2), behind, 1.2), EV, this.charge, 0.12);
    // The cable: from the holster's foot straight down the wall a hand's width out, along the drive, up to the flap.
    const path = [out, P(out.x + 0.06, out.y - 0.25, out.z), P(out.x + 0.08, 0.2, out.z), P(out.x + 0.3, 0.03, out.z), P(port.x - 0.4, 0.03, port.z), P(port.x - 0.12, 0.45, port.z), port];
    mk("boxCar", new THREE.CatmullRomCurve3(path.slice(2)), EV, this.charge, 0.09).line.visible = false;
    if (this.plug) { this.plug.removeFromParent(); this.plug.geometry.dispose(); (this.plug.material as THREE.Material).dispose(); }
    this.plug = cable(path, 0.02);
    this.g.add(this.plug);
    this.place(this.sys === "wallbox");
  }

  // Parked (instant), or about to arrive from the street 12 m south of the drive.
  private place(parked: boolean) {
    if (parked || this.host.opts.reduce) { this.carAt.copy(this.carGoal); this.carMoving = false; }
    else { this.carAt.copy(this.carGoal).add(new THREE.Vector3(0, 0, 12)); this.carMoving = true; }
    this.carV.set(0, 0, 0);
    this.car.position.copy(this.carAt);
    this.plugged();
  }
  // The cable reaches the car once it is parked in the Wallbox view; until then it hangs in its loop on the unit.
  private plugged() {
    const on = this.sys === "wallbox" && !this.carMoving && this.host.wbOn;
    if (this.plug) this.plug.visible = on;
    const loop = this.host.wallbox?.getObjectByName("loop");
    if (loop) loop.visible = !on;
  }

  set(sys: System | null) {
    const prev = this.sys;
    this.sys = sys;
    if (!Object.keys(this.pipes).length) this.rebuild();
    const H = this.host;
    if (prev === "heatpump" && sys !== "heatpump") H.xray.set(null);
    if (sys === "wallbox" && prev !== "wallbox") this.place(false);
    if (sys === "battery" && prev !== "battery") { this.h = 6; this.soc = 0.2; }
    this.override();
    if (sys === "heatpump") H.setLabels(H.xray.set(this.env) as unknown[]);
    // Heat pump: the high angle from the south, so both roof faces and their modules read under the x-ray.
    const pose = sys === "panels" ? POSES.solar : sys === "battery" ? POSES.storage : sys === "wallbox" ? POSES.extras : sys === "heatpump" ? POSES.heat : null;
    if (pose) H.flyTo(pose);
  }

  // Applied after the scene's own show(): what each system must have on screen. The panels are never touched.
  override() {
    const H = this.host, s = this.sys;
    this.battery.visible = s === "battery";
    this.charge.visible = s === "wallbox" && H.wbOn;
    this.car.visible = s === "wallbox" && H.wbOn;
    if (H.batteryBox) H.batteryBox.visible = s !== "wallbox" && s !== "panels" && s !== "heatpump";
    if (!s) { this.panelsOnTop(false); return; }
    H.panels.visible = true; // the kit is the same in every system
    this.panelsOnTop(s === "heatpump");
    H.sunGroup.visible = s === "panels" || s === "battery";
    H.kit.visible = s === "battery" || s === "wallbox";
    if (H.wallbox) H.wallbox.visible = H.wbOn;
    this.plugged();
  }

  // Heat pump: the x-ray roof fill sits 3 cm under the modules and wins the depth fight, and the far roof face hides its
  // modules from this pose. The panels draw last and through the shell (transparent pass, still fully opaque, no depth
  // test), so all of them show under the x-ray. Undone on leaving.
  private onTop = false;
  private panelsOnTop(on: boolean) {
    if (on === this.onTop) return;
    this.onTop = on;
    this.host.panels.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh && !(o as THREE.LineSegments).isLineSegments) return;
      const u = o.userData as { ro?: number; tr?: boolean };
      const mats = ([] as THREE.Material[]).concat((m.material as THREE.Material | THREE.Material[]) ?? []);
      if (on) { u.ro = o.renderOrder; u.tr = mats.some((x) => x.transparent); o.renderOrder = 10; mats.forEach((x) => { x.transparent = true; x.depthTest = false; x.needsUpdate = true; }); }
      else { o.renderOrder = u.ro ?? 0; mats.forEach((x) => { x.transparent = !!u.tr; x.depthTest = true; x.needsUpdate = true; }); }
    });
  }

  frame(dt: number) {
    const s = this.sys, H = this.host, still = !!H.opts.reduce;
    if (s === "panels") {
      const h = H.shade.at?.h ?? 13;
      H.sunDot.visible = h > 6 && h < 20;
      H.sunDot.position.copy(H.sunPos(h));
    } else if (s === "battery") {
      if (still) this.h = 13; else {
        this.h += (dt * 24) / DAY_S;
        if (this.h >= 30) { this.h -= 24; this.soc = 0.2; }
      }
      const h = this.h % 24, pv = pvAt(h), load = loadAt(h);
      const direct = Math.min(pv, load), spare = Math.max(0, pv - load), need = Math.max(0, load - pv);
      const charge = this.soc < 1 ? spare : 0, discharge = this.soc > 0.05 ? need : 0;
      if (!still) this.soc = Math.min(1, Math.max(0, this.soc + ((charge - discharge) * dt * 24) / DAY_S / 3.5));
      H.sunDot.visible = pv > 0;
      if (pv > 0) H.sunDot.position.copy(H.sunPos(h));
      this.pipes.pvHome?.step(dt, direct * 1.6, still);
      this.pipes.pvBatt?.step(dt, charge * 1.6, still);
      this.pipes.battHome?.step(dt, discharge * 1.6, still);
    } else if (s === "wallbox") {
      if (this.carMoving) {
        this.carMoving = !springStep(this.carAt, this.carV, this.carGoal, dt);
        this.car.position.copy(this.carAt);
        if (!this.carMoving) this.plugged();
      }
      // Charging runs once the car is in: overnight, from the house through the wallbox into the car.
      const rate = this.carMoving ? 0 : 0.8;
      this.pipes.gridBox?.step(dt, rate, still);
      this.pipes.boxCar?.step(dt, rate, still);
    }
  }

  dispose() {
    Object.values(this.pipes).forEach((p) => p?.dispose());
    this.car.traverse((o) => { const m = o as THREE.Mesh; m.geometry?.dispose(); (m.material as THREE.Material | undefined)?.dispose?.(); });
    if (this.plug) { this.plug.geometry.dispose(); (this.plug.material as THREE.Material).dispose(); }
    this.g.removeFromParent();
  }
}
// Exposed for the systems' colours elsewhere (legends, chips).
export const SYSTEM_COLOURS = { solar: `#${SOLAR.getHexString()}`, battery: `#${BATT.getHexString()}`, ev: `#${EV.getHexString()}`, grid: `#${GRID.getHexString()}` };
