// Google Photorealistic 3D Tiles inside the SpatialScene, with our layout drawn over them.
// Loaded with a dynamic import together with three. The tiles come through /api/tiles (key on the server).
//
// Frame: ReorientationPlugin puts the house's lat/lon/height at the origin with +Y up, east → -X, north → +Z.
// Our scene is UTM grid: east → +X, grid north → -Z, and grid north sits beta clockwise of true north.
// So the tiles sit in a holder rotated by pi + beta about Y; after that, local metres from the engine line up.
//
// Draw order: tile meshes first (renderOrder -10), then a depth clear, then the LoD2 house as a depth-only
// occluder, then everything else. Panels, battery, wallbox and labels always read over the photo mesh but stay
// hidden behind our own house.
import * as THREE from "three";
import { TilesRenderer, WGS84_ELLIPSOID } from "3d-tiles-renderer/three";
import { GLTFExtensionsPlugin, LoadRegionPlugin, ReorientationPlugin, SphereRegion } from "3d-tiles-renderer/plugins";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import type { SpatialScene } from "./scene";

export type Anchor = { lat: number; lon: number; height: number; beta: number };
type Inner = {
  scene: THREE.Scene; renderer: THREE.WebGLRenderer; camera: THREE.Camera; persp: THREE.PerspectiveCamera;
  placeholder: THREE.Object3D; glbRoot?: THREE.Object3D | null; box: THREE.Box3; alive: boolean;
};
type Opts = {
  root: string; anchor: Anchor; phone: boolean;
  onReady: () => void; onFail: (why: string) => void; onCredit: (text: string) => void;
};

const DRACO = "https://www.gstatic.com/draco/versioned/decoders/1.5.7/";
const RADIUS = 150;     // draw distance around the house, metres
const READY_MS = 6000;  // no photo by then: give up and keep the LoD2 model

// A WebGL context that can show the photo mesh without choking.
export function photoCapable(sc: SpatialScene) {
  const r = (sc as unknown as Inner).renderer;
  const c = r.capabilities;
  return c.isWebGL2 && c.maxTextureSize >= 4096;
}

// The LoD2 glb root in the scene: the web branch keeps it as glbRoot; else the group with the textured roof.
function glbOf(inner: Inner): THREE.Object3D | null {
  if (inner.glbRoot) return inner.glbRoot;
  for (const o of inner.scene.children) {
    let hit = false;
    o.traverse((m) => { const n = (m.name || "").toLowerCase(); if ((m as THREE.Mesh).isMesh && (n.startsWith("walls") || n.startsWith("context") || n.startsWith("ground"))) hit = true; });
    if (hit) return o;
  }
  return null;
}

export class PhotoLayer {
  private inner: Inner;
  private tiles: TilesRenderer;
  private holder = new THREE.Group();
  private clearer: THREE.Mesh;
  private occluder = new THREE.Group();
  private raf = 0;
  private timer: ReturnType<typeof setTimeout>;
  private ready = false;
  private dead = false;
  private cam: THREE.Camera | null = null;
  private credits = new Map<string, number>();
  private creditText = "";
  private hidden: { o: THREE.Object3D; v: boolean }[] = [];
  private draco = new DRACOLoader().setDecoderPath(DRACO);

  constructor(sc: SpatialScene, private o: Opts) {
    this.inner = sc as unknown as Inner;
    const { anchor } = o;
    const tiles = new TilesRenderer(new URL(o.root, window.location.href).href);
    this.tiles = tiles;
    tiles.errorTarget = o.phone ? 40 : 20;
    tiles.lruCache.minBytesSize = (o.phone ? 60 : 150) * 2 ** 20;
    tiles.lruCache.maxBytesSize = (o.phone ? 100 : 250) * 2 ** 20;
    tiles.registerPlugin(new ReorientationPlugin({ lat: anchor.lat, lon: anchor.lon, height: anchor.height, recenter: true }));
    tiles.registerPlugin(new GLTFExtensionsPlugin({ dracoLoader: this.draco }));
    const centre = WGS84_ELLIPSOID.getCartographicToPosition(anchor.lat, anchor.lon, anchor.height, new THREE.Vector3());
    const region = new LoadRegionPlugin();
    region.addRegion(new SphereRegion({ sphere: new THREE.Sphere(centre, RADIUS), mask: true, errorTarget: 1e9 }));
    tiles.registerPlugin(region);

    this.holder.rotation.y = Math.PI + anchor.beta;
    this.holder.add(tiles.group);
    this.holder.visible = false;
    this.inner.scene.add(this.holder);

    // Clears depth between the photo and our overlays; draws nothing itself.
    this.clearer = new THREE.Mesh(new THREE.PlaneGeometry(0.001, 0.001), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, depthTest: false }));
    this.clearer.frustumCulled = false;
    this.clearer.renderOrder = -5;
    this.clearer.onBeforeRender = (r) => r.clearDepth();
    this.clearer.visible = false;
    this.inner.scene.add(this.clearer);

    tiles.addEventListener("load-model", ({ scene }: { scene: THREE.Object3D }) => {
      scene.traverse((m) => { m.renderOrder = -10; });
      if (!this.ready && this.loadedCount() >= 6) this.show();
    });
    tiles.addEventListener("tiles-load-end", () => { if (!this.ready && this.loadedCount() > 0) this.show(); });
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

    this.timer = setTimeout(() => { if (!this.ready) this.fail("The photo tiles took too long."); }, READY_MS);
    this.loop();
  }

  private loadedCount() { let n = 0; this.tiles.group.traverse((m) => { if ((m as THREE.Mesh).isMesh) n++; }); return n; }

  private show() {
    if (this.dead || this.ready) return;
    this.ready = true;
    clearTimeout(this.timer);
    this.fitGround();
    const glb = glbOf(this.inner);
    // Depth-only copy of our own house: the overlays hide behind it, never behind the photo mesh.
    if (glb) {
      glb.updateMatrixWorld(true);
      const mat = new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide });
      glb.traverse((m) => {
        const mesh = m as THREE.Mesh, n = (m.name || m.parent?.name || "").toLowerCase();
        if (!mesh.isMesh || n.startsWith("context") || n.startsWith("ground")) return;
        const c = new THREE.Mesh(mesh.geometry, mat);
        c.matrixAutoUpdate = false; c.matrix.copy(mesh.matrixWorld); c.renderOrder = -4;
        this.occluder.add(c);
      });
      this.inner.scene.add(this.occluder);
    }
    for (const x of [glb, this.inner.placeholder]) if (x) { this.hidden.push({ o: x, v: x.visible }); x.visible = false; }
    this.holder.visible = true;
    this.clearer.visible = true;
    this.o.onReady();
  }

  // Our ground (local z 0, from DHHN heights plus a fixed geoid offset) against the photo mesh: ray-cast a ring
  // around the house and take a low quantile, so hedges and cars do not lift it. Shift only by a few metres.
  private fitGround() {
    const box = this.inner.box, c = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
    const r = box.isEmpty() ? 10 : Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2 + 4;
    this.holder.updateMatrixWorld(true);
    const ray = new THREE.Raycaster(), hits: number[] = [];
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      ray.set(new THREE.Vector3(c.x + Math.cos(a) * r, 120, c.z + Math.sin(a) * r), new THREE.Vector3(0, -1, 0));
      const h = ray.intersectObject(this.tiles.group, true)[0];
      if (h) hits.push(h.point.y);
    }
    if (hits.length < 4) return;
    hits.sort((x, y) => x - y);
    const g = hits[Math.floor(hits.length * 0.25)];
    if (Math.abs(g) < 8) this.holder.position.y = -g;
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
    const text = [...this.credits.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k).join("; ");
    if (text !== this.creditText) { this.creditText = text; this.o.onCredit(text); }
  };

  dispose() {
    if (this.dead) return;
    this.dead = true;
    cancelAnimationFrame(this.raf);
    clearTimeout(this.timer);
    const glb = glbOf(this.inner);
    this.hidden.forEach(({ o, v }) => { o.visible = o === this.inner.placeholder ? !glb : v; });
    if (glb) glb.visible = true;
    this.inner.scene.remove(this.holder, this.clearer, this.occluder);
    this.occluder.clear();
    this.tiles.dispose();
    this.draco.dispose();
    (this.clearer.material as THREE.Material).dispose();
    this.clearer.geometry.dispose();
  }
}
