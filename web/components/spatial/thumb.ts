// One board-card thumbnail: the lead's LoD2 model with its modules, from the Panels step's camera, rendered
// off-screen with the same SpatialScene the card uses, read back as a JPEG data URL, then torn down (WebGL
// context released). Never the Google mesh: the board must not fetch tiles, so thumbnails are always LoD2.
// Models only, no photographs: the roof is a flat roof colour and the ground white, neighbours as white slabs
// with their footprints outlined, the same look as the line drawing it replaces.
import * as THREE from "three";
import { SpatialScene } from "./scene";
import { POSES } from "./camera";
import type { PanelRect, RoofModel } from "./types";

type Inner = { renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.Camera; glbRoot: THREE.Object3D | null; ctxLines?: THREE.Object3D; loop: () => void };

const ROOF = "#cfc9bc", GROUND = "#fbfaf6", SLAB = "#efece5";

// A frame if the page is painting, else 60 ms: Safari stops requestAnimationFrame in a hidden or covered tab,
// and the card picture must still come.
const tick = () => new Promise<void>((r) => { const t = setTimeout(r, 60); requestAnimationFrame(() => { clearTimeout(t); r(); }); });

// Linear to sRGB per channel: a render target holds linear colour, only the screen path converts on output.
const LUT = Uint8ClampedArray.from({ length: 256 }, (_, i) => { const x = i / 255; return Math.round(255 * (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055)); });

// Draw once into an off-screen target and read the pixels back, so nothing depends on the canvas's drawing
// buffer surviving until toDataURL (Safari does not promise that without preserveDrawingBuffer).
function capture(i: Inner, w: number, h: number): string {
  const pr = i.renderer.getPixelRatio(), W = Math.round(w * pr), H = Math.round(h * pr);
  const rt = new THREE.WebGLRenderTarget(W, H, { samples: 4, type: THREE.UnsignedByteType });
  try {
    i.renderer.setRenderTarget(rt);
    i.renderer.render(i.scene, i.camera);
    const px = new Uint8Array(W * H * 4);
    i.renderer.readRenderTargetPixels(rt, 0, 0, W, H, px);
    const c = document.createElement("canvas");
    c.width = W; c.height = H;
    const g = c.getContext("2d");
    if (!g) throw new Error("no 2D canvas");
    const img = g.createImageData(W, H);
    for (let y = 0; y < H; y++) {
      const src = (H - 1 - y) * W * 4, dst = y * W * 4; // GL rows run bottom up
      for (let x = 0; x < W * 4; x += 4) {
        img.data[dst + x] = LUT[px[src + x]];
        img.data[dst + x + 1] = LUT[px[src + x + 1]];
        img.data[dst + x + 2] = LUT[px[src + x + 2]];
        img.data[dst + x + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    return c.toDataURL("image/jpeg", 0.82);
  } finally {
    i.renderer.setRenderTarget(null);
    rt.dispose();
  }
}

export async function renderThumb(model: RoofModel, glbUrl: string, w: number, h: number): Promise<string> {
  // Laid out (so the scene can measure it) but off-screen and invisible.
  const host = document.createElement("div");
  Object.assign(host.style, { position: "fixed", left: "-10000px", top: "0", width: `${w}px`, height: `${h}px`, opacity: "0", pointerEvents: "none" });
  const overlay = document.createElement("div");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  host.append(overlay, svg);
  document.body.appendChild(host);
  const sc = new SpatialScene(host, overlay, svg, { reduce: true });
  try {
    sc.setModel(model);
    await new Promise<void>((ok, no) => sc.loadGlb(glbUrl, (e) => (e ? no(new Error(e)) : ok())));
    const i = sc as unknown as Inner;
    // No photographs on the card: plain materials in place of the DOP20 texture.
    i.glbRoot?.traverse((o) => {
      const m = o as THREE.Mesh, n = (m.name || m.parent?.name || "").toLowerCase();
      if (!m.isMesh) return;
      const col = n.startsWith("ground") ? GROUND : n.startsWith("context") ? SLAB : n.startsWith("roof") ? ROOF : null;
      if (col) m.material = new THREE.MeshLambertMaterial({ color: col, side: THREE.DoubleSide });
    });
    if (i.ctxLines) i.ctxLines.visible = true;
    const target = model.planes.filter((p) => p.is_target);
    sc.setPanels(target.flatMap((p) => p.chosen_panels.map((r: PanelRect) => ({ p, r }))), false);
    sc.show({ outlines: false, panels: true, kit: false, sun: false, battery: "plain" });
    sc.flyTo({ ...POSES.solar, dist: POSES.solar.dist * 1.15 }); // the Panels camera, pulled back so a short card shows the whole house; reduce: a cut
    await tick();
    i.loop(); // one pass of the scene's per-frame work (controls, clipping) even when no frame has fired
    await tick();
    return capture(i, w, h);
  } finally {
    const r = (sc as unknown as Inner).renderer;
    sc.dispose();
    r.forceContextLoss();
    host.remove();
  }
}
