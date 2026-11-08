"use client";
// The Battery, Wallbox and Heat pump card bodies: headline figures from the engine's typical day (v2.18) and the day
// strip under them. A size from the ladder moves the figures at once from by_size (Num springs them, bounce 0); the
// strip follows when the day for that size lands. Scrubbing the hour drives the scene: the battery's fill, the car's
// charge, the x-ray's hour. The web computes no figure; only the car's charge so far is summed from the day's hours.
import { useEffect, useRef, useState, type ReactNode } from "react";
import Num from "@/components/offer/Num";
import DayStrip from "./DayStrip";
import { atSize, useDay, type Season, type Sizes } from "./day";
import { flowAt, sceneDay } from "./scene";

const n0 = (x: number) => Math.round(x).toLocaleString("en-GB");
const n1 = (x: number) => (Math.round(x * 10) / 10).toLocaleString("en-GB");
const pc = (x: number) => `${Math.round(x * 100)} %`;

type Props = { leadId: string; sizes: Sizes; version: string; fuel?: string | null };

function Figs({ items, loading }: { items: { v: string; u: ReactNode }[]; loading: boolean }) {
  return (
    <div className="dv-figs" aria-live="polite" aria-busy={loading}>
      {items.map((f, i) => loading
        ? <p key={i} className="dv-skelrow b-skel" aria-hidden="true"><b>00.0</b> {f.u}</p>
        : <p key={i}><b><Num v={f.v} lit /></b> {f.u}</p>)}
    </div>
  );
}
function Err({ error, retry }: { error: string; retry: () => void }) {
  return <p className="dv-err">{error}<button type="button" onClick={retry}>Try again</button></p>;
}

export function BatteryDay({ leadId, sizes, version }: Props) {
  const [season, setSeason] = useState<Season>("summer");
  const [hour, setHour] = useState(21);
  const [tries, setTries] = useState(0);
  const { data, error } = useDay(leadId, season, sizes, version, tries);
  const b = data?.battery ?? null;
  const at = atSize(b?.by_size, sizes.battery_kwh) ?? b;
  useEffect(() => { if (b?.soc?.[hour] != null) sceneDay("setBatteryFill", b.soc[hour]); if (data) sceneDay("setFlow", flowAt(data, hour)); }, [b, data, hour]);
  if (error && !data) return <Err error={error} retry={() => setTries((t) => t + 1)} />;
  return (
    <div className="dv">
      <Figs loading={!at} items={[
        { v: at ? n1(at.hours_after_sunset_covered) : "0", u: "h after sunset" },
        { v: at ? pc(at.self_sufficiency_share) : "0 %", u: "self-sufficiency" },
      ]} />
      <DayStrip label="A typical day" loading={!data} hour={hour} onHour={setHour} season={season} onSeason={setSeason}
        sunrise={data?.sunrise_h} sunset={data?.sunset_h}
        series={data ? [{ k: "Solar", v: data.solar_kwh, tone: "solar" }, { k: "Home", v: data.load_kwh, tone: "load" }] : []}
        band={b ? { k: "Battery", v: b.soc } : null}
        readout={data ? <><b>{n1(data.solar_kwh[hour])}</b> kWh solar, <b>{n1(data.load_kwh[hour])}</b> kWh home{b ? <>, battery <b>{pc(b.soc[hour])}</b></> : null}</> : null} />
      {error && <Err error={error} retry={() => setTries((t) => t + 1)} />}
    </div>
  );
}

export function WallboxDay({ leadId, sizes, version }: Props) {
  const [season, setSeason] = useState<Season>("summer");
  const [hour, setHour] = useState(18);
  const [tries, setTries] = useState(0);
  const { data, error } = useDay(leadId, season, sizes, version, tries);
  const w = data?.wallbox ?? null;
  // Until the planner scrubs, the strip opens on the hour the car charges most.
  const scrubbed = useRef(false);
  useEffect(() => {
    if (!w || scrubbed.current) return;
    const peak = w.charging_kwh.reduce((b, x, i, a) => (x > a[b] ? i : b), 0);
    if (w.charging_kwh[peak] > 0) setHour(peak);
  }, [w]);
  const at = atSize(w?.by_size, sizes.wallbox_kw) ?? w;
  useEffect(() => {
    if (!w) return;
    const all = w.charging_kwh.reduce((a, x) => a + x, 0);
    sceneDay("setCarCharge", all > 0 ? Math.min(1, w.charging_kwh.slice(0, hour + 1).reduce((a, x) => a + x, 0) / all) : 0);
    if (data) sceneDay("setFlow", flowAt(data, hour));
  }, [w, data, hour]);
  if (error && !data) return <Err error={error} retry={() => setTries((t) => t + 1)} />;
  const kw = sizes.wallbox_kw ?? w?.kw ?? null;
  // ENGINE may send the same car charged at midday; shown only when present, never worked out here.
  const sc = w?.solar_charging && Array.isArray(w.solar_charging.charging_kwh) ? w.solar_charging : null;
  return (
    <div className="dv">
      <Figs loading={!at || !w} items={[
        { v: w ? n0(w.ev_kwh_year) : "0", u: "kWh a year" },
        { v: at ? pc(at.solar_share_of_charging) : "0 %", u: "of charging from own solar" },
        ...(sc ? [{ v: pc(sc.solar_share_of_charging), u: "of charging on solar" }] : []),
        { v: at ? `${n1(at.full_charge_hours)} h` : "0 h", u: kw ? `full charge at ${n0(kw)} kW` : "full charge" },
      ]} />
      <DayStrip label="A typical day" loading={!data} hour={hour} onHour={(x) => { scrubbed.current = true; setHour(x); }} season={season} onSeason={setSeason}
        sunrise={data?.sunrise_h} sunset={data?.sunset_h}
        series={data ? [{ k: "Solar", v: data.solar_kwh, tone: "solar" }, { k: "Home", v: data.load_kwh, tone: "load" }, ...(w ? [{ k: "Car", v: w.charging_kwh, tone: "accent" as const }] : []), ...(sc ? [{ k: "Charged on solar", v: sc.charging_kwh, tone: "soft" as const }] : [])] : []}
        readout={data ? <><b>{n1(data.solar_kwh[hour])}</b> kWh solar{w ? <>, car <b>{n1(w.charging_kwh[hour])}</b> kWh</> : null}</> : null} />
      {error && <Err error={error} retry={() => setTries((t) => t + 1)} />}
    </div>
  );
}

export function HeatpumpDay({ leadId, sizes, version, fuel }: Props) {
  const [hour, setHour] = useState(7);
  const [tries, setTries] = useState(0);
  const { data, error } = useDay(leadId, "winter", sizes, version, tries);
  const h = data?.heatpump ?? null;
  const at = atSize(h?.by_size, sizes.heatpump_kw) ?? h;
  useEffect(() => { if (!h) return; sceneDay("setXrayHour", hour); if (h.outdoor_temp_c[hour] != null) sceneDay("setOutdoorTemp", h.outdoor_temp_c[hour]); }, [h, hour]);
  useEffect(() => () => sceneDay("setXrayHour", null), []);
  if (error && !data) return <Err error={error} retry={() => setTries((t) => t + 1)} />;
  const bill = fuel === "Gas" ? "gas" : fuel === "Oil" ? "oil" : "boiler";
  // Engine fields from the 11:45 restart, shown only when present: coverage and the bivalent point per size
  // (bivalent null when the unit never falls short), and the price of a kWh of heat including boiler losses.
  const num = (o: unknown, k: string) => { const v = (o as Record<string, unknown> | null)?.[k]; return typeof v === "number" && isFinite(v) ? v : null; };
  const cover = num(at, "heat_covered_share"), biv = num(at, "bivalent_temp_c"), ct = num(h, "heat_price_ct_kwh");
  return (
    <div className="dv">
      <Figs loading={!h} items={[{ v: `${n1(sizes.heatpump_kw ?? h?.kw ?? 0)} kW`, u: "design" }]} />
      {h && <p className="dv-note"><b>{n1(h.heat_load_kw)} kW</b> at most (building envelope)</p>}
      {cover != null && <p className="dv-note">Covers <b>{pc(cover)}</b> of the year&rsquo;s heat{biv != null ? <>, backup below <b>{n1(biv)} °C</b></> : null}</p>}
      <Figs loading={!h || !at} items={[
        { v: h ? n0(h.heating_kwh_year) : "0", u: "kWh heat a year" },
        { v: at ? n0(at.electricity_kwh_year) : "0", u: h ? `kWh power at COP ${n1(h.cop)}` : "kWh power" },
        { v: at ? `€${n0(at.cost_eur_year)}` : "€0", u: h ? <>a year, {bill} <b className="dv-was">€{n0(h.boiler_cost_eur_year)}</b>{ct != null ? `, heat at ${n1(ct)} ct` : ""}</> : "a year" },
      ]} />
      <DayStrip label="A winter day" loading={!data} hour={hour} onHour={setHour}
        sunrise={data?.sunrise_h} sunset={data?.sunset_h}
        series={h ? [{ k: "Heat", v: h.heat_demand_kwh, tone: "accent" }, { k: "Outside", v: h.outdoor_temp_c, tone: "line", axis: "right", unit: "°C" }] : []}
        readout={h ? <><b>{n1(h.heat_demand_kwh[hour])}</b> kWh heat, <b>{n1(h.outdoor_temp_c[hour])} °C</b> outside</> : null} />
      {error && <Err error={error} retry={() => setTries((t) => t + 1)} />}
    </div>
  );
}
