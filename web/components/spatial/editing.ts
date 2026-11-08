// On-model editing, the data side: every slot a module can take on a roof face, which of them the design uses, and
// the planner's own picks. The engine sends the slot grid with the layers (api v2.14, planes[].slots); when it does
// not, roof/model/layout.py's slots() is ported here as is (portrait 1.134 x 1.762 m,
// 2 cm gaps, 30 cm setback, eaves row first, capped at the face's max_panels), so an empty slot sits on the same
// grid as the modules the engine placed. A slot's id is "<face id>:<index in that order>".
// The picks go to the lead as layout_slots (slot ids, stored opaque) with pv_kwp in one edit, and come back from it on
// load. The lead is the only source: nothing about the layout is kept in the browser.
import type { PanelRect, RoofPlane, V3 } from "./types";

export const MODULE_WP = 450;
const MOD_U = 1.134, MOD_V = 1.762, GAP = 0.02, EDGE = 0.3, LIFT = 0.08, SLACK = 0.06;

type Vec = [number, number, number];
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: Vec): Vec => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

// Origin, u (along the ridge), v (up the slope), n (outward), as layout.frame().
export function frameOf(ring: Vec[]) {
  let n: Vec = [0, 0, 0];
  ring.forEach((a, i) => {
    const b = ring[(i + 1) % ring.length];
    n = [n[0] + (a[1] - b[1]) * (a[2] + b[2]), n[1] + (a[2] - b[2]) * (a[0] + b[0]), n[2] + (a[0] - b[0]) * (a[1] + b[1])];
  });
  n = unit(n); if (n[2] < 0) n = [-n[0], -n[1], -n[2]];
  let u: Vec;
  if (n[2] > 0.996) {
    let best = -1; u = [1, 0, 0];
    ring.forEach((a, i) => { const e = sub(ring[(i + 1) % ring.length], a); e[2] = 0; const l = Math.hypot(...e); if (l > best) { best = l; u = unit(e); } });
  } else u = unit(cross([0, 0, 1], n));
  return { o: ring[0], u, v: cross(n, u), n };
}

type P2 = [number, number];
// The polygon moved inwards by d along every edge (corners where the moved edges meet): shapely's buffer(-d) for
// the simple, mostly convex faces LoD2 gives.
function inset(poly: P2[], d: number): P2[] {
  let area = 0;
  poly.forEach((a, i) => { const b = poly[(i + 1) % poly.length]; area += a[0] * b[1] - b[0] * a[1]; });
  const s = area > 0 ? 1 : -1, N = poly.length;
  const lines = poly.map((a, i) => {
    const b = poly[(i + 1) % N], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
    const nx = (-dy / l) * s, ny = (dx / l) * s; // inward normal
    return { p: [a[0] + nx * d, a[1] + ny * d] as P2, r: [dx, dy] as P2 };
  });
  return lines.map((L1, i) => {
    const L0 = lines[(i + N - 1) % N], den = L0.r[0] * L1.r[1] - L0.r[1] * L1.r[0];
    if (Math.abs(den) < 1e-9) return L1.p;
    const t = ((L1.p[0] - L0.p[0]) * L1.r[1] - (L1.p[1] - L0.p[1]) * L1.r[0]) / den;
    return [L0.p[0] + L0.r[0] * t, L0.p[1] + L0.r[1] * t];
  });
}
function inside(q: P2, poly: P2[]) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > q[1]) !== (b[1] > q[1]) && q[0] < ((b[0] - a[0]) * (q[1] - a[1])) / (b[1] - a[1]) + a[0]) hit = !hit;
  }
  return hit;
}
function edgeDist(q: P2, poly: P2[]) {
  let m = Infinity;
  poly.forEach((a, i) => {
    const b = poly[(i + 1) % poly.length], dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / l2));
    m = Math.min(m, Math.hypot(q[0] - a[0] - t * dx, q[1] - a[1] - t * dy));
  });
  return m;
}

const centre = (r: V3[]): Vec => r.reduce<Vec>((s, q) => [s[0] + q[0] / r.length, s[1] + q[1] / r.length, s[2] + q[2] / r.length], [0, 0, 0]);
const corners = (r: PanelRect): V3[] | null => (Array.isArray(r) ? r : null);

export type Slot = { id: string; plane: string; i: number; corners: V3[]; c: V3; n: V3 };
export type FaceSlots = { plane: RoofPlane; slots: Slot[]; placed: number[] };

// Every slot on one face, in the engine's order; when the face already carries modules, the grid is nudged onto
// them so the placed ones and the empty ones line up exactly.
export function slotsOf(p: RoofPlane): FaceSlots {
  const ring = p.polygon as Vec[];
  if (ring.length < 3) return { plane: p, slots: [], placed: [] };
  const { o, u, v, n } = frameOf(ring);
  if (p.slots?.length) return withPlaced(p, p.slots.map((x, k) => {
    const i = Number(x.id.slice(x.id.lastIndexOf(":") + 1));
    return { id: x.id, plane: p.id, i: Number.isFinite(i) ? i : k, corners: x.corners, c: centre(x.corners) as V3, n: n as V3 };
  }));
  const uv: P2[] = ring.map((q) => { const d = sub(q, o); return [dot(d, u), dot(d, v)]; });
  const ins = inset(uv, EDGE);
  let minx = Math.min(...ins.map((q) => q[0])), miny = Math.min(...ins.map((q) => q[1]));
  const maxx = Math.max(...ins.map((q) => q[0])), maxy = Math.max(...ins.map((q) => q[1]));
  const chosen = (p.chosen_panels ?? []).map(corners).filter((r): r is V3[] => !!r && r.length === 4);
  if (chosen.length) {
    // The first placed module's lower-left corner is a grid point: shift the origin onto it.
    const c0 = chosen[0][0] as Vec, d = sub(c0, o), x0 = dot(d, u), y0 = dot(d, v);
    const sx = MOD_U + GAP, sy = MOD_V + GAP;
    const fx = x0 - minx - Math.round((x0 - minx) / sx) * sx, fy = y0 - miny - Math.round((y0 - miny) / sy) * sy;
    if (Math.abs(fx) < 0.5) minx += fx;
    if (Math.abs(fy) < 0.5) miny += fy;
  }
  const fits = (pts: P2[]) => pts.every((q) => inside(q, uv) && edgeDist(q, uv) >= EDGE - SLACK - 1e-6);
  const out: Slot[] = [];
  const cap = p.fits_panels ?? p.max_panels ?? Infinity;
  for (let y = miny; y + MOD_V <= maxy + 1e-6 && out.length < cap; y += MOD_V + GAP) {
    for (let x = minx; x + MOD_U <= maxx + 1e-6 && out.length < cap; x += MOD_U + GAP) {
      const box: P2[] = [[x, y], [x + MOD_U, y], [x + MOD_U, y + MOD_V], [x, y + MOD_V]];
      if (!fits(box)) continue;
      const cs = box.map(([a, b]) => [0, 1, 2].map((k) => Math.round((o[k] + u[k] * a + v[k] * b + n[k] * LIFT) * 100) / 100) as V3);
      out.push({ id: `${p.id}:${out.length}`, plane: p.id, i: out.length, corners: cs, c: centre(cs) as V3, n: n as V3 });
    }
  }
  return withPlaced(p, out);
}

// The modules on the face take the slot they sit on (same grid, so the nearest centre within half a module).
function withPlaced(p: RoofPlane, out: Slot[]): FaceSlots {
  const chosen = (p.chosen_panels ?? []).map(corners).filter((r): r is V3[] => !!r && r.length === 4);
  const placed: number[] = [];
  chosen.forEach((r) => {
    const c = centre(r); let best = -1, bd = 0.5;
    out.forEach((s, k) => { const dd = Math.hypot(s.c[0] - c[0], s.c[1] - c[1], s.c[2] - c[2]); if (dd < bd && !placed.includes(k)) { bd = dd; best = k; } });
    if (best >= 0) { placed.push(out[best].i); out[best] = { ...out[best], corners: r, c: c as V3 }; }
  });
  return { plane: p, slots: out, placed: placed.sort((a, b) => a - b) };
}

// The planner's picks: face id -> slot indices. Stored per lead and per kWp, so Undo and a reload find the layout
// that belongs to the design on screen.
export type Picks = Record<string, number[]>;
export const kwpKey = (kwp: number | null | undefined) => (kwp ?? 0).toFixed(2);
export const countOf = (p: Picks) => Object.values(p).reduce((s, x) => s + x.length, 0);
export const idsOf = (p: Picks) => Object.entries(p).flatMap(([f, is]) => is.map((i) => `${f}:${i}`));
export function picksOf(ids: string[], faces: string[]): Picks {
  const out: Picks = Object.fromEntries(faces.map((f) => [f, [] as number[]]));
  ids.forEach((id) => { const k = id.lastIndexOf(":"), f = id.slice(0, k), i = Number(id.slice(k + 1)); if (f in out && Number.isFinite(i)) out[f].push(i); });
  Object.values(out).forEach((x) => x.sort((a, b) => a - b));
  return out;
}
// Layouts an earlier build kept in this browser (marquee:slots:<lead>): removed, never read.
export function dropStoredPicks() {
  try { Object.keys(localStorage).filter((k) => k.startsWith("marquee:slots:")).forEach((k) => localStorage.removeItem(k)); } catch { /* storage off */ }
}

// The planes with the planner's picks as their modules (the engine's corners kept for any module it placed itself).
export function withPicks(planes: RoofPlane[], picks: Picks): RoofPlane[] {
  return planes.map((p) => {
    if (!p.is_target || !(p.id in picks)) return p.is_target ? { ...p, chosen_panels: [] } : p;
    const f = slotsOf(p), byI = new Map(f.slots.map((x) => [x.i, x]));
    return { ...p, chosen_panels: picks[p.id].filter((i) => byI.has(i)).map((i) => byI.get(i)!.corners) };
  });
}
