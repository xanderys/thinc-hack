// Google Photorealistic 3D Tiles as the 3D view, with our layout drawn on them.
// Loaded with a dynamic import together with three. The tiles come through /api/tiles (key on the server).
//
// Frame: ReorientationPlugin puts the house's lat/lon/height at the origin with +Y up, east → -X, north → +Z.
// Our scene is UTM grid: east → +X, grid north → -Z, and grid north sits beta clockwise of true north.
// So the tiles sit in a holder rotated by pi + beta about Y; after that, local metres from the engine line up.
//
// Alignment: the anchor puts the mesh within a few metres of our LoD2 house. Once the house's tiles are in, a
// height map of the mesh over the house is compared with the LoD2 roof planes; the horizontal and vertical shift
// that best fits the roof moves the mesh onto our frame. Then each module is draped: moved along the vertical onto
// the mesh roof under it, so modules sit on the real roof. Our LoD2 house, ground and neighbours hide in mesh mode;
// modules, markers, outlines and labels stay.
import * as THREE from "three";
import { TilesRenderer, WGS84_ELLIPSOID } from "3d-tiles-renderer/three";
import { GLTFExtensionsPlugin, LoadRegionPlugin, ReorientationPlugin, SphereRegion } from "3d-tiles-renderer/plugins";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import type { SpatialScene } from "./scene";
import type { RoofPlane } from "./types";

export type Anchor = { lat: number; lon: number; height: number; beta: number; geoid?: number };
export type Fit = { dx: number; dy: number; dz: number; spread: number; samples: number; draped: number; skipped: number };

// The aligned frame of the mesh, for other layers (the white context mask): one object, updated in place.
// Scene frame: three.js metres, x east, y up, z south (engine local (x, y, z) → (x, z, -y)), origin = the engine's
// origin_utm32. footprint: the house outline in engine local metres [x east, y north] (hull of its roof planes).
export type MeshFrame = {
  anchor: Anchor | null;          // lat, lon (radians), ellipsoidal height (m), beta (UTM grid convergence), geoid (m)
  rotationY: number;              // holder rotation about +Y: pi + beta
  offset: [number, number, number]; // holder translation after the fit (scene metres), i.e. -(dx, dy, dz)
  fit: Fit | null;
  footprint: [number, number][];
  holder: THREE.Group | null;     // the group the tiles live in; its matrixWorld maps tile-local to scene
  version: number;                // bumps whenever any of the above changes
};
export const meshFrame: MeshFrame = { anchor: null, rotationY: 0, offset: [0, 0, 0], fit: null, footprint: [], holder: null, version: 0 };

function hull(pts: [number, number][]) {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: [number, number][] = [], up: [number, number][] = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of [...p].reverse()) { while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
type Inner = {
  scene: THREE.Scene; renderer: THREE.WebGLRenderer; camera: THREE.Camera;
  placeholder: THREE.Object3D; glbRoot?: THREE.Object3D | null; box: THREE.Box3; panels: THREE.Group;
  targets: { p: RoofPlane }[];
};
type Opts = {
  root: string; anchor: Anchor; phone: boolean;
  onReady: () => void; onFail: (why: string) => void; onCredit: (text: string) => void;
};

const DRACO = "https://www.gstatic.com/draco/versioned/decoders/1.5.7/";
const RADIUS = 45;      // the mesh loads only this far around the house (metres), at full detail
const READY_MS = 6000;  // no mesh by then: the LoD2 model stays
const LIFT = 0.12;      // modules sit this far above the mesh roof

// A WebGL context that can show the photo mesh without choking.
export function photoCapable(sc: SpatialScene) {
  const c = (sc as unknown as Inner).renderer.capabilities;
  return c.isWebGL2 && c.maxTextureSize >= 4096;
}

// The LoD2 glb root in the scene: kept as glbRoot; else the group with walls, context or ground meshes.
function glbOf(inner: Inner): THREE.Object3D | null {
  if (inner.glbRoot) return inner.glbRoot;
  for (const o of inner.scene.children) {
    let hit = false;
    o.traverse((m) => { const n = (m.name || "").toLowerCase(); if ((m as THREE.Mesh).isMesh && (n.startsWith("walls") || n.startsWith("context") || n.startsWith("ground"))) hit = true; });
    if (hit) return o;
  }
  return null;
}

const toV = ([x, y, z]: [number, number, number]) => new THREE.Vector3(x, z, -y);
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };

// Points on the LoD2 roof planes: each fan triangle's centroid and the midpoints towards its corners.
function roofSamples(planes: RoofPlane[]) {
  const out: THREE.Vector3[] = [];
  for (const p of planes) {
    const pts = p.polygon.map(toV);
    if (pts.length < 3) continue;
    for (let i = 1; i < pts.length - 1; i++) {
      const c = pts[0].clone().add(pts[i]).add(pts[i + 1]).multiplyScalar(1 / 3);
      out.push(c);
      for (const q of [pts[0], pts[i], pts[i + 1]]) out.push(c.clone().lerp(q, 0.5));
    }
  }
  return out;
}

export class PhotoLayer {
  private inner: Inner;
  private tiles: TilesRenderer;
  private holder = new THREE.Group();
  private raf = 0;
  private timer: ReturnType<typeof setTimeout>;
  private early: ReturnType<typeof setTimeout> | undefined;
  private ready = false;
  private dead = false;
  private cam: THREE.Camera | null = null;
  private credits = new Map<string, number>();
  private creditText = "";
  private hidden: { o: THREE.Object3D; v: boolean }[] = [];
  private draco = new DRACOLoader().setDecoderPath(DRACO);
  private ray = new THREE.Raycaster();
  private fits = 0;
  private fitting = false;
  private panelsSeen: THREE.Object3D[] = [];
  fit: Fit | null = null;

  constructor(sc: SpatialScene, private o: Opts) {
    this.inner = sc as unknown as Inner;
    const { anchor } = o;
    const tiles = new TilesRenderer(new URL(o.root, window.location.href).href);
    this.tiles = tiles;
    tiles.errorTarget = o.phone ? 24 : 12;
    tiles.lruCache.minBytesSize = (o.phone ? 120 : 200) * 2 ** 20;
    tiles.lruCache.maxBytesSize = (o.phone ? 180 : 300) * 2 ** 20;
    tiles.registerPlugin(new ReorientationPlugin({ lat: anchor.lat, lon: anchor.lon, height: anchor.height, recenter: true }));
    tiles.registerPlugin(new GLTFExtensionsPlugin({ dracoLoader: this.draco }));
    const centre = WGS84_ELLIPSOID.getCartographicToPosition(anchor.lat, anchor.lon, anchor.height, new THREE.Vector3());
    const region = new LoadRegionPlugin();
    region.addRegion(new SphereRegion({ sphere: new THREE.Sphere(centre, RADIUS), mask: true, errorTarget: 1e9 }));
    tiles.registerPlugin(region);
    // The house itself loads at full detail whatever the camera sees, so the fit and the drape have the whole roof.
    tiles.addEventListener("load-root-tileset", () => {
      this.holder.updateMatrixWorld(true); this.collect();
      const b = this.inner.box.isEmpty() ? new THREE.Box3(new THREE.Vector3(-8, 0, -8), new THREE.Vector3(8, 9, 8)) : this.inner.box;
      const c = b.getCenter(new THREE.Vector3()), r = b.getSize(new THREE.Vector3()).length() / 2 + 6;
      const toEcef = tiles.group.matrixWorld.clone().invert();
      region.addRegion(new SphereRegion({ sphere: new THREE.Sphere(c.applyMatrix4(toEcef), r), errorTarget: 1.5 }));
    });

    this.holder.rotation.y = Math.PI + anchor.beta;
    this.publish();
    this.holder.add(tiles.group);
    this.holder.visible = false;
    this.inner.scene.add(this.holder);

    tiles.addEventListener("tiles-load-end", () => { void this.align(); });
    tiles.addEventListener("load-error", ({ error, tile }: { error: Error; tile: unknown }) => {
      if (!this.ready && !tile) this.fail(error?.message || "The photo tiles did not load.");
    });
    tiles.addEventListener("tile-visibility-change", ({ tile, visible }: { tile: { engineData?: { metadata?: { asset?: { copyright?: string } } } }; visible: boolean }) => {
      const c = tile.engineData?.metadata?.asset?.copyright;
      if (!c) return;
      c.split(";").map((x) => x.trim()).filter(Boolean).forEach((x) => {
        const n = (this.credits.get(x) ?? 0) + (visible ? 1 : -1);
        if (n > 0) this.credits.set(x, n); else this.credits.delete(x);
      });
    });

    this.timer = setTimeout(() => { if (!this.ready) this.fail("The photo mesh took too long."); }, READY_MS);
    // Do not wait for every detail tile: fit with what is in at 3.5 s, and again as the rest lands.
    this.early = setTimeout(() => { if (!this.ready) void this.align(); }, 3500);
    if (typeof window !== "undefined") (window as unknown as { __mesh?: PhotoLayer }).__mesh = this;
    this.loop();
  }

  private publish() {
    const pts = this.inner.targets.flatMap((t) => t.p.polygon.map(([x, y]) => [x, y] as [number, number]));
    const p = this.holder.position;
    Object.assign(meshFrame, {
      anchor: this.o.anchor, rotationY: this.holder.rotation.y, offset: [p.x, p.y, p.z], fit: this.fit,
      footprint: hull(pts), holder: this.holder, version: meshFrame.version + 1,
    });
  }

  private meshCount() { let n = 0; this.tiles.group.traverse((m) => { if ((m as THREE.Mesh).isMesh) n++; }); return n; }

  private meshList: THREE.Object3D[] = [];
  private collect() { this.meshList = []; this.tiles.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) this.meshList.push(o); }); }
  private down(x: number, z: number, from = 200): number | null {
    this.ray.set(new THREE.Vector3(x, from, z), new THREE.Vector3(0, -1, 0));
    this.ray.far = from + 100;
    // Plain mesh raycast: the tiles group's own raycast skipped whole tiles under our rotated holder.
    const h = this.ray.intersectObjects(this.meshList, false)[0];
    return h ? h.point.y : null;
  }

  // Fit the mesh to the LoD2 roof: a height map of the mesh over the house, then the shift (dx, dz) at which the
  // mesh heights under the LoD2 roof samples agree best (least median spread), and dy as their median difference.
  private async align() {
    if (this.dead || this.fitting || this.fits >= 3 || this.meshCount() === 0) return;
    this.fitting = true;
    try {
      const box = this.inner.box.isEmpty() ? new THREE.Box3(new THREE.Vector3(-8, 0, -8), new THREE.Vector3(8, 9, 8)) : this.inner.box;
      const S = 5, step = 1;
      const x0 = box.min.x - S, z0 = box.min.z - S, nx = Math.ceil((box.max.x - box.min.x + 2 * S) / step) + 1, nz = Math.ceil((box.max.z - box.min.z + 2 * S) / step) + 1;
      this.holder.updateMatrixWorld(true); this.collect();
      const H = new Float32Array(nx * nz).fill(NaN);
      for (let j = 0; j < nz; j++) {
        for (let i = 0; i < nx; i++) { const y = this.down(x0 + i * step, z0 + j * step); if (y != null) H[j * nx + i] = y; }
        if (j % 8 === 7) { await new Promise((r) => setTimeout(r, 0)); if (this.dead) return; }
      }
      const at = (x: number, z: number) => {
        const fi = (x - x0) / step, fj = (z - z0) / step, i = Math.floor(fi), j = Math.floor(fj);
        if (i < 0 || j < 0 || i >= nx - 1 || j >= nz - 1) return NaN;
        const a = H[j * nx + i], b = H[j * nx + i + 1], c = H[(j + 1) * nx + i], d = H[(j + 1) * nx + i + 1], u = fi - i, v = fj - j;
        return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
      };
      const pts = roofSamples(this.inner.targets.map((t) => t.p));
      if (pts.length < 6) { this.show(); return; }
      const score = (dx: number, dz: number) => {
        const r: number[] = [];
        for (const p of pts) { const h = at(p.x + dx, p.z + dz); if (!Number.isNaN(h)) r.push(h - p.y); }
        if (r.length < pts.length * 0.6) return { s: Infinity, dy: 0, n: r.length };
        const m = median(r);
        return { s: median(r.map((x) => Math.abs(x - m))), dy: m, n: r.length };
      };
      let best = { dx: 0, dz: 0, ...score(0, 0) };
      for (const [span, st] of [[4, 0.5], [0.5, 0.125]] as const) {
        const cx = best.dx, cz = best.dz;
        for (let dx = -span; dx <= span + 1e-6; dx += st) for (let dz = -span; dz <= span + 1e-6; dz += st) {
          const r = score(cx + dx, cz + dz);
          if (r.s < best.s - 1e-4) best = { dx: cx + dx, dz: cz + dz, ...r };
        }
      }
      if (Number.isFinite(best.s) && Math.abs(best.dy) < 25) {
        // Mesh point at (x + dx, z + dz) belongs at our (x, z): move the mesh by (-dx, -dy, -dz).
        this.holder.position.x -= best.dx; this.holder.position.z -= best.dz; this.holder.position.y -= best.dy;
        this.holder.updateMatrixWorld(true);
        const prev = this.fit;
        this.fit = { dx: (prev?.dx ?? 0) + best.dx, dy: (prev?.dy ?? 0) + best.dy, dz: (prev?.dz ?? 0) + best.dz, spread: best.s, samples: best.n, draped: 0, skipped: 0 };
        this.fits++;
        this.publish();
      }
      this.drape(true); this.publish();
      this.show();
    } finally { this.fitting = false; }
  }

  // Each module moves along the vertical onto the mesh roof under it (median of its corners and centre),
  // when that is within 1.5 m; otherwise it keeps the LoD2 roof height.
  private drape(force = false) {
    const kids = this.inner.panels.children;
    if (!force && kids.length === this.panelsSeen.length && kids.every((k, i) => k === this.panelsSeen[i])) return;
    this.panelsSeen = [...kids];
    if (!this.fit) return;
    let draped = 0, skipped = 0;
    this.holder.updateMatrixWorld(true); this.collect();
    for (const g of kids) {
      const cs = (g.userData?.cs as THREE.Vector3[] | undefined) ?? [];
      if (cs.length < 3) continue;
      const c = cs.reduce((a, b) => a.clone().add(b), new THREE.Vector3()).multiplyScalar(1 / cs.length);
      const d = [...cs, c].map((q) => { const y = this.down(q.x, q.z, q.y + 6); return y == null ? null : y + LIFT - q.y; }).filter((x): x is number => x != null);
      const m = d.length >= 3 ? median(d) : null;
      const ok = m != null && Math.abs(m) < 1.5;
      g.children.forEach((ch) => { ch.position.y = ok ? m! : 0; });
      if (ok) draped++; else skipped++;
    }
    this.fit = { ...this.fit, draped, skipped };
  }

  private show() {
    if (this.dead || this.ready) return;
    this.ready = true;
    clearTimeout(this.timer); clearTimeout(this.early);
    for (const x of [glbOf(this.inner), this.inner.placeholder]) if (x) { this.hidden.push({ o: x, v: x.visible }); x.visible = false; }
    this.holder.visible = true;
    this.o.onReady();
  }

  private fail(why: string) {
    if (this.dead) return;
    this.o.onFail(why);
  }

  private loop = () => {
    if (this.dead) return;
    this.raf = requestAnimationFrame(this.loop);
    const { camera, renderer } = this.inner;
    if (camera !== this.cam) {
      if (this.cam) this.tiles.deleteCamera(this.cam);
      this.tiles.setCamera(camera); this.cam = camera;
    }
    this.tiles.setResolutionFromRenderer(camera, renderer);
    camera.updateMatrixWorld();
    this.tiles.update();
    if (this.ready) this.drape();
    const text = [...this.credits.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k).join("; ");
    if (text !== this.creditText) { this.creditText = text; this.o.onCredit(text); }
  };

  dispose() {
    if (this.dead) return;
    this.dead = true;
    cancelAnimationFrame(this.raf);
    clearTimeout(this.timer); clearTimeout(this.early);
    const glb = glbOf(this.inner);
    this.hidden.forEach(({ o, v }) => { o.visible = o === this.inner.placeholder ? !glb : v; });
    if (glb) glb.visible = true;
    this.inner.panels.children.forEach((g) => g.children.forEach((ch) => { ch.position.y = 0; }));
    this.inner.scene.remove(this.holder);
    if (meshFrame.holder === this.holder) Object.assign(meshFrame, { anchor: null, fit: null, holder: null, offset: [0, 0, 0], version: meshFrame.version + 1 });
    this.tiles.dispose();
    this.draco.dispose();
  }
}
