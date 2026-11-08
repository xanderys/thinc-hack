// Usage: <KitSheet kit={design} total={economics.capex_eur} /> on any surface (planner Offer panel, homeowner pages).
//   kit: the design's sizes (pv_kwp, inverter_kw, battery_kwh, wallbox_kw, heatpump_kw), plus modules when the roof layout knows the count.
//   total: capex in euros, shown once as an estimate; omit it (or null) and the total line is left out.
//   edit (planner only): (field, label) => node, wraps a row's label in a control such as InlineOverride; omit for read-only.
//   changed + flash (optional): parts that just changed ring once; bump flash to ring again.
//   A size of null or 0 means the component is not in the design and gets no row.
// One parts list in the German Angebot order, drawn like a building-instruction sheet: quantity, part, the one spec.
import type { ReactNode } from "react";
import { eur, n1, type Part } from "./format";
import s from "./kitSheet.module.css";

export type KitSheetKit = {
  modules?: number | null; pv_kwp: number | null; inverter_kw: number | null;
  battery_kwh: number | null; wallbox_kw: number | null; heatpump_kw: number | null;
};
export type KitField = "pv_kwp" | "inverter_kw" | "battery_kwh" | "wallbox_kw" | "heatpump_kw";

const MODULE_KWP = 0.45;   // the engine's standard module when the layout gives no count

type Row = { key: string; field?: KitField; part?: Part; qty: number; label: string; icon: ReactNode };

export default function KitSheet({ kit, total, edit, changed, flash = 0, className }: {
  kit: KitSheetKit; total?: number | null; edit?: (f: KitField, label: string) => ReactNode;
  changed?: Part[]; flash?: number; className?: string;
}) {
  const rows: Row[] = [];
  if (kit.pv_kwp) {
    const count = kit.modules && kit.modules > 0 ? kit.modules : Math.max(1, Math.round(kit.pv_kwp / MODULE_KWP));
    const wp = Math.round((kit.pv_kwp * 1000) / count / 5) * 5;
    rows.push({ key: "pv", field: "pv_kwp", part: "pv", qty: count, label: `Solar module ${wp} Wp`, icon: <Modules n={count} /> });
  }
  if (kit.inverter_kw) rows.push({ key: "inv", field: "inverter_kw", part: "inverter", qty: 1, label: `${kit.battery_kwh ? "Hybrid inverter" : "Inverter"} ${n1(kit.inverter_kw)} kW`, icon: <Inverter /> });
  if (kit.battery_kwh) rows.push({ key: "bat", field: "battery_kwh", part: "battery", qty: 1, label: `Battery storage ${n1(kit.battery_kwh)} kWh`, icon: <Battery kwh={kit.battery_kwh} /> });
  if (kit.wallbox_kw) rows.push({ key: "wb", field: "wallbox_kw", part: "wallbox", qty: 1, label: `Wallbox ${n1(kit.wallbox_kw)} kW`, icon: <Wallbox /> });
  if (kit.heatpump_kw) rows.push({ key: "hp", field: "heatpump_kw", part: "heatpump", qty: 1, label: `Heat pump ${n1(kit.heatpump_kw)} kW`, icon: <HeatPump /> });
  if (rows.length) rows.push({ key: "inst", qty: 1, label: "Installation and services", icon: <Cabinet /> });
  const hot = new Set(changed ?? []);

  return (
    <div className={`${s.sheet} ${className ?? ""}`}>
      <ol className={s.rows} aria-label="Parts list">
        {rows.map((r) => (
          <li key={r.key} className={s.row} data-hot={r.part && hot.has(r.part) ? "" : undefined}>
            {r.part && hot.has(r.part) && <span key={flash} className={s.ring} aria-hidden="true" />}
            <span className={s.qty}>{r.qty}×</span>
            <span className={s.icon} aria-hidden="true">{r.icon}</span>
            <span className={s.label}>{r.field && edit ? edit(r.field, r.label) : r.label}</span>
          </li>
        ))}
      </ol>
      {total != null && rows.length > 0 && (
        <p className={s.total}><span>Total</span><b>{eur(total)}</b><em>estimate</em></p>
      )}
    </div>
  );
}

// Icons: front views with one side face, traced from the scene's own pieces (flat module rects, the 0.9 by 1.5 m
// battery box, the wall-mounted wallbox box). Ink lines, paper faces, the accent on the part that names it.
const Svg = ({ children }: { children: ReactNode }) => (
  <svg viewBox="0 0 40 40" width="100%" height="100%" fill="none" stroke="var(--ink)" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round">{children}</svg>
);
const A = "var(--accent)", T = "color-mix(in srgb, var(--accent) 16%, #fff)", W = "#fff";

// A stack of modules: one more layer per band of eight, up to five.
function Modules({ n }: { n: number }) {
  const layers = n <= 8 ? 1 : n <= 16 ? 2 : n <= 24 ? 3 : n <= 32 ? 4 : 5;
  const h = 14 + 4 * (layers - 1), y0 = (40 - h) / 2 + 4 * (layers - 1);
  const top = (y: number) => `M3,${y + 6} L21,${y} L37,${y + 6} L19,${y + 12} Z`;
  const out: ReactNode[] = [];
  for (let i = 0; i < layers; i++) {
    const y = y0 - 4 * i, last = i === layers - 1;
    out.push(<g key={i}>
      <path d={`M3,${y + 6} L19,${y + 12} L37,${y + 6} L37,${y + 8} L19,${y + 14} L3,${y + 8} Z`} fill={W} />
      <path d={top(y)} fill={last ? A : W} />
      {last && <path d={`M9,${y + 4} L25,${y + 10} M15,${y + 2} L31,${y + 8} M12,${y + 9} L29,${y + 3}`} stroke={W} strokeWidth="1" />}
    </g>);
  }
  return <Svg>{out}</Svg>;
}

function Inverter() {
  return <Svg>
    <path d="M28,8 L32,6 L32,30 L28,32 Z" fill={T} />
    <rect x="10" y="8" width="18" height="24" rx="1.5" fill={W} />
    <rect x="14" y="12" width="10" height="6" rx="1" fill={A} stroke="none" />
    <path d="M14 22.5c1.2-2 2.4-2 3.6 0s2.4 2 3.6 0s2.4-2 3.6 0" />
    <path d="M15 32v3M23 32v3" />
  </Svg>;
}

// The battery tower: one module per 3 kWh, two to six, under a cap.
function Battery({ kwh }: { kwh: number }) {
  const n = Math.min(6, Math.max(1, Math.ceil(kwh / 3))), m = 4.5, h = n * m + 3;
  const top = 36 - h;
  return <Svg>
    <path d={`M26,${top} L30,${top - 2.5} L30,${36 - 2.5} L26,36 Z`} fill={T} />
    <path d={`M14,${top} L18,${top - 2.5} L30,${top - 2.5} L26,${top} Z`} fill={W} />
    <rect x="14" y={top} width="12" height="3" fill={A} />
    {Array.from({ length: n }, (_, i) => <rect key={i} x="14" y={top + 3 + i * m} width="12" height={m} fill={W} />)}
    {Array.from({ length: n }, (_, i) => <path key={`l${i}`} d={`M17,${top + 3 + i * m + m / 2}h3`} stroke={A} />)}
  </Svg>;
}

function Wallbox() {
  return <Svg>
    <path d="M25,6 L28,4.5 L28,24.5 L25,26 Z" fill={T} />
    <rect x="12" y="6" width="13" height="20" rx="2" fill={W} />
    <circle cx="18.5" cy="13" r="3" fill={A} stroke="none" />
    <path d="M18.5 26v3c0 4 4 6 8 5.5s5-3 5-6" />
    <rect x="29" y="25" width="5" height="4" rx="1" fill={W} />
  </Svg>;
}

function HeatPump() {
  return <Svg>
    <path d="M33,11 L37,9 L37,29 L33,31 Z" fill={T} />
    <path d="M3,11 L7,9 L37,9 L33,11 Z" fill={W} />
    <rect x="3" y="11" width="30" height="20" rx="1.5" fill={W} />
    <circle cx="14" cy="21" r="7" fill={T} />
    <path d="M14 21l0-5.5M14 21l4.8 2.7M14 21l-4.8 2.7" stroke={A} strokeWidth="1.6" />
    <path d="M25 15h5M25 18.5h5M25 22h5M25 25.5h5" />
    <path d="M7 31v3M29 31v3" />
  </Svg>;
}

// The meter cabinet stands for mounting, cabling and the grid connection.
function Cabinet() {
  return <Svg>
    <path d="M28,5 L31,3.5 L31,34.5 L28,36 Z" fill={T} />
    <rect x="11" y="5" width="17" height="31" rx="1" fill={W} />
    <path d="M11 20.5h17" />
    <rect x="14.5" y="9" width="10" height="7" rx="1" fill={A} stroke="none" />
    <path d="M14.5 25h10M14.5 28.5h10M14.5 32h10" />
  </Svg>;
}
