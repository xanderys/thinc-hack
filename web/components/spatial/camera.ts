// Camera poses for the reasoning chain: each stage looks at the part of the house it explains.
// az: compass bearing from the focus to the camera (0 north, 90 east, 180 south); el: degrees above the horizon;
// dist: multiple of the scene's fitted distance. topDown ends in the 2D orthographic plan, north up.
import * as THREE from "three";

export type Focus = "roof" | "house" | "drive" | "battery" | "wallbox" | "west";
// unit: a close view of that unit on its own wall (scene.ts unitGoal), not a bearing round the house.
export type Pose = { focus: Focus; az: number; el: number; dist: number; topDown?: boolean; unit?: "battery" | "wallbox" | "heatpump" };

export const STAGE_VIEWS = ["site", "load", "future", "solar", "storage", "extras", "heatpump", "heat", "sanity", "offer"] as const;
export type StageView = (typeof STAGE_VIEWS)[number];

export const POSES: Record<StageView, Pose> = {
  site: { focus: "roof", az: 135, el: 38, dist: 0.85 },          // three-quarter from the south-east, roof dominant
  load: { focus: "house", az: 150, el: 30, dist: 1.25 },         // pull back, street context
  future: { focus: "drive", az: 135, el: 50, dist: 0.72 },       // pan to the drive and the boiler wall
  solar: { focus: "roof", az: 110, el: 45, dist: 0.8 },          // look down the roof planes
  storage: { focus: "battery", az: 200, el: 48, dist: 0.72 },     // pull back and tilt so the battery block reads
  extras: { focus: "wallbox", az: 120, el: 44, dist: 0.72 },     // the wallbox at the drive
  heatpump: { focus: "west", az: 250, el: 40, dist: 1.05 },       // the heat pump wall, pulled back so the envelope x-ray reads whole
  // The view stays 3D on every stage: the old top-down pins are a high angle from the south, north up.
  heat: { focus: "house", az: 180, el: 52, dist: 1.1 },
  sanity: { focus: "house", az: 180, el: 52, dist: 1.1 },
  offer: { focus: "house", az: 180, el: 52, dist: 1.1 },
};

// Battery, Wallbox and Heat pump chips move close to the wall where their unit stands, at eye height (scene.ts
// unitGoal), never the top-down roof view: the battery (indoors) and the heat pump by the south wall, the wallbox on
// the east wall. az, el and dist are the fallback before the unit exists.
export const UNIT_POSES: Record<"battery" | "wallbox" | "heatpump", Pose> = {
  battery: { focus: "battery", az: 195, el: 26, dist: 0.75, unit: "battery" },
  wallbox: { focus: "wallbox", az: 105, el: 24, dist: 0.75, unit: "wallbox" },
  heatpump: { focus: "battery", az: 210, el: 26, dist: 0.85, unit: "heatpump" },
};

// Chain stage (1 to 8) to its pose; EXTRAS shows the wallbox first, the heat pump wall on a second call.
export const stageView = (stage: number): StageView =>
  (["site", "load", "future", "solar", "storage", "extras", "sanity", "offer"] as const)[Math.min(8, Math.max(1, stage)) - 1];

export function poseOffset(p: Pose) {
  const az = (p.az * Math.PI) / 180, el = (Math.min(p.el, 89.5) * Math.PI) / 180;
  // three: x east, y up, z south.
  return new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
}

// Critically damped spring, perceptual duration 0.6 s, bounce 0; keeps velocity when retargeted.
const OMEGA = (2 * Math.PI) / 0.5;   // 0.5 s, bounce 0
export function springStep(x: THREE.Vector3, v: THREE.Vector3, goal: THREE.Vector3, dt: number) {
  // Exact step of x'' = -w^2 (x - g) - 2w x': e(t) = (e0 + c t) e^-wt, v(t) = (c - w (e0 + c t)) e^-wt, c = v0 + w e0.
  const e0 = x.clone().sub(goal), k = Math.exp(-OMEGA * dt);
  const c = v.clone().addScaledVector(e0, OMEGA);
  const et = e0.clone().addScaledVector(c, dt);
  v.copy(c.clone().addScaledVector(et, -OMEGA).multiplyScalar(k));
  et.multiplyScalar(k);
  x.copy(goal).add(et);
  return et.length() < 0.01 && v.length() < 0.02;
}

// Orbit momentum after a flick. The release velocity is kept (no jump, no bounce, capped at MAX) and then decays with
// friction: below FLICK nothing happens, up to REVOLVE it coasts to a stop in about 1.5 s, above REVOLVE it eases into a
// slow turntable (one turn in 12 s, the flick's direction). Reduce Motion: never the turntable, only the decay.
export const FLICK = 1.2;                   // rad/s
export const REVOLVE = 4;                   // rad/s
export const MAX = 15;                      // rad/s: a hard flick turns about one more time before the turntable
export const TURN = (2 * Math.PI) / 12;     // rad/s, turntable
const TAU = 0.4;                            // s, friction time constant: 4 rad/s falls below 0.03 in about 2 s
const STOP = 0.03;                          // rad/s
export type Coast = { w: number; revolve: boolean };
export type Sample = { t: number; x: number };

// Azimuth rate (rad/s, the sign OrbitControls' theta takes) from the pointer samples of the last 100 ms, widened to the
// one before when a slow device sent fewer (within 200 ms). OrbitControls turns 2 pi per canvas height of horizontal
// drag. A finger that rested for 80 ms before lifting has no flick.
export function releaseRate(s: Sample[], now: number, height: number): number {
  const last = s[s.length - 1];
  if (!last || now - last.t > 80) return 0;
  let i = s.findIndex((p) => last.t - p.t <= 100);
  if (i === s.length - 1 && i > 0 && last.t - s[i - 1].t <= 200) i--;
  const first = s[i], dt = (last.t - first.t) / 1000;
  if (dt < 0.016) return 0;
  return (-2 * Math.PI * (last.x - first.x)) / height / dt;
}

export function startCoast(w: number, reduce: boolean): Coast | null {
  if (!Number.isFinite(w) || Math.abs(w) < FLICK) return null;
  return { w: Math.sign(w) * Math.min(Math.abs(w), MAX), revolve: !reduce && Math.abs(w) > REVOLVE };
}

// Exact exponential step towards 0, or towards the turntable rate; false once it has stopped.
export function stepCoast(c: Coast, dt: number): boolean {
  const goal = c.revolve ? Math.sign(c.w) * TURN : 0;
  c.w = goal + (c.w - goal) * Math.exp(-dt / TAU);
  return c.revolve || Math.abs(c.w) > STOP;
}
