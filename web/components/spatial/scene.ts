// The three.js side of the spatial demonstration. Loaded with a dynamic import so three never
// reaches the first paint. Local metres from the engine are x east, y north, z up; three uses
// x east, y up, z south (the same as the glb), so a local point (x, y, z) becomes (x, z, -y).
// Orbit momentum (camera.ts): scene.cancelMomentum() stops a flick; chips, Reset view, Face north and 2D/3D call it.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { DayHour, Envelope, PanelRect, Plan, RoofModel, RoofPlane, V3 } from "./types";
import { flowsOf, lerpHour, p2 } from "./types";
import { facing } from "./facing";
import { SYSTEM_EVENT } from "@/components/systems/system";
import { poseOffset, springStep, type Focus, type Pose, releaseRate, startCoast, stepCoast, type Coast, type Sample } from "./camera";
import { ShadeLayer } from "./shading";
import { neighbourEdges, outlineMesh, registerGlb } from "./whiteContext";
import { Xray } from "./xray";
import { Systems, type System } from "./systems";
import { googleGround, sharpen } from "./satGround";
import { BATTERY, HEATPUMP, INVERTER, WALLBOX, battery, heatPump, inverter, wallbox, withEdges } from "./kitMeshes";
import type { ShadeAt, Shading } from "@/lib/shading";

const PAPER = new THREE.Color("#fdfdfb");
const BLUE = new THREE.Color("#374be6");
const SUN = new THREE.Color("#E8730C");
const INK = "#0A0C14";
const NEIGHBOUR = "#B4B1A9";
const WALL = "#E2DED4";
const WALL_MASS = "#F6F3EC";

const toV = ([x, y, z]: V3) => new THREE.Vector3(x, z, -y);
const OMEGA = (2 * Math.PI) / 0.5; // spring duration 0.5 s, bounce 0 (critically damped)
const springOut = (t: number) => (t <= 0 ? 0 : 1 - (1 + OMEGA * t) * Math.exp(-OMEGA * t));
// Variant switches: modules and units come and go on a 0.25 s spring, bounce 0 (critically damped).
const OMEGA_Q = (2 * Math.PI) / 0.25;
const springQ = (t: number) => (t <= 0 ? 0 : 1 - (1 + OMEGA_Q * t) * Math.exp(-OMEGA_Q * t));
type Fx = { g: THREE.Object3D; t: number; dir: 1 | -1; mats: { m: THREE.Material; base: number }[]; c: THREE.Vector3 };
type Fade = { a: number; v: number; goal: number };
const DAY_SECONDS = 12;

// prio: when two labels come within 24 px the lesser hides. tap: a roof plane's label that shows only once that plane is tapped.
// unit: a pill that belongs to a part on the model. Each frame it sits on the part's own top (top, in the part's
// frame) and hides when the roof or walls stand between the camera and the part's centre (mid).
export type Label = { key: string; at: THREE.Vector3; html: string; cls?: string; prio?: number; tap?: string; unit?: { obj: THREE.Object3D; top: THREE.Vector3; mid: THREE.Vector3 } };
const GAP = 24;
// On-model chips: one line each, never more than four on screen; a chip that would overlap another tries below,
// left and right of its anchor before it hides.
const MAX_CHIPS = 4, CHIP_GAP = 6;
const kwpS = (x: number) => x.toLocaleString("en-GB", { maximumFractionDigits: 2 });



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

export interface SceneOpts { reduce: boolean; onZoom?: (can: { in: boolean; out: boolean }) => void; onHour?: (h: number, playing: boolean) => void; compass?: HTMLElement | null; onView?: (mode: "3d" | "2d") => void }

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
  private down = { x: 0, y: 0 };
  private tapped: string | null = null;
  private labelSize = new Map<string, { w: number; h: number }>();
  private wallGeo: THREE.BufferGeometry | null = null;
  private wallEdges: THREE.LineSegments | null = null;
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
  private hpGroup = new THREE.Group(); // the heat pump unit: outside the kit layers, so the heat pump step shows it too
  private sunGroup = new THREE.Group();
  private sunDot!: THREE.Mesh;
  private sunLight = new THREE.DirectionalLight(0xffffff, 1.6);
  private targets: { p: RoofPlane; c: THREE.Vector3; n: THREE.Vector3; tint: THREE.Mesh }[] = [];
  private centre = new THREE.Vector3();
  private span = 14;
  private anchors = { roof: new THREE.Vector3(), home: new THREE.Vector3(), batt: new THREE.Vector3(), grid: new THREE.Vector3() };
  private focusPts: Record<Focus, THREE.Vector3> = { roof: new THREE.Vector3(), house: new THREE.Vector3(), drive: new THREE.Vector3(), battery: new THREE.Vector3(), wallbox: new THREE.Vector3(), west: new THREE.Vector3() };
  private fitD = 40;
  private wallbox: THREE.Object3D | null = null;
  // Live anchors for the size pills: the same vectors are re-projected every frame, so a pill follows its unit
  // when snapUnits moves it onto the wall after the building model loads.
  private wbAt = new THREE.Vector3();
  private battAt = new THREE.Vector3();
  private occluders: THREE.Mesh[] = []; // the house's roof and walls, for hiding a pill whose part is behind them
  private occRay = new THREE.Raycaster();
  private gridPole = new THREE.Group(); // the grid connection, shown only with the day flow's "Grid" label
  private inverterUnit: THREE.Object3D | null = null;
  private hpUnit: THREE.Object3D | null = null;
  private fly: { pos: THREE.Vector3; tgt: THREE.Vector3; top: boolean } | null = null;
  private pose: Pose | null = null;
  private home: Pose | null = null;   // the current step's framing, kept when the planner drags away; Re-centre returns to it
  private spin: { a: number; v: number; h: number; y: number } | null = null;   // compass turn to north
  private vPos = new THREE.Vector3();
  private vTgt = new THREE.Vector3();
  private batteryBox!: THREE.Mesh;
  private labels: Label[] = [];
  private labelEls = new Map<string, HTMLDivElement>();
  private panelAnim: { g: THREE.Object3D; from: THREE.Vector3; delay: number; mats: THREE.Material[] }[] = [];
  private panelT = -1;
  private panelsOut = new THREE.Group();   // modules leaving after a variant switch, fading out
  private panelFx: Fx[] = [];
  private fades = new Map<THREE.Object3D, Fade>();
  private geoKey = "";
  private wbOn = false; private battOn = true;
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
  private xray = new Xray({ walls: () => this.wallMesh, box: this.box, planes: () => this.targets.map((t) => t.p), root: this.scene,
    overlay: () => this.overlay ?? null, project: (v) => this.project(v), camera: () => this.camera, reduce: () => !!this.opts?.reduce });
  // Per-system layers (systems.ts); it reads this scene's anchors, kit and sun lazily, so it can be made here.
  private systems = new Systems(this as unknown as ConstructorParameters<typeof Systems>[0]);
  private ctxOff: (() => void)[] = [];   // the white-context and ground subscriptions of this glb
  private groundOrigin: [number, number, number] | null = null; // wanted satellite ground, applied once the glb is in
  private groundOff: (() => void) | null = null;
  private groundKey = "";

  constructor(private host: HTMLElement, private overlay: HTMLElement, private svg: SVGSVGElement, private opts: SceneOpts) {
    this.renderer = takeRenderer();
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(PAPER, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(this.renderer.domElement);
    this.renderer.domElement.setAttribute("aria-hidden", "true");

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xd6d1c5, 1.9));
    this.sunLight.position.set(-20, 30, 25);
    this.scene.add(this.sunLight);
    this.scene.add(this.ctxLines, this.placeholder, this.outlines, this.tints, this.panels, this.panelsOut, this.kit, this.hpGroup, this.gridPole, this.sunGroup);

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
    this.controls.addEventListener("start", () => { this.dragging = true; });
    this.controls.addEventListener("end", () => { this.dragging = false; });
    this.controls.addEventListener("start", () => { this.coast = null; this.fly = null; this.pose = null; this.spin = null; this.vPos.set(0, 0, 0); this.vTgt.set(0, 0, 0); this.controls.minPolarAngle = Math.PI * 0.08; });

    this.ortho.up.set(0, 0, -1);
    this.controls2d = new OrbitControls(this.ortho, this.renderer.domElement);
    Object.assign(this.controls2d, { enableRotate: false, enablePan: true, screenSpacePanning: true, enableDamping: !opts.reduce, dampingFactor: 0.12, minZoom: 0.7, maxZoom: 5, enabled: false });
    this.controls2d.touches = { ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN };
    this.controls2d.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    this.controls2d.addEventListener("start", () => { this.fly = null; this.pose = null; this.zoom2 = null; this.zoom2V = 0; });
    // Double tap or double click puts the house back in frame.
    this.renderer.domElement.addEventListener("pointerup", this.onTap);
    this.renderer.domElement.addEventListener("pointerdown", this.onDown);
    // Orbit momentum (camera.ts): one-finger or left-button rotate drags are sampled; the release decides.
    const el = this.renderer.domElement;
    el.addEventListener("pointerdown", this.onFlickDown);
    el.addEventListener("pointermove", this.onFlickMove);
    el.addEventListener("pointerup", this.onFlickUp);
    window.addEventListener(SYSTEM_EVENT, this.onSystemPick); // a Systems chip tap, even on the chip already showing
    this.shade.mount(overlay, this.renderer.domElement);

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    this.resize();
    this.loop();
  }

  private resize(glide = false) {
    const w = this.host.clientWidth || 1, h = this.host.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    this.persp.aspect = w / h;
    // The house centres in the canvas area the overlays leave free: shift both cameras' principal point there.
    const f = this.free();
    // A card arriving or leaving glides the framing (spring below); a resize of the canvas itself cuts.
    this.offGoal = { x: w / 2 - f.cx, y: h / 2 - f.cy };
    if (!glide || this.opts.reduce || !this.offInit) { this.off = { ...this.offGoal }; this.offV = { x: 0, y: 0 }; this.offInit = true; }
    this.applyOffset();
    this.setOrtho(w / h);
    this.svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    this.fit(false);
  }

  // Overlays on the model (the number card, the shading strip) in canvas pixels from each edge. The fit uses the
  // rest: the house and its poses frame inside it with a margin, re-fitted whenever the stack changes.
  private insets = { top: 0, right: 0, bottom: 0, left: 0 };
  // A calculation card (or any cover) changing: the house re-frames into the space left, on the camera spring
  // (0.6 s, bounce 0) and a matching spring on the screen offset; a drag in progress keeps its own motion; Reduce Motion cuts.
  setInsets(i: { top: number; right: number; bottom: number; left: number }) {
    const r = (x: number) => Math.max(0, Math.round(x));
    const n = { top: r(i.top), right: r(i.right), bottom: r(i.bottom), left: r(i.left) };
    const o = this.insets;
    if (n.top === o.top && n.right === o.right && n.bottom === o.bottom && n.left === o.left) return;
    this.insets = n;
    const glide = !this.opts.reduce && this.fitted && !this.dragging && this.mode === "3d";
    const p0 = this.persp.position.clone(), t0 = this.controls.target.clone();
    this.resize(glide);
    if (glide && !this.fly) {
      const pos = this.persp.position.clone(), tgt = this.controls.target.clone();
      if (pos.distanceTo(p0) > 1e-3 || tgt.distanceTo(t0) > 1e-3) {
        this.persp.position.copy(p0); this.controls.target.copy(t0); this.controls.update();
        this.cancelMomentum();
        this.fly = { pos, tgt, top: false };
      }
    }
  }
  private off = { x: 0, y: 0 }; private offV = { x: 0, y: 0 }; private offGoal = { x: 0, y: 0 }; private offInit = false;
  private dragging = false;
  private applyOffset() {
    const w = this.host.clientWidth || 1, h = this.host.clientHeight || 1;
    this.persp.setViewOffset(w, h, this.off.x, this.off.y, w, h);
    this.ortho.setViewOffset(w, h, this.off.x, this.off.y, w, h);
    this.persp.updateProjectionMatrix(); this.ortho.updateProjectionMatrix();
  }
  private stepOffset(dt: number) {
    const k = Math.exp(-OMEGA * dt);
    let moving = false;
    (["x", "y"] as const).forEach((a) => {
      const e0 = this.off[a] - this.offGoal[a], c = this.offV[a] + OMEGA * e0, et = e0 + c * dt;
      this.offV[a] = (c - OMEGA * et) * k; this.off[a] = this.offGoal[a] + et * k;
      if (Math.abs(this.off[a] - this.offGoal[a]) < 0.3 && Math.abs(this.offV[a]) < 1) { this.off[a] = this.offGoal[a]; this.offV[a] = 0; } else moving = true;
    });
    this.applyOffset();
    return moving;
  }
  // The free area: never under 45% of the canvas either way, so a tall stack cannot squeeze the house to nothing.
  private free() {
    const W = this.host.clientWidth || 1, H = this.host.clientHeight || 1, { top, right, bottom, left } = this.insets;
    const fw = Math.max(W * 0.45, W - left - right), fh = Math.max(H * 0.45, H - top - bottom);
    const cx = Math.min(Math.max(left + fw / 2, fw / 2), W - fw / 2), cy = Math.min(Math.max(top + fh / 2, fh / 2), H - fh / 2);
    return { W, H, fw, fh, cx, cy, kW: W / fw, kH: H / fh };
  }

  private setOrtho(a: number) {
    // Top-down on the house itself with a margin of street around it.
    const c = this.box.isEmpty() ? this.centre : this.box.getCenter(new THREE.Vector3());
    const sz = this.box.isEmpty() ? new THREE.Vector3(this.span, 0, this.span) : this.box.getSize(new THREE.Vector3());
    // Margin inside the free area: the overlays' room is added on top, so the street margin stays modest.
    const half = this.plan ? Math.max(sz.x, sz.z) * 0.62 + 4 : Math.max(sz.x, sz.z) * 0.8 + 3;
    const f = this.free();
    const hh = Math.max(half * f.kH, (half * f.kW) / a), hw = hh * a; // the plan fits the free area, not the canvas
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
    this.cancelMomentum();
    this.mode = mode;
    this.camera = mode === "2d" ? this.ortho : this.persp;
    this.controls.enabled = mode === "3d";
    this.controls2d.enabled = mode === "2d";
    this.setOrtho(this.persp.aspect);
  }

  private fit(reset: boolean) {
    const a = this.persp.aspect, vfov = (this.persp.fov * Math.PI) / 180;
    const f = this.free(), t = Math.tan(vfov / 2);
    const half = this.span / 2, need = Math.max((half * f.kH) / t, (half * f.kW) / (t * a));
    // The mesh cap keeps the photo crisp; a tall free area, or one narrowed by overlays, still gets the room it needs.
    const d = Math.min(need * 1.6, this.fitCap * Math.max(1, 1.3 / (f.fw / f.fh)) * Math.max(f.kW, f.kH));
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
  // The photo mesh is only crisp up close: it caps the fitted distance (stage poses scale with it); null lifts it.
  private fitCap = Infinity;
  setFitCap(m: number | null) {
    const cap = m ?? Infinity;
    if (cap === this.fitCap) return;
    this.fitCap = cap;
    if (this.fitted) this.fit(false);
  }

  // Moves the camera to a stage's pose on one smooth spring (0.6 s, bounce 0) from wherever it is now, keeping
  // its velocity if a new stage arrives mid-flight. A top-down pose ends in the 2D plan. Reduce Motion: a cut.
  flyTo(p: Pose) {
    this.pose = p; this.home = p; this.spin = null; this.cancelMomentum();
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

  // Returns true when the house itself changed (a new address or roof model): everything is rebuilt and the camera
  // frames it. A new design on the same house only refreshes the planes' numbers: no rebuild, no camera move.
  setModel(model: RoofModel): boolean {
    const target0 = model.planes.filter((p) => p.is_target);
    const geo = JSON.stringify([model.planes.length, target0.map((p) => [p.id, p.polygon.map((v) => v.map((x) => Math.round(x * 100)))])]);
    if (this.modelSet && geo === this.geoKey) {
      const byId = new Map(target0.map((p) => [p.id, p]));
      this.targets.forEach((t) => { const q = byId.get(t.p.id); if (q) t.p = q; });
      this.shade.setPlanes(target0);
      const ys0 = model.planes.map((p) => p.yield_shaded_kwh_per_kwp ?? p.yield_kwh_per_kwp).filter((x) => x > 0);
      this.yieldScale = [Math.min(...ys0), Math.max(...ys0)];
      this.setTint(this.tintMode);
      return false;
    }
    this.geoKey = geo;
    this.fades.clear();
    this.targets = [];
    [this.placeholder, this.outlines, this.tints, this.kit, this.hpGroup, this.gridPole, this.sunGroup, this.ctxLines].forEach((g) => g.clear());
    const nbr = neighbourEdges(model.planes);
    this.ctxLines.add(outlineMesh(nbr));
    this.ctxLines.userData.edges = nbr; // the mesh view paints the same edges in its shader (whiteContext.ts)
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
    // Battery: indoors against the south wall, seen through the glass walls (snapUnits puts it on the wall's inner
    // face once the building model is in); grid: a pole at the edge of the plot, only with the day flow.
    const bx = box.min.x + 1.6, bz = box.max.z - 1.2;
    // The parts come from kitMeshes.ts, the same objects the parts list shows as icons.
    this.batteryBox = withEdges(battery() as THREE.Mesh, INK);
    this.batteryBox.position.set(bx, 0.75, bz);
    const gx = box.max.x + 5, gz = box.min.z + 3;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 7.5, 8), new THREE.MeshLambertMaterial({ color: "#4A4C55" }));
    pole.position.set(gx, 3.75, gz);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.08, 0.08), new THREE.MeshLambertMaterial({ color: "#4A4C55" }));
    arm.position.set(gx, 7.1, gz);
    this.kit.add(this.batteryBox);
    this.gridPole.add(pole, arm);
    this.gridPole.visible = false;
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
    // Wallbox: the wall unit on the east wall by the drive, its front facing the drive, shown only when the
    // design has one. No ink edges: it is a rounded unit.
    this.wallbox = wallbox();
    this.wallbox.rotation.y = Math.PI / 2;
    this.wallbox.position.set(box.max.x + WALLBOX.d / 2, 1.05, box.max.z - 1.5);
    this.wallbox.visible = false;
    this.kit.add(this.wallbox);
    // Inverter: indoors on the south wall beside the battery, at head height. Heat pump: the outdoor unit on the
    // ground by the west wall, its fan facing out. Each shows only when the design has one (setUnits).
    this.inverterUnit = withEdges(inverter(), INK);
    this.inverterUnit.position.set(bx + BATTERY.w / 2 + 0.2 + INVERTER.w / 2, 1.0, bz);
    this.inverterUnit.visible = false;
    this.kit.add(this.inverterUnit);
    const hp = withEdges(heatPump(), INK);
    hp.position.set(box.min.x - 0.45, 0, box.max.z - 2.2);
    hp.rotation.y = -Math.PI / 2;
    this.hpGroup.add(hp);
    this.hpGroup.visible = false;
    this.hpUnit = hp;
    this.snapUnits();

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
    this.systems.rebuild();
    this.systems.override();
    this.fadeTo(this.batteryBox, this.battOn);
    this.setWallbox(this.wbOn);
    return true;
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
        else if (old && old.map) { m.material = new THREE.MeshLambertMaterial({ map: old.map, side: THREE.DoubleSide }); }
      });
      // The target footprint comes with the roof model; until it is in, flatten later.
      this.glbRoot = gltf.scene; this.flattened = false;
      this.occluders = [];
      gltf.scene.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && /^(roof|walls)/.test((m.name || m.parent?.name || "").toLowerCase())) this.occluders.push(m); });
      if (!this.box.isEmpty()) this.flattenNeighbours(gltf.scene);
      sharpen(gltf.scene, this.renderer);
      this.ctxOff.push(registerGlb(gltf.scene, this.ctxLines));
      this.scene.add(gltf.scene);
      this.placeholder.visible = false;
      this.snapUnits();
      if (this.heat) this.setHeat(this.heat);
      this.applyGround();
      onDone(null);
    }, undefined, (e) => onDone((e as Error)?.message || "The house model did not load."));
  }

  // Only the house we explain stands up. Neighbours' roofs and walls drop flat onto the ground (2 cm up, no height,
  // so no edges stand out of the satellite picture at any angle); their shade is already in the engine's numbers.
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
      // Per triangle, not per corner: a wall triangle with one corner outside the house would stay half up as a
      // slanted sliver, so a triangle stands only when all three corners are the house's.
      const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone(), pos = g.attributes.position as THREE.BufferAttribute;
      inv.copy(m.matrixWorld).invert();
      const inside = (i: number) => { v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld); return !!own && v.x >= own.min.x && v.x <= own.max.x && v.z >= own.min.z && v.z <= own.max.z; };
      for (let t = 0; t + 2 < pos.count; t += 3) {
        if (!ctx && inside(t) && inside(t + 1) && inside(t + 2)) continue;
        for (let i = t; i < t + 3; i++) { v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld); v.y = ground + 0.02; v.applyMatrix4(inv); pos.setXYZ(i, v.x, v.y, v.z); }
      }
      pos.needsUpdate = true; g.computeVertexNormals(); g.computeBoundingBox(); g.computeBoundingSphere();
      m.geometry = g;
    });
  }

  // The walls as an architectural massing model: off-white, one flat shade per face, darker towards the ground
  // (baked ambient occlusion per vertex) and thin edge lines. No invented windows.
  private massing() {
    const wm = this.wallMesh;
    if (!wm) return;
    const g = wm.geometry.index ? wm.geometry.toNonIndexed() : wm.geometry.clone();
    g.computeVertexNormals();
    wm.updateWorldMatrix(true, false);
    const pos = g.getAttribute("position") as THREE.BufferAttribute, v = new THREE.Vector3();
    let ground = Infinity;
    for (let i = 0; i < pos.count; i++) ground = Math.min(ground, v.fromBufferAttribute(pos, i).applyMatrix4(wm.matrixWorld).y);
    const base = new THREE.Color(WALL_MASS), col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      const h = v.fromBufferAttribute(pos, i).applyMatrix4(wm.matrixWorld).y - ground;
      const s = Math.min(1, Math.max(0, h / 2.5)), ao = 0.66 + 0.34 * s * s * (3 - 2 * s);
      col.set([base.r * ao, base.g * ao, base.b * ao], i * 3);
    }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    wm.geometry = g;
    this.wallGeo = g;
    this.wallMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, flatShading: true });
    if (!this.heat) wm.material = this.wallMat;
    if (this.wallEdges) { this.wallEdges.removeFromParent(); this.wallEdges.geometry.dispose(); }
    this.wallEdges = new THREE.LineSegments(new THREE.EdgesGeometry(g, 25), new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.32 }));
    wm.add(this.wallEdges);
  }

  // diff: a design change on screen. Modules that stay keep their mesh; new ones fade and grow in, gone ones fade
  // and shrink out (Reduce Motion: fade only). Without diff, or with nothing placed yet, the layout is rebuilt.
  setPanels(list: { p: RoofPlane; r: PanelRect }[], animate: boolean, diff = false) {
    const keyOf = (p: RoofPlane, r: PanelRect) => `${p.id}|${JSON.stringify(r)}`;
    if (diff && this.panels.children.length) {
      const old = new Map<string, THREE.Object3D>(this.panels.children.map((g) => [g.userData.key as string, g]));
      const per: Record<string, number> = {}, next: THREE.Object3D[] = [];
      list.forEach(({ p, r }) => {
        const k = keyOf(p, r);
        let g = old.get(k);
        if (g) old.delete(k);
        else { g = this.panelMesh(p, r, true); this.fxStart(g, 1); }
        g.userData.plane = p.id; g.userData.idx = (per[p.id] = (per[p.id] ?? -1) + 1);
        next.push(g);
      });
      old.forEach((g) => { this.panelsOut.add(g); this.fxStart(g, -1); });
      this.panels.clear(); next.forEach((g) => this.panels.add(g));
      this.shade.setPanels(this.panels);
      return;
    }
    this.panelsOut.clear(); this.panelFx = [];
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
      grp.userData = { plane: p.id, idx: (per[p.id] = (per[p.id] ?? -1) + 1), cs, n: f.n, key: keyOf(p, r) }; // shading.ts reads these
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

  // One module as the layout draws it, with its own materials (a variant switch fades it alone).
  private panelMesh(p: RoofPlane, r: PanelRect, own: boolean): THREE.Group {
    const f = planeFrame(p);
    const cs = panelCorners(p, r).map((q) => q.addScaledVector(f.n, 0.09));
    const g = new THREE.BufferGeometry().setFromPoints(cs);
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const fill = new THREE.MeshBasicMaterial({ color: "#151826", side: THREE.DoubleSide, transparent: own, opacity: own ? 0 : 1 });
    const edge = new THREE.LineBasicMaterial({ color: "#F4F1EA", transparent: true, opacity: own ? 0 : 0.85 });
    const quad = new THREE.Mesh(g, fill); quad.renderOrder = 3;
    const grp = new THREE.Group();
    grp.add(quad, new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(cs), edge));
    grp.userData = { plane: p.id, idx: 0, cs, n: f.n, key: `${p.id}|${JSON.stringify(r)}` };
    return grp;
  }

  // Starts a module fading in (dir 1) or out (dir -1) from where it is now.
  private fxStart(g: THREE.Object3D, dir: 1 | -1) {
    const was = this.panelFx.find((x) => x.g === g);
    if (was) {
      // Reversed mid-flight: carry on from the opacity on screen, no jump.
      const a = was.dir > 0 ? springQ(was.t) : 1 - springQ(was.t), k = dir > 0 ? a : 1 - a;
      let lo = 0, hi = 1;
      for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (springQ(mid) < k) lo = mid; else hi = mid; }
      was.dir = dir; was.t = lo; return;
    }
    const mats: Fx["mats"] = [];
    g.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (!m || Array.isArray(m)) return;
      const own = m.clone(); own.transparent = true; (o as THREE.Mesh).material = own;
      mats.push({ m: own, base: dir > 0 ? (o instanceof THREE.LineLoop ? 0.85 : 1) : (m as THREE.Material & { opacity: number }).opacity });
    });
    const cs = g.userData.cs as THREE.Vector3[] | undefined;
    const c = cs?.length ? cs.reduce((a, q) => a.add(q), new THREE.Vector3()).multiplyScalar(1 / cs.length) : new THREE.Vector3();
    this.panelFx.push({ g, t: 0, dir, mats, c });
  }

  private stepFx(dt: number) {
    if (!this.panelFx.length) return;
    const still = this.opts.reduce;
    this.panelFx = this.panelFx.filter((f) => {
      f.t += dt;
      const k = springQ(f.t), a = f.dir > 0 ? k : 1 - k;
      f.mats.forEach(({ m, base }) => { (m as THREE.Material & { opacity: number }).opacity = base * a; });
      const sc = still ? 1 : 0.6 + 0.4 * a;
      f.g.scale.setScalar(sc); f.g.position.copy(f.c).multiplyScalar(1 - sc);
      if (k < 0.999) return true;
      if (f.dir < 0) { f.g.removeFromParent(); f.g.traverse((o) => { (o as THREE.Mesh).geometry?.dispose(); ((o as THREE.Mesh).material as THREE.Material | undefined)?.dispose?.(); }); }
      else f.mats.forEach(({ m }) => { if (m instanceof THREE.MeshBasicMaterial) { m.transparent = false; m.needsUpdate = true; } });
      return false;
    });
  }

  // Battery and wallbox: present or not in this design. The first call sets it outright; later ones fade over the
  // 0.25 s spring (Reduce Motion: the same fade). Works on the materials, so the Systems chips keep .visible.
  private fadeTo(o: THREE.Object3D | null, on: boolean) {
    if (!o) return;
    const goal = on ? 1 : 0, f = this.fades.get(o);
    if (!f) { this.fades.set(o, { a: goal, v: 0, goal }); this.applyFade(o, goal); return; }
    f.goal = goal;
  }
  private applyFade(o: THREE.Object3D, a: number) {
    o.traverse((x) => {
      const m = (x as THREE.Mesh).material as (THREE.Material & { opacity: number }) | undefined;
      if (!m || Array.isArray(m)) return;
      if (m.userData.base == null) m.userData.base = m.opacity;
      m.transparent = a < 1 || m.userData.base < 1; m.opacity = m.userData.base * a; m.visible = a > 0.003;
    });
  }
  private stepFades(dt: number) {
    this.fades.forEach((f, o) => {
      if (Math.abs(f.a - f.goal) < 0.002 && Math.abs(f.v) < 0.01) { if (f.a !== f.goal) { f.a = f.goal; f.v = 0; this.applyFade(o, f.a); } return; }
      const acc = -OMEGA_Q * OMEGA_Q * (f.a - f.goal) - 2 * OMEGA_Q * f.v;
      f.v += acc * dt; f.a = Math.max(0, Math.min(1, f.a + f.v * dt));
      this.applyFade(o, f.a);
    });
  }
  setBattery(on: boolean) { this.battOn = on; this.fadeTo(this.batteryBox ?? null, on); }

  setShading(d: Shading | null, on: boolean, at: ShadeAt) { this.shade.set(d, on, at); }
  // Heat pump step: envelope x-ray (xray.ts); null fades it out.
  setXray(env: Envelope | null): Label[] {
    if (!env && this.systems.sys === "heatpump") return []; // the Heat pump system keeps its x-ray
    return this.xray.set(env);
  }

  // One call for the Systems chips: the system's layer on the model and its camera pose; null hands back to layers.
  setSystem(s: System | null) {
    this.systems.set(s);
    if (!s) this.show(this.lastShow);
    this.applyUnits();
    this.setWallbox(this.wbOn);
  }
  // The envelope for the Heat pump system's x-ray, kept whatever layer is showing.
  setEnvelope(env: Envelope | null) { this.systems.setEnvelope(env); }
  private lastShow: { outlines: boolean; panels: boolean; kit: boolean; sun: boolean; battery: "plain" | "lit" } = { outlines: true, panels: true, kit: false, sun: false, battery: "plain" };

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

  // The Google satellite ground at the engine origin (UTM 32N E, N, Z) (satGround.ts). Callable at any time:
  // before the glb is in it is remembered and starts the moment the glb lands; a changed origin replaces it.
  groundFor(origin: [number, number, number]) {
    this.groundOrigin = origin;
    this.applyGround();
  }

  private applyGround() {
    const o = this.groundOrigin;
    if (!o || !this.glbRoot || !this.alive) return;
    const key = o.join(",");
    if (this.groundOff && this.groundKey === key) return;
    this.groundOff?.();
    this.groundKey = key;
    this.groundOff = googleGround(this.glbRoot, this.renderer, o);
  }

  // The design has a wallbox. Without one the Wallbox view shows no unit, car or cable, matching its "No wallbox" card.
  setWallbox(on: boolean) {
    this.wbOn = on;
    if (this.wallbox) this.wallbox.visible = on;
    if (this.systems.sys) this.systems.override();
  }
  // The roof box includes the eaves, so a unit placed from it misses the wall: once the building model is in,
  // move the battery and inverter onto the inner face of the south wall (the ray starts inside the house), the
  // wallbox onto the outer face of the east wall by the drive, and the heat pump to a hand's width outside the west
  // wall. The glass shell stands in for the house's own walls. The Systems pipes and the car's cable start at the
  // wallbox and the battery, so they are rebuilt after.
  private snapUnits() {
    const w = this.wallMesh;
    if (!w) return;
    w.updateWorldMatrix(true, false);
    const walls = [w, this.xray.shellMesh()].filter((m): m is THREE.Mesh => !!m);
    const ray = new THREE.Raycaster();
    const inner = (o: THREE.Object3D, y: number, d: number) => {
      ray.set(new THREE.Vector3(o.position.x, y, (this.box.min.z + this.box.max.z) / 2), new THREE.Vector3(0, 0, 1));
      const hit = ray.intersectObjects(walls, false)[0];
      if (hit && hit.point.z <= this.box.max.z + 0.5) o.position.z = hit.point.z - d / 2 - 0.05;
    };
    if (this.batteryBox) {
      inner(this.batteryBox, 0.75, BATTERY.d);
      const b = this.batteryBox.position;
      this.anchors.batt.set(b.x, 1.5, b.z);
      this.focusPts.battery.set(this.focusPts.battery.x, this.focusPts.battery.y, b.z - 1);
    }
    const inv = this.inverterUnit;
    if (inv) inner(inv, inv.position.y + INVERTER.h / 2, INVERTER.d);
    const wb = this.wallbox;
    if (wb) {
      ray.set(new THREE.Vector3(this.box.max.x + 10, wb.position.y + WALLBOX.h / 2, wb.position.z), new THREE.Vector3(-1, 0, 0));
      const hit = ray.intersectObjects(walls, false)[0];
      if (hit && hit.point.x >= this.box.max.x - 2.5) wb.position.x = hit.point.x + WALLBOX.d / 2 + 0.01;
    }
    this.pillAnchors();
    this.systems.rebuild();
    const hp = this.hpUnit;
    if (hp) {
      ray.set(new THREE.Vector3(this.box.min.x - 10, 0.5, hp.position.z), new THREE.Vector3(1, 0, 0));
      const hit = ray.intersectObject(w, false)[0];
      if (hit && hit.point.x >= this.box.min.x - 0.5) hp.position.x = hit.point.x - HEATPUMP.d / 2 - 0.25;
    }
  }

  // inverter, heatpump: the design has one. layer: the stepper's layer shows the kit. In a System view the heat pump
  // unit stands with the Heat pump and Battery systems instead.
  private units = { inverter: false, heatpump: false, layer: false };
  setUnits(o: { inverter: boolean; heatpump: boolean; layer: boolean }) { this.units = o; this.applyUnits(); }
  private applyUnits() {
    const u = this.units, sys = this.systems.sys;
    if (this.inverterUnit) this.inverterUnit.visible = u.inverter;
    this.hpGroup.visible = u.heatpump && (sys ? sys === "heatpump" || sys === "battery" : u.layer);
  }

  show(o: { outlines: boolean; panels: boolean; kit: boolean; sun: boolean; battery: "plain" | "lit" }) {
    this.outlines.visible = o.outlines;
    this.panels.visible = o.panels;
    this.kit.visible = o.kit;
    this.sunGroup.visible = o.sun;
    if (this.batteryBox) (this.batteryBox.material as THREE.MeshLambertMaterial).color.set(o.battery === "lit" ? "#24a148" : "#FAF8F3");
    if (!o.sun) this.setFlows(null);
    this.lastShow = o;
    this.systems.override();
  }

  // Heat layer: walls tinted per triangle by the W/m2 of the envelope face with the nearest azimuth,
  // the roof faces by theirs, paper to orange. Only the target house is tinted.
  setHeat(env: Envelope | null) {
    this.heat = env;
    const wm = this.wallMesh;
    if (!env) {
      if (wm && this.wallMat) { if (this.wallGeo) wm.geometry = this.wallGeo; wm.material = this.wallMat; }
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
      if (el.innerHTML !== x.html) { el.innerHTML = x.html; this.labelSize.delete(x.key); }
    });
  }

  // Only the faces that carry modules are labelled; any other face shows its label when tapped.
  planeLabels(kind: "roof" | "sun" | "panels", counts?: Record<string, number>, kwpPerModule?: number): Label[] {
    const own: Record<string, number> = {};
    this.panels.children.forEach((g) => { const id = g.userData?.plane; if (id) own[id] = (own[id] ?? 0) + 1; });
    const cnt = (id: string) => counts?.[id] ?? own[id] ?? 0;
    return this.targets.map(({ p, c, n }) => {
      const at = c.clone().addScaledVector(n, 0.4), k = cnt(p.id);
      const face = p.pitch < 3 ? "flat roof" : `${facing(p.azimuth)} face, ${Math.round(p.pitch)}° pitch`;
      const html = kind === "roof"
        ? `<b>${face}</b>`
        : kind === "sun"
          ? sunHtml(p)
          : (() => {
            // Panels: one chip per face with its panels and kWp; an empty face shows its name on tap.
            const name = p.pitch < 3 ? "Flat roof" : `${facing(p.azimuth).replace(/^./, (x) => x.toUpperCase())} face`;
            // "20 panels" bold, "9 kWp" lighter: no face name, no commas, no count of the total (8 Nov 2026).
            if (k > 0) return `<b>${k} panel${k === 1 ? "" : "s"}</b>${kwpPerModule ? ` <span class="sub">${kwpS(k * kwpPerModule)} kWp</span>` : ""}`;
            return skipOf(p) ? `${name}, no modules, ${skipOf(p)}` : `${name}, no modules`;
          })();
      return { key: `${kind}-${p.id}`, at, html, cls: kind === "panels" ? `chip ${k > 0 ? "c-pv" : ""}` : undefined, prio: k * 1000 + p.area_m2, ...(k > 0 ? {} : { tap: p.id }) };
    });
  }

  nodeLabel(key: "roof" | "home" | "batt" | "grid", html: string) { this.nodeLabels[key] = html; }

  // Battery and wallbox steps: the marker on the house carries its size ("10 kWh", "11 kW").
  // The pills sit just above their unit: the battery's top, the wallbox's top edge.
  private pillAnchors() {
    this.battAt.copy(this.anchors.batt).setY(1.65);
    if (this.wallbox) this.wbAt.copy(this.wallbox.position).add(new THREE.Vector3(0, WALLBOX.h + 0.06, 0));
  }
  kitLabels(batt: string | null, wb: string | null): Label[] {
    const out: Label[] = [];
    this.pillAnchors();
    const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    if (batt) out.push({ key: "kit-batt", at: this.battAt, html: `<b>${batt}</b>`, cls: "chip c-bat", prio: 5e6,
      unit: this.batteryBox ? { obj: this.batteryBox, top: V(0, BATTERY.h / 2, 0), mid: V(0, 0, 0) } : undefined });
    if (wb && this.wallbox) out.push({ key: "kit-wb", at: this.wbAt, html: `<b>${wb}</b>`, cls: "chip c-ev", prio: 5e6,
      unit: { obj: this.wallbox, top: V(0, WALLBOX.h, 0), mid: V(0, WALLBOX.h / 2, 0) } });
    return out;
  }

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

  // The roof or a wall stands between the camera and this point, more than 0.6 m in front of it (so the glass wall a
  // part is mounted on, or stands behind, does not count). 3D only: the plan view looks straight down.
  private behindHouse(pt: THREE.Vector3) {
    if (this.camera !== this.persp || !this.occluders.length) return false;
    const from = this.persp.position, d = from.distanceTo(pt);
    this.occRay.set(from, pt.clone().sub(from).normalize());
    this.occRay.far = d - 0.6;
    return this.occRay.intersectObjects(this.occluders, false).length > 0;
  }

  private project(v: THREE.Vector3) {
    const p = v.clone().project(this.camera);
    const w = this.host.clientWidth, h = this.host.clientHeight;
    return { x: ((p.x + 1) / 2) * w, y: ((1 - p.y) / 2) * h, ok: p.z < 1 };
  }

  // Orbit momentum: the gesture is a flick candidate only while one pointer rotates (no pan button or modifier).
  private coast: Coast | null = null;
  // Stops a flick's coast or turntable at once; every camera command (chip, Reset view, Face north, 2D/3D) calls it.
  cancelMomentum() { this.coast = null; }
  private onSystemPick = () => this.cancelMomentum();
  private flick: { ok: boolean; s: Sample[] } | null = null;
  private onFlickDown = (e: PointerEvent) => {
    this.coast = null;
    // A second finger turns the gesture into pinch or pan. A primary pointer always starts afresh: OrbitControls sends
    // no "end" while it is disabled (the 2D plan), so state left over from there must not swallow the next flick.
    if (!e.isPrimary) { if (this.flick) this.flick.ok = false; return; }
    const rotate = this.mode === "3d" && e.button === 0 && !e.shiftKey && !e.ctrlKey && !e.metaKey;
    this.flick = { ok: rotate, s: [{ t: e.timeStamp, x: e.clientX }] };
  };
  private onFlickMove = (e: PointerEvent) => {
    const f = this.flick;
    if (!f?.ok || !e.isPrimary) return;
    // Browsers merge the moves of one frame into a single event; the merged ones keep their own stamps.
    for (const m of e.getCoalescedEvents?.() ?? [e]) f.s.push({ t: m.timeStamp, x: m.clientX });
    while (f.s.length > 2 && e.timeStamp - f.s[0].t > 200) f.s.shift();
  };
  // Timed by the events' own stamps, so a busy main thread that handles the lift late still reads the flick.
  private onFlickUp = (e: PointerEvent) => {
    const f = this.flick;
    if (!e.isPrimary || !f) return;
    this.flick = null;
    if (!f.ok || this.mode !== "3d") return;
    const w = releaseRate(f.s, e.timeStamp, this.renderer.domElement.clientHeight || 1);
    this.coast = startCoast(w, !!this.opts.reduce);
  };
  // Drives the turn through OrbitControls' own pending rotation, so its damping tail is replaced, not added to.
  private stepCoast(dt: number) {
    const c = this.coast!;
    if (this.mode !== "3d") { this.coast = null; return; }
    const alive = stepCoast(c, dt);
    const d = (this.controls as unknown as { _sphericalDelta: THREE.Spherical })._sphericalDelta;
    d.theta = (c.w * dt) / (this.controls.enableDamping ? this.controls.dampingFactor : 1);
    if (!alive) this.coast = null;
  }

  private onDown = (e: PointerEvent) => { this.down = { x: e.clientX, y: e.clientY }; };
  private onTap = (e: PointerEvent) => {
    const now = performance.now(), near = Math.hypot(e.clientX - this.tap.x, e.clientY - this.tap.y) < 30;
    if (now - this.tap.t < 320 && near) { this.tap.t = 0; this.refit(); return; }
    this.tap = { t: now, x: e.clientX, y: e.clientY };
    // A tap (not a drag) on a roof face shows that face's label; a tap elsewhere hides it.
    if (Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 6) return;
    const r = this.renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), this.camera);
    const hit = ray.intersectObjects(this.targets.map((x) => x.tint), false)[0];
    const id = hit ? this.targets.find((x) => x.tint === hit.object)?.p.id ?? null : null;
    this.tapped = id && id !== this.tapped ? id : null;
  };

  // Back to the stage's pose, or the opening view, on the same spring; the plan resets its pan and zoom.
  refit() {
    this.spin = null; this.zoom2 = null; this.zoom2V = 0;
    this.cancelMomentum();
    if (this.mode === "2d") { this.setOrtho(this.persp.aspect); return; }
    if (this.home) { this.flyTo(this.home); return; }
    const d = this.fitD, dir = new THREE.Vector3(0.42, 0.62, 0.66).normalize();
    const pos = this.centre.clone().addScaledVector(dir, d), tgt = this.centre.clone();
    if (this.opts.reduce) { this.persp.position.copy(pos); this.controls.target.copy(tgt); this.controls.update(); return; }
    this.fly = { pos, tgt, top: false };
  }

  // Compass: turn the camera to face north (it sits south of the target, north at the top of the screen), keeping
  // the tilt, the distance and the target; the shorter way round, one spring (0.5 s, bounce 0); Reduce Motion cuts.
  // The 2D plan is always north up.
  faceNorth() {
    this.cancelMomentum();
    if (this.mode === "2d") return;
    this.fly = null; this.pose = null;
    const o = this.persp.position.clone().sub(this.controls.target);
    const h = Math.hypot(o.x, o.z), a = Math.atan2(o.x, o.z);
    if (h < 1e-3) return;
    this.spin = { a: this.opts.reduce ? 0 : a, v: 0, h, y: o.y };
    if (this.opts.reduce) this.stepSpin(0);
  }
  // Zoom buttons and keys: one step is 20 % of the camera distance (dir 1 in, -1 out), clamped to the limits pinch and
  // wheel already use (the controls' min/max distance, the plan's min/max zoom). The 3D step rides the same fly spring
  // as a stage change (0.6 s, bounce 0, velocity kept); a drag or a wheel cancels it. Reduce Motion: a cut.
  zoomBy(dir: 1 | -1) {
    this.cancelMomentum();   // a zoom press stops a flick's coast, as a wheel does
    if (this.mode === "2d") {
      const c = this.controls2d, z = THREE.MathUtils.clamp((this.zoom2 ?? this.ortho.zoom) * (dir > 0 ? 1.25 : 0.8), c.minZoom, c.maxZoom);
      this.zoom2 = z;
      if (this.opts.reduce) { this.ortho.zoom = z; this.ortho.updateProjectionMatrix(); this.zoom2 = null; }
      return;
    }
    this.spin = null; this.pose = null;
    const tgt = this.fly?.tgt.clone() ?? this.controls.target.clone();
    const from = (this.fly?.pos ?? this.persp.position).clone().sub(tgt);
    const d = THREE.MathUtils.clamp(from.length() * (dir > 0 ? 0.8 : 1.25), this.controls.minDistance, this.controls.maxDistance);
    const pos = tgt.clone().addScaledVector(from.normalize(), d);
    if (this.opts.reduce) { this.persp.position.copy(pos); this.controls.target.copy(tgt); this.controls.update(); this.fly = null; return; }
    this.fly = { pos, tgt, top: false };
  }
  private zoom2: number | null = null; private zoom2V = 0;
  // Whether another step in or out is possible, for the buttons' disabled state (reported on change).
  private zoomState = "";
  private reportZoom() {
    let cin: boolean, cout: boolean;
    if (this.mode === "2d") { const z = this.zoom2 ?? this.ortho.zoom, c = this.controls2d; cin = z < c.maxZoom - 1e-3; cout = z > c.minZoom + 1e-3; }
    else { const d = (this.fly?.pos ?? this.persp.position).distanceTo(this.fly?.tgt ?? this.controls.target); cin = d > this.controls.minDistance + 1e-2; cout = d < this.controls.maxDistance - 1e-2; }
    const s = `${cin}${cout}`;
    if (s !== this.zoomState) { this.zoomState = s; this.opts.onZoom?.({ in: cin, out: cout }); }
  }
  private stepZoom2(dt: number) {
    if (this.zoom2 == null) return;
    const g = this.zoom2, e0 = this.ortho.zoom - g, k = Math.exp(-OMEGA * dt), c = this.zoom2V + OMEGA * e0, et = e0 + c * dt;
    this.zoom2V = (c - OMEGA * et) * k; this.ortho.zoom = g + et * k;
    if (Math.abs(this.ortho.zoom - g) < 1e-3 && Math.abs(this.zoom2V) < 1e-3) { this.ortho.zoom = g; this.zoom2 = null; this.zoom2V = 0; }
    this.ortho.updateProjectionMatrix();
  }

  private stepSpin(dt: number) {
    const s = this.spin!;
    if (dt > 0) { const k = Math.exp(-OMEGA * dt), c = s.v + OMEGA * s.a, e = s.a + c * dt; s.v = (c - OMEGA * e) * k; s.a = e * k; }
    const done = Math.abs(s.a) < 1e-3 && Math.abs(s.v) < 1e-3;
    if (done) s.a = 0;
    const t = this.controls.target;
    this.persp.position.set(t.x + s.h * Math.sin(s.a), t.y + s.y, t.z + s.h * Math.cos(s.a));
    if (done) this.spin = null;
  }

  private loop = () => {
    if (!this.alive) return;
    this.raf = requestAnimationFrame(this.loop);
    this.tick();
  };
  // Safari stops animation frames while its window is hidden or covered; a timer keeps drawing the house there
  // (about four frames a second), so a model that lands meanwhile is on the canvas the moment the window shows.
  private lastTick = 0;
  private wd = window.setInterval(() => { if (this.alive && performance.now() - this.lastTick > 250) this.tick(); }, 250);
  private tick() {
    this.lastTick = performance.now();
    const dt = Math.min(0.05, this.clock.getDelta());
    if (this.spin) this.stepSpin(dt);
    if (this.coast && !document.hidden) this.stepCoast(dt);
    if (this.zoom2 != null) this.stepZoom2(dt);
    if (this.off.x !== this.offGoal.x || this.off.y !== this.offGoal.y) this.stepOffset(dt);
    this.reportZoom();
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
    this.gridPole.visible = !!this.day && this.sunGroup.visible;
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
    // Never two labels within 24 px: the tapped face first, then by priority (modules, then area); the lesser hides.
    const NODE: Record<string, number> = { "node-roof": 4e6, "node-home": 3e6, "node-batt": 2e6, "node-grid": 1e6 };
    const shown: { x0: number; y0: number; x1: number; y1: number; chip: boolean }[] = [];
    const VW = this.host.clientWidth, VH = this.host.clientHeight;
    let chips = 0;
    all.map((x) => ({ x, pr: x.tap && x.tap === this.tapped ? 1e9 : NODE[x.key] ?? x.prio ?? 0 }))
      .sort((a, b) => b.pr - a.pr)
      .forEach(({ x }) => {
        const el = this.labelEls.get(x.key);
        if (!el) return;
        if (x.key.startsWith("node-") && el.innerHTML !== x.html) { el.innerHTML = x.html; this.labelSize.delete(x.key); }
        const p = this.project(x.unit ? x.unit.obj.localToWorld(x.unit.top.clone()) : x.at);
        const batt = x.key === "node-batt", chip = !!x.cls?.includes("chip");
        let ok = p.ok && (!x.tap || x.tap === this.tapped) && (!chip || chips < MAX_CHIPS) && (!x.unit || (x.unit.obj.visible && !this.behindHouse(x.unit.obj.localToWorld(x.unit.mid.clone()))));
        let dx = 0, dy = 0;
        if (ok) {
          let sz = this.labelSize.get(x.key);
          if (!sz || !sz.w) { sz = { w: el.offsetWidth, h: el.offsetHeight }; this.labelSize.set(x.key, sz); }
          const base = { x0: p.x - sz.w / 2, x1: p.x + sz.w / 2, y0: batt ? p.y + 10 : p.y - sz.h, y1: batt ? p.y + 10 + sz.h : p.y };
          const tries: [number, number][] = chip ? [[0, 0], [0, sz.h + 10], [-(sz.w / 2 + 10), sz.h / 2], [sz.w / 2 + 10, sz.h / 2], [0, -(sz.h + 6)]] : [[0, 0]];
          const hit = (r: typeof base, c: boolean) => shown.some((q) => { const g = c && q.chip ? CHIP_GAP : GAP; return r.x0 < q.x1 + g && q.x0 < r.x1 + g && r.y0 < q.y1 + g && q.y0 < r.y1 + g; });
          const at = tries.map(([ox, oy]) => ({ ox, oy, r: { x0: base.x0 + ox, x1: base.x1 + ox, y0: base.y0 + oy, y1: base.y1 + oy } }))
            .find(({ r }) => !hit(r, chip) && (!chip || (r.x0 >= 2 && r.x1 <= VW - 2 && r.y0 >= 2 && r.y1 <= VH - 2)));
          if (!at) ok = false;
          else { dx = at.ox; dy = at.oy; shown.push({ ...at.r, chip }); if (chip) chips++; }
        }
        el.style.transform = `translate(${(p.x + dx).toFixed(1)}px, ${(p.y + dy).toFixed(1)}px) ${batt ? "translate(-50%, 10px)" : "translate(-50%, -100%)"}`;
        el.style.visibility = ok ? "visible" : "hidden";
      });

    if (this.plan) this.drawPlan();
    this.shade.frame(this.camera, this.mode, (v) => this.project(v), this.host.clientWidth);
    this.xray.frame(dt);
    this.stepFx(dt); this.stepFades(dt);
    this.panelsOut.visible = this.panels.visible;
    if (this.opts.compass) {
      // Screen direction of north (local -z in three).
      const a = this.project(this.centre), b = this.project(this.centre.clone().add(new THREE.Vector3(0, 0, -5)));
      const ang = Math.atan2(b.x - a.x, -(b.y - a.y));
      this.opts.compass.style.transform = `rotate(${ang.toFixed(3)}rad)`;
    }
    this.systems.frame(dt);
    this.renderer.render(this.scene, this.camera);
  };

  dispose() {
    this.alive = false;
    this.systems.dispose();
    cancelAnimationFrame(this.raf);
    clearInterval(this.wd);
    this.ro.disconnect();
    this.controls.dispose();
    this.controls2d.dispose();
    this.renderer.domElement.removeEventListener("pointerup", this.onTap);
    this.renderer.domElement.removeEventListener("pointerdown", this.onDown);
    this.renderer.domElement.removeEventListener("pointerdown", this.onFlickDown);
    this.renderer.domElement.removeEventListener("pointermove", this.onFlickMove);
    this.renderer.domElement.removeEventListener("pointerup", this.onFlickUp);
    window.removeEventListener(SYSTEM_EVENT, this.onSystemPick);
    this.labelEls.forEach((el) => el.remove());
    Object.values(this.flowPaths).forEach((el) => el.remove());
    this.planG?.remove();
    this.shade.dispose();
    this.xray.dispose();
    this.groundOff?.(); this.groundOff = null;
    this.ctxOff.forEach((f) => f());
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
      mats.forEach((x) => { (x as THREE.MeshLambertMaterial).map?.dispose(); x.dispose(); });
    });
    giveRenderer(this.renderer);
  }
}

// One WebGL context per live view for the life of the page. Safari caps live contexts and a context that is
// thrown away is not freed at once, so a view rebuilt on a data reload drew into a context that never painted
// (blank white canvas). A disposed view hands its renderer back here and the next view takes the same canvas.
const spare: THREE.WebGLRenderer[] = [];
function takeRenderer(): THREE.WebGLRenderer {
  const r = spare.pop();
  if (r && !r.getContext().isContextLost()) return r;
  r?.dispose();
  return new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "low-power" });
}
function giveRenderer(r: THREE.WebGLRenderer) {
  r.setRenderTarget(null);
  r.renderLists.dispose();
  const c = r.domElement;
  c.remove();
  c.removeAttribute("style");
  if (spare.length < 2 && !r.getContext().isContextLost()) spare.push(r);
  else { r.dispose(); r.forceContextLoss(); }
}
