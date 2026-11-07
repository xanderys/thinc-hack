// The three.js side of the spatial demonstration. Loaded with a dynamic import so three never
// reaches the first paint. Local metres from the engine are x east, y north, z up; three uses
// x east, y up, z south (the same as the glb), so a local point (x, y, z) becomes (x, z, -y).
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { DayHour, Envelope, PanelRect, Plan, RoofModel, RoofPlane, V3 } from "./types";
import { flowsOf, lerpHour, p2 } from "./types";
import { facing } from "./facing";
import { poseOffset, springStep, type Focus, type Pose } from "./camera";
import { ShadeLayer } from "./shading";
import { neighbourEdges, outlineMesh, whiteFallback } from "./whiteContext";
import type { ShadeAt, Shading } from "@/lib/shading";

const PAPER = new THREE.Color("#fdfdfb");
const BLUE = new THREE.Color("#374be6");
const SUN = new THREE.Color("#E8730C");
const INK = "#0A0C14";
const NEIGHBOUR = "#B4B1A9";
const WALL = "#E2DED4";

const toV = ([x, y, z]: V3) => new THREE.Vector3(x, z, -y);
const OMEGA = (2 * Math.PI) / 0.5; // spring duration 0.5 s, bounce 0 (critically damped)
const springOut = (t: number) => (t <= 0 ? 0 : 1 - (1 + OMEGA * t) * Math.exp(-OMEGA * t));
const DAY_SECONDS = 12;

export type Label = { key: string; at: THREE.Vector3; html: string; cls?: string };



const fmt0 = (x: number) => Math.round(x).toLocaleString("en-GB");
const skipOf = (p: RoofPlane) => p.skip_reason || p.skip || p.shade_reason || null;
function sunHtml(p: RoofPlane) {
  const loss = p.shade_loss_share;
  if (p.yield_shaded_kwh_per_kwp != null && loss != null && loss >= 0.005)
    return `<b>${fmt0(p.yield_shaded_kwh_per_kwp)}</b> kWh/kWp after shade<br/><span>${Math.round(loss * 100)}% lost to shade</span>`;
  if (p.yield_shaded_kwh_per_kwp != null) return `<b>${fmt0(p.yield_shaded_kwh_per_kwp)}</b> kWh/kWp after shade`;
  return `<b>${fmt0(p.yield_kwh_per_kwp)}</b> kWh/kWp`;
}

function planeFrame(p: RoofPlane) {
  const pts = p.polygon.map(toV);
  const c = pts.reduce((a, b) => a.add(b), new THREE.Vector3()).multiplyScalar(1 / pts.length);
  // Newell normal, pointed up.
  const n = new THREE.Vector3();
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    n.x += (a.y - b.y) * (a.z + b.z); n.y += (a.z - b.z) * (a.x + b.x); n.z += (a.x - b.x) * (a.y + b.y);
  }
  n.normalize(); if (n.y < 0) n.negate();
  return { pts, c, n };
}

function planeMesh(p: RoofPlane, lift: number, mat: THREE.Material) {
  const { pts, n } = planeFrame(p);
  const u = new THREE.Vector3().subVectors(pts[1], pts[0]).normalize();
  const v = new THREE.Vector3().crossVectors(n, u).normalize();
  const flat = pts.map((q) => new THREE.Vector2(q.dot(u), q.dot(v)));
  const tris = THREE.ShapeUtils.triangulateShape(flat, []);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pts.flatMap((q) => [q.x + n.x * lift, q.y + n.y * lift, q.z + n.z * lift]), 3));
  g.setIndex(tris.flat());
  return new THREE.Mesh(g, mat);
}

function panelCorners(p: RoofPlane, r: PanelRect): THREE.Vector3[] {
  if (Array.isArray(r)) return r.map(toV);
  // Plane-local rectangle: centre (x, y) in local metres, w along the eave, h up the slope.
  const { n, pts } = planeFrame(p);
  const u0 = new THREE.Vector3().subVectors(pts[1], pts[0]).normalize();
  const v0 = new THREE.Vector3().crossVectors(n, u0).normalize();
  const a = (r.angle * Math.PI) / 180, u = u0.clone().multiplyScalar(Math.cos(a)).addScaledVector(v0, Math.sin(a)), v = new THREE.Vector3().crossVectors(n, u);
  const c = toV([r.x, r.y, 0]);
  const k = pts[0].clone().sub(c).dot(n) / (n.y || 1); c.y += k; // drop the centre onto the plane
  return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => c.clone().addScaledVector(u, (i * r.w) / 2).addScaledVector(v, (j * r.h) / 2));
}

export interface SceneOpts { reduce: boolean; onHour?: (h: number, playing: boolean) => void; compass?: HTMLElement | null; onView?: (mode: "3d" | "2d") => void }

export class SpatialScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private persp = new THREE.PerspectiveCamera(30, 1, 0.5, 600);
  private ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.5, 600);
  private camera: THREE.Camera = this.persp;
  private mode: "3d" | "2d" = "3d";
  private controls: OrbitControls;
  private controls2d: OrbitControls;   // 2D plan: pan and pinch zoom, no rotation
  private tap = { t: 0, x: 0, y: 0 };
  private glbRoot: THREE.Object3D | null = null;
  private flattened = false;
  private ro: ResizeObserver;
  private raf = 0;
  private alive = true;
  private clock = new THREE.Clock();
  private placeholder = new THREE.Group();
  private outlines = new THREE.Group();
  private tints = new THREE.Group();
  private panels = new THREE.Group();
  private kit = new THREE.Group();
  private sunGroup = new THREE.Group();
  private sunDot!: THREE.Mesh;
  private sunLight = new THREE.DirectionalLight(0xffffff, 1.6);
  private targets: { p: RoofPlane; c: THREE.Vector3; n: THREE.Vector3; tint: THREE.Mesh }[] = [];
  private centre = new THREE.Vector3();
  private span = 14;
  private anchors = { roof: new THREE.Vector3(), home: new THREE.Vector3(), batt: new THREE.Vector3(), grid: new THREE.Vector3() };
  private focusPts: Record<Focus, THREE.Vector3> = { roof: new THREE.Vector3(), house: new THREE.Vector3(), drive: new THREE.Vector3(), battery: new THREE.Vector3(), wallbox: new THREE.Vector3(), west: new THREE.Vector3() };
  private fitD = 40;
  private wallbox: THREE.Mesh | null = null;
  private fly: { pos: THREE.Vector3; tgt: THREE.Vector3; top: boolean } | null = null;
  private pose: Pose | null = null;
  private vPos = new THREE.Vector3();
  private vTgt = new THREE.Vector3();
  private batteryBox!: THREE.Mesh;
  private labels: Label[] = [];
  private labelEls = new Map<string, HTMLDivElement>();
  private panelAnim: { g: THREE.Object3D; from: THREE.Vector3; delay: number; mats: THREE.Material[] }[] = [];
  private panelT = -1;
  private tintMode: "off" | "yield" | "sun" = "off";
  private yieldScale: [number, number] = [500, 1110];
  private day: DayHour[] | null = null;
  private dayT = 0;
  private playing = false;
  private lastHour = -1;
  private flowPaths: Record<string, SVGPathElement> = {};
  private nodeLabels: Record<string, string> = {};
  private dash = 0;
  private wallMesh: THREE.Mesh | null = null;
  private wallMat: THREE.Material | null = null;
  private box = new THREE.Box3();
  private heat: Envelope | null = null;
  private plan: Plan | null = null;
  private planG: SVGGElement | null = null;
  private shade = new ShadeLayer();
  private ctxLines = new THREE.Group(); // neighbours' footprints on the white ground

  constructor(private host: HTMLElement, private overlay: HTMLElement, private svg: SVGSVGElement, private opts: SceneOpts) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "low-power" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(PAPER, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(this.renderer.domElement);
    this.renderer.domElement.setAttribute("aria-hidden", "true");

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xd6d1c5, 1.9));
    this.sunLight.position.set(-20, 30, 25);
    this.scene.add(this.sunLight);
    this.scene.add(this.ctxLines, this.placeholder, this.outlines, this.tints, this.panels, this.kit, this.sunGroup);

    // Touch moves the model, never the page.
    this.renderer.domElement.style.touchAction = "none";
    this.controls = new OrbitControls(this.persp, this.renderer.domElement);
    // One finger rotates, two fingers pan and pinch; right-drag or shift-drag pans with a mouse.
    this.controls.enablePan = true;
    this.controls.screenSpacePanning = true;
    this.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    this.controls.enableDamping = !opts.reduce;
    this.controls.dampingFactor = 0.12;
    this.controls.maxPolarAngle = Math.PI * 0.46;
    this.controls.minPolarAngle = Math.PI * 0.08;
    this.controls.autoRotate = false;
    // A drag takes the camera back from the reasoning chain at once.
    this.controls.addEventListener("start", () => { this.fly = null; this.pose = null; this.vPos.set(0, 0, 0); this.vTgt.set(0, 0, 0); this.controls.minPolarAngle = Math.PI * 0.08; });

    this.ortho.up.set(0, 0, -1);
    this.controls2d = new OrbitControls(this.ortho, this.renderer.domElement);
    Object.assign(this.controls2d, { enableRotate: false, enablePan: true, screenSpacePanning: true, enableDamping: !opts.reduce, dampingFactor: 0.12, minZoom: 0.7, maxZoom: 5, enabled: false });
    this.controls2d.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };
    this.controls2d.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    this.controls2d.addEventListener("start", () => { this.fly = null; this.pose = null; });
    // Double tap or double click puts the house back in frame.
    this.renderer.domElement.addEventListener("pointerup", this.onTap);
    this.shade.mount(overlay, this.renderer.domElement);

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
    this.loop();
  }

  private resize() {
    const w = this.host.clientWidth || 1, h = this.host.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    this.persp.aspect = w / h;
    this.persp.updateProjectionMatrix();
    this.setOrtho(w / h);
    this.svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    this.fit(false);
  }

  private setOrtho(a: number) {
    // Top-down on the house itself with a margin of street around it.
    const c = this.box.isEmpty() ? this.centre : this.box.getCenter(new THREE.Vector3());
    const sz = this.box.isEmpty() ? new THREE.Vector3(this.span, 0, this.span) : this.box.getSize(new THREE.Vector3());
    const half = this.plan ? Math.max(sz.x, sz.z) * 0.62 + 4 : Math.max(sz.x, sz.z) * 1.1 + 4;
    const hh = a >= 1 ? half : half / a, hw = hh * a;
    Object.assign(this.ortho, { left: -hw, right: hw, top: hh, bottom: -hh });
    this.ortho.position.set(c.x, 120, c.z);
    this.ortho.up.set(0, 0, -1); // north up
    this.ortho.lookAt(c.x, 0, c.z);
    this.ortho.zoom = 1;
    this.ortho.updateProjectionMatrix();
    if (this.controls2d) { this.controls2d.target.set(c.x, 0, c.z); this.controls2d.update(); }
  }

  // 2D: straight down, north up, no rotation. 3D: drag to rotate.
  setView(mode: "3d" | "2d") {
    this.mode = mode;
    this.camera = mode === "2d" ? this.ortho : this.persp;
    this.controls.enabled = mode === "3d";
    this.controls2d.enabled = mode === "2d";
    this.setOrtho(this.persp.aspect);
  }

  private fit(reset: boolean) {
    const a = this.persp.aspect, vfov = (this.persp.fov * Math.PI) / 180;
    const half = this.span / 2, need = Math.max(half / Math.tan(vfov / 2), half / (Math.tan(vfov / 2) * a));
    const d = need * 1.6;
    if (reset || !this.fitted) {
      const dir = new THREE.Vector3(0.42, 0.62, 0.66).normalize();
      this.persp.position.copy(this.centre).addScaledVector(dir, d);
      this.fitted = true;
    } else {
      const cur = this.persp.position.clone().sub(this.controls.target).normalize();
      this.persp.position.copy(this.centre).addScaledVector(cur, d);
    }
    this.fitD = d;
    if (!this.fly) this.controls.target.copy(this.centre);
    this.controls.minDistance = d * 0.55;
    this.controls.maxDistance = d * 1.8;
    // A stage pose survives a resize or a new design: re-aim at it (no animation unless already flying).
    if (this.pose && this.fitted) {
      const g = this.goalOf(this.pose);
      if (this.fly) { this.fly.pos.copy(g.pos); this.fly.tgt.copy(g.tgt); }
      else { this.persp.position.copy(g.pos); this.controls.target.copy(g.tgt); }
    }
    this.controls.update();
  }
  private goalOf(p: Pose) {
    const tgt = this.focusPts[p.focus].clone();
    return { tgt, pos: tgt.clone().addScaledVector(poseOffset(p), this.fitD * p.dist) };
  }
  private fitted = false;

  // Moves the camera to a stage's pose on one smooth spring (0.6 s, bounce 0) from wherever it is now, keeping
  // its velocity if a new stage arrives mid-flight. A top-down pose ends in the 2D plan. Reduce Motion: a cut.
  flyTo(p: Pose) {
    this.pose = p;
    const { pos, tgt } = this.goalOf(p);
    if (this.mode === "2d" && !p.topDown) { this.setView("3d"); this.opts.onView?.("3d"); }
    this.controls.minPolarAngle = p.topDown ? 0 : Math.PI * 0.08;
    if (this.opts.reduce) {
      this.persp.position.copy(pos); this.controls.target.copy(tgt); this.controls.update();
      this.fly = null;
      if (p.topDown) { this.setView("2d"); this.opts.onView?.("2d"); }
      return;
    }
    this.fly = { pos, tgt, top: !!p.topDown };
  }

  setModel(model: RoofModel) {
    this.targets = [];
    [this.placeholder, this.outlines, this.tints, this.kit, this.sunGroup, this.ctxLines].forEach((g) => g.clear());
    this.ctxLines.add(outlineMesh(neighbourEdges(model.planes)));
    const target = model.planes.filter((p) => p.is_target);
    this.shade.setPlanes(target);
    const ys = model.planes.map((p) => p.yield_shaded_kwh_per_kwp ?? p.yield_kwh_per_kwp).filter((x) => x > 0);
    this.yieldScale = [Math.min(...ys), Math.max(...ys)];

    // Paper-grey placeholder of every roof plane until the glb arrives.
    const ph = new THREE.MeshLambertMaterial({ color: "#D6D1C5", side: THREE.DoubleSide });
    const pt = new THREE.MeshLambertMaterial({ color: "#C9C3B6", side: THREE.DoubleSide });
    // Neighbours are not raised: only the target's planes stand in until the glb arrives.
    void ph;
    target.forEach((p) => this.placeholder.add(planeMesh(p, 0, pt)));

    const box = new THREE.Box3();
    target.forEach((p) => {
      const f = planeFrame(p);
      f.pts.forEach((q) => box.expandByPoint(q));
      const line = new THREE.LineLoop(
        new THREE.BufferGeometry().setFromPoints(f.pts.map((q) => q.clone().addScaledVector(f.n, 0.06))),
        new THREE.LineBasicMaterial({ color: BLUE }),
      );
      this.outlines.add(line);
      const tint = planeMesh(p, 0.04, new THREE.MeshBasicMaterial({ color: PAPER.clone(), transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
      tint.renderOrder = 2;
      this.tints.add(tint);
      this.targets.push({ p, c: f.c, n: f.n, tint });
    });
    if (box.isEmpty()) box.setFromCenterAndSize(new THREE.Vector3(0, 4, 0), new THREE.Vector3(12, 8, 12));
    box.expandByPoint(new THREE.Vector3(box.min.x, 0, box.min.z));
    this.box.copy(box);
    if (this.glbRoot && !this.box.isEmpty()) this.flattenNeighbours(this.glbRoot);
    const size = box.getSize(new THREE.Vector3());
    // Battery: a block beside the house on the east side; grid: a pole at the edge of the plot.
    const bx = box.min.x + 1.2, bz = box.max.z + 1.1; // in front of the south-west corner, where the camera sees it
    this.batteryBox = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.5, 0.6), new THREE.MeshLambertMaterial({ color: "#FAF8F3" }));
    this.batteryBox.position.set(bx, 0.75, bz);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(this.batteryBox.geometry), new THREE.LineBasicMaterial({ color: INK }));
    this.batteryBox.add(edges);
    const gx = box.max.x + 5, gz = box.min.z + 3;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 7.5, 8), new THREE.MeshLambertMaterial({ color: "#4A4C55" }));
    pole.position.set(gx, 3.75, gz);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.08, 0.08), new THREE.MeshLambertMaterial({ color: "#4A4C55" }));
    arm.position.set(gx, 7.1, gz);
    this.kit.add(this.batteryBox, pole, arm);
    this.kit.visible = false;

    this.centre.set((box.min.x + gx) / 2, size.y * 0.4, (box.min.z + gz) / 2);
    this.span = Math.max(gx - box.min.x, gz - box.min.z, size.y) + 4;
    this.anchors.roof.copy(box.getCenter(new THREE.Vector3())).setY(box.max.y - 0.6);
    this.anchors.home.set((box.min.x + box.max.x) / 2, Math.max(1.6, box.min.y * 0.4), box.max.z);
    this.anchors.batt.set(bx, 1.5, bz);
    this.anchors.grid.set(gx, 7.1, gz);
    const bc = box.getCenter(new THREE.Vector3()), midZ = (box.min.z + box.max.z) / 2;
    this.focusPts.roof.copy(this.anchors.roof);
    this.focusPts.house.set(bc.x, size.y * 0.4, bc.z);
    // Close-up foci sit at mid-height, so the house stays in frame while the camera looks at its base.
    const fy = size.y * 0.45;
    this.focusPts.battery.set((bx + bc.x) / 2, fy, bz - 1);
    this.focusPts.drive.set(box.max.x + 1.5, fy, box.max.z);
    this.focusPts.wallbox.set(box.max.x, fy, box.max.z - 1.5);
    this.focusPts.west.set(box.min.x, fy, midZ);
    // Wallbox: a small EV-blue box on the wall by the drive, shown only when the design has one.
    this.wallbox = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.6, 0.2), new THREE.MeshLambertMaterial({ color: "#1c71ef" }));
    this.wallbox.position.set(box.max.x + 0.12, 1.3, box.max.z - 1.5);
    this.wallbox.add(new THREE.LineSegments(new THREE.EdgesGeometry(this.wallbox.geometry), new THREE.LineBasicMaterial({ color: INK })));
    this.wallbox.visible = false;
    this.kit.add(this.wallbox);

    // Sun path for the day layer.
    const path: THREE.Vector3[] = [];
    for (let h = 6; h <= 20; h += 0.25) path.push(this.sunPos(h));
    const arc = new THREE.Line(new THREE.BufferGeometry().setFromPoints(path), new THREE.LineDashedMaterial({ color: SUN, dashSize: 0.6, gapSize: 0.5 }));
    arc.computeLineDistances();
    this.sunDot = new THREE.Mesh(new THREE.SphereGeometry(0.7, 16, 12), new THREE.MeshBasicMaterial({ color: SUN }));
    this.sunGroup.add(arc, this.sunDot);
    this.sunGroup.visible = false;

    this.fit(!this.modelSet); // keep the planner's camera when only the design changes
    this.modelSet = true;
    this.setOrtho(this.persp.aspect);
  }
  private modelSet = false;

  // A spring weekday in Munich: sunrise about 06:00, sunset about 20:00 (summer time), noon height about 55 degrees.
  private sunPos(h: number) {
    const f = (h - 6) / 14, az = (90 + f * 180) * (Math.PI / 180), el = Math.max(0, Math.sin(Math.PI * f)) * 55 * (Math.PI / 180);
    const r = this.span * 1.05;
    return new THREE.Vector3(this.centre.x + Math.sin(az) * Math.cos(el) * r, Math.sin(el) * r + 1, this.centre.z - Math.cos(az) * Math.cos(el) * r);
  }

  loadGlb(url: string, onDone: (err: string | null) => void) {
    new GLTFLoader().load(url, (gltf) => {
      if (!this.alive) return;
      gltf.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const name = (m.name || m.parent?.name || "").toLowerCase();
        const old = m.material as THREE.MeshStandardMaterial;
        if (name.startsWith("context")) m.material = new THREE.MeshLambertMaterial({ color: NEIGHBOUR, side: THREE.DoubleSide, transparent: true, opacity: 0.35, depthWrite: false });
        else if (name.startsWith("walls")) { m.material = new THREE.MeshLambertMaterial({ color: WALL, side: THREE.DoubleSide }); this.wallMesh = m; this.wallMat = m.material; }
        else if (old && old.map) { old.map.anisotropy = 4; m.material = new THREE.MeshLambertMaterial({ map: old.map, side: THREE.DoubleSide }); }
      });
      // The target footprint comes with the roof model; until it is in, flatten later.
      this.glbRoot = gltf.scene; this.flattened = false;
      if (!this.box.isEmpty()) this.flattenNeighbours(gltf.scene);
      whiteFallback(gltf.scene);
      this.scene.add(gltf.scene);
      this.placeholder.visible = false;
      if (this.heat) this.setHeat(this.heat);
      onDone(null);
    }, undefined, (e) => onDone((e as Error)?.message || "The house model did not load."));
  }

  // Only the house we explain stands up. Neighbours' roofs and walls drop to a 0.4 m slab on the ground, so the
  // street still reads and nothing hides the facade; their shade is already in the engine's numbers.
  private flattenNeighbours(root: THREE.Object3D) {
    if (this.flattened) return;
    this.flattened = true;
    root.updateMatrixWorld(true);
    let ground = 0;
    root.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && (m.name || "").toLowerCase().startsWith("ground")) ground = new THREE.Box3().setFromObject(m).max.y; });
    const own = this.box.isEmpty() ? null : this.box.clone().expandByVector(new THREE.Vector3(1, 0, 1));
    const v = new THREE.Vector3(), inv = new THREE.Matrix4();
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const name = (m.name || m.parent?.name || "").toLowerCase(), ctx = name.startsWith("context"), walls = name.startsWith("walls");
      if (!ctx && !walls) return;
      const g = m.geometry.clone(), pos = g.attributes.position as THREE.BufferAttribute;
      inv.copy(m.matrixWorld).invert();
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
        const mine = own && v.x >= own.min.x && v.x <= own.max.x && v.z >= own.min.z && v.z <= own.max.z;
        if (ctx || !mine) { v.y = Math.min(v.y, ground + 0.4); v.applyMatrix4(inv); pos.setXYZ(i, v.x, v.y, v.z); }
      }
      pos.needsUpdate = true; g.computeVertexNormals(); g.computeBoundingBox(); g.computeBoundingSphere();
      m.geometry = g;
    });
  }

  setPanels(list: { p: RoofPlane; r: PanelRect }[], animate: boolean) {
    this.panels.clear();
    this.panelAnim = [];
    const fill = new THREE.MeshBasicMaterial({ color: "#151826", side: THREE.DoubleSide });
    const edge = new THREE.LineBasicMaterial({ color: "#F4F1EA", transparent: true, opacity: 0.85 });
    const per: Record<string, number> = {};
    list.forEach(({ p, r }, i) => {
      const f = planeFrame(p);
      const cs = panelCorners(p, r).map((q) => q.addScaledVector(f.n, 0.09));
      const g = new THREE.BufferGeometry().setFromPoints(cs);
      g.setIndex([0, 1, 2, 0, 2, 3]);
      const grp = new THREE.Group();
      const mats = animate ? [fill.clone(), edge.clone()] : [fill, edge];
      const quad = new THREE.Mesh(g, mats[0]);
      quad.renderOrder = 3;
      const ln = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(cs), mats[1]);
      grp.add(quad, ln);
      grp.userData = { plane: p.id, idx: (per[p.id] = (per[p.id] ?? -1) + 1), cs, n: f.n }; // shading.ts reads these
      this.panels.add(grp);
      if (animate) {
        mats.forEach((m) => { m.transparent = true; m.opacity = 0; });
        const from = f.n.clone().multiplyScalar(1.4);
        grp.position.copy(from);
        this.panelAnim.push({ g: grp, from, delay: i * 0.04, mats });
      }
    });
    this.panelT = animate ? 0 : -1;
    this.shade.setPanels(this.panels);
  }

  setShading(d: Shading | null, on: boolean, at: ShadeAt) { this.shade.set(d, on, at); }

  setTint(mode: "off" | "yield" | "sun") {
    this.tintMode = mode;
    const [lo, hi] = this.yieldScale;
    this.targets.forEach(({ p, tint }) => {
      const m = tint.material as THREE.MeshBasicMaterial;
      if (mode === "yield") {
        const y = p.yield_shaded_kwh_per_kwp ?? p.yield_kwh_per_kwp;
        const s = Math.max(0, Math.min(1, (y - lo) / Math.max(1, hi - lo)));
        m.color.copy(PAPER).lerp(BLUE, 0.15 + 0.85 * s);
        m.opacity = 0.86;
      } else if (mode === "off") m.opacity = 0;
    });
  }

  setWallbox(on: boolean) { if (this.wallbox) this.wallbox.visible = on; }

  show(o: { outlines: boolean; panels: boolean; kit: boolean; sun: boolean; battery: "plain" | "lit" }) {
    this.outlines.visible = o.outlines;
    this.panels.visible = o.panels;
    this.kit.visible = o.kit;
    this.sunGroup.visible = o.sun;
    if (this.batteryBox) (this.batteryBox.material as THREE.MeshLambertMaterial).color.set(o.battery === "lit" ? "#24a148" : "#FAF8F3");
    if (!o.sun) this.setFlows(null);
  }

  // Heat layer: walls tinted per triangle by the W/m2 of the envelope face with the nearest azimuth,
  // the roof faces by theirs, paper to orange. Only the target house is tinted.
  setHeat(env: Envelope | null) {
    this.heat = env;
    const wm = this.wallMesh;
    if (!env) {
      if (wm && this.wallMat) wm.material = this.wallMat;
      this.targets.forEach(({ tint }) => ((tint.material as THREE.MeshBasicMaterial).opacity = 0));
      return [] as Label[];
    }
    const dens = env.faces.filter((f) => f.area_m2 > 0).map((f) => f.loss_w / f.area_m2);
    const hi = Math.max(1, ...dens);
    const col = (wm2: number) => PAPER.clone().lerp(SUN, 0.12 + 0.88 * Math.min(1, wm2 / hi));
    const walls = env.faces.filter((f) => /wall|window|door/i.test(f.kind) && f.azimuth != null);
    const byAz = new Map<number, { loss: number; area: number }>();
    walls.forEach((f) => { const k = Math.round((f.azimuth as number) / 45) * 45 % 360; const v = byAz.get(k) ?? { loss: 0, area: 0 }; v.loss += f.loss_w; v.area += f.area_m2; byAz.set(k, v); });
    const nearest = (az: number) => { let best: number | null = null, d = 999; byAz.forEach((_, k) => { const x = Math.abs(((az - k + 540) % 360) - 180); if (x < d) { d = x; best = k; } }); return best; };
    if (wm) {
      const g = (wm.geometry.index ? wm.geometry.toNonIndexed() : wm.geometry.clone());
      const pos = g.getAttribute("position"), colors = new Float32Array(pos.count * 3);
      const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), m = new THREE.Vector3();
      const inHouse = this.box.clone().expandByScalar(0.8);
      wm.updateWorldMatrix(true, false);
      for (let i = 0; i < pos.count; i += 3) {
        a.fromBufferAttribute(pos, i).applyMatrix4(wm.matrixWorld); b.fromBufferAttribute(pos, i + 1).applyMatrix4(wm.matrixWorld); c.fromBufferAttribute(pos, i + 2).applyMatrix4(wm.matrixWorld);
        m.copy(a).add(b).add(c).multiplyScalar(1 / 3);
        n.subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
        let k: THREE.Color = new THREE.Color(WALL);
        if (inHouse.containsPoint(new THREE.Vector3(m.x, Math.min(m.y, inHouse.max.y - 0.1), m.z))) {
          // Outward normal: away from the house centre.
          const ctr = this.box.getCenter(new THREE.Vector3());
          if (n.dot(m.clone().sub(ctr)) < 0) n.negate();
          const az = ((Math.atan2(n.x, -n.z) * 180) / Math.PI + 360) % 360;
          const key = nearest(az), v = key == null ? null : byAz.get(key);
          if (v && v.area > 0) k = col(v.loss / v.area);
        }
        for (let j = 0; j < 3; j++) colors.set([k.r, k.g, k.b], (i + j) * 3);
      }
      g.setAttribute("color", new THREE.BufferAttribute(colors, 3));
      wm.geometry = g;
      wm.material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    }
    const roof = env.faces.filter((f) => /roof|ceiling/i.test(f.kind));
    const roofLoss = roof.reduce((x, f) => x + f.loss_w, 0), roofArea = roof.reduce((x, f) => x + f.area_m2, 0);
    this.targets.forEach(({ tint }) => {
      const mt = tint.material as THREE.MeshBasicMaterial;
      if (roofArea > 0) { mt.color.copy(col(roofLoss / roofArea)); mt.opacity = 0.9; } else mt.opacity = 0;
    });
    const ctr = this.box.getCenter(new THREE.Vector3()), size = this.box.getSize(new THREE.Vector3());
    const W = (x: number) => `<b>${Math.round(x).toLocaleString("en-GB")}</b> W`;
    const labels: Label[] = [];
    byAz.forEach((v, k) => {
      const r = (k * Math.PI) / 180, dx = Math.sin(r), dz = -Math.cos(r);
      const at = new THREE.Vector3(ctr.x + dx * (size.x / 2 + 0.3), Math.max(2, size.y * 0.3), ctr.z + dz * (size.z / 2 + 0.3));
      labels.push({ key: `heat-w${k}`, at, html: `${facing(k)} walls<br/>${W(v.loss)}` });
    });
    if (roofArea > 0) labels.push({ key: "heat-roof", at: new THREE.Vector3(ctr.x, this.box.max.y + 0.6, ctr.z), html: `roof<br/>${W(roofLoss)}` });
    const floor = env.faces.filter((f) => /floor|ground|base/i.test(f.kind)).reduce((x, f) => x + f.loss_w, 0);
    if (floor > 0) labels.push({ key: "heat-floor", at: new THREE.Vector3(this.box.min.x - 0.5, 0.3, this.box.max.z + 0.5), html: `ground<br/>${W(floor)}` });
    return labels;
  }

  // Plan layer: dimensioned footprint, equipment, clearances and cable run, drawn in SVG over the 2D view.
  setPlan(plan: Plan | null) {
    this.plan = plan;
    this.setOrtho(this.persp.aspect);
    if (!plan) { this.planG?.remove(); this.planG = null; return; }
    if (!this.planG) { this.planG = document.createElementNS("http://www.w3.org/2000/svg", "g"); this.planG.setAttribute("class", "sp-plan"); this.svg.appendChild(this.planG); }
  }

  private drawPlan() {
    const plan = this.plan, g = this.planG;
    if (!plan || !g) return;
    const pr = (q: [number, number], z = 0.05) => this.project(new THREE.Vector3(q[0], z, -q[1]));
    const f = (v: number) => v.toFixed(1);
    const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    const out: string[] = [];
    const pts = plan.outline.map(p2).filter(Boolean) as [number, number][];
    if (pts.length > 2) {
      const sp = pts.map((q) => pr(q));
      out.push(`<polygon class="pl-outline" points="${sp.map((p) => `${f(p.x)},${f(p.y)}`).join(" ")}"/>`);
      // Dimension lines, offset outward from each edge.
      const cx = pts.reduce((a, q) => a + q[0], 0) / pts.length, cy = pts.reduce((a, q) => a + q[1], 0) / pts.length;
      pts.forEach((a, i) => {
        const b = pts[(i + 1) % pts.length];
        const given = plan.edges?.[i]?.length_m ?? plan.edge_lengths_m?.[i];
        const len = given ?? Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (len < 1.5) return;
        let nx = b[1] - a[1], ny = -(b[0] - a[0]); const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
        const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
        if ((mx - cx) * nx + (my - cy) * ny < 0) { nx = -nx; ny = -ny; }
        const o = 1.4, A = pr([a[0] + nx * o, a[1] + ny * o]), B = pr([b[0] + nx * o, b[1] + ny * o]), A0 = pr(a), B0 = pr(b);
        out.push(`<line class="pl-ext" x1="${f(A0.x)}" y1="${f(A0.y)}" x2="${f(A.x)}" y2="${f(A.y)}"/><line class="pl-ext" x1="${f(B0.x)}" y1="${f(B0.y)}" x2="${f(B.x)}" y2="${f(B.y)}"/>`);
        out.push(`<line class="pl-dim" x1="${f(A.x)}" y1="${f(A.y)}" x2="${f(B.x)}" y2="${f(B.y)}"/>`);
        let ang = (Math.atan2(B.y - A.y, B.x - A.x) * 180) / Math.PI; if (ang > 90) ang -= 180; if (ang < -90) ang += 180;
        const L = pr([mx + nx * (o + 0.9), my + ny * (o + 0.9)]);
        out.push(`<text class="pl-len" x="${f(L.x)}" y="${f(L.y)}" transform="rotate(${ang.toFixed(1)} ${f(L.x)} ${f(L.y)})" text-anchor="middle" dominant-baseline="middle">${len.toFixed(1)} m</text>`);
      });
    }
    const run = Array.isArray(plan.cable_run) ? plan.cable_run : plan.cable_run?.points ?? plan.cable_run?.path ?? null;
    const rp = (run ?? []).map(p2).filter(Boolean) as [number, number][];
    if (rp.length > 1) out.push(`<polyline class="pl-cable" points="${rp.map((q) => pr(q)).map((p) => `${f(p.x)},${f(p.y)}`).join(" ")}"/>`);
    (plan.clearances ?? []).forEach((c) => {
      const at = p2(c.at ?? c.center ?? c.centre ?? (c.x != null && c.y != null ? [c.x, c.y] : null)), r = c.r_m ?? c.radius_m;
      if (!at || !r) return;
      const C = pr(at), E = pr([at[0] + r, at[1]]);
      out.push(`<circle class="pl-clear" cx="${f(C.x)}" cy="${f(C.y)}" r="${f(Math.hypot(E.x - C.x, E.y - C.y))}"/>`);
    });
    const placed: { x0: number; x1: number; y: number }[] = [];
    const cxAll = pts.length ? pts.reduce((a, q) => a + q[0], 0) / pts.length : 0, cyAll = pts.length ? pts.reduce((a, q) => a + q[1], 0) / pts.length : 0;
    [...(plan.equipment ?? []), ...(plan.markers ?? [])].forEach((m) => {
      const at = p2(m.at ?? m.position ?? (m.x != null && m.y != null ? [m.x, m.y] : null));
      if (!at) return;
      const P = pr(at), r = m.clearance_m ?? m.radius_m;
      if (r) { const E = pr([at[0] + r, at[1]]); out.push(`<circle class="pl-clear" cx="${f(P.x)}" cy="${f(P.y)}" r="${f(Math.hypot(E.x - P.x, E.y - P.y))}"/>`); }
      out.push(`<rect class="pl-mark" x="${f(P.x - 5)}" y="${f(P.y - 5)}" width="10" height="10"/>`);
      // Labels only on the drawing (notes go in the caption); markers close together stack their labels.
      // Markers on the east half label to the left, so labels stay over the house and off the dimension lines.
      const C = pr([cxAll, cyAll]), left = P.x > C.x, lx = left ? P.x - 9 : P.x + 9;
      const full = m.label ?? m.kind ?? "", text = this.host.clientWidth < 520 ? full.split(" ").slice(0, 2).join(" ") : full, w = text.length * 6.6 + 4;
      const x0 = left ? lx - w : lx, x1 = left ? lx : lx + w;
      let ly = P.y + 4;
      while (placed.some((q) => Math.abs(q.y - ly) < 14 && q.x0 < x1 && x0 < q.x1)) ly += 14;
      placed.push({ x0, x1, y: ly });
      out.push(`<text class="pl-label" x="${f(lx)}" y="${f(ly)}" text-anchor="${left ? "end" : "start"}">${esc(text)}</text>`);
    });
    const html = out.join("");
    if (g.innerHTML !== html) g.innerHTML = html;
  }

  setLabels(l: Label[]) {
    this.labels = l;
    const keep = new Set(l.map((x) => x.key));
    this.labelEls.forEach((el, k) => { if (!keep.has(k)) { el.remove(); this.labelEls.delete(k); } });
    l.forEach((x) => {
      let el = this.labelEls.get(x.key);
      if (!el) { el = document.createElement("div"); this.overlay.appendChild(el); this.labelEls.set(x.key, el); }
      el.className = `sp-label ${x.cls ?? ""}`;
      el.innerHTML = x.html;
    });
  }

  planeLabels(kind: "roof" | "sun" | "panels", counts?: Record<string, number>): Label[] {
    return this.targets.map(({ p, c, n }) => {
      const at = c.clone().addScaledVector(n, 0.4);
      const html = kind === "roof"
        ? `<b>${facing(p.pitch < 3 ? null : p.azimuth)}, ${Math.round(p.pitch)}°</b><br/><span>azimuth ${p.azimuth == null ? "none" : `${Math.round(p.azimuth)}°`}</span>`
        : kind === "sun"
          ? sunHtml(p)
          : (counts?.[p.id] ?? 0) > 0 || !skipOf(p) ? `<b>${counts?.[p.id] ?? 0}</b> modules` : `No modules<br/><span>${skipOf(p)}</span>`;
      return { key: `${kind}-${p.id}`, at, html };
    });
  }

  nodeLabel(key: "roof" | "home" | "batt" | "grid", html: string) { this.nodeLabels[key] = html; }

  // Day layer: hours of one representative day, played over 12 s.
  setDay(hours: DayHour[] | null, play: boolean) {
    this.day = hours && hours.length ? hours : null;
    this.dayT = this.opts.reduce || !play ? 12 : 0;
    this.playing = !!this.day && play && !this.opts.reduce;
    this.lastHour = -1;
    if (!this.day) { this.setFlows(null); this.tintMode === "sun" && this.setTint("off"); }
  }
  seek(h: number) { this.dayT = h; this.playing = false; this.lastHour = -1; }
  play() { if (!this.day || this.opts.reduce) return; if (this.dayT >= this.day.length - 1) this.dayT = 0; this.playing = true; }
  pause() { this.playing = false; this.lastHour = -1; }

  private setFlows(f: Record<string, number> | null) {
    const keys = ["pvHome", "pvBatt", "pvGrid", "battHome", "gridHome"];
    keys.forEach((k) => {
      let el = this.flowPaths[k];
      if (!el) { el = document.createElementNS("http://www.w3.org/2000/svg", "path"); el.setAttribute("class", `sp-flow sp-${k}`); this.svg.appendChild(el); this.flowPaths[k] = el; }
      const kw = f?.[k] ?? 0;
      el.style.display = kw > 0.03 ? "" : "none";
      el.setAttribute("stroke-width", String(Math.min(26, 1.5 + kw * 3.2)));
    });
  }

  private project(v: THREE.Vector3) {
    const p = v.clone().project(this.camera);
    const w = this.host.clientWidth, h = this.host.clientHeight;
    return { x: ((p.x + 1) / 2) * w, y: ((1 - p.y) / 2) * h, ok: p.z < 1 };
  }

  private onTap = (e: PointerEvent) => {
    const now = performance.now(), near = Math.hypot(e.clientX - this.tap.x, e.clientY - this.tap.y) < 30;
    if (now - this.tap.t < 320 && near) { this.tap.t = 0; this.refit(); return; }
    this.tap = { t: now, x: e.clientX, y: e.clientY };
  };

  // Back to the stage's pose, or the opening view, on the same spring; the plan resets its pan and zoom.
  refit() {
    if (this.mode === "2d") { this.setOrtho(this.persp.aspect); return; }
    if (this.pose) { this.flyTo(this.pose); return; }
    const d = this.fitD, dir = new THREE.Vector3(0.42, 0.62, 0.66).normalize();
    const pos = this.centre.clone().addScaledVector(dir, d), tgt = this.centre.clone();
    if (this.opts.reduce) { this.persp.position.copy(pos); this.controls.target.copy(tgt); this.controls.update(); return; }
    this.fly = { pos, tgt, top: false };
  }

  private loop = () => {
    if (!this.alive) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(0.05, this.clock.getDelta());
    if (this.fly) {
      const a = springStep(this.persp.position, this.vPos, this.fly.pos, dt);
      const b = springStep(this.controls.target, this.vTgt, this.fly.tgt, dt);
      if (a && b) {
        const top = this.fly.top;
        this.fly = null;
        if (top && this.mode !== "2d") { this.setView("2d"); this.opts.onView?.("2d"); }
      }
    }
    this.controls.update();
    if (this.mode === "2d") this.controls2d.update();
    // Panning cannot lose the house: the target stays within one house span of it.
    const off = this.controls.target.clone().sub(this.centre), lim = this.span * 0.9;
    if (!this.fly && off.length() > lim) { const back = off.setLength(lim).add(this.centre), d = back.clone().sub(this.controls.target); this.controls.target.add(d); this.persp.position.add(d); }
    if (this.mode === "2d") {
      const c = this.box.isEmpty() ? this.centre : this.box.getCenter(new THREE.Vector3());
      const o2 = this.controls2d.target.clone().sub(c); o2.y = 0;
      if (o2.length() > lim) { const d = o2.setLength(lim).add(c).sub(this.controls2d.target); d.y = 0; this.controls2d.target.add(d); this.ortho.position.add(d); }
    }

    if (this.panelT >= 0) {
      this.panelT += dt;
      let done = true;
      this.panelAnim.forEach(({ g, from, delay, mats }) => {
        const t = this.panelT - delay, k = springOut(t);
        if (t < 1.2) done = false;
        g.position.copy(from).multiplyScalar(1 - k);
        mats.forEach((m, i) => (m.opacity = Math.min(1, Math.max(0, t / 0.18)) * (i ? 0.85 : 1)));
      });
      if (done) this.panelT = -1;
    }

    if (this.day && this.sunGroup.visible) {
      if (this.playing) {
        this.dayT += (dt * (this.day.length - 1)) / DAY_SECONDS;
        if (this.dayT >= this.day.length - 1) { this.dayT = this.day.length - 1; this.playing = false; this.lastHour = -1; }
      }
      const x = lerpHour(this.day, this.dayT);
      const hi = Math.floor(this.dayT + 1e-6);
      if (hi !== this.lastHour) { this.lastHour = hi; this.opts.onHour?.(this.day[hi]?.h ?? hi, this.playing); }
      const sp = this.sunPos(x.h);
      const up = x.h > 6 && x.h < 20;
      this.sunDot.visible = up;
      this.sunDot.position.copy(sp);
      this.sunLight.position.copy(up ? sp : new THREE.Vector3(-20, 30, 25));
      // The sun on each roof face: its share of today's output, by the angle to the sun.
      const peak = Math.max(0.1, ...this.day.map((d) => d.pv_kw));
      const dir = sp.clone().sub(this.centre).normalize();
      this.targets.forEach(({ n, tint }) => {
        const m = tint.material as THREE.MeshBasicMaterial;
        const cos = Math.max(0, n.dot(dir));
        m.color.copy(PAPER).lerp(SUN, 0.75);
        m.opacity = up ? Math.min(0.8, (x.pv_kw / peak) * (0.25 + cos)) : 0;
      });
      this.tintMode = "sun";
      const f = flowsOf(x) as unknown as Record<string, number>;
      this.setFlows(f);
      if (!this.opts.reduce && this.playing) this.dash -= dt * 40;
      const P = { roof: this.project(this.anchors.roof), home: this.project(this.anchors.home), batt: this.project(this.anchors.batt), grid: this.project(this.anchors.grid) };
      const curve = (a: { x: number; y: number }, b: { x: number; y: number }, bend: number) => {
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2 - bend;
        return `M${a.x.toFixed(1)},${a.y.toFixed(1)} Q${mx.toFixed(1)},${my.toFixed(1)} ${b.x.toFixed(1)},${b.y.toFixed(1)}`;
      };
      const d: Record<string, string> = {
        pvHome: curve(P.roof, P.home, 10), pvBatt: curve(P.roof, P.batt, 30), pvGrid: curve(P.roof, P.grid, 50),
        battHome: curve(P.batt, P.home, -20), gridHome: curve(P.grid, P.home, -30),
      };
      Object.entries(this.flowPaths).forEach(([k, el]) => { el.setAttribute("d", d[k]); el.style.strokeDashoffset = String(this.dash); });
      const kw = (v: number) => v.toLocaleString("en-GB", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
      this.nodeLabels.roof = `Solar <b>${kw(x.pv_kw)}</b> kW`;
      this.nodeLabels.home = `Home <b>${kw(x.load_kw)}</b> kW`;
      this.nodeLabels.batt = `Battery <b>${kw(x.soc_kwh)}</b> kWh`;
      this.nodeLabels.grid = x.grid_kw >= 0 ? `Grid in <b>${kw(x.grid_kw)}</b> kW` : `Grid out <b>${kw(-x.grid_kw)}</b> kW`;
    }

    // Floating labels.
    const all: Label[] = [...this.labels];
    if (this.day && this.sunGroup.visible) {
      (["roof", "home", "batt", "grid"] as const).forEach((k) => all.push({ key: `node-${k}`, at: this.anchors[k], html: this.nodeLabels[k] ?? "", cls: `node node-${k}` }));
      const keys = new Set(all.map((a) => a.key));
      all.forEach((x) => {
        if (!this.labelEls.has(x.key)) { const el = document.createElement("div"); el.className = `sp-label ${x.cls ?? ""}`; this.overlay.appendChild(el); this.labelEls.set(x.key, el); }
      });
      this.labelEls.forEach((el, k) => { if (!keys.has(k)) { el.remove(); this.labelEls.delete(k); } });
    } else {
      this.labelEls.forEach((el, k) => { if (k.startsWith("node-")) { el.remove(); this.labelEls.delete(k); } });
    }
    all.forEach((x) => {
      const el = this.labelEls.get(x.key);
      if (!el) return;
      if (x.key.startsWith("node-") && el.innerHTML !== x.html) el.innerHTML = x.html;
      const p = this.project(x.at);
      el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) ${x.key === "node-batt" ? "translate(-50%, 10px)" : "translate(-50%, -100%)"}`;
      el.style.visibility = p.ok ? "visible" : "hidden";
    });

    if (this.plan) this.drawPlan();
    this.shade.frame(this.camera, this.mode, (v) => this.project(v), this.host.clientWidth);
    if (this.opts.compass) {
      // Screen direction of north (local -z in three).
      const a = this.project(this.centre), b = this.project(this.centre.clone().add(new THREE.Vector3(0, 0, -5)));
      const ang = Math.atan2(b.x - a.x, -(b.y - a.y));
      this.opts.compass.style.transform = `rotate(${ang.toFixed(3)}rad)`;
    }
    this.renderer.render(this.scene, this.camera);
  };

  dispose() {
    this.alive = false;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.controls.dispose();
    this.controls2d.dispose();
    this.renderer.domElement.removeEventListener("pointerup", this.onTap);
    this.labelEls.forEach((el) => el.remove());
    Object.values(this.flowPaths).forEach((el) => el.remove());
    this.planG?.remove();
    this.shade.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      mats.forEach((x) => { (x as THREE.MeshLambertMaterial).map?.dispose(); x.dispose(); });
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
