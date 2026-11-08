// The ground under the house, sharper. Two pictures can lie on the glb's ground square:
// - Bavaria: the DOP20 orthophoto baked into the glb (20 cm source, fetched at about 8 cm per pixel, so the
//   texture is not the limit); it was blurred by mipmaps at grazing angles, so it now gets the renderer's
//   maximum anisotropic filtering.
// - Google: Map Tiles API 2D satellite tiles at zoom 20 (about 10 cm per pixel here; Google's own maximum for the
//   hero house is 21), stitched on a canvas, through /api/tiles/sat (key on the server). Usually newer and sharper.
// The layers menu picks one (whiteMode.ts); Google is the default once its picture has loaded, with its
// attribution on screen.
import * as THREE from "three";
import { setGoogleGround, onWhite, viewOpts, whiteOn } from "./whiteMode";
import { setRealGround, WHITE } from "./whiteContext";
import { anchorOf } from "@/lib/tilesGeo";

type Anchor = { lat: number; lon: number; beta: number }; // radians, from the engine origin (lib/tilesGeo.ts)
const A = 6378137, E2 = 0.00669437999014;
const ZOOM = 20;      // near ring: the glb's own ground square, about 82 m across for the hero house
const MAX_TILES = 49;
// Outer ring: a larger plane under the glb's square, so orbiting or zooming out never shows its edge. Coarser
// tiles keep the cost about flat: at zoom 17 one tile is about 205 m here, so 256 m across is 4 to 9 tiles.
const OUTER = 128;    // half-width in metres, about three times the near square's
const FADE = 0.5;     // the outer plane is opaque to this share of OUTER, then fades to the page background
const OUTER_ZOOM = 17;
const MAX_OUTER = 9;
let owner = 0, seq = 0; // which ground last put its credit in the shared store

// Every textured mesh of the glb gets the sharpest filtering the device has.
export function sharpen(root: THREE.Object3D, renderer: THREE.WebGLRenderer) {
  const max = renderer.capabilities.getMaxAnisotropy();
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.MeshLambertMaterial | undefined;
    if (m?.map) { m.map.anisotropy = max; m.map.needsUpdate = true; }
  });
}

// Scene point (three: x east, z south, grid frame) → lat/lon in degrees. Grid north sits beta clockwise of
// true north; over a 100 m square a local tangent plane is exact to a few millimetres.
function latLon(a: Anchor, x: number, z: number) {
  const gx = x, gy = -z, cb = Math.cos(a.beta), sb = Math.sin(a.beta);
  const e = gx * cb + gy * sb, n = -gx * sb + gy * cb;
  const s = Math.sin(a.lat), w = 1 - E2 * s * s;
  const M = (A * (1 - E2)) / w ** 1.5, N = A / Math.sqrt(w);
  return { lat: (a.lat + n / M) * (180 / Math.PI), lon: (a.lon + e / (N * Math.cos(a.lat))) * (180 / Math.PI) };
}
const merc = (lat: number, lon: number, z: number) => {
  const k = 256 * 2 ** z, r = (lat * Math.PI) / 180;
  return { x: ((lon + 180) / 360) * k, y: ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * k };
};

function img(url: string, signal: AbortSignal) {
  return new Promise<HTMLImageElement>((ok, no) => {
    const i = new Image();
    i.onload = () => ok(i); i.onerror = () => no(new Error(`Tile failed: ${url}`));
    signal.addEventListener("abort", () => { i.src = ""; no(new Error("aborted")); });
    i.src = url;
  });
}

type Stitch = { canvas: HTMLCanvasElement; z: number; x0: number; y0: number; W: number; H: number; tiles: number; copyright?: string };

// The tiles covering these lat/lon corners at zoom (or coarser, until at most max tiles), on one canvas.
async function stitch(corners: { lat: number; lon: number }[], zoom: number, max: number, floor: number, signal: AbortSignal): Promise<Stitch> {
  const lats = corners.map((c) => c.lat), lons = corners.map((c) => c.lon);
  const v = await fetch(`/api/tiles/sat/viewport?zoom=${zoom}&north=${Math.max(...lats)}&south=${Math.min(...lats)}&east=${Math.max(...lons)}&west=${Math.min(...lons)}`, { signal }).then((r) => r.json()) as { copyright?: string; maxZoom?: number; error?: string };
  if (v.error || !v.maxZoom) throw new Error(v.error || "No satellite imagery here.");
  let z = Math.min(zoom, v.maxZoom);
  const range = (zz: number) => {
    const ps = corners.map((c) => merc(c.lat, c.lon, zz));
    return { x0: Math.floor(Math.min(...ps.map((p) => p.x)) / 256), x1: Math.floor(Math.max(...ps.map((p) => p.x)) / 256), y0: Math.floor(Math.min(...ps.map((p) => p.y)) / 256), y1: Math.floor(Math.max(...ps.map((p) => p.y)) / 256) };
  };
  let r = range(z);
  while ((r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1) > max && z > floor) r = range(--z);
  const W = (r.x1 - r.x0 + 1) * 256, H = (r.y1 - r.y0 + 1) * 256;
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const cx = canvas.getContext("2d")!;
  const jobs: Promise<void>[] = [];
  for (let x = r.x0; x <= r.x1; x++) for (let y = r.y0; y <= r.y1; y++)
    jobs.push(img(`/api/tiles/sat/${z}/${x}/${y}`, signal).then((i) => cx.drawImage(i, (x - r.x0) * 256, (y - r.y0) * 256)));
  await Promise.all(jobs);
  return { canvas, z, x0: r.x0, y0: r.y0, W, H, tiles: jobs.length, copyright: v.copyright };
}

// uv on the stitched canvas for a scene point (flipY: v runs bottom up).
function uvOf(a: Anchor, s: Stitch, x: number, z: number): [number, number] {
  const ll = latLon(a, x, z), m = merc(ll.lat, ll.lon, s.z);
  return [(m.x - s.x0 * 256) / s.W, 1 - (m.y - s.y0 * 256) / s.H];
}

function texOf(canvas: HTMLCanvasElement, renderer: THREE.WebGLRenderer) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}

// Builds the Google ground for this glb and registers both pictures with the layers menu. Returns a cleanup.
// The anchor comes from the origin the card already has (planes.origin_utm32), computed here: no engine call.
// The near square paints as soon as its tiles are in; the outer plane follows on its own and never holds it up.
export function googleGround(root: THREE.Object3D, renderer: THREE.WebGLRenderer, origin: [number, number, number]): () => void {
  const ac = new AbortController(), id = ++seq;
  let off: (() => void) | null = null, tex: THREE.Texture | null = null, mat: THREE.Material | null = null;
  let outer: THREE.Mesh | null = null, near = false, credits: string[] = [];
  const ground: THREE.Mesh[] = [];
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh && (o.name || o.parent?.name || "").toLowerCase().startsWith("ground")) ground.push(o as THREE.Mesh); });
  if (!ground.length) return () => {};
  const bavaria = ground.map((g) => ({ g, mat: (g.userData.white ? g.userData.real : g.material) as THREE.Material, uv: g.geometry.getAttribute("uv") }));
  const a: Anchor = anchorOf(origin);
  root.updateMatrixWorld(true);
  const box = new THREE.Box3();
  ground.forEach((g) => box.expandByObject(g));
  const c = box.getCenter(new THREE.Vector3());

  // The outer plane: the Google picture in the real look, plain white in the white look (so the white ground
  // fades into the page too). With the Bavarian picture it stays off: its credit line names no Google imagery.
  let real: THREE.Material | null = null, white: THREE.Material | null = null;
  const showOuter = () => {
    if (!outer) return;
    const w = whiteOn();
    outer.material = w ? white! : real!;
    outer.visible = near && (w || viewOpts().ground === "google");
  };
  const credit = (s?: string) => {
    if (s) s.split(/,\s*/).forEach((x) => { if (x && !credits.includes(x)) credits.push(x); });
    if (near) { owner = id; setGoogleGround(true, credits.length ? `${credits.join(", ")}, Google` : "Google"); }
  };

  (async () => {
    // The ground square's corners in lat/lon, then the tile range that covers them at ZOOM.
    const corners = [[box.min.x, box.min.z], [box.max.x, box.min.z], [box.min.x, box.max.z], [box.max.x, box.max.z]].map(([x, z]) => latLon(a, x, z));
    const s = await stitch(corners, ZOOM, MAX_TILES, 17, ac.signal);
    if (ac.signal.aborted) return;
    tex = texOf(s.canvas, renderer);
    mat = new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide });
    // Each ground vertex gets the canvas position of its own lat/lon.
    const google = ground.map((g) => {
      const pos = g.geometry.getAttribute("position"), uv = new Float32Array(pos.count * 2), p = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        p.fromBufferAttribute(pos, i).applyMatrix4(g.matrixWorld);
        const [u, v] = uvOf(a, s, p.x, p.z);
        uv[i * 2] = u; uv[i * 2 + 1] = v;
      }
      return new THREE.BufferAttribute(uv, 2);
    });
    const apply = () => {
      const g = viewOpts().ground === "google";
      ground.forEach((m, i) => { m.geometry.setAttribute("uv", g ? google[i] : bavaria[i].uv); setRealGround(m, g ? mat! : bavaria[i].mat); });
      showOuter();
    };
    near = true;
    apply();
    off = onWhite(apply);
    credit(s.copyright);
  })().catch((e) => { if (!ac.signal.aborted) console.warn(`Google satellite ground off: ${(e as Error).message}`); });

  (async () => {
    const R = Math.max(OUTER, (box.max.x - box.min.x) * 1.5, (box.max.z - box.min.z) * 1.5);
    const corners = [[c.x - R, c.z - R], [c.x + R, c.z - R], [c.x - R, c.z + R], [c.x + R, c.z + R]].map(([x, z]) => latLon(a, x, z));
    const s = await stitch(corners, OUTER_ZOOM, MAX_OUTER, 15, ac.signal);
    if (ac.signal.aborted) return;
    // Radial alpha on the canvas itself: opaque to FADE * R, then a smooth ramp to nothing at R. Mercator is
    // conformal, so a circle in metres is a circle in canvas pixels. The same ramp in grey is the white look's alphaMap.
    const ll = latLon(a, c.x, c.z), m = merc(ll.lat, ll.lon, s.z);
    const mpp = (2 * Math.PI * A * Math.cos(a.lat)) / (256 * 2 ** s.z), rp = R / mpp;
    const px = m.x - s.x0 * 256, py = m.y - s.y0 * 256;
    const ramp = (cx: CanvasRenderingContext2D, col: (al: string) => string) => {
      const grad = cx.createRadialGradient(px, py, rp * FADE, px, py, rp);
      for (let k = 0; k <= 8; k++) { const t = k / 8; grad.addColorStop(t, col((1 - t * t * (3 - 2 * t)).toFixed(3))); }
      cx.fillStyle = grad;
      cx.fillRect(0, 0, s.W, s.H);
    };
    const cx = s.canvas.getContext("2d")!;
    cx.globalCompositeOperation = "destination-in";
    ramp(cx, (al) => `rgba(0,0,0,${al})`);
    const am = document.createElement("canvas");
    am.width = s.W; am.height = s.H;
    ramp(am.getContext("2d")!, (al) => { const g = Math.round(+al * 255); return `rgb(${g},${g},${g})`; });
    const t = texOf(s.canvas, renderer), at = new THREE.CanvasTexture(am);
    const geo = new THREE.PlaneGeometry(2 * R, 2 * R, 24, 24).rotateX(-Math.PI / 2);
    const pos = geo.getAttribute("position"), uv = geo.getAttribute("uv") as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) { const [u, v] = uvOf(a, s, pos.getX(i) + c.x, pos.getZ(i) + c.z); uv.setXY(i, u, v); }
    // Just under the glb's square, drawn before the see-through neighbours so their slabs stay on top.
    real = new THREE.MeshLambertMaterial({ map: t, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    white = new THREE.MeshLambertMaterial({ color: WHITE, alphaMap: at, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    outer = new THREE.Mesh(geo, real);
    outer.name = "outer-satellite";
    outer.position.set(c.x, box.min.y - 0.05, c.z);
    outer.renderOrder = -1;
    outer.visible = false;
    root.add(outer);
    showOuter();
    credit(s.copyright);
  })().catch((e) => { if (!ac.signal.aborted) console.warn(`Google outer ground off: ${(e as Error).message}`); });

  return () => {
    ac.abort(); off?.();
    ground.forEach((m, i) => { m.geometry.setAttribute("uv", bavaria[i].uv); setRealGround(m, bavaria[i].mat); });
    if (owner === id) setGoogleGround(false);
    tex?.dispose(); mat?.dispose();
    if (outer) {
      root.remove(outer); outer.geometry.dispose();
      [real, white].forEach((x) => { const l = x as THREE.MeshLambertMaterial; l.map?.dispose(); l.alphaMap?.dispose(); l.dispose(); });
    }
  };
}
