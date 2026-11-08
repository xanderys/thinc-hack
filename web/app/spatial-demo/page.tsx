"use client";
// Standalone check page for the spatial demonstration: the hero home (or ?address=...) with the engine's own design.
import { useEffect, useState } from "react";
import SpatialDemo from "@/components/spatial/SpatialDemo";
import { HERO_INPUTS } from "@/lib/demo";
import { STAGE_VIEWS, type StageView } from "@/components/spatial/camera";
import type { DesignResponse, HomeInputs } from "@/lib/api";
import { call } from "@/lib/client";
import type { System } from "@/components/spatial/systems";

const SYSTEMS: [System | null, string][] = [["panels", "Panels"], ["battery", "Battery"], ["wallbox", "Wallbox"], ["heatpump", "Heat pump"], [null, "No system"]];

export default function Page() {
  const [layer, setLayer] = useState(1);
  const [ok, setOk] = useState<boolean | null>(null);
  const [inputs, setInputs] = useState<HomeInputs | null>(null);
  const [res, setRes] = useState<DesignResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [n, setN] = useState(0);
  const [view, setView] = useState<StageView | undefined>(undefined);
  const [system, setSystem] = useState<System | null | undefined>(undefined);
  useEffect(() => {
    const address = new URLSearchParams(location.search).get("address") || HERO_INPUTS.address!;
    const i = { ...HERO_INPUTS, address };
    setInputs(i); setErr(null);
    call<DesignResponse>("/api/design", { inputs: i }).then((r) => (r.ok ? setRes(r.data) : setErr(r.error)));
  }, [n]);
  if (err) return <p style={{ paddingTop: 24 }}>{err} <button type="button" onClick={() => setN((x) => x + 1)}>Retry</button></p>;
  if (!inputs || !res) return null;
  return (
    <div style={{ paddingTop: 24, maxWidth: 980 }}>
      <SpatialDemo inputs={inputs} design={res.design} response={res} address={inputs.address!} layer={layer} onLayerChange={setLayer} onAvailable={setOk} view={view} system={system} />
      <p style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{STAGE_VIEWS.map((v) => <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}>{v}</button>)}</p>
      <p style={{ display: "flex", gap: 8, flexWrap: "wrap" }} role="group" aria-label="Systems">{SYSTEMS.map(([k, t]) => <button key={t} type="button" aria-pressed={system === k} onClick={() => setSystem(k)}>{t}</button>)}</p>
      {ok === false && <p>No 3D model for this address.</p>}
    </div>
  );
}
