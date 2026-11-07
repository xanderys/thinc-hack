"use client";
// Standalone check page for the spatial demonstration (hero home, live engine).
import { useState } from "react";
import SpatialDemo from "@/components/spatial/SpatialDemo";
import { HERO_INPUTS } from "@/lib/demo";
import type { Design } from "@/lib/api";

const DESIGN: Design = { pv_kwp: 10.35, inverter_kw: 8, battery_kwh: 10, heatpump_kw: null, wallbox_kw: null };

export default function Page() {
  const [layer, setLayer] = useState(1);
  const [ok, setOk] = useState<boolean | null>(null);
  return (
    <div style={{ paddingTop: 24, maxWidth: 980 }}>
      <SpatialDemo inputs={HERO_INPUTS} design={DESIGN} address={HERO_INPUTS.address!} layer={layer} onLayerChange={setLayer} onAvailable={setOk} />
      {ok === false && <p>No 3D model for this address.</p>}
    </div>
  );
}
