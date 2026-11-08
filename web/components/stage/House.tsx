// Isometric line drawing of the home. It draws only what the design includes; absent parts are dashed ghosts.
import type { Design } from "@/lib/api";
import { n2 } from "@/lib/stage";

type V = [number, number, number];
const S = 21, C = Math.cos(Math.PI / 6), OX = 250, OY = 120;
const P = ([x, y, z]: V): [number, number] => [OX + (x - y) * C * S, OY + (x + y) * 0.5 * S - z * S];
const pts = (a: V[]) => a.map((p) => P(p).map((v) => v.toFixed(1)).join(",")).join(" ");
const L = 10, D = 7, H = 4.6, R = 7.6, M = D / 2;
const at = (u: number, t: number): V => [u, D - (D - M) * t, H + (R - H) * t];

function Poly({ a, c }: { a: V[]; c: string }) { return <polygon className={c} points={pts(a)} />; }

function Tag({ p, dx, dy, text, off }: { p: V; dx: number; dy: number; text: string; off: boolean }) {
  const [x, y] = P(p);
  return (
    <g>
      <line className="h-lead" x1={x} y1={y} x2={x + dx} y2={y + dy} />
      <text className={off ? "h-tag off" : "h-tag"} x={x + dx + (dx < 0 ? -4 : 4)} y={y + dy + 4} textAnchor={dx < 0 ? "end" : "start"}>{text}</text>
    </g>
  );
}

export default function House({ design }: { design: Design }) {
  const { pv_kwp: pv, battery_kwh: bat, heatpump_kw: hp, wallbox_kw: wb } = design;
  const count = pv ? Math.min(32, Math.round(pv / 0.45)) : 0, cols = 8, rows = Math.max(3, Math.ceil(count / cols));
  const cw = (L - 1) / cols, rh = 0.88 / rows;
  const panels = Array.from({ length: count }, (_, k) => {
    const i = k % cols, j = Math.floor(k / cols), t0 = 0.08 + j * rh, t1 = t0 + rh * 0.92, u = 0.5 + i * cw;
    return <Poly key={k} c="h-panel" a={[at(u + 0.06, t0), at(u + cw - 0.06, t0), at(u + cw - 0.06, t1), at(u + 0.06, t1)]} />;
  });
  const x0 = L + 1.0;
  const hpFaces: V[][] = [
    [[x0, 5.4, 0], [x0 + 1.2, 5.4, 0], [x0 + 1.2, 5.4, 1.3], [x0, 5.4, 1.3]],
    [[x0, 4.4, 1.3], [x0 + 1.2, 4.4, 1.3], [x0 + 1.2, 5.4, 1.3], [x0, 5.4, 1.3]],
    [[x0 + 1.2, 4.4, 0], [x0 + 1.2, 5.4, 0], [x0 + 1.2, 5.4, 1.3], [x0 + 1.2, 4.4, 1.3]],
  ];
  const cx = 1.6, cy = D + 1.6, cl = 4.4, cwd = 1.9, ch = 1.1, k0 = cx + 1.1, k1 = cx + 3.2, y0 = cy + 0.2, y1 = cy + cwd - 0.2, z1 = ch + 0.75;
  const [a1, b1] = P([0.8, D, 1.0]), [a2, b2] = P([cx + 0.6, cy + cwd, 0.6]);
  const label = [pv ? `${n2(pv)} kWp of solar` : "", bat ? `${n2(bat)} kWh battery` : "", hp ? `${n2(hp)} kW heat pump` : "", wb ? `${n2(wb)} kW wallbox` : ""].filter(Boolean).join(", ") || "House";
  return (
    <svg className="house" viewBox="0 0 540 420" role="img" aria-label={`The home: ${label}`}>
      <Poly c="h-ground" a={[[-1.5, -1, 0], [L + 5.5, -1, 0], [L + 5.5, D + 5, 0], [-1.5, D + 5, 0]]} />
      <Poly c="h-wall" a={[[0, D, 0], [L, D, 0], [L, D, H], [0, D, H]]} />
      <Poly c="h-wall side" a={[[L, 0, 0], [L, D, 0], [L, D, H], [L, M, R], [L, 0, H]]} />
      <Poly c="h-roof back" a={[[0, M, R], [L, M, R], [L, 0, H], [0, 0, H]]} />
      <Poly c="h-roof" a={[[0, M, R], [L, M, R], [L, D, H], [0, D, H]]} />
      {[1.4, 4.0, 7.6].map((x) => <Poly key={x} c="h-win" a={[[x, D, 1.9], [x + 1.3, D, 1.9], [x + 1.3, D, 3.5], [x, D, 3.5]]} />)}
      <Poly c="h-win" a={[[5.8, D, 0], [6.9, D, 0], [6.9, D, 2.6], [5.8, D, 2.6]]} />
      <Poly c="h-win" a={[[L, 2.2, 1.9], [L, 3.4, 1.9], [L, 3.4, 3.5], [L, 2.2, 3.5]]} />
      <g className="h-part" key={`pv${count}`}>{panels}</g>
      <g className="h-part" key={`b${bat}`}><Poly c={bat ? "h-box" : "h-ghost"} a={[[L, 4.6, 0.2], [L, 5.8, 0.2], [L, 5.8, 2.0], [L, 4.6, 2.0]]} /></g>
      <g className="h-part" key={`h${hp}`}>{hpFaces.map((f, i) => <Poly key={i} c={hp ? "h-box" : "h-ghost"} a={f} />)}</g>
      <g className="h-part" key={`w${wb}`}>
        <Poly c={wb ? "h-box" : "h-ghost"} a={[[0.5, D, 1.0], [1.1, D, 1.0], [1.1, D, 2.0], [0.5, D, 2.0]]} />
        {wb != null && <>
          <Poly c="h-car" a={[[cx, cy + cwd, 0.25], [cx + cl, cy + cwd, 0.25], [cx + cl, cy + cwd, ch], [cx, cy + cwd, ch]]} />
          <Poly c="h-car" a={[[cx + cl, cy, 0.25], [cx + cl, cy + cwd, 0.25], [cx + cl, cy + cwd, ch], [cx + cl, cy, ch]]} />
          <Poly c="h-car top" a={[[cx, cy, ch], [cx + cl, cy, ch], [cx + cl, cy + cwd, ch], [cx, cy + cwd, ch]]} />
          <Poly c="h-car" a={[[k0, y1, ch], [k1, y1, ch], [k1 - 0.3, y1, z1], [k0 + 0.4, y1, z1]]} />
          <Poly c="h-car" a={[[k1, y0, ch], [k1, y1, ch], [k1 - 0.3, y1, z1], [k1 - 0.3, y0, z1]]} />
          <Poly c="h-car top" a={[[k0 + 0.4, y0, z1], [k1 - 0.3, y0, z1], [k1 - 0.3, y1, z1], [k0 + 0.4, y1, z1]]} />
          <path className="h-cable" d={`M${a1},${b1} C${a1},${b1 + 30} ${a2 + 10},${b2 + 4} ${a2},${b2}`} />
        </>}
      </g>
      {!!pv && <Tag p={[L / 2 + 2, D - 1.2, H + 1.6]} dx={120} dy={-96} text={`${n2(pv)} kWp`} off={false} />}
      {!!bat && <Tag p={[L, 5.2, 1.1]} dx={92} dy={-6} text={`${n2(bat)} kWh`} off={false} />}
      {!!hp && <Tag p={[L + 1.6, 4.9, 1.3]} dx={70} dy={26} text={`${n2(hp)} kW`} off={false} />}
      {!!wb && <Tag p={[0.8, D, 2.0]} dx={-30} dy={-40} text={`${n2(wb)} kW`} off={false} />}
    </svg>
  );
}
