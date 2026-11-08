// The installed kit in Reonic's offer grammar: rounded boxes in component colours joined by gradient pipes.
// Sizes come in as props, so the planner card, the proposal and the signature page draw the same picture.
// Only installed components appear; nothing is greyed or hidden.
import { useId } from "react";
import { COLOUR, n1, n2, type Part } from "./format";
import Glyph from "./Glyph";
import s from "./offer.module.css";

export type Kit = {
  modules?: number | null; pv_kwp: number | null; inverter_kw: number | null;
  battery_kwh: number | null; wallbox_kw: number | null; heatpump_kw: number | null;
};

const W = 360, BW = 106, BH = 48;
const X = { left: 2, mid: 127, right: 252 };

export default function KitDiagram({ kit, changed, flash = 0, className }: { kit: Kit; changed?: Part[]; flash?: number; className?: string }) {
  const id = useId().replace(/:/g, "");
  const pv = !!kit.pv_kwp, bat = !!kit.battery_kwh, wb = !!kit.wallbox_kw, hp = !!kit.heatpump_kw;
  const inv = pv || bat;   // the inverter is drawn whenever there is DC to convert
  const loads: { k: Part; label: string; value: string }[] = [
    ...(wb ? [{ k: "wallbox" as Part, label: "Wallbox", value: `${n1(kit.wallbox_kw!)} kW` }] : []),
    ...(hp ? [{ k: "heatpump" as Part, label: "Heat pump", value: `${n1(kit.heatpump_kw!)} kW` }] : []),
  ];
  const rowY = { top: 4, mid: pv ? 88 : 4, low: (pv ? 88 : 4) + BH + 36 };
  const H = (loads.length ? rowY.low + BH : rowY.mid + BH) + 4;
  const hub = inv ? { x: X.mid, y: rowY.mid } : { x: X.right, y: rowY.mid };   // the loads hang off the inverter, else the meter
  const loadX = loads.length === 2 ? [X.mid - 63, X.mid + 63] : [X.mid];   // two loads straddle the inverter
  const hot = new Set(changed ?? []);

  const pipes: { d: string; from: Part; to: Part; x1: number; y1: number; x2: number; y2: number }[] = [];
  const cx = (x: number) => x + BW / 2;
  if (pv && inv) pipes.push({ d: `M${cx(X.mid)},${rowY.top + BH} V${rowY.mid}`, from: "pv", to: "inverter", x1: 0, y1: rowY.top + BH, x2: 0, y2: rowY.mid });
  if (bat && inv) pipes.push({ d: `M${X.left + BW},${rowY.mid + BH / 2} H${X.mid}`, from: "battery", to: "inverter", x1: X.left + BW, y1: 0, x2: X.mid, y2: 0 });
  if (inv) pipes.push({ d: `M${X.mid + BW},${rowY.mid + BH / 2} H${X.right}`, from: "inverter", to: "grid", x1: X.mid + BW, y1: 0, x2: X.right, y2: 0 });
  loads.forEach((l, i) => {
    const sx = cx(hub.x) + (loads.length === 2 ? (i ? 14 : -14) : 0), sy = hub.y + BH, ex = cx(loadX[i]), ey = rowY.low, my = (sy + ey) / 2;
    pipes.push({ d: `M${sx},${sy} C${sx},${my} ${ex},${my} ${ex},${ey}`, from: inv ? "inverter" : "grid", to: l.k, x1: 0, y1: sy, x2: 0, y2: ey });
  });

  const box = (k: Part, x: number, y: number, label: string, value?: string) => (
    <g key={k} className={hot.has(k) ? s.kHot : undefined}>
      {hot.has(k) && <rect key={`r${flash}`} className={s.kRing} x={x - 3} y={y - 3} width={BW + 6} height={BH + 6} rx="13" fill="none" stroke={COLOUR[k]} strokeWidth="2" />}
      <rect x={x} y={y} width={BW} height={BH} rx="10" fill="#fff" stroke={COLOUR[k]} strokeWidth="1.5" />
      <rect x={x + 7} y={y + 13} width="22" height="22" rx="6" fill={COLOUR[k]} />
      <g transform={`translate(${x + 10},${y + 16})`}><Glyph k={k} size={16} colour={k === "pv" ? "#071b71" : "#fff"} /></g>
      {value ? (
        <>
          <text x={x + 35} y={y + 20} className={s.kLabel}>{label}</text>
          <text x={x + 35} y={y + 36} className={s.kValue}>{value}</text>
        </>
      ) : <text x={x + 35} y={y + 28} className={s.kSolo}>{label}</text>}
    </g>
  );

  const words = [
    pv && `${kit.modules ? `${kit.modules} modules, ` : ""}${n2(kit.pv_kwp!)} kWp`, inv && kit.inverter_kw && `${n1(kit.inverter_kw)} kW inverter`,
    bat && `${n1(kit.battery_kwh!)} kWh battery`, ...loads.map((l) => `${l.value} ${l.label.toLowerCase()}`), "grid meter",
  ].filter(Boolean).join(", ");

  return (
    <svg className={`${s.kit} ${className ?? ""}`} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Kit: ${words}`}>
      <defs>
        {pipes.map((p, i) => (
          <linearGradient key={i} id={`${id}p${i}`} gradientUnits="userSpaceOnUse" x1={p.x1 || 0} y1={p.y1 || 0} x2={p.x2 || (p.x1 ? p.x2 : 0)} y2={p.y2 || 0}>
            <stop offset="0" stopColor={COLOUR[p.from]} /><stop offset="1" stopColor={COLOUR[p.to]} />
          </linearGradient>
        ))}
      </defs>
      {pipes.map((p, i) => <path key={i} d={p.d} fill="none" stroke={`url(#${id}p${i})`} strokeWidth="6" strokeLinecap="round" />)}
      {pv && box("pv", X.mid, rowY.top, kit.modules ? `${kit.modules} modules` : "Modules", `${n2(kit.pv_kwp!)} kWp`)}
      {bat && box("battery", X.left, rowY.mid, "Battery", `${n1(kit.battery_kwh!)} kWh`)}
      {inv && box("inverter", X.mid, rowY.mid, "Inverter", kit.inverter_kw ? `${n1(kit.inverter_kw)} kW` : undefined)}
      {box("grid", X.right, rowY.mid, "Grid meter")}
      {loads.map((l, i) => box(l.k, loadX[i], rowY.low, l.label, l.value))}
    </svg>
  );
}
