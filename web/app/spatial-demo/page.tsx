"use client";
// Standalone check page for the spatial demonstration: the hero home (or ?address=...) with the engine's own design.
import { useEffect, useState } from "react";
import SpatialDemo from "@/components/spatial/SpatialDemo";
import { HERO_INPUTS } from "@/lib/demo";
import type { DesignResponse, HomeInputs } from "@/lib/api";
import { call } from "@/lib/client";

export default function Page() {
  const [layer, setLayer] = useState(1);
  const [ok, setOk] = useState<boolean | null>(null);
  const [inputs, setInputs] = useState<HomeInputs | null>(null);
  const [res, setRes] = useState<DesignResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [n, setN] = useState(0);
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
      <SpatialDemo inputs={inputs} design={res.design} response={res} address={inputs.address!} layer={layer} onLayerChange={setLayer} onAvailable={setOk} />
      {ok === false && <p>No 3D model for this address.</p>}
    </div>
  );
}
