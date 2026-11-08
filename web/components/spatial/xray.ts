// Envelope x-ray for the heat pump step. The real LoD2 model stays: the aerial-textured roof keeps its pitch and
// texture under a light tint, and the house's own walls become a frosted glass shell, so the floor reads through
// them. Each element (roof, outer walls, floor) takes a muted cool-to-warm tint by its share of the heat loss
// (lib/envelope.ts), and a faint shell just outside each face breathes slowly where heat leaves. No windows are
// drawn: the engine's window share is a typology figure, not measured facade data. The shares sit in one legend
// card at the side of the view, with thin leader lines to their face. Numbers are the engine's envelope block.
// Motion: one critically damped spring (0.5 s, bounce 0) fades it all in and out; the glow breathes over 5 s.
// Reduce Motion: the same opacity fade (a crossfade) and a still glow.
import * as THREE from "three";
import type { Envelope, RoofPlane, V3 } from "./types";
import { elementsOf, type ElementKey } from "@/lib/envelope";

type P = { x: number; y: number; ok: boolean };
export interface XrayHost {
  walls: () => THREE.Mesh | null; box: THREE.Box3; planes: () => RoofPlane[]; root: THREE.Object3D;
  overlay: () => HTMLElement | null; project: (v: THREE.Vector3) => P; camera: () => THREE.Camera; reduce: () => boolean;
}

const toV = ([x, y, z]: V3) => new THREE.Vector3(x, z, -y);
const FROST = new THREE.Color("#F3F1EC");
const INK = "#2A2C33";
const OMEGA = (2 * Math.PI) / 0.5;
const BREATH_S = 5;
// The four shares on the card, in this order; roof falls back to the top ceiling when the roof space is unheated.
const CARD: ElementKey[] = ["roof", "wall", "window", "floor"];

// Leader targets: points just inside each face's outline; the one nearest the card on screen is used, so a leader
// reaches its face at the near edge and never crosses the roof or another face.
type Face = { c: THREE.Vector3; n: THREE.Vector3; area: number; cands: THREE.Vector3[]; poly?: THREE.Vector3[] };
type Fade = { m: THREE.Material & { opacity: number }; k: number; glow?: number };

export class Xray {
  private env: Envelope | null = null;
  private f = 0; private v = 0; private goal = 0; private t = 0;
  private g = new THREE.Group();
  private mats: Fade[] = [];
  private wall: { mesh: THREE.Mesh; orig: THREE.BufferGeometry } | null = null;
  private wallsDone = false;
  private faces: Face[] = [];          // wall facades of this house, for the wall leader
  private roofs: Face[] = [];
  private floorCands: THREE.Vector3[] = [];
  private shellBox: THREE.Box3 | null = null;   // the glass shell's own bounds, tighter than the scene's box
  private card: HTMLDivElement | null = null;
  private lines: SVGSVGElement | null = null;

  constructor(private host: XrayHost) { this.g.visible = false; host.root.add(this.g); }

  // env null: fade out, then put the plain walls back. Returns no on-model labels: the shares live in the card.
  set(env: Envelope | null): never[] {
    if (!env || !env.faces?.length) { this.goal = 0; return []; }
    const same = this.env === env && this.g.children.length > 0;
    this.env = env; this.goal = 1;
    if (!same) this.build();
    return [];
  }

  private clear() {
    this.g.clear();
    this.mats.forEach(({ m }) => m.dispose());
    this.mats = [];
    if (this.wall) { this.wall.mesh.geometry = this.wall.orig; this.wall = null; }
    this.wallsDone = false;
    this.faces = []; this.roofs = []; this.floorCands = []; this.shellBox = null;
    this.card?.remove(); this.card = null;
    this.lines?.remove(); this.lines = null;
  }

  private mat(colour: THREE.Color, k: number, opts: { lit?: boolean; glow?: number } = {}) {
    const p = { color: colour, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false };
    // Lit glass keeps the facets readable; the emissive share keeps it from going grey in shade.
    const m = opts.lit ? new THREE.MeshLambertMaterial({ ...p, emissive: colour.clone().multiplyScalar(0.45) }) : new THREE.MeshBasicMaterial(p);
    this.mats.push({ m, k, glow: opts.glow });
    return m;
  }

  private tints(env: Envelope) {
    const { list, scale } = elementsOf(env);
    const share = new Map(list.map((e) => [e.key, e.share]));
    const c = (k: ElementKey) => {
      const s = share.get(k);
      if (s == null || s <= 0) return null;
      const [r, g, b] = scale(s);
      return { col: new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace), s };
    };
    return { roof: c("roof") ?? c("ceiling"), wall: c("wall"), floor: c("floor"), hi: Math.max(0.01, ...list.map((e) => e.share)) };
  }

  private build() {
    this.clear();
    const T = this.tints(this.env!);
    // Roof: the aerial texture stays readable under a light tint; a second sheet just above it carries the glow.
    if (T.roof) {
      this.host.planes().filter((p) => p.is_target).forEach((p) => {
        const pts = p.polygon.map(toV), n = new THREE.Vector3();
        for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; n.x += (a.y - b.y) * (a.z + b.z); n.y += (a.z - b.z) * (a.x + b.x); n.z += (a.x - b.x) * (a.y + b.y); }
        n.normalize(); if (n.y < 0) n.negate();
        const u = new THREE.Vector3().subVectors(pts[1], pts[0]).normalize(), v = new THREE.Vector3().crossVectors(n, u).normalize();
        const tris = THREE.ShapeUtils.triangulateShape(pts.map((q) => new THREE.Vector2(q.dot(u), q.dot(v))), []).flat();
        const sheet = (lift: number, mat: THREE.Material, order: number) => {
          const geo = new THREE.BufferGeometry().setFromPoints(pts.map((q) => q.clone().addScaledVector(n, lift)));
          geo.setIndex(tris);
          const m = new THREE.Mesh(geo, mat); m.renderOrder = order; this.g.add(m);
        };
        sheet(0.05, this.mat(T.roof!.col, 0.34), 5);
        sheet(0.45, this.mat(T.roof!.col, 0, { glow: 0.22 * (T.roof!.s / T.hi) }), 7);
        const c0 = pts.reduce((a, q) => a.add(q), new THREE.Vector3()).multiplyScalar(1 / pts.length);
        this.roofs.push({ c: c0, n, area: p.area_m2, poly: pts, cands: inset(pts, c0, 0.4).map((q) => q.addScaledVector(n, 0.1)) });
      });
    }
    this.buildWalls();
  }

  // Walls need the glb; until it is in, frame() retries.
  private buildWalls() {
    const wm = this.host.walls(), env = this.env;
    if (!wm || !env || this.wallsDone) return;
    this.wallsDone = true;
    const T = this.tints(env);
    const src = wm.geometry.index ? wm.geometry.toNonIndexed() : wm.geometry;
    const pos = src.getAttribute("position");
    wm.updateWorldMatrix(true, false);
    const inHouse = this.host.box.clone().expandByScalar(0.8);
    const mine: THREE.Vector3[] = [], keep: number[] = [];
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), m = new THREE.Vector3();
    for (let i = 0; i < pos.count; i += 3) {
      a.fromBufferAttribute(pos, i).applyMatrix4(wm.matrixWorld); b.fromBufferAttribute(pos, i + 1).applyMatrix4(wm.matrixWorld); c.fromBufferAttribute(pos, i + 2).applyMatrix4(wm.matrixWorld);
      m.copy(a).add(b).add(c).multiplyScalar(1 / 3);
      if (inHouse.containsPoint(m.setY(Math.min(m.y, inHouse.max.y - 0.1)))) mine.push(a.clone(), b.clone(), c.clone());
      else keep.push(i, i + 1, i + 2);
    }
    if (!mine.length) return;
    // The house's own walls leave the shared wall mesh while the x-ray is on (every attribute kept, so the
    // neighbours keep their shading); the glass shell stands in their place. The massing's edge lines stay.
    const rest = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(src.attributes)) {
      const A = attr as THREE.BufferAttribute, out = new Float32Array(keep.length * A.itemSize);
      keep.forEach((j, o) => { for (let q = 0; q < A.itemSize; q++) out[o * A.itemSize + q] = A.getComponent(j, q); });
      rest.setAttribute(name, new THREE.BufferAttribute(out, A.itemSize));
    }
    this.wall = { mesh: wm, orig: wm.geometry };
    wm.geometry = rest;

    const glass = FROST.clone();
    if (T.wall) glass.lerp(T.wall.col, 0.62);
    const geo = new THREE.BufferGeometry().setFromPoints(mine); geo.computeVertexNormals();
    this.shellBox = new THREE.Box3().setFromPoints(mine);
    const shell = new THREE.Mesh(geo, this.mat(glass, 0.58, { lit: true })); shell.renderOrder = 4; this.g.add(shell);
    const lm = new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0, depthWrite: false });
    this.mats.push({ m: lm, k: 0.38 });
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo, 25), lm);
    edges.renderOrder = 6; this.g.add(edges);

    // Facades (vertical faces grouped by plane): leader targets, and a glow sheet a little outside each one.
    const ctr = this.host.box.getCenter(new THREE.Vector3());
    const groups = new Map<string, { n: THREE.Vector3; pts: THREE.Vector3[]; area: number }>();
    for (let i = 0; i < mine.length; i += 3) {
      const [p, q, r] = [mine[i], mine[i + 1], mine[i + 2]];
      const n = new THREE.Vector3().subVectors(q, p).cross(new THREE.Vector3().subVectors(r, p));
      const area = n.length() / 2; if (area < 0.05) continue;
      n.normalize();
      const mid = p.clone().add(q).add(r).multiplyScalar(1 / 3);
      if (n.dot(mid.clone().sub(ctr)) < 0) n.negate();
      if (Math.abs(n.y) > 0.2) continue;
      const k = `${Math.round(Math.atan2(n.x, -n.z) * 36 / Math.PI)}:${Math.round(n.dot(p) / 0.3)}`;
      const gq = groups.get(k) ?? { n, pts: [], area: 0 };
      gq.pts.push(p, q, r); gq.area += area; groups.set(k, gq);
    }
    if (T.wall) {
      const halo: THREE.Vector3[] = [];
      groups.forEach(({ n, pts, area }) => {
        if (area < 3) return;
        pts.forEach((p) => halo.push(p.clone().addScaledVector(n, 0.4)));
        const c0 = pts.reduce((s, p) => s.add(p), new THREE.Vector3()).multiplyScalar(1 / pts.length);
        // Both ends of the facade at ground-floor height, inset 0.4 m: always below the eaves.
        const u = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), n).normalize();
        const us = pts.map((q) => q.dot(u)), u0 = Math.min(...us), u1 = Math.max(...us), y0 = Math.min(...pts.map((q) => q.y));
        const d = n.dot(pts[0]) + 0.05;
        const cands = [u0 + 0.4, u1 - 0.4].flatMap((uu) => [1.2, 2.2].map((dy) => u.clone().multiplyScalar(uu).addScaledVector(n, d).setY(y0 + dy)));
        this.faces.push({ c: c0.addScaledVector(n, 0.05), n, area, cands });
      });
      if (halo.length) { const h = new THREE.Mesh(new THREE.BufferGeometry().setFromPoints(halo), this.mat(T.wall.col, 0, { glow: 0.2 * (T.wall.s / T.hi) })); h.renderOrder = 7; this.g.add(h); }
    }
    // Floor: the hull of the walls' foot, just above the ground, seen through the glass.
    if (T.floor) {
      const foot = mine.filter((p) => p.y < this.host.box.min.y + 0.4).map((p) => new THREE.Vector2(p.x, p.z));
      const hull = convexHull(foot);
      if (hull.length >= 3) {
        const y = this.host.box.min.y + 0.06;
        const geoF = new THREE.BufferGeometry().setFromPoints(hull.map((p) => new THREE.Vector3(p.x, y, p.y)));
        geoF.setIndex(THREE.ShapeUtils.triangulateShape(hull, []).flat());
        const fm = new THREE.Mesh(geoF, this.mat(T.floor.col, 0.62)); fm.renderOrder = 3; this.g.add(fm);
        const cx = hull.reduce((s, p) => s.add(p), new THREE.Vector2()).multiplyScalar(1 / hull.length);
        this.floorCands = inset(hull.map((p) => new THREE.Vector3(p.x, y, p.y)), new THREE.Vector3(cx.x, y, cx.y), 0.5);
      }
    }
    this.apply();
  }

  // The legend card: four shares, the engine's numbers, with a thin leader to each face that is drawn.
  private ensureCard() {
    const ov = this.host.overlay(), env = this.env;
    if (!ov || !env || this.card) return;
    const { list } = elementsOf(env);
    const by = new Map(list.map((e) => [e.key, e]));
    const rows = CARD.map((k) => (k === "roof" && !(by.get("roof")?.share) ? by.get("ceiling") ?? by.get("roof") : by.get(k)))
      .filter((e): e is NonNullable<typeof e> => !!e && e.share > 0);
    if (!rows.length) return;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("aria-hidden", "true");
    Object.assign(svg.style, { position: "absolute", left: "0", top: "0", width: "100%", height: "100%", pointerEvents: "none", overflow: "visible", zIndex: "2" });
    const card = document.createElement("div");
    card.className = "xr-card";
    card.setAttribute("role", "group"); card.setAttribute("aria-label", "Heat loss by element");
    Object.assign(card.style, {
      position: "absolute", zIndex: "3", pointerEvents: "none", background: "#fff", border: "1px solid var(--rule-strong, #d6d3cb)",
      borderRadius: "12px", padding: "8px 10px 7px", font: "12.5px/1.25 var(--font-sans), sans-serif", color: "var(--ink, #0A0C14)",
      display: "grid", gap: "4px", minWidth: "148px",
    });
    const pc = (s: number) => `${Math.round(s * 100)} %`;
    card.innerHTML = `<div data-x="head" style="font-weight:600;margin-bottom:1px">Heat loss</div>` +
      rows.map((e) => `<div data-k="${e.key === "ceiling" ? "roof" : e.key}" data-c="${e.colour}" style="display:grid;grid-template-columns:8px 1fr auto;gap:7px;align-items:center;white-space:nowrap">` +
        `<i style="width:8px;height:8px;border-radius:50%;background:${e.colour}"></i><span>${e.name}</span>` +
        `<b style="font-weight:600;font-variant-numeric:tabular-nums">${pc(e.share)}</b></div>`).join("") +
      `<div data-x="foot" style="font-size:11px;color:var(--ink-3, #8a8d96);margin-top:2px">Estimate</div>`;
    ov.appendChild(svg); ov.appendChild(card);
    this.card = card; this.lines = svg;
  }

  private place() {
    const card = this.card, svg = this.lines, ov = this.host.overlay();
    if (!card || !svg || !ov) return;
    const cs = getComputedStyle(card);
    const num = (v: string, d: number) => { const x = parseFloat(cs.getPropertyValue(v)); return Number.isFinite(x) ? x : d; };
    const fl = num("--free-l", 0), ft = num("--free-t", 0), fw = num("--free-w", ov.clientWidth), fh = num("--free-h", ov.clientHeight);
    const phone = ov.clientWidth < 560;
    card.style.fontSize = phone ? "11.5px" : "12.5px";
    card.style.minWidth = phone ? "0" : "148px";
    card.style.gridTemplateColumns = phone ? "auto auto" : "";
    card.style.columnGap = phone ? "14px" : "";
    card.style.padding = phone ? "6px 9px 5px" : "8px 10px 7px";
    card.querySelectorAll<HTMLElement>("[data-x]").forEach((el) => { el.style.display = phone && el.dataset.x === "head" ? "none" : ""; el.style.gridColumn = phone ? "1 / -1" : ""; });
    // Beside the house on screen, so the leaders stay short and cross no other building: to the right of the
    // building on a wide view (left if there is no room), below it on a phone; always inside the free area.
    const bx = this.shellBox ?? this.host.box, hs = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    for (const cx of [bx.min.x, bx.max.x]) for (const cy of [bx.min.y, bx.max.y]) for (const cz of [bx.min.z, bx.max.z]) {
      const q = this.host.project(new THREE.Vector3(cx, cy, cz));
      hs.x0 = Math.min(hs.x0, q.x); hs.x1 = Math.max(hs.x1, q.x); hs.y0 = Math.min(hs.y0, q.y); hs.y1 = Math.max(hs.y1, q.y);
    }
    const cw = card.offsetWidth, ch = card.offsetHeight, G = 20;
    const clampX = (v: number) => Math.max(fl + 8, Math.min(fl + fw - cw - 8, v)), clampY = (v: number) => Math.max(ft + 8, Math.min(ft + fh - ch - 8, v));
    let x: number, y: number;
    if (phone) {
      // Directly below the house, over its own garden (the camera looks from the street side), above the
      // toolbar band at the bottom of the canvas; never over the house.
      // The model toolbar's top edge, measured; 58 px when it is not on the page.
      const tb = ov.parentElement?.parentElement?.querySelector<HTMLElement>('[class*="toolbar"]');
      const ovr = ov.getBoundingClientRect(), tr = tb?.getBoundingClientRect();
      const floor = (tr && tr.height && tr.top > ovr.top + ovr.height / 2 ? tr.top - ovr.top : ft + fh - 58 + 8) - ch - 8;
      x = clampX((hs.x0 + hs.x1) / 2 - cw / 2);
      y = Math.max(ft + 8, Math.min(floor, hs.y1 + 10));
    } else {
      x = hs.x1 + G + cw <= fl + fw - 8 ? hs.x1 + G : hs.x0 - G - cw;
      x = clampX(x);
      y = clampY((hs.y0 + hs.y1) / 2 - ch / 2);
    }
    card.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px)`;
    const o = this.f;
    card.style.opacity = o.toFixed(3);
    svg.style.opacity = o.toFixed(3);
    // Each row's leader starts at the card edge nearest its face and ends in a small dot on the face.
    const cam = this.host.camera(), eye = new THREE.Vector3(); cam.getWorldPosition(eye);
    const facing = (fc: Face) => fc.n.dot(eye.clone().sub(fc.c).normalize());
    // The facade that faces the camera most (a facade seen edge-on would put its dot under the roof).
    const big = this.faces.filter((fc) => fc.area >= 6), pool = big.length ? big : this.faces;
    const wall = pool.length ? pool.reduce((b, fc) => (facing(fc) > facing(b) ? fc : b)) : null;
    const up = this.roofs.filter((r) => facing(r) > 0.05);
    const roofCands = up.flatMap((r) => r.cands);
    // Wall and floor ends hidden behind a roof face on screen are skipped, so their leaders never cross the roof.
    const shadows = up.map((r) => (r.poly ?? []).map((v) => this.host.project(v)));
    const open = (q: P) => !shadows.some((poly) => inside(q, poly));
    // The candidate whose screen point lies nearest the card.
    const near = (cands: THREE.Vector3[]) => {
      let best: P | null = null, bd = Infinity;
      cands.forEach((v) => {
        const q = this.host.project(v); if (!q.ok || (!roofCands.includes(v) && !open(q))) return;
        const dx = Math.max(x - q.x, 0, q.x - (x + cw)), dy = Math.max(y - q.y, 0, q.y - (y + ch)), dd = dx * dx + dy * dy;
        if (dd < bd) { bd = dd; best = q; }
      });
      return best as P | null;
    };
    const at: Record<string, P | null> = { roof: near(roofCands), wall: wall ? near(wall.cands) : null, floor: near(this.floorCands), window: null };
    let html = "";
    card.querySelectorAll<HTMLElement>("[data-k]").forEach((row) => {
      const p = at[row.dataset.k ?? ""];
      if (!p) return;
      const ry = y + row.offsetTop + row.offsetHeight / 2;
      const sx = p.x < x ? x : p.x > x + cw ? x + cw : x + cw / 2, sy = p.x < x || p.x > x + cw ? ry : p.y < y ? y : y + ch;
      const kx = sx === x ? sx - 14 : sx === x + cw ? sx + 14 : sx;
      html += `<polyline points="${sx.toFixed(1)},${sy.toFixed(1)} ${kx.toFixed(1)},${sy.toFixed(1)} ${p.x.toFixed(1)},${p.y.toFixed(1)}" fill="none" stroke="${INK}" stroke-opacity="0.45" stroke-width="1"/>` +
        `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3" fill="${row.dataset.c ?? "#fff"}" stroke="${INK}" stroke-width="1"/>`;
    });
    if (svg.innerHTML !== html) svg.innerHTML = html;
  }

  private apply() {
    const still = this.host.reduce();
    const breath = still ? 0.75 : 0.55 + 0.45 * (0.5 - 0.5 * Math.cos((2 * Math.PI * this.t) / BREATH_S));
    this.mats.forEach(({ m, k, glow }) => { m.opacity = glow != null ? this.f * glow * breath : this.f * k; m.visible = m.opacity > 0.003; });
    this.g.visible = this.f > 0.005;
  }

  frame(dt: number) {
    if (this.goal === 1 && !this.wallsDone) this.buildWalls();
    if (this.goal === 1) this.ensureCard();
    this.t += dt;
    const settled = Math.abs(this.f - this.goal) < 0.002 && Math.abs(this.v) < 0.01;
    if (settled) {
      if (this.f !== this.goal) { this.f = this.goal; this.v = 0; if (this.goal === 0) { this.apply(); this.clear(); this.env = null; return; } }
    } else {
      const a = -OMEGA * OMEGA * (this.f - this.goal) - 2 * OMEGA * this.v;
      this.v += a * dt; this.f = Math.max(0, Math.min(1, this.f + this.v * dt));
    }
    if (this.f > 0) { this.apply(); this.place(); }
  }

  dispose() { this.clear(); this.g.removeFromParent(); }
}

function convexHull(p: THREE.Vector2[]): THREE.Vector2[] {
  const pts = [...p].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const cross = (o: THREE.Vector2, a: THREE.Vector2, b: THREE.Vector2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lo: THREE.Vector2[] = [], hi: THREE.Vector2[] = [];
  for (const q of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of pts.reverse()) { while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q); }
  return lo.slice(0, -1).concat(hi.slice(0, -1));
}

// Points along a closed outline (corners and edge midpoints), each moved d metres towards c so it sits on the face.
function inset(pts: THREE.Vector3[], c: THREE.Vector3, d: number): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  pts.forEach((a, i) => {
    const b = pts[(i + 1) % pts.length];
    [a, a.clone().lerp(b, 0.5)].forEach((q) => { const v = c.clone().sub(q), l = v.length(); out.push(q.clone().addScaledVector(v, l > d * 2 ? d / l : 0.3)); });
  });
  return out;
}

function inside(q: { x: number; y: number }, poly: { x: number; y: number }[]): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > q.y) !== (b.y > q.y) && q.x < ((b.x - a.x) * (q.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}
