// The kit's physical parts, built once here so the 3D scene and the parts-list icons are the same objects:
// scene.ts places them on the house (with its ink edges), scripts/render-kit-icons.mjs renders them into
// public/kit/*.png. Sizes in metres, three's axes (x east, y up, z south); each part stands on y = 0 with its
// front face towards +z. Lambert boxes in the scene's paper colours, the modules' dark fill as on the roof.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

export const KIT = {
  paper: "#FAF8F3", // battery housing (the scene's battery colour)
  slate: "#596070", // inverter housing
  unit: "#E9E6DF",  // heat pump and cabinet housings, a shade darker so they read against the wall
  dark: "#151826",  // module fill and displays, the roof panels' colour
  frame: "#F4F1EA", // module frame, the roof panels' frame line
  seam: "#3A3D47",  // gaps between battery modules, the heat pump's fan grille
  ev: "#1c71ef",    // the wallbox's charging light and the EV pipes
  car: "#C4C7CE",   // the car body, a neutral grey
};

const lam = (color: string) => new THREE.MeshLambertMaterial({ color });
const box = (w: number, h: number, d: number, m: THREE.Material, x = 0, y = h / 2, z = 0) => {
  const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  b.position.set(x, y, z);
  return b;
};

// A module as it lies on the roof: the dark cell field inside its light frame. A stack of `layers` of them.
export const MODULE = { w: 1.13, d: 1.72, t: 0.05 };
export function moduleStack(layers: number): THREE.Group {
  const g = new THREE.Group(), frame = lam(KIT.frame), cells = new THREE.MeshBasicMaterial({ color: KIT.dark });
  const gap = 0.07;
  for (let i = 0; i < layers; i++) {
    const y = i * (MODULE.t + gap);
    g.add(box(MODULE.w, MODULE.t, MODULE.d, frame, 0, y + MODULE.t / 2));
    const top = new THREE.Mesh(new THREE.PlaneGeometry(MODULE.w - 0.08, MODULE.d - 0.08), cells);
    top.rotation.x = -Math.PI / 2;
    top.position.y = y + MODULE.t + 0.002;
    g.add(top);
  }
  return g;
}

// The battery as it stands beside the house: the scene's 0.9 by 0.6 m footprint. modules = 0 gives the scene's
// single 1.5 m box (its colour changes when the battery step lights it); 1 to 6 gives a tower of 0.25 m modules
// under a cap (the parts list's bands, KitSheet.tsx).
export const BATTERY = { w: 0.9, h: 1.5, d: 0.6 };
export function battery(modules = 0): THREE.Mesh | THREE.Group {
  if (!modules) return box(BATTERY.w, BATTERY.h, BATTERY.d, lam(KIT.paper));
  const g = new THREE.Group(), body = lam(KIT.paper), seam = lam(KIT.seam), mh = 0.25, sh = 0.018;
  let y = 0.04;
  g.add(box(BATTERY.w - 0.06, 0.04, BATTERY.d - 0.06, seam, 0, 0.02)); // plinth
  for (let i = 0; i < modules; i++) {
    g.add(box(BATTERY.w, mh, BATTERY.d, body, 0, y + mh / 2));
    y += mh;
    g.add(box(BATTERY.w - 0.04, sh, BATTERY.d - 0.04, seam, 0, y + sh / 2));
    y += sh;
  }
  g.add(box(BATTERY.w, 0.08, BATTERY.d, body, 0, y + 0.04)); // cap
  return g;
}

// A charging cable through the given points (metres, local frame).
export function cable(pts: THREE.Vector3[], r = 0.016): THREE.Mesh {
  return new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), Math.max(24, pts.length * 12), r, 8), lam(KIT.seam));
}

// The wallbox: a small rounded unit for the wall (its base at y = 0, its back at z = -d/2), a dark front panel
// with the blue charging light, and the cable hanging in a loop to the plug holster at its side. The loop is a
// child named "loop", hidden while the cable runs to a parked car.
export const WALLBOX = { w: 0.32, h: 0.42, d: 0.13 };
export function wallbox(): THREE.Group {
  const g = new THREE.Group(), W = WALLBOX;
  const body = new THREE.Mesh(new RoundedBoxGeometry(W.w, W.h, W.d, 4, 0.045), lam(KIT.paper));
  body.position.y = W.h / 2;
  const face = new THREE.Mesh(new RoundedBoxGeometry(W.w - 0.07, W.h - 0.11, 0.014, 3, 0.006), new THREE.MeshBasicMaterial({ color: KIT.dark }));
  face.position.set(0, W.h / 2 + 0.015, W.d / 2 - 0.002);
  const led = box(0.13, 0.022, 0.012, new THREE.MeshBasicMaterial({ color: KIT.ev }), 0, W.h - 0.1, W.d / 2 + 0.008);
  const holster = box(0.05, 0.08, 0.06, lam(KIT.seam), W.w / 2 + 0.035, 0.13, 0.0);
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const loop = cable([V(0, 0.02, 0.01), V(0.02, -0.13, 0.05), V(0.12, -0.22, 0.07), V(0.23, -0.15, 0.05), V(W.w / 2 + 0.035, 0.09, 0.01)]);
  loop.name = "loop";
  g.add(body, face, led, holster, loop);
  return g;
}
// Where the cable leaves the unit, in the wallbox's own frame: the foot of the plug holster at its side.
export const WALLBOX_OUTLET = new THREE.Vector3(WALLBOX.w / 2 + 0.035, 0.09, 0.01);

// The car: a low-poly hatchback, an extruded side profile with a glass band and four wheels, in a neutral grey.
// Wheels on y = 0, centred, nose towards -z. CAR_PORT is the charging flap on its left front wing (the -x side).
export const CAR = { l: 4.1, w: 1.78, h: 1.5 };
export const CAR_PORT = new THREE.Vector3(-(CAR.w / 2 + 0.05), 0.86, -1.3);
export function car(): THREE.Group {
  const { l, w } = CAR, bev = 0.04;
  const shape = (pts: [number, number][]) => new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const side = new THREE.Group(); // built along +x (rear at 0, nose at l), across z
  const bodyGeo = new THREE.ExtrudeGeometry(shape([[0, 0.32], [l, 0.32], [l + 0.02, 0.62], [l - 0.1, 0.78], [3.2, 0.95], [2.45, 1.45], [0.55, 1.48], [0.1, 1.15], [0, 0.9]]),
    { depth: w - 2 * bev, bevelEnabled: true, bevelThickness: bev, bevelSize: bev, bevelSegments: 2 });
  bodyGeo.translate(-l / 2, 0, -(w - 2 * bev) / 2);
  const glassGeo = new THREE.ExtrudeGeometry(shape([[3.19, 1.0], [2.59, 1.417], [0.75, 1.42], [0.32, 1.12], [0.4, 1.0]]), { depth: w + 0.02, bevelEnabled: false });
  glassGeo.translate(-l / 2, 0, -(w + 0.02) / 2);
  side.add(new THREE.Mesh(bodyGeo, lam(KIT.car)), new THREE.Mesh(glassGeo, new THREE.MeshBasicMaterial({ color: KIT.dark })));
  const tyre = lam(KIT.seam);
  for (const x of [0.8, 3.3]) for (const z of [-1, 1]) {
    const wh = new THREE.Mesh(new THREE.CylinderGeometry(0.33, 0.33, 0.22, 20), tyre);
    wh.rotation.x = Math.PI / 2;
    wh.position.set(x - l / 2, 0.33, z * (w / 2 - 0.12));
    side.add(wh);
  }
  side.rotation.y = Math.PI / 2; // +x (the nose) turns to -z
  const g = new THREE.Group();
  g.add(side);
  return g;
}

// The inverter: a wall-mounted slate housing with a light display near the top, so it reads apart from the
// paper battery beside it (and through the glass walls).
export const INVERTER = { w: 0.5, h: 0.65, d: 0.2 };
export function inverter(): THREE.Group {
  const g = new THREE.Group();
  g.add(box(INVERTER.w, INVERTER.h, INVERTER.d, lam(KIT.slate)));
  g.add(box(0.26, 0.09, 0.01, new THREE.MeshBasicMaterial({ color: KIT.frame }), 0, INVERTER.h - 0.16, INVERTER.d / 2 + 0.005));
  return g;
}

// The heat pump outdoor unit: a housing on two feet, its fan grille on the left of the front face.
export const HEATPUMP = { w: 1.0, h: 0.78, d: 0.4 };
export function heatPump(): THREE.Group {
  const g = new THREE.Group(), body = lam(KIT.unit), seam = lam(KIT.seam), foot = 0.08;
  g.add(box(0.08, foot, HEATPUMP.d, seam, -0.36, foot / 2), box(0.08, foot, HEATPUMP.d, seam, 0.36, foot / 2));
  g.add(box(HEATPUMP.w, HEATPUMP.h - foot, HEATPUMP.d, body, 0, foot + (HEATPUMP.h - foot) / 2));
  const fan = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.02, 40), seam);
  fan.rotation.x = Math.PI / 2;
  fan.position.set(-0.17, foot + (HEATPUMP.h - foot) / 2, HEATPUMP.d / 2 + 0.01);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.03, 24), body);
  hub.rotation.x = Math.PI / 2;
  hub.position.copy(fan.position).setZ(HEATPUMP.d / 2 + 0.02);
  g.add(fan, hub);
  return g;
}

// The meter cabinet, standing for mounting, cabling and the grid connection (parts list only).
export function cabinet(): THREE.Group {
  const g = new THREE.Group(), body = lam(KIT.unit);
  g.add(box(0.6, 1.0, 0.25, body));
  g.add(box(0.36, 0.2, 0.01, new THREE.MeshBasicMaterial({ color: KIT.dark }), 0, 0.78, 0.13));
  g.add(box(0.012, 0.98, 0.012, lam(KIT.seam), 0, 0.5, 0.13)); // door seam
  return g;
}

// The scene's ink edges round every box of a part (the icons go without).
export function withEdges<T extends THREE.Object3D>(o: T, ink: string): T {
  const mat = new THREE.LineBasicMaterial({ color: ink });
  const meshes: THREE.Mesh[] = [];
  o.traverse((c) => { if ((c as THREE.Mesh).isMesh && (c as THREE.Mesh).geometry.type === "BoxGeometry") meshes.push(c as THREE.Mesh); });
  meshes.forEach((m) => m.add(new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), mat)));
  return o;
}
