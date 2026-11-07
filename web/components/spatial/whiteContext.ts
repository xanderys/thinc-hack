// White context: the house we explain keeps its photo texture, everything around it turns into a white
// architectural model with soft shading, the way a planner's massing model reads (Autarc style).
//
// Mesh mode (Google Photorealistic 3D Tiles): every tile material is patched in its shader. The mask is the
// target house's LoD2 footprint (its roof planes projected to the ground) plus about 1 m. Inside the mask
// Google's texture stays; outside it the fragment is painted flat white, shaded by its own face normal (from
// screen derivatives, the tiles carry no normals) with a soft darkening where walls meet the ground.
// The mask is tested in world space, which is the aligned frame: the photo layer's holder and anchor bring the
// tiles into our scene frame (x east, y up, z south), so the footprint is read from the same roof model the
// overlays use and never recomputed from the tiles. A frame matrix can be passed if that alignment ever moves
// our overlays instead of the tiles.
//
// Fallback mode (LoD2 glb, no tiles): the roof keeps its texture, walls and neighbours go white, the ground goes
// white with neighbours' footprints as faint grey outlines.
import * as THREE from "three";
import type { RoofPlane, V3 } from "./types";

const MAX_EDGES = 128;
const MAX_NBR = 96;                       // neighbours' footprint edges painted onto the white mesh
const MARGIN = 1.0;                       // metres of photo kept around the footprint
const WHITE = new THREE.Color("#fbfaf6"); // a touch warm, so it sits on the paper ground
const OUTLINE = "#cfcbc2";
const SLAB = "#f1efe9";  // neighbours: low white slabs, their footprints outlined on the ground
const WALL = "#f6f4ef";

type XZ = [number, number];
const xz = ([x, y]: V3): XZ => [x, -y]; // engine local (x east, y north) → three (x, z south)

// Target footprint as polygons in the three XZ plane (one per roof plane; dormers overlap and that is fine).
export function footprintOf(planes: RoofPlane[]): XZ[][] {
  return planes.filter((p) => p.is_target && p.polygon.length > 2).map((p) => p.polygon.map(xz));
}

// Outer edges of the neighbours' roofs: an edge shared by two planes is a ridge or valley, so it is dropped.
export function neighbourEdges(planes: RoofPlane[]): [XZ, XZ][] {
  const k = ([x, z]: XZ) => `${Math.round(x * 5)},${Math.round(z * 5)}`;
  const seen = new Map<string, { e: [XZ, XZ]; n: number }>();
  planes.filter((p) => !p.is_target && p.polygon.length > 2).forEach((p) => {
    const pts = p.polygon.map(xz);
    pts.forEach((a, i) => {
      const b = pts[(i + 1) % pts.length], ka = k(a), kb = k(b);
      if (ka === kb) return;
      const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      const v = seen.get(key);
      if (v) v.n++; else seen.set(key, { e: [a, b], n: 1 });
    });
  });
  return [...seen.values()].filter((v) => v.n === 1).map((v) => v.e);
}

function hull(pts: XZ[]): XZ[] {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cr = (o: XZ, a: XZ, b: XZ) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: XZ[] = [], up: XZ[] = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.reverse()) { while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

// Faint grey footprints of the neighbours, just above the ground and the 0.4 m slabs; buildings hide them.
export function outlineMesh(edges: [XZ, XZ][], y = 0.42): THREE.LineSegments {
  const g = new THREE.BufferGeometry().setFromPoints(edges.flatMap(([a, b]) => [new THREE.Vector3(a[0], y, a[1]), new THREE.Vector3(b[0], y, b[1])]));
  const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: OUTLINE, transparent: true, opacity: 0.8, depthWrite: false }));
  l.name = "white-outlines";
  return l;
}

const VERT_DECL = /* glsl */ `varying vec3 vWcPos;\n`;
const VERT_BODY = /* glsl */ `
  vWcPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
`;
const FRAG_DECL = /* glsl */ `
varying vec3 vWcPos;
uniform vec4 uWcEdges[${MAX_EDGES}];
uniform float uWcPoly[${MAX_EDGES}];
uniform int uWcCount;
uniform float uWcMargin;
uniform mat4 uWcFrame;
uniform vec3 uWcWhite;
uniform float uWcOn;
uniform vec4 uWcNbr[${MAX_NBR}];
uniform int uWcNbrCount;
float wcNbr(vec2 p) {
  float d = 1e9;
  for (int i = 0; i < ${MAX_NBR}; i++) {
    if (i >= uWcNbrCount) break;
    vec2 a = uWcNbr[i].xy, ab = uWcNbr[i].zw - a;
    float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
    d = min(d, length(p - a - ab * t));
  }
  return d;
}
float wcMask(vec2 p) {
  float dmin = 1e9; bool inside = false; bool par = false; float cur = -1.0;
  for (int i = 0; i < ${MAX_EDGES}; i++) {
    if (i >= uWcCount) break;
    if (uWcPoly[i] != cur) { inside = inside || par; par = false; cur = uWcPoly[i]; }
    vec2 a = uWcEdges[i].xy, b = uWcEdges[i].zw, ab = b - a;
    float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
    dmin = min(dmin, length(p - a - ab * t));
    if ((a.y > p.y) != (b.y > p.y) && p.x < a.x + (p.y - a.y) * ab.x / (ab.y + 1e-9)) par = !par;
  }
  inside = inside || par;
  if (inside) return 1.0;
  return 1.0 - smoothstep(uWcMargin - 0.25, uWcMargin + 0.25, dmin);
}
`;
const FRAG_BODY = /* glsl */ `
  {
    vec3 wp = (uWcFrame * vec4(vWcPos, 1.0)).xyz;
    float m = uWcCount > 0 ? wcMask(wp.xz) : 0.0;
    vec3 n = normalize(cross(dFdx(vWcPos), dFdy(vWcPos)));
    if (dot(n, cameraPosition - vWcPos) < 0.0) n = -n;
    // Photogrammetry is lumpy: faces within about 30 degrees of level read as flat white (ground, roofs),
    // steeper faces get a gentle key light and a soft darkening where they meet the ground.
    float lvl = smoothstep(0.62, 0.85, n.y);
    float key = clamp(dot(n, normalize(vec3(-0.45, 0.5, 0.75))), 0.0, 1.0);
    float ao = mix(0.92, 1.0, smoothstep(0.0, 2.5, wp.y));
    float shade = mix((0.87 + 0.09 * key) * ao, 1.0, lvl);
    // Neighbours' footprints as faint grey hairlines on the ground, about one pixel wide at any zoom.
    if (uWcNbrCount > 0) { float dn = wcNbr(wp.xz); float w = max(fwidth(dn), 1e-4); shade *= 1.0 - 0.2 * (1.0 - smoothstep(0.5 * w, 1.5 * w, dn)); }
    diffuseColor.rgb = mix(diffuseColor.rgb, uWcWhite * shade, uWcOn * (1.0 - m));
  }
`;

// One instance per photo layer: owns the shared uniforms, patches tile materials as they load.
export class WhiteContext {
  readonly uniforms = {
    uWcEdges: { value: Array.from({ length: MAX_EDGES }, () => new THREE.Vector4()) },
    uWcPoly: { value: new Array(MAX_EDGES).fill(0) as number[] },
    uWcCount: { value: 0 },
    uWcMargin: { value: MARGIN },
    uWcFrame: { value: new THREE.Matrix4() },
    uWcWhite: { value: new THREE.Vector3(WHITE.r, WHITE.g, WHITE.b) },
    uWcOn: { value: 1 },
    uWcNbr: { value: Array.from({ length: MAX_NBR }, () => new THREE.Vector4()) },
    uWcNbrCount: { value: 0 },
  };
  private mats = new Set<THREE.Material>();

  private seen = -1;

  constructor(footprint: XZ[][] = [], frame?: THREE.Matrix4) {
    this.setFootprint(footprint);
    if (frame) this.uniforms.uWcFrame.value.copy(frame);
  }

  // Follow the photo layer's aligned frame: its footprint is engine local [x east, y north], the tiles already sit
  // in the scene frame through its holder, so the mask is tested in world space.
  sync(f: { footprint: [number, number][]; version: number }) {
    if (f.version === this.seen) return;
    this.seen = f.version;
    this.setFootprint(f.footprint.length > 2 ? [f.footprint.map(([x, y]) => [x, -y] as XZ)] : []);
  }

  // World → mask frame. Identity while the tiles are aligned into our scene frame.
  setFrame(m: THREE.Matrix4) { this.uniforms.uWcFrame.value.copy(m); }

  setFootprint(polys: XZ[][]) {
    let total = polys.reduce((n, p) => n + p.length, 0);
    // Too many edges for the shader: the convex hull of the house still keeps it photographic.
    if (total > MAX_EDGES) { polys = [hull(polys.flat())]; total = polys[0].length; }
    const E = this.uniforms.uWcEdges.value, P = this.uniforms.uWcPoly.value;
    let i = 0;
    polys.forEach((poly, j) => poly.forEach((a, k) => {
      if (i >= MAX_EDGES) return;
      const b = poly[(k + 1) % poly.length];
      E[i].set(a[0], a[1], b[0], b[1]); P[i] = j; i++;
    }));
    this.uniforms.uWcCount.value = i;
  }

  // Neighbours' footprint edges in the three XZ plane; the nearest MAX_NBR to the house are kept.
  setNeighbours(edges: [XZ, XZ][], house: XZ = [0, 0]) {
    const d = ([a, b]: [XZ, XZ]) => Math.hypot((a[0] + b[0]) / 2 - house[0], (a[1] + b[1]) / 2 - house[1]);
    const keep = [...edges].sort((x, y) => d(x) - d(y)).slice(0, MAX_NBR), N = this.uniforms.uWcNbr.value;
    keep.forEach(([a, b], i) => N[i].set(a[0], a[1], b[0], b[1]));
    this.uniforms.uWcNbrCount.value = keep.length;
  }

  // Patch every mesh of a freshly loaded tile. Google's tiles are unlit; anything else becomes unlit too, so
  // the scene lights never shade the photo.
  apply(root: THREE.Object3D) {
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const list = Array.isArray(m.material) ? m.material : [m.material];
      const next = list.map((mat) => this.patch(mat));
      m.material = Array.isArray(m.material) ? next : next[0];
    });
  }

  private patch(mat: THREE.Material): THREE.Material {
    let out = mat as THREE.MeshBasicMaterial;
    if (!(mat as THREE.MeshBasicMaterial).isMeshBasicMaterial) {
      const src = mat as THREE.MeshStandardMaterial;
      out = new THREE.MeshBasicMaterial({ map: src.map ?? null, color: src.color ?? 0xffffff, side: src.side, transparent: src.transparent, opacity: src.opacity });
      mat.dispose();
    }
    if (out.userData.whiteCtx) return out;
    out.userData.whiteCtx = true;
    out.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.uniforms);
      sh.vertexShader = VERT_DECL + sh.vertexShader.replace("#include <project_vertex>", `#include <project_vertex>\n${VERT_BODY}`);
      sh.fragmentShader = FRAG_DECL + sh.fragmentShader.replace("#include <map_fragment>", `#include <map_fragment>\n${FRAG_BODY}`);
    };
    out.customProgramCacheKey = () => "white-context-v2";
    out.needsUpdate = true;
    this.mats.add(out);
    return out;
  }

  // Desaturate-and-fade is not needed (see docs/photo.md); uWcOn 0 shows the plain photo everywhere.
  setOn(on: boolean) { this.uniforms.uWcOn.value = on ? 1 : 0; }

  dispose() { this.mats.clear(); }
}

// Fallback look on the LoD2 glb: textured roof on a white massing model. Colours change in place, so the heat
// layer's saved wall material stays the white one. The ground loses its aerial photo.
export function whiteFallback(root: THREE.Object3D) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const name = (m.name || m.parent?.name || "").toLowerCase();
    const mat = m.material as THREE.MeshLambertMaterial;
    if (name.startsWith("ground")) {
      m.material = new THREE.MeshLambertMaterial({ color: WHITE, side: THREE.DoubleSide });
      mat.map?.dispose(); mat.dispose();
    } else if (name.startsWith("context")) {
      Object.assign(mat, { transparent: false, opacity: 1, depthWrite: true });
      mat.color.set(SLAB);
      mat.needsUpdate = true;
    } else if (name.startsWith("walls")) {
      mat.color.set(WALL);
    }
  });
}
