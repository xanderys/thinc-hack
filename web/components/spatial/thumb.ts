// One board-card thumbnail: the lead's LoD2 model with its modules, from the Panels step's camera, rendered
// off-screen with the same SpatialScene the card uses, read back as a JPEG data URL, then torn down (WebGL
// context released). Never the Google mesh: the board must not fetch tiles, so thumbnails are always LoD2.
// Models only, no photographs: the roof is a flat roof colour and the ground white, neighbours as white slabs
// with their footprints outlined, the same look as the line drawing it replaces.
import * as THREE from "three";
import { SpatialScene } from "./scene";
import { POSES } from "./camera";
import type { PanelRect, RoofModel } from "./types";

type Inner = { renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.Camera; glbRoot: THREE.Object3D | null; ctxLines?: THREE.Object3D };

const ROOF = "#cfc9bc", GROUND = "#fbfaf6", SLAB = "#efece5";

const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

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
    await frame(); await frame();
    i.renderer.render(i.scene, i.camera); // read back in the same task, before the buffer is cleared
    return i.renderer.domElement.toDataURL("image/jpeg", 0.82);
  } finally {
    const r = (sc as unknown as Inner).renderer;
    sc.dispose();
    r.forceContextLoss();
    host.remove();
  }
}
