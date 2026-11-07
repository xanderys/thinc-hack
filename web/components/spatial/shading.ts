// Shading layer for the three.js scene: a tint over each chosen module by its solar access (lib/shading.ts),
// the % on each module once it is big enough on screen (on tap at phone width), and edge lengths on the roof faces in 3D.
// The scene tags each module group with { plane, idx, cs, n } in setPanels and calls frame() once per render.
import * as THREE from "three";
import type { RoofPlane, V3 } from "./types";
import { shadeRgb, shareAt, type ShadeAt, type Shading } from "@/lib/shading";

const toV = ([x, y, z]: V3) => new THREE.Vector3(x, z, -y);
const NARROW = 520;   // px: at phone width the % shows on tap only
const MIN_PX = 34;    // a module narrower than this on screen gets no %
// Inline, so they win over the scene's boxed label style: plain figures on the drawing, like the plan's lengths.
const PCT_CSS = "position:absolute;left:0;top:0;padding:0;border:0;background:none;box-shadow:none;font:600 10px/1 var(--font-mono),monospace;color:#fff;text-shadow:0 0 2px rgba(0,0,0,.55);white-space:nowrap;";
const EDGE_CSS = "position:absolute;left:0;top:0;padding:1px 4px;border:0;border-radius:4px;background:rgba(255,255,255,.88);box-shadow:none;font:500 10.5px/1.2 var(--font-mono),monospace;color:#0A0C14;white-space:nowrap;";

type Mod = { key: string; mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; centre: THREE.Vector3; a: THREE.Vector3; b: THREE.Vector3; el: HTMLDivElement };
type Edge = { at: THREE.Vector3; el: HTMLDivElement };

export class ShadeLayer {
  private overlay: HTMLElement | null = null;
  private dom: HTMLElement | null = null;
  private mods: Mod[] = [];
  private edges: Edge[] = [];
  private planes: RoofPlane[] = [];
  private data: Shading | null = null;
  private on = false;
  private at: ShadeAt = null;
  private picked: string | null = null;
  private down = { x: 0, y: 0, t: 0 };
  private camera: THREE.Camera | null = null;
  private ray = new THREE.Raycaster();

  mount(overlay: HTMLElement, dom: HTMLElement) {
    this.overlay = overlay; this.dom = dom;
    dom.addEventListener("pointerdown", this.onDown);
    dom.addEventListener("pointerup", this.onUp);
  }

  // The roof faces, for edge lengths.
  setPlanes(planes: RoofPlane[]) { this.planes = planes.filter((p) => p.is_target); this.buildEdges(); }

  // Re-tags after the scene re-placed its modules.
  setPanels(panels: THREE.Group) {
    this.mods.forEach((m) => { m.el.remove(); m.mesh.removeFromParent(); m.mat.dispose(); m.mesh.geometry.dispose(); });
    this.mods = [];
    panels.children.forEach((g) => {
      const u = g.userData as { plane?: string; idx?: number; cs?: THREE.Vector3[]; n?: THREE.Vector3 };
      if (!u.plane || u.idx == null || !u.cs || !u.n) return;
      const cs = u.cs.map((q) => q.clone().addScaledVector(u.n!, 0.012));
      const geo = new THREE.BufferGeometry().setFromPoints(cs);
      geo.setIndex([0, 1, 2, 0, 2, 3]);
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = 4;
      mesh.visible = false;
      g.add(mesh);
      const el = document.createElement("div");
      el.className = "sp-shade";
      el.style.cssText = PCT_CSS + "visibility:hidden;";
      this.overlay?.appendChild(el);
      const centre = cs.reduce((a, b) => a.add(b), new THREE.Vector3()).multiplyScalar(0.25);
      this.mods.push({ key: `${u.plane}:${u.idx}`, mesh, mat, centre, a: cs[0], b: cs[1], el });
    });
    this.apply();
  }

  set(data: Shading | null, on: boolean, at: ShadeAt) {
    const edgesChanged = data !== this.data;
    this.data = data; this.on = on && !!data; this.at = at;
    if (edgesChanged) this.buildEdges();
    this.apply();
  }

  private apply() {
    const by = new Map((this.data?.modules ?? []).map((m) => [`${m.plane_id}:${m.index}`, m]));
    this.mods.forEach((m) => {
      const s = by.get(m.key), v = s && this.on ? shareAt(s, this.at) : null;
      m.mesh.visible = v != null;
      if (v != null) {
        const [r, g, b] = shadeRgb(v);
        m.mat.color.setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
        m.el.textContent = `${Math.round(v * 100)}%`;
      }
    });
  }

  private buildEdges() {
    this.edges.forEach((e) => e.el.remove());
    this.edges = [];
    if (!this.data || !this.overlay) return;
    const lens = new Map(this.data.planes.map((p) => [p.id, p.edges_m]));
    const seen: THREE.Vector3[] = [];
    this.planes.forEach((p) => {
      const pts = p.polygon.map(toV), given = lens.get(p.id);
      pts.forEach((a, i) => {
        const b = pts[(i + 1) % pts.length], len = given?.[i] ?? a.distanceTo(b);
        if (len < 1.5) return;
        const mid = a.clone().add(b).multiplyScalar(0.5);
        if (seen.some((q) => q.distanceTo(mid) < 0.4)) return;   // a ridge shared by two faces gets one label
        seen.push(mid);
        const el = document.createElement("div");
        el.className = "sp-edge";
        el.textContent = `${len.toFixed(1)} m`;
        el.style.cssText = EDGE_CSS + "visibility:hidden;";
        this.overlay!.appendChild(el);
        this.edges.push({ at: mid.setY(mid.y + 0.15), el });
      });
    });
  }

  frame(camera: THREE.Camera, mode: "3d" | "2d", project: (v: THREE.Vector3) => { x: number; y: number; ok: boolean }, width: number) {
    this.camera = camera;
    const narrow = width < NARROW;
    this.mods.forEach((m) => {
      const show = this.on && m.mesh.visible && (narrow ? this.picked === m.key : true);
      if (!show) { if (m.el.style.visibility !== "hidden") m.el.style.visibility = "hidden"; return; }
      m.mesh.updateWorldMatrix(true, false);
      const c = m.centre.clone().applyMatrix4(m.mesh.matrixWorld), p = project(c);
      const A = project(m.a.clone().applyMatrix4(m.mesh.matrixWorld)), B = project(m.b.clone().applyMatrix4(m.mesh.matrixWorld));
      const big = Math.hypot(A.x - B.x, A.y - B.y) >= MIN_PX || (narrow && this.picked === m.key);
      m.el.style.visibility = p.ok && big ? "visible" : "hidden";
      m.el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -50%)`;
    });
    this.edges.forEach((e) => {
      const show = this.on && mode === "3d";
      if (!show) { if (e.el.style.visibility !== "hidden") e.el.style.visibility = "hidden"; return; }
      const p = project(e.at);
      e.el.style.visibility = p.ok ? "visible" : "hidden";
      e.el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -50%)`;
    });
  }

  private onDown = (e: PointerEvent) => { this.down = { x: e.clientX, y: e.clientY, t: performance.now() }; };
  private onUp = (e: PointerEvent) => {
    if (!this.on || !this.camera || !this.dom) return;
    if (Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 8 || performance.now() - this.down.t > 400) return;
    const r = this.dom.getBoundingClientRect();
    this.ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
    const hit = this.ray.intersectObjects(this.mods.filter((m) => m.mesh.visible).map((m) => m.mesh), false)[0];
    const m = hit && this.mods.find((x) => x.mesh === hit.object);
    this.picked = m ? (this.picked === m.key ? null : m.key) : null;
  };

  dispose() {
    this.dom?.removeEventListener("pointerdown", this.onDown);
    this.dom?.removeEventListener("pointerup", this.onUp);
    this.mods.forEach((m) => m.el.remove());
    this.edges.forEach((e) => e.el.remove());
  }
}
