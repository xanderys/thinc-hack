// The kit's physical parts, built once here so the 3D scene and the parts-list icons are the same objects:
// scene.ts places them on the house (with its ink edges), scripts/render-kit-icons.mjs renders them into
// public/kit/*.png. Sizes in metres, three's axes (x east, y up, z south); each part stands on y = 0 with its
// front face towards +z. Lambert boxes in the scene's paper colours, the modules' dark fill as on the roof.
import * as THREE from "three";

export const KIT = {
  paper: "#FAF8F3", // battery and inverter housings (the scene's battery colour)
  unit: "#E9E6DF",  // heat pump and cabinet housings, a shade darker so they read against the wall
  dark: "#151826",  // module fill and displays, the roof panels' colour
  frame: "#F4F1EA", // module frame, the roof panels' frame line
  seam: "#3A3D47",  // gaps between battery modules, the heat pump's fan grille
  ev: "#1c71ef",    // the wallbox
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

// The wallbox: the scene's EV-blue box on the wall by the drive.
export const WALLBOX = { w: 0.45, h: 0.6, d: 0.2 };
export const wallbox = () => box(WALLBOX.w, WALLBOX.h, WALLBOX.d, lam(KIT.ev));

// The inverter: a wall-mounted housing with a dark display near the top.
export const INVERTER = { w: 0.5, h: 0.65, d: 0.2 };
export function inverter(): THREE.Group {
  const g = new THREE.Group();
  g.add(box(INVERTER.w, INVERTER.h, INVERTER.d, lam(KIT.paper)));
  g.add(box(0.26, 0.09, 0.01, new THREE.MeshBasicMaterial({ color: KIT.dark }), 0, INVERTER.h - 0.16, INVERTER.d / 2 + 0.005));
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
