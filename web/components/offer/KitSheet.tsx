// Usage: <KitSheet kit={design} total={economics.capex_eur} /> on any surface (planner Offer panel, homeowner pages).
//   kit: the design's sizes (pv_kwp, inverter_kw, battery_kwh, wallbox_kw, heatpump_kw), plus modules when the roof layout knows the count.
//   total: capex in euros, shown once as an estimate; assumptions: the engine's economics.assumptions, for the rate card "i" on it; omit it (or null) and the total line is left out. note: one small line under it.
//   edit (planner only): (field, label, content) => node, wraps a row's name and spec in a control such as InlineOverride; omit for read-only.
//   skus (optional): the engine's products per part (skusOf(response)); rows and the rate card name them.
//   info (optional): per field, an "i" popover at the row's end (planner: DC/AC ratio on the inverter).
//   changed + flash (optional): parts that just changed ring once; bump flash to ring again.
//   A size of null or 0 means the component is not in the design and gets no row.
// One parts list in the German Angebot order, drawn like a building-instruction sheet: quantity, part, the one spec.
import type { ReactNode } from "react";
import { eur, n1, type Part } from "./format";
import Num from "./Num";
import { invoiceOf, skuShort, type Rates, type RowKey2, type Sku, type SkuPart } from "./facts";
import RateCard from "./RateCard";
import s from "./kitSheet.module.css";
import { batteryModules, moduleLayers } from "@/components/spatial/kitBands";

export type KitSheetKit = {
  modules?: number | null; pv_kwp: number | null; inverter_kw: number | null;
  battery_kwh: number | null; wallbox_kw: number | null; heatpump_kw: number | null;
};
export type KitField = "pv_kwp" | "inverter_kw" | "battery_kwh" | "wallbox_kw" | "heatpump_kw";

const MODULE_KWP = 0.45;   // the engine's standard module when the layout gives no count

type Row = { key: string; field?: KitField; part?: Part; qty: number; name: string; spec?: string; icon: ReactNode };

export default function KitSheet({ kit, total, assumptions, rates, skus, note, edit, info, changed, flash = 0, className }: {
  kit: KitSheetKit; total?: number | null; assumptions?: string[] | null; rates?: Rates | null; skus?: Partial<Record<SkuPart, Sku>>; note?: string; info?: Partial<Record<KitField, ReactNode>>; edit?: (f: KitField, label: string, content: ReactNode) => ReactNode;
  changed?: Part[]; flash?: number; className?: string;
}) {
  if (!kit) return null;   // the design is not in yet
  const rows: Row[] = [];
  let moduleFits = false;   // the engine's module is the one that makes this kWp (else the row keeps a generic name)
  if (kit.pv_kwp) {
    // The count and watts that actually make the kWp. The engine's module where it fits (23 x 463 W = 10.65 kWp); a
    // stored count whose product does not fit (an approval made with the older 450 W module) keeps its count and the
    // watts its kWp implies, under a generic name; else the standard module. Never today's module for a design it did not make.
    const W = kit.pv_kwp * 1000, m = skus?.module;
    const unitW = m?.size && (m.unit ?? "W").toUpperCase().startsWith("W") ? m.size : null;
    const fits = (n: number, w: number) => n > 0 && Math.abs(n * w - W) <= 0.02 * W;
    let count: number, wp: number;
    if (kit.modules && kit.modules > 0) { count = kit.modules; wp = unitW && fits(count, unitW) ? unitW : Math.round(W / count); }
    else if (unitW && m?.modules && fits(m.modules, unitW)) { count = m.modules; wp = unitW; }
    else if (unitW && fits(Math.round(W / unitW), unitW)) { count = Math.round(W / unitW); wp = unitW; }
    else if (m?.modules) { count = m.modules; wp = Math.round(W / count); }
    else { count = Math.max(1, Math.round(W / (MODULE_KWP * 1000))); wp = Math.round(W / count / 5) * 5; }
    moduleFits = !!unitW && wp === unitW;
    rows.push({ key: "pv", field: "pv_kwp", part: "pv", qty: count, name: "Solar module", spec: `${wp} Wp`, icon: <Modules n={count} /> });
  }
  if (kit.inverter_kw) rows.push({ key: "inv", field: "inverter_kw", part: "inverter", qty: 1, name: kit.battery_kwh ? "Hybrid inverter" : "Inverter", spec: `${n1(kit.inverter_kw)} kW`, icon: <Inverter /> });
  if (kit.battery_kwh) rows.push({ key: "bat", field: "battery_kwh", part: "battery", qty: 1, name: "Battery storage", spec: `${n1(kit.battery_kwh)} kWh`, icon: <Battery kwh={kit.battery_kwh} /> });
  if (kit.wallbox_kw) rows.push({ key: "wb", field: "wallbox_kw", part: "wallbox", qty: 1, name: "Wallbox", spec: `${n1(kit.wallbox_kw)} kW`, icon: <Wallbox /> });
  if (kit.heatpump_kw) rows.push({ key: "hp", field: "heatpump_kw", part: "heatpump", qty: 1, name: "Heat pump", spec: `${n1(kit.heatpump_kw)} kW`, icon: <HeatPump /> });
  // The product name from the data where the engine sends one (engine v2.15), else the generic part name.
  const SKU_OF: Record<string, SkuPart> = { pv: "module", inv: "inverter", bat: "battery", wb: "wallbox", hp: "heatpump" };
  for (const r of rows) { const k = SKU_OF[r.key], s = k && skus?.[k]; if (s && (k !== "module" || moduleFits)) r.name = skuShort(s, k); }
  if (rows.length) rows.push({ key: "inst", qty: 1, name: "Installation and services", icon: <Cabinet /> });
  // Each row's price and the total as their exact sum (no rounding line); the rate card shows the arithmetic.
  const pvRow = rows.find((r) => r.key === "pv");
  const inv = invoiceOf(kit, rates, assumptions, total, pvRow?.qty, { pv: moduleFits ? skus?.module?.name : undefined, bat: skus?.battery?.name });
  const sum = inv ? inv.total : total;
  const hot = new Set(changed ?? []);

  return (
    <div className={`${s.sheet} ${className ?? ""}`}>
      <ol className={s.rows} aria-label="Parts list">
        {rows.map((r) => (
          <li key={r.key} className={s.row} data-hot={r.part && hot.has(r.part) ? "" : undefined}>
            {r.part && hot.has(r.part) && <span key={flash} className={s.ring} aria-hidden="true" />}
            <span className={s.qty}><Num v={`${r.qty}×`} lit /></span>
            <span className={s.icon} aria-hidden="true">{r.icon}</span>
            <span className={s.label}>{(() => {
              const content = <><b className={s.name}>{r.name}</b>{r.spec && <> <span className={s.spec}><Num v={r.spec} lit /></span></>}</>;
              return r.field && edit ? edit(r.field, r.spec ? `${r.name} ${r.spec}` : r.name, content) : content;
            })()}</span>
            {r.field && info?.[r.field] && <span className={s.rowInfo}>{info[r.field]}</span>}
            {inv && <span className={s.price}>{(() => { const v = inv.price[r.key as RowKey2]; return v == null ? "" : v === "included" ? "included" : <Num v={eur(v)} />; })()}</span>}
          </li>
        ))}
      </ol>
      {total != null && rows.length > 0 && (
        <p className={s.total}><span>Total</span><b><Num v={eur(sum ?? total)} /></b><em>estimate</em>{inv && <RateCard calc={inv.calc} />}</p>
      )}
      {note && total != null && rows.length > 0 && <p className={s.note}>{note}</p>}
    </div>
  );
}

// Icons: the scene's own parts (components/spatial/kitMeshes.ts) rendered at build time into public/kit by
// scripts/render-kit-icons.mjs: one three-quarter camera, the scene's lights, 72 px for 36 px at 2x. Static files,
// so the list needs no WebGL context of its own (Safari caps them) and the homeowner page loads no three.js.
const Img = ({ name }: { name: string }) => <img src={`/kit/${name}.png`} width={36} height={36} alt="" draggable={false} />;
// A stack of modules: one more layer per band of eight, up to five.
const Modules = ({ n }: { n: number }) => <Img name={`modules-${moduleLayers(n)}`} />;
// The battery tower: one module per 3 kWh, one to six, under a cap.
const Battery = ({ kwh }: { kwh: number }) => <Img name={`battery-${batteryModules(kwh)}`} />; // the same tower as on the house
const Inverter = () => <Img name="inverter" />;
const Wallbox = () => <Img name="wallbox" />;
const HeatPump = () => <Img name="heatpump" />;
// The meter cabinet stands for mounting, cabling and the grid connection.
const Cabinet = () => <Img name="cabinet" />;
