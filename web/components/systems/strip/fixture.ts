// A stand-in typical day in the brief's v2.18 shape, for UI checks before the engine serves it (?mockday=1, never on
// production). A small hourly simulation so the battery's fill and the figures move with size like the real thing.
type Season = "summer" | "winter";
const H = Array.from({ length: 24 }, (_, h) => h);
const r2 = (x: number) => Math.round(x * 100) / 100;

function solarAt(h: number, s: Season, kwp: number) {
  const [rise, set, peak] = s === "summer" ? [5.3, 21.2, 0.68] : [7.9, 16.4, 0.18];
  const t = h + 0.5;
  return t <= rise || t >= set ? 0 : kwp * peak * Math.sin((Math.PI * (t - rise)) / (set - rise)) ** 1.6;
}
function loadAt(h: number) {
  return 0.28 + (h >= 6 && h <= 8 ? 0.45 : 0) + (h >= 11 && h <= 13 ? 0.25 : 0) + (h >= 17 && h <= 21 ? 0.7 : 0) + (h === 22 ? 0.3 : 0);
}
function simBattery(solar: number[], load: number[], kwh: number, sunset: number) {
  let e = kwh * 0.15;
  const soc: number[] = [], ch: number[] = [], dis: number[] = [];
  let fromGrid = 0, total = 0, covered = 0, gap = false;
  H.forEach((h) => {
    const net = solar[h] - load[h];
    let c = 0, d = 0;
    if (net > 0) c = Math.min(net * 0.95, kwh * 0.9 - e, kwh * 0.5);
    else d = Math.min(-net, e - kwh * 0.05, kwh * 0.5);
    e += c - d;
    soc.push(r2(e / kwh)); ch.push(r2(c)); dis.push(r2(d));
    total += load[h]; fromGrid += Math.max(0, load[h] - solar[h] - d);
    if (h + 0.5 > sunset && !gap) { if (d >= load[h] - solar[h] - 0.01) covered += 1; else gap = true; }
  });
  return { soc, charge_kwh: ch, discharge_kwh: dis, hours_after_sunset_covered: covered, self_sufficiency_share: r2(1 - fromGrid / total) };
}

export function mockDay(s: Season, sizes: { battery_kwh?: number; wallbox_kw?: number; heatpump_kw?: number }) {
  const kwp = 10.65, [sunrise_h, sunset_h] = s === "summer" ? [5.3, 21.2] : [7.9, 16.4];
  const solar = H.map((h) => r2(solarAt(h, s, kwp))), load = H.map((h) => r2(loadAt(h)));
  const ladder = [5, 7, 9, 10, 18];
  const kwh = sizes.battery_kwh ?? 10;
  const battery = { kwh, ...simBattery(solar, load, kwh, sunset_h), ladder, by_size: Object.fromEntries(ladder.map((k) => { const b = simBattery(solar, load, k, sunset_h); return [String(k), { hours_after_sunset_covered: b.hours_after_sunset_covered, self_sufficiency_share: b.self_sufficiency_share }]; })) };
  const kw = sizes.wallbox_kw ?? 11, need = 9.5;
  const charging_kwh = H.map((h) => (h >= 18 && h <= 21 ? Math.min(kw, need / 4) : 0)).map(r2);
  const wb = (k: number) => ({ solar_share_of_charging: s === "summer" ? 0.62 : 0.18, full_charge_hours: r2(60 / k) });
  const solar_charging = { charging_kwh: H.map((h) => (h >= 11 && h <= 14 ? r2(need / 4) : 0)), solar_share_of_charging: s === "summer" ? 0.81 : 0.22 };
  const wallbox = { kw, ev_kwh_year: 2400, charging_kwh, solar_charging, ...wb(kw), ladder: [11, 22], by_size: { "11": wb(11), "22": wb(22) } };
  const temp = H.map((h) => r2(-3 + 5 * Math.sin((Math.PI * (h - 8)) / 16) * (h >= 8 && h <= 23 ? 1 : 0.2)));
  const hpkw = sizes.heatpump_kw ?? 7.5;
  const heat_demand_kwh = temp.map((t, h) => r2(Math.max(0.6, (20 - t) * 0.28 * (h >= 23 || h < 5 ? 0.75 : 1))));
  const hp = (k: number) => ({ electricity_kwh_year: Math.round(14500 / (3.4 + (k - 7.5) * 0.02)), cost_eur_year: Math.round((14500 / (3.4 + (k - 7.5) * 0.02)) * 0.32) });
  const heatpump = { kw: hpkw, heat_demand_kwh, outdoor_temp_c: temp, heat_load_kw: 6.8, heating_kwh_year: 14500, cop: 3.4, ...hp(hpkw), boiler_cost_eur_year: 1680, ladder: [5.5, 7.5, 10.5, 12.5], by_size: Object.fromEntries([5.5, 7.5, 10.5, 12.5].map((k) => [String(k), hp(k)])) };
  return { day: s, hours: 24, solar_kwh: solar, load_kwh: load, battery, wallbox, heatpump, sunrise_h, sunset_h };
}
