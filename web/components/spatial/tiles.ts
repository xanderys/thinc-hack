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
import { WhiteContext } from "./whiteContext";
import { applyTileLod } from "./tileLod";

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
  outlines: THREE.Group; overlay: HTMLElement; setFitCap: (m: number | null) => void;
  targets: { p: RoofPlane }[]; ctxLines?: THREE.Group;
};
// desktop: a desktop browser; touch: iOS, iPadOS and visionOS Safari (tighter memory); phone: a small screen.
export type Profile = "desktop" | "touch" | "phone";
type Opts = {
  root: string; anchor: Anchor; profile: Profile; planes: RoofPlane[];
  onReady: () => void; onFail: (why: string) => void; onCredit: (text: string) => void; onSharp: () => void;
};

const DRACO = "https://www.gstatic.com/draco/versioned/decoders/1.5.7/";
const RADIUS = 60;      // the mesh loads only this far around the house (metres)
const HOUSE_ERR = 0.05; // geometric error target inside the house's sphere: the finest level Google has
const SHARP_ERR = 1;    // a house tile with children is sharp enough at or below this geometric error (metres)
const SHARP_MS = 15000; // sharpening takes longer than this: show the panels on what is there
const CLOSE = 40;       // fitted camera distance cap with the mesh on (metres): the landing pose ends about 34 m out
const SINK = 0.8;       // our ground plate drops this far under the mesh ground, which then shows
const FLAT = 0.5;       // neighbours' mesh is pressed down to this height above the ground
const DILATE = 1.5;     // metres added around each neighbour's outline before pressing
const READY_MS = 6000;  // no mesh by then: the LoD2 model stays
const LIFT = 0.12;      // modules sit this far above the mesh roof
// Far-field error target and tile cache (MB) per device; the house itself always refines to HOUSE_ERR.
const BUDGET: Record<Profile, { err: number; min: number; max: number }> = {
  desktop: { err: 12, min: 200, max: 320 },
  touch: { err: 16, min: 110, max: 180 },
  phone: { err: 20, min: 90, max: 150 },
};

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
  private frames = 0;
  private fitting = false;
  private panelsSeen: THREE.Object3D[] = [];
  fit: Fit | null = null;
  private white = new WhiteContext();
  private lodOff: () => void = () => {};

  constructor(sc: SpatialScene, private o: Opts) {
    this.inner = sc as unknown as Inner;
    this.inner.renderer.domElement.addEventListener("webglcontextlost", this.lost);
    const { anchor } = o;
    const tiles = new TilesRenderer(new URL(o.root, window.location.href).href);
    this.tiles = tiles;
    const budget = BUDGET[o.profile];
    tiles.errorTarget = budget.err;
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
      this.houseLocal = new THREE.Sphere(c.applyMatrix4(toEcef), r);
      region.addRegion(new SphereRegion({ sphere: this.houseLocal, errorTarget: HOUSE_ERR }));
    });

    this.holder.rotation.y = Math.PI + anchor.beta;
    this.publish();
    this.holder.add(tiles.group);
    // White context outside the house footprint (mask read from meshFrame), full detail only near the house.
    const house = this.inner.box.isEmpty() ? new THREE.Vector3() : this.inner.box.getCenter(new THREE.Vector3());
    this.white.setNeighbours(this.inner.ctxLines?.userData.edges ?? [], [house.x, house.z]);
    tiles.addEventListener("load-model", ({ scene }: { scene: THREE.Object3D }) => { try { this.white.apply(scene); } catch (e) { this.fail(e); } });
    this.lodOff = applyTileLod(tiles, house, { phone: o.profile !== "desktop" });
    // tileLod sizes the cache for the white look; the sharp house needs room for its finest tiles. A full cache
    // refuses new tiles, which is what left the house a coarse lump on Safari.
    tiles.lruCache.minBytesSize = budget.min * 2 ** 20;
    tiles.lruCache.maxBytesSize = budget.max * 2 ** 20;
    // Up close, and nothing drawn on the house until it is sharp.
    this.inner.setFitCap?.(CLOSE);
    this.marks(false);
    this.holder.visible = false;
    this.inner.scene.add(this.holder);

    tiles.addEventListener("tiles-load-end", () => { this.safeAlign(); });
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
    this.early = setTimeout(() => { if (!this.ready) this.safeAlign(); }, 3500);
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
    const p = this.inner.placeholder;
    this.hidden.push({ o: p, v: p.visible }); p.visible = false;
    this.holder.visible = true;
    // The real surroundings stay (streets, gardens, trees); the neighbours are pressed flat so they never hide the
    // facade. Our glb is dressed now, or in frame() when it lands after the mesh.
    this.white.uniforms.uWcKeep.value = 1;
    this.dress();
    this.sharpBy = setTimeout(() => { if (!this.sharp) { console.warn("Mesh view: house still sharpening after 15 s"); this.markSharp(); } }, SHARP_MS);
    this.o.onReady();
  }

  // Our LoD2 glb around the mesh house (real look: satellite ground dropped under the mesh ground, neighbour slabs);
  // its roof hides and its walls are clipped (whiteContext.ts). The flatten mask needs its ground height.
  private dressed: THREE.Object3D | null = null;
  private dress() {
    const glb = glbOf(this.inner);
    if (glb === this.dressed) return;
    if (glb) { this.hidden.push({ o: glb, v: glb.visible }); glb.visible = false; }
    this.white.detach();
    this.white.attach(glb);
    this.dressed = glb;
    this.sinkGround(false);
    this.sinkGround(true);
    this.flatten();
  }

  // Panels, outlines and labels hide while the house tiles are coarse (they would float beside a lump).
  private marksOn = true;
  private marks(on: boolean) {
    this.marksOn = on;
    this.inner.panels.children.forEach((g) => { g.visible = on; });
    this.inner.outlines?.children.forEach((g) => { g.visible = on; });
    if (this.inner.overlay) this.inner.overlay.style.visibility = on ? "" : "hidden";
  }

  private sunk: { o: THREE.Object3D; y: number }[] = [];
  private groundY: number | null = null;
  private sinkGround(down: boolean) {
    if (!down) { this.sunk.forEach(({ o, y }) => { o.position.y = y; }); this.sunk = []; return; }
    const glb = glbOf(this.inner);
    glb?.traverse((m) => {
      if (!(m as THREE.Mesh).isMesh || !(m.name || m.parent?.name || "").toLowerCase().startsWith("ground")) return;
      if (this.groundY == null) this.groundY = new THREE.Box3().setFromObject(m).max.y;
      this.sunk.push({ o: m, y: m.position.y }); m.position.y -= SINK;
    });
  }

  // A top-down mask of the neighbours' roof outlines (not the target's) for the tile shader to press down.
  private flatten() {
    const U = this.white.uniforms;
    const g = this.groundY ?? 0, size = 2 * RADIUS + 20, W = 512;
    const c = this.inner.box.isEmpty() ? new THREE.Vector3() : this.inner.box.getCenter(new THREE.Vector3());
    const x0 = c.x - size / 2, z0 = c.z - size / 2;
    const cv = document.createElement("canvas"); cv.width = cv.height = W;
    const cx = cv.getContext("2d");
    if (!cx) return;
    const px = ([x, y]: number[]) => [((x - x0) / size) * W, ((-y - z0) / size) * W] as const;
    const draw = (poly: number[][], fill: string) => {
      cx.beginPath(); poly.forEach((p, i) => { const [a, b] = px(p); if (i) cx.lineTo(a, b); else cx.moveTo(a, b); }); cx.closePath();
      cx.fillStyle = fill; cx.fill();
    };
    // Photogrammetry edges spill past the modelled outline: grow each neighbour by DILATE metres.
    cx.lineJoin = "round"; cx.lineWidth = ((2 * DILATE) / size) * W; cx.strokeStyle = "#fff";
    this.o.planes.filter((p) => !p.is_target && p.polygon.length > 2).forEach((p) => { draw(p.polygon, "#fff"); cx.stroke(); });
    // The target and a metre around it always stay real (shared walls, attached garages).
    cx.lineWidth = (2 / size) * W; cx.strokeStyle = "#000";
    this.o.planes.filter((p) => p.is_target && p.polygon.length > 2).forEach((p) => { draw(p.polygon, "#000"); cx.stroke(); });
    const tex = new THREE.DataTexture(new Uint8Array(cx.getImageData(0, 0, W, W).data.buffer), W, W);
    tex.needsUpdate = true;
    (U.uWcFlat.value as THREE.Texture).dispose();
    U.uWcFlat.value = tex;
    U.uWcFlatBox.value.set(x0, z0, size, 0);
    U.uWcFlatY.value = g + FLAT;
  }

  // Sharp: no tile over the house still waiting to refine (each is a leaf or fine enough). Then refit, drape, and
  // show the panels and labels.
  private sharp = false;
  private sharpBy: ReturnType<typeof setTimeout> | undefined;
  private houseLocal: THREE.Sphere | null = null;
  private checkSharp() {
    if (this.sharp || !this.ready || !this.houseLocal) return;
    type T = { children: unknown[]; geometricError: number; engineData?: { boundingVolume?: { intersectsSphere: (s: THREE.Sphere) => boolean } } };
    let n = 0, coarse = 0;
    for (const t of (this.tiles as unknown as { visibleTiles: Set<T> }).visibleTiles) {
      if (!t.engineData?.boundingVolume?.intersectsSphere(this.houseLocal)) continue;
      n++;
      if (t.children.length > 0 && t.geometricError > SHARP_ERR) coarse++;
    }
    if (n > 0 && coarse === 0) this.markSharp();
  }
  private markSharp() {
    if (this.sharp || this.dead) return;
    this.sharp = true; clearTimeout(this.sharpBy);
    this.fits = Math.min(this.fits, 2);
    this.align().then(() => { if (this.dead) return; this.drape(true); this.marks(true); this.o.onSharp(); }).catch((e) => this.fail(e));
  }

  // Any failure in the mesh path ends the mesh only: the hook disposes this layer and the LoD2 model returns.
  private fail(why: unknown) {
    if (this.dead || this.failed) return;
    this.failed = true;
    cancelAnimationFrame(this.raf);
    this.o.onFail(why instanceof Error ? why.message : String(why));
  }
  private failed = false;
  private safeAlign() { this.align().catch((e) => this.fail(e)); }
  private lost = (e: Event) => { e.preventDefault(); this.fail("the GPU dropped the WebGL context"); };

  private loop = () => {
    if (this.dead || this.failed) return;
    this.raf = requestAnimationFrame(this.loop);
    try { this.frame(); } catch (e) { this.fail(e); }
  };

  private frame() {
    const { camera, renderer } = this.inner;
    if (camera !== this.cam) {
      if (this.cam) this.tiles.deleteCamera(this.cam);
      this.tiles.setCamera(camera); this.cam = camera;
    }
    this.tiles.setResolutionFromRenderer(camera, renderer);
    camera.updateMatrixWorld();
    this.tiles.update();
    this.white.sync(meshFrame);
    if (this.ready) { this.drape(); if (this.frames % 30 === 0) this.dress(); }
    if (!this.marksOn) this.marks(false); // panels the scene adds meanwhile stay hidden too
    if (++this.frames % 20 === 0) this.checkSharp();
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
    this.inner.renderer.domElement.removeEventListener("webglcontextlost", this.lost);
    clearTimeout(this.sharpBy);
    const U = this.white.uniforms;
    for (const f of [() => this.marks(true), () => this.sinkGround(false), () => { U.uWcKeep.value = 0; U.uWcFlatBox.value.set(0, 0, 0, 0); }, () => this.inner.setFitCap?.(null),() => this.lodOff(), () => this.white.dispose(), () => this.tiles.dispose(), () => this.draco.dispose()]) {
      try { f(); } catch (e) { console.warn(`Mesh view teardown: ${(e as Error)?.message ?? e}`); }
    }
  }
}
