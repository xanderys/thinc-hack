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

// Icons: the scene's own parts (components/spatial/kitMeshes.ts) rendered at build time into public/kit by
// scripts/render-kit-icons.mjs: one three-quarter camera, the scene's lights, 72 px for 36 px at 2x. Static files,
// so the list needs no WebGL context of its own (Safari caps them) and the homeowner page loads no three.js.
const Img = ({ name }: { name: string }) => <img src={`/kit/${name}.png`} width={36} height={36} alt="" draggable={false} />;
// A stack of modules: one more layer per band of eight, up to five.
const Modules = ({ n }: { n: number }) => <Img name={`modules-${n <= 8 ? 1 : n <= 16 ? 2 : n <= 24 ? 3 : n <= 32 ? 4 : 5}`} />;
// The battery tower: one module per 3 kWh, one to six, under a cap.
const Battery = ({ kwh }: { kwh: number }) => <Img name={`battery-${Math.min(6, Math.max(1, Math.ceil(kwh / 3)))}`} />;
const Inverter = () => <Img name="inverter" />;
const Wallbox = () => <Img name="wallbox" />;
const HeatPump = () => <Img name="heatpump" />;
// The meter cabinet stands for mounting, cabling and the grid connection.
const Cabinet = () => <Img name="cabinet" />;
