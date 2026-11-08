// A shared building (flats, offices): no flat-level kit. The whole roof's potential for the owners' association, a
// balcony system for this flat, the wallbox if the design has one; battery and heat pump withheld with one line each.
// Figures only from the engine; a missing one is left out, never estimated here.
import type { Balcony, RoofPotential } from "@/lib/building";

const n0 = (x: number) => Math.round(x).toLocaleString("en-GB");
const n1 = (x: number) => (Math.round(x * 10) / 10).toLocaleString("en-GB");
const n2 = (x: number) => (Math.round(x * 100) / 100).toLocaleString("en-GB");

export const SHARED_LINES = {
  verdict: "Shared building",
  next: "Ask about parking and the owners' association",
  roof: "Whole roof: needs the owners' association vote (WEG)",
  model: "Building-wide supply shared between flats (§42b EnWG)",
  balcony: "Balcony system, up to 800 W",
  battery: "A home battery needs its own roof system behind the meter.",
  wallbox: "Right to a wallbox at your own parking space: §20 WEG (2020)",
  heatpump: "Heating is shared: a heat pump is sized for the whole building with the owners.",
};

// The pass tiles: whole-roof kWp, balcony kWh a year, wallbox if any. Never a flat-kit price.
export const SHARED_TILE_LABELS = { kwp: "Whole roof", kwh: "Balcony", price: "Wallbox" } as const;
export function sharedFigs(roof: RoofPotential | null, balcony: Balcony | null, wallboxKw?: number | null) {
  const f: { k: "kwp" | "kwh" | "price"; v: string }[] = [];
  f.push({ k: "kwp", v: roof?.kwp ? `${n2(roof.kwp)} kWp` : "Owners' vote" });
  f.push({ k: "kwh", v: balcony?.kwh_year ? `${n0(balcony.kwh_year)} kWh a year` : "up to 800 W" });
  if (wallboxKw) f.push({ k: "price", v: `${n1(wallboxKw)} kW` });
  return f;
}

export default function SharedBuilding({ roof, balcony, wallboxKw, part, noteWallbox, noneBattery, noneHeatpump, verdict }: {
  roof: RoofPotential | null; balcony: Balcony | null; wallboxKw?: number | null; part?: "panels" | "battery" | "wallbox" | "heatpump";
  noteWallbox?: string | null; noneBattery?: string | null; noneHeatpump?: string | null; verdict?: { label?: string | null; next_action?: string | null } | null;
}) {
  const L = SHARED_LINES;
  const rows = {
    panels: (
      <div key="r" className="sb-row">
        <b>{roof?.label ?? L.roof}</b>
        {(roof?.kwp || roof?.kwh_year) && <span>{[roof?.kwp ? `${n2(roof.kwp)} kWp` : null, roof?.modules ? `${n0(roof.modules)} modules` : null, roof?.kwh_year ? `${n0(roof.kwh_year)} kWh a year` : null].filter(Boolean).join(", ")}{roof?.price_eur_whole_roof ? `, €${n0(roof.price_eur_whole_roof)} whole roof` : ""}</span>}
        <span>{roof?.model ?? L.model}</span>
        <b>{L.balcony}</b>
        {(balcony?.kwh_year || balcony?.price_eur) && <span>{[balcony?.kwh_year ? `${n0(balcony.kwh_year)} kWh a year` : null, balcony?.price_eur ? `€${n0(balcony.price_eur)}` : null].filter(Boolean).join(", ")}</span>}
      </div>
    ),
    battery: <p key="b" className="sb-row"><b>No battery</b><span>{noneBattery ?? L.battery}</span></p>,
    wallbox: wallboxKw ? <div key="w" className="sb-row"><b>Wallbox {n1(wallboxKw)} kW</b><span>{noteWallbox ?? L.wallbox}</span></div> : null,
    heatpump: <p key="h" className="sb-row"><b>No heat pump</b><span>{noneHeatpump ?? L.heatpump}</span></p>,
  };
  if (part) return <div className="sb">{rows[part]}</div>;
  return (
    <div className="sb">
      <p className="sb-row"><b>{verdict?.label ?? L.verdict}</b><span>{verdict?.next_action ?? L.next}</span></p>
      {rows.panels}{rows.wallbox}{rows.battery}{rows.heatpump}
    </div>
  );
}
