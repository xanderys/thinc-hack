"use client";
// The homeowner's read-only Systems card inside the canvas: the planner's SystemCard and Figures, fed from the same layers
// response (bars, car) and the offered economics. Figures and bars only; the one sentence per system waits behind the "i".
import type { ReactNode } from "react";
import SystemCard from "@/components/systems/SystemCard";
import { Chainline, Fig, Head, PairBars, SplitBar } from "@/components/systems/Figures";
import type { SystemName } from "@/components/systems/system";
import { scrub } from "@/components/offer/facts";
import type { Bar, Layers } from "@/components/spatial/types";
import type { Design, DesignResponse } from "@/lib/api";

const n0 = (x: number) => Math.round(x).toLocaleString("en-GB");
const n1 = (x: number) => (Math.round(x * 10) / 10).toLocaleString("en-GB");
const n2 = (x: number) => (Math.round(x * 100) / 100).toLocaleString("en-GB");

type Props = { sys: SystemName; design: Design; economics: DesignResponse["economics"]; layers: Layers | null; demandKwh?: number | null; pending: boolean; note?: ReactNode };

export default function HomeSystems({ sys, design: d0, economics: e, layers, demandKwh, pending, note }: Props) {
  const d = d0 ?? ({} as NonNullable<Props["design"]>);   // a frame before the design is in draws empty figures
  const bar = (k: Bar["key"]) => layers?.bars?.find((b) => b.key === k);
  const seg = (b: Bar | undefined, re: RegExp) => b?.segments.find((g) => re.test(g.name))?.value;
  const line = (b: Bar | undefined) => { const t = scrub(b?.sentence); return t ? <p>{t.endsWith(".") ? t : `${t}.`}</p> : null; };
  let head: ReactNode, label: string, body: ReactNode = null, info: ReactNode = null;

  if (sys === "panels") {
    const kwp = d.pv_kwp ?? 0, yieldKwh = e.annual?.pv_yield_kwh ?? seg(bar("roof"), /./) ?? null;
    const use = demandKwh ?? e.annual?.load_kwh ?? null;
    head = kwp ? <Head main={`${n2(kwp)} kWp`} /> : <Head main="No solar" />; label = `${n2(kwp)} kWp`;
    body = yieldKwh && use ? <PairBars roof={yieldKwh} share={e.autarky_share ?? null} parts={[{ k: "Household", v: use }, ...(layers?.ev ? [{ k: "Car", v: layers.ev.annual_kwh }] : [])]} /> : null;
    info = line(bar("roof"));
  } else if (sys === "battery") {
    const day = bar("day"), roof = seg(day, /solar|roof/i), fromB = seg(day, /from the battery/i) ?? seg(day, /^battery$/i), grid = seg(day, /grid/i), kwh = d.battery_kwh;
    head = kwh ? <Head main={`${n1(kwh)} kWh`} sub={d.pv_kwp ? `${n2(kwh / d.pv_kwp)} kWh per kWp` : null} /> : <Head main="No battery" />;
    label = kwh ? `${n1(kwh)} kWh battery` : "No battery";
    body = day && roof != null ? <SplitBar label="A spring weekday" unit="kWh" parts={[{ k: "Roof", v: roof }, { k: "Battery", v: fromB ?? 0 }, { k: "Grid", v: grid ?? 0 }]} /> : null;
    info = line(day);
  } else if (sys === "wallbox") {
    const ch = bar("charging"), segOf = (re: RegExp) => ch?.segments.find((g) => re.test(g.name));
    const km = segOf(/^km\b|^driving/i)?.value ?? layers?.ev?.annual_km, kwh = segOf(/^energy\b/i)?.value ?? layers?.ev?.annual_kwh;
    const night = segOf(/typical night/i)?.value ?? layers?.ev?.kwh_per_night_typical, wb = d.wallbox_kw;
    head = wb ? <Head main={`${n1(wb)} kW`} sub="wallbox" /> : <Head main="No wallbox" />; label = wb ? `${n1(wb)} kW wallbox` : "No wallbox";
    body = wb && km && kwh ? <Chainline steps={[{ v: n0(km), u: "km a year" }, { v: n0(kwh), u: "kWh a year" }, ...(night ? [{ v: n1(night), u: "kWh a night" }] : [])]} /> : null;
    info = line(ch);
  } else {
    const hl = bar("heat_loss"), hp = d.heatpump_kw;
    head = hp ? <Head main={`${n1(hp)} kW`} sub="heat pump" /> : <Head main="No heat pump" />; label = hp ? `${n1(hp)} kW heat pump` : "No heat pump";
    body = hl ? <Fig v={`${n1(hl.total)} kW`} u="heat loss" /> : null;
    info = line(hl);
  }
  return <SystemCard sys={sys} head={head} label={label} info={<>{info}{sys === "panels" ? note : null}</>} pending={pending}>{body}</SystemCard>;
}
