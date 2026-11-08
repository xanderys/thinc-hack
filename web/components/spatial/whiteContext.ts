// The context around the house, in two looks. Default (real): the target house real (Google mesh where tiles
// cover it, the Bavarian model otherwise) on the satellite ground, neighbours as low slabs. "White context" (a
// view option, whiteMode.ts): the house real, everything else a white architectural model with soft shading,
// the way a planner's massing model reads (Autarc style).
//
// Mesh mode (Google Photorealistic 3D Tiles): every tile material is patched in its shader. The mask is the
// target house's footprint plus about 1 m. Inside it Google's texture stays. Outside it, the real look discards
// the mesh (our satellite ground and slabs show instead); the white look paints it flat white, shaded by its face
// normal (from screen derivatives, the tiles carry no normals) with a soft darkening where walls meet the ground.
// The mask is tested in world space: the photo layer's holder brings the tiles into our scene frame (x east, y up,
// z south), and the footprint is read from its meshFrame, never recomputed from the tiles.
//
// Fallback mode (LoD2 glb, no tiles): white swaps the ground, slabs and walls to white materials and back.
import * as THREE from "three";
import type { RoofPlane, V3 } from "./types";
import { onWhite, setMesh, whiteOn } from "./whiteMode";

const MAX_EDGES = 128;
const MAX_NBR = 96;                       // neighbours' footprint edges painted onto the white mesh
const MARGIN = 1.0;                       // metres of photo kept around the footprint
export const WHITE = new THREE.Color("#fbfaf6"); // a touch warm, so it sits on the paper ground
const OUTLINE = "#cfcbc2";
const SLAB = "#f1efe9";                   // neighbours: low white slabs, their footprints outlined on the ground
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

// Faint grey footprints of the neighbours, flat just above the ground and their flattened roofs; buildings hide them.
// Shown only in the white look without the mesh (the mesh paints them in its shader).
export function outlineMesh(edges: [XZ, XZ][], y = 0.04): THREE.LineSegments {
  const g = new THREE.BufferGeometry().setFromPoints(edges.flatMap(([a, b]) => [new THREE.Vector3(a[0], y, a[1]), new THREE.Vector3(b[0], y, b[1])]));
  const l = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: OUTLINE, transparent: true, opacity: 0.8, depthWrite: false }));
  l.name = "white-outlines";
  return l;
}

const VERT_DECL = /* glsl */ `varying vec3 vWcPos;
uniform sampler2D uWcFlat;
uniform vec4 uWcFlatBox;
uniform float uWcFlatY;
`;
// Photo layer hook (tiles.ts): inside the neighbours' footprints (a top-down mask, uWcFlatBox = x0, z0, size in
// metres) the mesh is pressed down to uWcFlatY, about 0.5 m above the ground, so neighbours never hide the facade.
const FLAT_PRE = /* glsl */ `
  if (uWcFlatBox.z > 0.0) {
    vec4 wcW = modelMatrix * vec4(transformed, 1.0);
    vec2 wcUv = (wcW.xz - uWcFlatBox.xy) / uWcFlatBox.z;
    if (wcW.y > uWcFlatY && all(greaterThan(wcUv, vec2(0.0))) && all(lessThan(wcUv, vec2(1.0))) && texture(uWcFlat, wcUv).r > 0.5) {
      wcW.y = uWcFlatY;
      transformed = (inverse(modelMatrix) * wcW).xyz;
    }
  }
`;
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
uniform float uWcKeep;
uniform float uWcClip;
uniform float uWcGround;
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
    if (uWcOn < 0.5 && m < 0.5 && uWcKeep < 0.5) discard; // uWcKeep: the photo layer keeps the real surroundings
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
// Our LoD2 walls with the mesh on screen: the neighbours' walls are already 0.4 m slab skirts, so anything
// taller, and anything inside the footprint, is the target's (or an annex's) and gives way to the mesh.
const CLIP_BODY = /* glsl */ `
  if (uWcClip > 0.5 && (vWcPos.y > uWcGround + 0.6 || (uWcCount > 0 && wcMask((uWcFrame * vec4(vWcPos, 1.0)).xz) > 0.5))) discard;
`;

// One set of uniforms for every patched material: there is one scene on screen at a time.
const U = {
  uWcEdges: { value: Array.from({ length: MAX_EDGES }, () => new THREE.Vector4()) },
  uWcPoly: { value: new Array(MAX_EDGES).fill(0) as number[] },
  uWcCount: { value: 0 },
  uWcMargin: { value: MARGIN },
  uWcFrame: { value: new THREE.Matrix4() },
  uWcWhite: { value: new THREE.Vector3(WHITE.r, WHITE.g, WHITE.b) },
  uWcOn: { value: whiteOn() ? 1 : 0 },
  uWcKeep: { value: 0 },
  uWcFlat: { value: new THREE.DataTexture(new Uint8Array(4), 1, 1) as THREE.Texture },
  uWcFlatBox: { value: new THREE.Vector4(0, 0, 0, 0) },
  uWcFlatY: { value: 0 },
  uWcClip: { value: 0 },
  uWcGround: { value: 0 },
  uWcNbr: { value: Array.from({ length: MAX_NBR }, () => new THREE.Vector4()) },
  uWcNbrCount: { value: 0 },
};
onWhite(() => { U.uWcOn.value = whiteOn() ? 1 : 0; });

function patchShader(mat: THREE.Material, body: string, key: string) {
  if (mat.userData.whiteCtx) return;
  mat.userData.whiteCtx = key;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, U);
    const pre = body === FRAG_BODY ? FLAT_PRE : ""; // only the photo tiles are flattened, never our glb walls
    sh.vertexShader = VERT_DECL + sh.vertexShader.replace("#include <project_vertex>", `${pre}#include <project_vertex>\n${VERT_BODY}`);
    sh.fragmentShader = FRAG_DECL + sh.fragmentShader.replace("#include <map_fragment>", `#include <map_fragment>\n${body}`);
  };
  mat.customProgramCacheKey = () => key;
  mat.needsUpdate = true;
}

let meshOn = false;
let lines: THREE.Object3D | null = null;
function refreshLines() { if (lines) lines.visible = whiteOn() && !meshOn; }

// One instance per photo layer: patches tile materials as they load and dresses our glb around the mesh.
export class WhiteContext {
  readonly uniforms = U;
  private seen = -1;
  private glb: THREE.Object3D | null = null;
  private off: (() => void) | null = null;

  constructor(footprint: XZ[][] = []) { this.setFootprint(footprint); }

  // Follow the photo layer's aligned frame: its footprint is engine local [x east, y north], the tiles already sit
  // in the scene frame through its holder, so the mask is tested in world space.
  sync(f: { footprint: [number, number][]; version: number }) {
    this.clipWalls();
    if (f.version === this.seen) return;
    this.seen = f.version;
    this.setFootprint(f.footprint.length > 2 ? [f.footprint.map(([x, y]) => [x, -y] as XZ)] : []);
  }

  setFootprint(polys: XZ[][]) {
    const total = polys.reduce((n, p) => n + p.length, 0);
    // Too many edges for the shader: the convex hull of the house still keeps it photographic.
    if (total > MAX_EDGES) polys = [hull(polys.flat())];
    const E = U.uWcEdges.value, P = U.uWcPoly.value;
    let i = 0;
    polys.forEach((poly, j) => poly.forEach((a, k) => {
      if (i >= MAX_EDGES) return;
      const b = poly[(k + 1) % poly.length];
      E[i].set(a[0], a[1], b[0], b[1]); P[i] = j; i++;
    }));
    U.uWcCount.value = i;
  }

  // Neighbours' footprint edges in the three XZ plane; the nearest MAX_NBR to the house are kept.
  setNeighbours(edges: [XZ, XZ][], house: XZ = [0, 0]) {
    const d = ([a, b]: [XZ, XZ]) => Math.hypot((a[0] + b[0]) / 2 - house[0], (a[1] + b[1]) / 2 - house[1]);
    const keep = [...edges].sort((x, y) => d(x) - d(y)).slice(0, MAX_NBR), N = U.uWcNbr.value;
    keep.forEach(([a, b], i) => N[i].set(a[0], a[1], b[0], b[1]));
    U.uWcNbrCount.value = keep.length;
  }

  // Patch every mesh of a freshly loaded tile. Google's tiles are unlit; anything else becomes unlit too, so
  // the scene lights never shade the photo.
  apply(root: THREE.Object3D) {
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const list = Array.isArray(m.material) ? m.material : [m.material];
      const next = list.map((mat) => {
        let out = mat as THREE.MeshBasicMaterial;
        if (!out.isMeshBasicMaterial) {
          const src = mat as THREE.MeshStandardMaterial;
          out = new THREE.MeshBasicMaterial({ map: src.map ?? null, color: src.color ?? 0xffffff, side: src.side, transparent: src.transparent, opacity: src.opacity });
          mat.dispose();
        }
        patchShader(out, FRAG_BODY, "white-context-v4");
        return out;
      });
      m.material = Array.isArray(m.material) ? next : next[0];
    });
  }

  // The mesh is on screen. Real look: our glb comes back around it (satellite ground, slabs, neighbour walls)
  // without the target's roof, and its walls are cut away inside the footprint. White look: the glb stays hidden
  // and the shader paints the context.
  attach(glb: THREE.Object3D | null) {
    this.glb = glb; meshOn = true; U.uWcClip.value = 1; setMesh(true);
    const dress = () => {
      if (glb) {
        glb.visible = !whiteOn();
        glb.traverse((o) => { if ((o as THREE.Mesh).isMesh && (o.name || "").toLowerCase().startsWith("ground")) U.uWcGround.value = new THREE.Box3().setFromObject(o).max.y; });
        glb.traverse((o) => {
          const m = o as THREE.Mesh, n = (m.name || m.parent?.name || "").toLowerCase();
          if (!m.isMesh) return;
          if (n.startsWith("roof")) m.visible = false;
        });
        this.clipWalls();
      }
      refreshLines();
    };
    dress();
    this.off = onWhite(dress);
  }

  // The scene swaps the wall material (massing look, heat layer) at any time: patch whatever is there now, edge
  // lines included. Idempotent, a handful of objects.
  private clipWalls() {
    this.glb?.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.material || !/^walls/.test((m.name || m.parent?.name || "").toLowerCase())) return;
      (Array.isArray(m.material) ? m.material : [m.material]).forEach((x) => patchShader(x, CLIP_BODY, `white-clip-v1-${x.type}`));
    });
  }

  detach() {
    this.off?.(); this.off = null; meshOn = false; U.uWcClip.value = 0; setMesh(false);
    this.glb?.traverse((o) => { const n = (o.name || o.parent?.name || "").toLowerCase(); if ((o as THREE.Mesh).isMesh && n.startsWith("roof")) o.visible = true; });
    this.glb = null;
    refreshLines();
  }

  dispose() { this.detach(); }
}

// The real ground material can change while white is on (the satellite texture arriving): keep it for later.
export function setRealGround(m: THREE.Mesh, mat: THREE.Material) {
  if (m.userData.white) m.userData.real = mat;
  else m.material = mat;
}

// Registers the loaded glb (and the neighbours' outline lines) with the view option: white swaps in white
// materials, off puts the real ones back. Returns the unsubscribe.
export function registerGlb(root: THREE.Object3D, outlines: THREE.Object3D | null) {
  lines = outlines;
  const apply = () => {
    const white = whiteOn();
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const name = (m.name || m.parent?.name || "").toLowerCase();
      if (!/^(ground|context|walls)/.test(name)) return;
      if (white && !m.userData.white) {
        const real = m.material as THREE.MeshLambertMaterial;
        const w = name.startsWith("walls") ? real.clone() : new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
        w.color.set(name.startsWith("ground") ? WHITE : name.startsWith("context") ? SLAB : WALL);
        m.userData.real = real; m.userData.white = true; m.material = w;
      } else if (!white && m.userData.white) {
        (m.material as THREE.Material).dispose();
        m.material = m.userData.real; m.userData.white = false;
      }
    });
    refreshLines();
  };
  apply();
  return onWhite(apply);
}
