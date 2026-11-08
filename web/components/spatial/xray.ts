// Envelope x-ray for the heat pump step: the house as one heated zone (DIN EN 12831 treats a single-family house as one
// zone), its outer walls, windows, roof and floor tinted by their element's share of the heat loss (lib/envelope.ts:
// orange loses most, blue least). Walls turn translucent so the floor reads through them. Windows are drawn as the
// typology's share of each wall, in rows per storey; all of it is estimated from the address.
// One spring (0.5 s, bounce 0) fades it in and out; it never moves anything, so Reduce Motion keeps the same fade.
import * as THREE from "three";
import type { Envelope, RoofPlane, V3 } from "./types";
import { elementsOf, windowShare, type ElementKey } from "@/lib/envelope";

type Label = { key: string; at: THREE.Vector3; html: string; cls?: string; prio?: number };
export interface XrayHost { walls: () => THREE.Mesh | null; box: THREE.Box3; planes: () => RoofPlane[]; root: THREE.Object3D }

const toV = ([x, y, z]: V3) => new THREE.Vector3(x, z, -y);
const WALL = new THREE.Color("#E2DED4");
const OMEGA = (2 * Math.PI) / 0.5;
const STOREY = 3, SILL = 0.9, WIN_H = 1.3, WIN_W = 1.2, GAP = 0.45;

export class Xray {
  private env: Envelope | null = null;
  private f = 0; private v = 0; private goal = 0;
  private g = new THREE.Group();
  private mats: { m: THREE.Material & { opacity: number }; k: number }[] = [];
  private wall: { mesh: THREE.Mesh; orig: THREE.BufferGeometry } | null = null;
  private wallsDone = false;

  constructor(private host: XrayHost) { this.g.visible = false; host.root.add(this.g); }

  // env null: fade out, then put the plain walls back.
  set(env: Envelope | null): Label[] {
    if (!env || !env.faces?.length) { this.goal = 0; return []; }
    const same = this.env === env && this.g.children.length > 0;
    this.env = env; this.goal = 1;
    if (!same) this.build();
    // One chip per element share, pinned where that element is on the house ("Windows 31 %"); the biggest first.
    const b = this.host.box, w = b.max.x - b.min.x, h = b.max.y - b.min.y, cz = (b.min.z + b.max.z) / 2;
    const AT: Partial<Record<ElementKey, THREE.Vector3>> = {
      roof: new THREE.Vector3(b.min.x + w * 0.5, b.max.y + 0.3, cz),
      ceiling: new THREE.Vector3(b.min.x + w * 0.5, b.max.y + 0.3, cz),
      wall: new THREE.Vector3(b.min.x + w * 0.2, b.min.y + h * 0.35, b.max.z),
      window: new THREE.Vector3(b.min.x + w * 0.75, b.min.y + h * 0.45, b.max.z),
      floor: new THREE.Vector3(b.max.x, b.min.y + 0.2, b.max.z),
    };
    return elementsOf(env).list.filter((e) => e.share > 0 && AT[e.key]).sort((x, y) => y.share - x.share).slice(0, 4)
      .map((e, i) => ({ key: `xray-${e.key}`, at: AT[e.key]!, html: `<i style="background:${e.colour}"></i>${e.name} <b>${Math.round(e.share * 100)} %</b>`, cls: "chip c-el", prio: 4e6 - i }));
  }

  private clear() {
    this.g.clear();
    this.mats.forEach(({ m }) => m.dispose());
    this.mats = [];
    if (this.wall) { this.wall.mesh.geometry = this.wall.orig; this.wall = null; }
    this.wallsDone = false;
  }

  private mat(colour: THREE.Color | null, k: number, vertex = false) {
    const m = new THREE.MeshBasicMaterial({ color: colour ?? 0xffffff, vertexColors: vertex, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
    this.mats.push({ m, k });
    return m;
  }

  private colour(scale: (s: number) => [number, number, number], share: Map<ElementKey, number>, k: ElementKey) {
    const s = share.get(k);
    if (s == null) return null;
    const [r, g, b] = scale(s);
    return new THREE.Color().setRGB(r / 255, g / 255, b / 255, THREE.SRGBColorSpace);
  }

  private build() {
    this.clear();
    const env = this.env!;
    const { list, scale } = elementsOf(env);
    const share = new Map(list.map((e) => [e.key, e.share]));
    const roofC = this.colour(scale, share, "roof") ?? this.colour(scale, share, "ceiling");
    // Roof faces of the house itself.
    if (roofC) this.host.planes().filter((p) => p.is_target).forEach((p) => {
      const pts = p.polygon.map(toV), n = new THREE.Vector3();
      for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; n.x += (a.y - b.y) * (a.z + b.z); n.y += (a.z - b.z) * (a.x + b.x); n.z += (a.x - b.x) * (a.y + b.y); }
      n.normalize(); if (n.y < 0) n.negate();
      const u = new THREE.Vector3().subVectors(pts[1], pts[0]).normalize(), v = new THREE.Vector3().crossVectors(n, u).normalize();
      const tris = THREE.ShapeUtils.triangulateShape(pts.map((q) => new THREE.Vector2(q.dot(u), q.dot(v))), []);
      const geo = new THREE.BufferGeometry().setFromPoints(pts.map((q) => q.clone().addScaledVector(n, 0.06)));
      geo.setIndex(tris.flat());
      const m = new THREE.Mesh(geo, this.mat(roofC, 0.9)); m.renderOrder = 5; this.g.add(m);
    });
    this.buildWalls();
  }

  // Walls need the glb; until it is in, frame() retries.
  private buildWalls() {
    const wm = this.host.walls(), env = this.env;
    if (!wm || !env || this.wallsDone) return;
    this.wallsDone = true;
    const { list, scale } = elementsOf(env);
    const share = new Map(list.map((e) => [e.key, e.share]));
    const wallC = this.colour(scale, share, "wall"), winC = this.colour(scale, share, "window"), floorC = this.colour(scale, share, "floor");
    const src = wm.geometry.index ? wm.geometry.toNonIndexed() : wm.geometry.clone();
    const pos = src.getAttribute("position");
    wm.updateWorldMatrix(true, false);
    const inHouse = this.host.box.clone().expandByScalar(0.8);
    const mine: THREE.Vector3[] = [], rest: number[] = [];
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let i = 0; i < pos.count; i += 3) {
      a.fromBufferAttribute(pos, i).applyMatrix4(wm.matrixWorld); b.fromBufferAttribute(pos, i + 1).applyMatrix4(wm.matrixWorld); c.fromBufferAttribute(pos, i + 2).applyMatrix4(wm.matrixWorld);
      const m = a.clone().add(b).add(c).multiplyScalar(1 / 3);
      if (inHouse.containsPoint(new THREE.Vector3(m.x, Math.min(m.y, inHouse.max.y - 0.1), m.z))) mine.push(a.clone(), b.clone(), c.clone());
      else for (let j = 0; j < 3; j++) rest.push(pos.getX(i + j), pos.getY(i + j), pos.getZ(i + j));
    }
    if (!mine.length) return;
    // The plain walls of this house leave the shared wall mesh while the x-ray is on; a grey copy fades out.
    const restG = new THREE.BufferGeometry(); restG.setAttribute("position", new THREE.Float32BufferAttribute(rest, 3)); restG.computeVertexNormals();
    this.wall = { mesh: wm, orig: wm.geometry };
    wm.geometry = restG;
    const geo = new THREE.BufferGeometry().setFromPoints(mine);
    const grey = new THREE.Mesh(geo, this.mat(WALL, -1)); grey.renderOrder = 1; this.g.add(grey);
    if (wallC) { const t = new THREE.Mesh(geo, this.mat(wallC, 0.55)); t.renderOrder = 4; this.g.add(t); }

    // Facades: target triangles grouped by plane; vertical ones get windows.
    const ctr = this.host.box.getCenter(new THREE.Vector3());
    const groups = new Map<string, { n: THREE.Vector3; pts: THREE.Vector3[]; area: number }>();
    for (let i = 0; i < mine.length; i += 3) {
      const [p, q, r] = [mine[i], mine[i + 1], mine[i + 2]];
      const n = new THREE.Vector3().subVectors(q, p).cross(new THREE.Vector3().subVectors(r, p));
      const area = n.length() / 2; if (area < 0.05) continue;
      n.normalize();
      const m = p.clone().add(q).add(r).multiplyScalar(1 / 3);
      if (n.dot(m.clone().sub(ctr)) < 0) n.negate();
      if (Math.abs(n.y) > 0.2) continue;
      const k = `${Math.round(Math.atan2(n.x, -n.z) * 36 / Math.PI)}:${Math.round(n.dot(p) / 0.3)}`;
      const gq = groups.get(k) ?? { n, pts: [], area: 0 };
      gq.pts.push(p, q, r); gq.area += area; groups.set(k, gq);
    }
    const env2 = env;
    if (winC) {
      const wins: THREE.Vector3[] = [];
      groups.forEach(({ n, pts, area }) => {
        if (area < 4) return;
        const az = ((Math.atan2(n.x, -n.z) * 180) / Math.PI + 360) % 360;
        const s = windowShare(env2, az);
        if (s <= 0) return;
        const u = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), n).normalize();
        const us = pts.map((p) => p.dot(u)), u0 = Math.min(...us), u1 = Math.max(...us);
        const y0 = Math.min(...pts.map((p) => p.y));
        // Full-height part of the wall: the lower of the tops at its two ends (a gable's eaves, a rectangle's top).
        const edge = (uu: number) => Math.max(...pts.filter((p) => Math.abs(p.dot(u) - uu) < 0.25).map((p) => p.y));
        const top = Math.min(edge(u0), edge(u1));
        const rows = Math.max(0, Math.floor((top - y0 - SILL - WIN_H) / STOREY) + 1);
        const width = u1 - u0;
        if (!rows || width < WIN_W + 0.6) return;
        const per = Math.max(1, Math.min(Math.floor((width - 0.6) / (WIN_W + GAP)), Math.round((s * area) / (rows * WIN_W * WIN_H))));
        const d = n.dot(pts[0]) + 0.04, step = width / per;
        for (let r = 0; r < rows; r++) for (let i = 0; i < per; i++) {
          const cu = u0 + step * (i + 0.5), by = y0 + r * STOREY + SILL;
          const at = (du: number, dy: number) => u.clone().multiplyScalar(cu + du).addScaledVector(n, d).setY(by + dy);
          const [p0, p1, p2, p3] = [at(-WIN_W / 2, 0), at(WIN_W / 2, 0), at(WIN_W / 2, WIN_H), at(-WIN_W / 2, WIN_H)];
          wins.push(p0, p1, p2, p0, p2, p3);
        }
      });
      if (wins.length) { const m = new THREE.Mesh(new THREE.BufferGeometry().setFromPoints(wins), this.mat(winC, 0.95)); m.renderOrder = 6; this.g.add(m); }
    }
    // Floor: the hull of the walls' foot, just above the ground, seen through the walls.
    if (floorC) {
      const foot = mine.filter((p) => p.y < this.host.box.min.y + 0.4).map((p) => new THREE.Vector2(p.x, p.z));
      const hull = convexHull(foot);
      if (hull.length >= 3) {
        const y = this.host.box.min.y + 0.06;
        const tris = THREE.ShapeUtils.triangulateShape(hull, []);
        const geoF = new THREE.BufferGeometry().setFromPoints(hull.map((p) => new THREE.Vector3(p.x, y, p.y)));
        geoF.setIndex(tris.flat());
        const m = new THREE.Mesh(geoF, this.mat(floorC, 0.9)); m.renderOrder = 3; this.g.add(m);
      }
    }
    this.apply();
  }

  private apply() {
    this.mats.forEach(({ m, k }) => { m.opacity = k < 0 ? 1 - this.f : this.f * k; m.visible = m.opacity > 0.005; });
    this.g.visible = this.f > 0.005;
  }

  frame(dt: number) {
    if (this.goal === 1 && !this.wallsDone) this.buildWalls();
    if (Math.abs(this.f - this.goal) < 0.002 && Math.abs(this.v) < 0.01) {
      if (this.f !== this.goal) { this.f = this.goal; this.v = 0; this.apply(); if (this.goal === 0) { this.clear(); this.env = null; } }
      return;
    }
    const a = -OMEGA * OMEGA * (this.f - this.goal) - 2 * OMEGA * this.v;
    this.v += a * dt; this.f = Math.max(0, Math.min(1, this.f + this.v * dt));
    this.apply();
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
