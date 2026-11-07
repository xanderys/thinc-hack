// The ground under the house, sharper. Two pictures can lie on the glb's ground square:
// - Bavaria: the DOP20 orthophoto baked into the glb (20 cm source, fetched at about 8 cm per pixel, so the
//   texture is not the limit); it was blurred by mipmaps at grazing angles, so it now gets the renderer's
//   maximum anisotropic filtering.
// - Google: Map Tiles API 2D satellite tiles at zoom 20 (about 10 cm per pixel here; Google's own maximum for the
//   hero house is 21), stitched on a canvas, through /api/tiles/sat (key on the server). Usually newer and sharper.
// The layers menu picks one (whiteMode.ts); Google is the default once its picture has loaded, with its
// attribution on screen.
import * as THREE from "three";
import { setGoogleGround, onWhite, viewOpts } from "./whiteMode";
import { setRealGround } from "./whiteContext";
import { anchorOf } from "@/lib/tilesGeo";

type Anchor = { lat: number; lon: number; beta: number }; // radians, from the engine origin (lib/tilesGeo.ts)
const A = 6378137, E2 = 0.00669437999014;
const ZOOM = 20;
const MAX_TILES = 49;

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

// Builds the Google ground for this glb and registers both pictures with the layers menu. Returns a cleanup.
// The anchor comes from the origin the card already has (planes.origin_utm32), computed here: no engine call.
export function googleGround(root: THREE.Object3D, renderer: THREE.WebGLRenderer, origin: [number, number, number]): () => void {
  const ac = new AbortController();
  let off: (() => void) | null = null, tex: THREE.Texture | null = null, mat: THREE.Material | null = null;
  const ground: THREE.Mesh[] = [];
  root.traverse((o) => { if ((o as THREE.Mesh).isMesh && (o.name || o.parent?.name || "").toLowerCase().startsWith("ground")) ground.push(o as THREE.Mesh); });
  if (!ground.length) return () => {};
  const bavaria = ground.map((g) => ({ g, mat: (g.userData.white ? g.userData.real : g.material) as THREE.Material, uv: g.geometry.getAttribute("uv") }));

  (async () => {
    const a: Anchor = anchorOf(origin);
    root.updateMatrixWorld(true);
    // The ground square's corners in lat/lon, then the tile range that covers them at ZOOM.
    const box = new THREE.Box3();
    ground.forEach((g) => box.expandByObject(g));
    const corners = [[box.min.x, box.min.z], [box.max.x, box.min.z], [box.min.x, box.max.z], [box.max.x, box.max.z]].map(([x, z]) => latLon(a, x, z));
    const lats = corners.map((c) => c.lat), lons = corners.map((c) => c.lon);
    const v = await fetch(`/api/tiles/sat/viewport?zoom=${ZOOM}&north=${Math.max(...lats)}&south=${Math.min(...lats)}&east=${Math.max(...lons)}&west=${Math.min(...lons)}`, { signal: ac.signal }).then((r) => r.json()) as { copyright?: string; maxZoom?: number; error?: string };
    if (v.error || !v.maxZoom) throw new Error(v.error || "No satellite imagery here.");
    let z = Math.min(ZOOM, v.maxZoom);
    const range = (zz: number) => {
      const ps = corners.map((c) => merc(c.lat, c.lon, zz));
      return { x0: Math.floor(Math.min(...ps.map((p) => p.x)) / 256), x1: Math.floor(Math.max(...ps.map((p) => p.x)) / 256), y0: Math.floor(Math.min(...ps.map((p) => p.y)) / 256), y1: Math.floor(Math.max(...ps.map((p) => p.y)) / 256) };
    };
    let r = range(z);
    while ((r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1) > MAX_TILES && z > 17) r = range(--z);
    const W = (r.x1 - r.x0 + 1) * 256, H = (r.y1 - r.y0 + 1) * 256;
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const cx = canvas.getContext("2d")!;
    const jobs: Promise<void>[] = [];
    for (let x = r.x0; x <= r.x1; x++) for (let y = r.y0; y <= r.y1; y++)
      jobs.push(img(`/api/tiles/sat/${z}/${x}/${y}`, ac.signal).then((i) => cx.drawImage(i, (x - r.x0) * 256, (y - r.y0) * 256)));
    await Promise.all(jobs);
    if (ac.signal.aborted) return;

    tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    mat = new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide });
    // Each ground vertex gets the canvas position of its own lat/lon (flipY: v runs bottom up).
    const google = ground.map((g) => {
      const pos = g.geometry.getAttribute("position"), uv = new Float32Array(pos.count * 2), p = new THREE.Vector3();
      for (let i = 0; i < pos.count; i++) {
        p.fromBufferAttribute(pos, i).applyMatrix4(g.matrixWorld);
        const ll = latLon(a, p.x, p.z), m = merc(ll.lat, ll.lon, z);
        uv[i * 2] = (m.x - r.x0 * 256) / W; uv[i * 2 + 1] = 1 - (m.y - r.y0 * 256) / H;
      }
      return new THREE.BufferAttribute(uv, 2);
    });
    const apply = () => {
      const g = viewOpts().ground === "google";
      ground.forEach((m, i) => { m.geometry.setAttribute("uv", g ? google[i] : bavaria[i].uv); setRealGround(m, g ? mat! : bavaria[i].mat); });
    };
    apply();
    off = onWhite(apply);
    setGoogleGround(true, v.copyright ? `${v.copyright}, Google` : "Google");
  })().catch((e) => { if (!ac.signal.aborted) console.warn(`Google satellite ground off: ${(e as Error).message}`); });

  return () => {
    ac.abort(); off?.();
    ground.forEach((m, i) => { m.geometry.setAttribute("uv", bavaria[i].uv); setRealGround(m, bavaria[i].mat); });
    setGoogleGround(false);
    tex?.dispose(); mat?.dispose();
  };
}
