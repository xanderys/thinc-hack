import home from "../data/home.json";
import type { AnchorId } from "./anchors";

const num = (v: number) => (String(Math.round(v * 100) / 100));
const d = home.design as Record<string, number | null>;

const spec: Record<AnchorId, { name: string; key: string; unit: string }> = {
  pv: { name: "PV", key: "pv_kwp", unit: "kWp" },
  battery: { name: "Battery", key: "battery_kwh", unit: "kWh" },
  heatpump: { name: "Heat pump", key: "heatpump_kw", unit: "kW" },
  wallbox: { name: "Charger", key: "wallbox_kw", unit: "kW" },
};

export const labelFor = (id: AnchorId) => {
  const { name, key, unit } = spec[id];
  const v = d[key];
  return v == null ? { name: name.toUpperCase(), value: "None", none: true } : { name: name.toUpperCase(), value: `${num(v)} ${unit}`, none: false };
};
