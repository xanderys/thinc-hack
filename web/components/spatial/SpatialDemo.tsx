"use client";
// Progressive, layered explanation of a design over the real house model.
// Usage: <SpatialDemo inputs={inputs} design={design} address={address} layer={n} onLayerChange={setN} />
// Renders nothing when the engine has no 3D model for the address; onAvailable(false) tells the parent to keep its drawing.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Design, DesignResponse, HomeInputs } from "@/lib/api";
import { call } from "@/lib/client";
import type { Envelope, Layers, PanelRect, RoofModel, RoofPlane } from "./types";
import { labelOf, p2, planesOf } from "./types";
import type { SpatialScene } from "./scene";
import { BatteryChart, FrontierChart } from "./charts";
import { facing } from "./facing";
import s from "./spatial.module.css";

export type Endpoints = { glb?: string; layers?: string };

const modelOf = (x: Layers["planes"] | null | undefined): RoofModel | null =>
  !x ? null : Array.isArray(x) ? { address: "", planes: x } : x.planes ? x : null;

type Props = {
  inputs: HomeInputs; design: Design; address: string;
  layer?: number; onLayerChange?: (n: number) => void; onAvailable?: (ok: boolean) => void;
  endpoints?: Endpoints;
  response?: DesignResponse | null;   // optional: the heat layer reads the heat pump derivation from it
};

// Layer ids are fixed (7 Heat, 8 Plan); a step shows only when its data is present.
const STEPS = ["Roof", "Sun", "Panels", "A day", "Battery", "Value", "Heat", "Plan"];
const LICENCE = "Bayerische Vermessungsverwaltung, www.geodaten.bayern.de, CC BY 4.0";
const n0 = (x: number) => Math.round(x).toLocaleString("en-GB");
const n1 = (x: number) => x.toLocaleString("en-GB", { maximumFractionDigits: 1 });
const n2 = (x: number) => x.toLocaleString("en-GB", { maximumFractionDigits: 2 });
const pct = (x: number) => `${Math.round(x * 100)}%`;
const hh = (h: number) => `${String(Math.floor(h)).padStart(2, "0")}:00`;

function useReduce() {
  const [r, setR] = useState(false);
  useEffect(() => {
    const m = window.matchMedia("(prefers-reduced-motion: reduce)");
    setR(m.matches);
    const f = () => setR(m.matches);
    m.addEventListener("change", f);
    return () => m.removeEventListener("change", f);
  }, []);
  return r;
}

export default function SpatialDemo({ inputs, design, address, layer: ctrl, onLayerChange, onAvailable, endpoints, response }: Props) {
  const reduce = useReduce();
  const [own, setOwn] = useState(1);
  const layer = ctrl ?? own;
  const setLayer = (n: number) => { if (onLayerChange) onLayerChange(n); if (ctrl == null) setOwn(n); };

  const [layers, setLayers] = useState<Layers | null>(null);
  const [absent, setAbsent] = useState(false);
  const [layersErr, setLayersErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tryN, setTryN] = useState(0);
  const [glbErr, setGlbErr] = useState<string | null>(null);
  const [glbOk, setGlbOk] = useState(false);
  const [ready, setReady] = useState(false);
  const [hour, setHour] = useState<{ h: number; playing: boolean }>({ h: 12, playing: false });
  const [view, setView] = useState<"3d" | "2d">("3d");

  const host = useRef<HTMLDivElement>(null), overlay = useRef<HTMLDivElement>(null), svg = useRef<SVGSVGElement>(null), compass = useRef<HTMLDivElement>(null);
  const scene = useRef<SpatialScene | null>(null);
  const modelRef = useRef<RoofModel | null>(null);
  const [modelGen, setModelGen] = useState(0);
  const [retryGlb, setRetryGlb] = useState(0);
  const prevLayer = useRef(0);

  const kwp = design.pv_kwp;
  const enc = encodeURIComponent(address);
  const glbUrl = endpoints?.glb ?? `/spatial-demo/glb?address=${enc}`;
  const layersUrl = endpoints?.layers ?? "/api/explain/layers";
  const layersKey = JSON.stringify([inputs, design, address]);

  // One call for everything on screen: POST /api/explain/layers for this design (planes with its modules, shade,
  // envelope, plan, day, night, frontier), re-run whenever the design changes. No roof planes: render nothing.
  useEffect(() => {
    const ac = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    setLayersErr(null); setBusy(true);
    fetch(layersUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ inputs: { ...inputs, address }, design }), signal: ac.signal })
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        setBusy(false);
        const m = body ? modelOf(body.planes) : null;
        if (res.status === 404 || (res.ok && !m?.planes?.some((p) => p.is_target))) { setAbsent(true); setLayers(null); onAvailable?.(false); return; }
        if (!res.ok) { setLayersErr(body?.error || `Engine answered ${res.status}`); if (tryN < 1) timer = setTimeout(() => setTryN((x) => x + 1), 20000); return; }
        setAbsent(false); setLayers(body as Layers); onAvailable?.(true);
      })
      .catch((e) => { if ((e as Error).name !== "AbortError") { setBusy(false); setLayersErr((e as Error).message); } });
    return () => { ac.abort(); if (timer) clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layersKey, layersUrl, tryN]);

  const model = useMemo(() => (layers ? modelOf(layers.planes) : null), [layers]);
  modelRef.current = model;
  const hasModel = !!model;
  // three.js, loaded only once there is a model to show.
  useEffect(() => {
    if (!hasModel || !host.current || !overlay.current || !svg.current) return;
    let dead = false;
    import("./scene").then(({ SpatialScene }) => {
      if (dead || !host.current || !overlay.current || !svg.current) return;
      const sc = new SpatialScene(host.current, overlay.current, svg.current, {
        reduce, compass: compass.current, onHour: (h, playing) => setHour({ h, playing }),
      });
      if (modelRef.current) sc.setModel(modelRef.current);
      scene.current = sc;
      setReady(true);
      setGlbErr(null);
      sc.loadGlb(glbUrl, (e) => { if (!dead) { setGlbErr(e); setGlbOk(!e); } });
    });
    return () => { dead = true; scene.current?.dispose(); scene.current = null; setReady(false); setGlbOk(false); prevLayer.current = 0; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasModel, glbUrl, reduce, retryGlb]);

  // A new design re-reads the planes; the scene keeps its glb and camera.
  useEffect(() => { if (model && scene.current && ready) { scene.current.setModel(model); setModelGen((x) => x + 1); } }, [model, ready]);

  const planes: RoofPlane[] = model?.planes ?? [];
  const panelList = useMemo(() => planes.filter((p) => p.is_target).flatMap((p) => p.chosen_panels.map((r: PanelRect) => ({ p, r }))), [planes]);
  const counts = useMemo(() => Object.fromEntries(planes.filter((p) => p.is_target).map((p) => [p.id, p.chosen_panels.length])), [planes]);
  const envelope: Envelope | null = (model?.envelope && model.envelope.faces?.length ? model.envelope : null);
  const plan = model?.plan && model.plan.outline?.length ? model.plan : null;
  const ids = [1, 2, 3, 4, 5, 6, ...(envelope ? [7] : []), ...(plan ? [8] : [])];
  const nSteps = ids.length;
  const L = ids.includes(layer) ? layer : 1;

  // Panels change with the design: re-place them (animated only when the panels layer is showing).
  const panelKey = panelList.length + ":" + JSON.stringify(Object.values(counts));
  useEffect(() => {
    const sc = scene.current;
    if (!sc || !ready) return;
    sc.setPanels(panelList, !reduce && L === 3);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelKey, ready, modelGen]);

  // Apply the layer.
  useEffect(() => {
    const sc = scene.current;
    if (!sc || !ready) return;
    const prev = prevLayer.current;
    prevLayer.current = L;
    sc.setHeat(null);
    sc.show({ outlines: L <= 3, panels: L >= 3 && L !== 7, kit: L >= 4 && L <= 6, sun: L === 4, battery: L === 5 && !!design.battery_kwh ? "lit" : "plain" });
    sc.setTint(L === 2 ? "yield" : "off");
    if (L === 3 && prev !== 3 && prev < 3) sc.setPanels(panelList, !reduce);
    if (L === 4 && layers) sc.setDay(layers.day.hours, !reduce); else sc.setDay(null, false);
    if (L === 1) sc.setLabels(sc.planeLabels("roof"));
    else if (L === 2) sc.setLabels(sc.planeLabels("sun"));
    else if (L === 3) sc.setLabels(sc.planeLabels("panels", counts));
    else if (L === 7) sc.setLabels(sc.setHeat(envelope));
    else sc.setLabels([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [L, ready, layers, panelKey, glbOk, !!envelope, modelGen]);

  // The plan layer is always top-down; the other layers keep the planner's choice.
  useEffect(() => { scene.current?.setView(L === 8 ? "2d" : view); scene.current?.setPlan(L === 8 ? plan : null); }, [view, ready, L, plan]);

  const seek = useCallback((h: number) => { scene.current?.seek(h); setHour({ h, playing: false }); }, []);

  if (absent) return null;

  const target = planes.filter((p) => p.is_target);
  const nPanels = panelList.length;
  const modKwp = model?.layout && model.layout.panels ? model.layout.kwp / model.layout.panels : null;
  const e = layers?.economics;
  const src = (keys: string[]) => (layers?.sources ?? []).filter((x) => keys.includes(x.key));
  const chosenPt = layers?.frontier.find((p) => p.chosen) ?? null;
  // The swept point that is this design (the panel shows the design on screen, not the engine's own pick).
  const designPt = layers?.frontier.find((p) => Math.abs(p.kwp - (design.pv_kwp ?? -1)) < 0.06 && Math.abs(p.kwh - (design.battery_kwh ?? 0)) < 0.06) ?? null;

  const content = (() => {
    switch (L) {
      case 1: {
        const area = target.reduce((a, p) => a + p.area_m2, 0), fit = target.reduce((a, p) => a + (p.fits_panels ?? p.max_panels), 0);
        return {
          sentence: "The real roof, measured from the Bavarian 3D building model.",
          eq: target.map((p) => `${facing(p.azimuth)} ${n1(p.area_m2)} m², ${Math.round(p.pitch)}°, azimuth ${p.azimuth ?? "none"}°`).join("; ") + ` → ${n1(area)} m² fits ${fit} modules`,
          sources: [{ key: "lod2", citation: "LoD2 CityGML and DOP20 orthophoto, Bayerische Vermessungsverwaltung", url: "https://www.geodaten.bayern.de" }],
        };
      }
      case 2:
        return {
          sentence: "Each face of the roof gets a different amount of sun in a year.",
          eq: target.map((p) => `${facing(p.azimuth)} ${Math.round(p.pitch)}° → ${n0(p.yield_shaded_kwh_per_kwp ?? p.yield_kwh_per_kwp)} kWh per kWp a year${p.yield_shaded_kwh_per_kwp != null ? " after shade" : ""}${p.shade_loss_share != null ? `, ${n1(p.shade_loss_share * 100)}% lost to shade${p.shade_reason ? ` (${p.shade_reason})` : ""}` : ""}`).join("; "),
          sources: src(["pvgis", "pvlib", "yield"]).length ? src(["pvgis", "pvlib", "yield"]) : [{ key: "pvgis", citation: model?.sun_source ?? "PVGIS typical meteorological year", url: "https://re.jrc.ec.europa.eu/pvg_tools/en/" }],
        };
      case 3: {
        const per = target.filter((p) => counts[p.id]).map((p) => `${counts[p.id]} ${facing(p.azimuth)}`);
        const kw = modKwp ? nPanels * modKwp : kwp;
        const short = kwp != null && kw != null && kwp - kw > 0.05 ? `; the design asks for ${n2(kwp)} kWp, the usable roof takes ${n2(kw)}` : "";
        const yieldOk = model?.layout && model.layout.panels === nPanels;
        return {
          sentence: "Modules go where the roof pays back best.",
          eq: `${nPanels} modules${modKwp ? ` × ${n2(modKwp)} kWp` : ""} = ${kw != null ? n2(kw) : "?"} kWp` + (per.length > 1 ? ` (${per.join(" + ")})` : "") + (e?.annual ? `; ${n0(e.annual.pv_yield_kwh)} kWh a year` : yieldOk ? `; ${n0(model!.layout!.kwh_per_year)} kWh a year` : "") + short,
          sources: src(["pvgis", "pvlib", "lod2", "yield", "module_kwp"]),
        };
      }
      case 4: {
        if (!layers) return null;
        const hs = layers.day.hours, sum = (f: (x: (typeof hs)[0]) => number) => hs.reduce((a, x) => a + f(x), 0);
        const pv = sum((x) => x.pv_kw), load = sum((x) => x.load_kw), exp = sum((x) => Math.max(-x.grid_kw, 0)), imp = sum((x) => Math.max(x.grid_kw, 0));
        return {
          sentence: "One spring weekday, hour by hour.",
          eq: `${layers.day.date.split(" (")[0]}: solar ${n1(pv)} kWh, home ${n1(load)} kWh, export ${n1(exp)} kWh, import ${n1(imp)} kWh; used on site ${pv ? pct((pv - exp) / pv) : "0%"}`,
          sources: src(["pvgis", "pvlib", "bdew", "yield", "load"]),
        };
      }
      case 5: {
        if (!layers) return null;
        const nt = layers.night, mwh = (inputs.annual_demand_kwh ?? 0) / 1000;
        return {
          sentence: design.battery_kwh ? "The battery carries the evening, up to the size where more storage stops paying." : "No battery: the evening comes from the grid.",
          eq: `after sunset ${n1(nt.evening_kwh)} kWh over ${nt.night_hours} h; HTW cap 1.5 kWh per MWh × ${n1(mwh)} MWh = ${n1(nt.htw_cap_kwh)} kWh; battery ${design.battery_kwh ? `${n1(design.battery_kwh)} kWh` : "none"}`,
          sources: src(["htw", "bdew", "htw_cap", "battery_physics", "load"]),
        };
      }
      case 6: {
        if (!layers) return null;
        const c = chosenPt, best = [...layers.frontier].sort((a, b) => b.npv_20y_eur - a.npv_20y_eur)[0];
        const alts = layers.frontier.filter((p) => p.label && !p.chosen).map((p) => `${labelOf(p).toLowerCase()} ${n2(p.kwp)} kWp + ${n1(p.kwh)} kWh`);
        return {
          sentence: "Every size, through the same year: upfront cost against 20-year value.",
          eq: `${c ? `recommended ${n2(c.kwp)} kWp + ${n1(c.kwh)} kWh: ${n0(c.capex_eur)} EUR → ${n0(c.npv_20y_eur)} EUR` : ""}${best && best !== c ? `; best value ${n2(best.kwp)} kWp + ${n1(best.kwh)} kWh: ${n0(best.capex_eur)} EUR → ${n0(best.npv_20y_eur)} EUR` : ""}${alts.length ? `; ${alts.join("; ")}` : ""}${layers.objective.sentence ? `. ${layers.objective.sentence}` : ""}`,
          sources: src(layers.objective.sources.length ? layers.objective.sources : ["knee", "discount", "pv_cost", "battery_cost"]),
        };
      }
      case 7: {
        if (!envelope) return null;
        const t = envelope.design?.outside_c ?? envelope.design_outdoor_c ?? -16, tin = envelope.design?.inside_c ?? 20, kw = envelope.design_heat_load_kw;
        const dv = response?.components?.heatpump?.derivation;
        const bill = dv?.axiom_result ?? dv?.final ?? design.heatpump_kw ?? null;
        const parts = envelope.faces.reduce((a, f) => a + f.loss_w, 0);
        const yr = envelope.build_year ?? inputs.house_built_year;
        const tb = envelope.thermal_bridges_w ?? 0;
        return {
          sentence: `If the ${yr ?? "original"} fabric is unrenovated, this house loses up to ${n0(kw)} kW at minus ${Math.abs(t)}.`,
          second: bill != null ? `The ${inputs.heating_type === "Oil" ? "oil" : inputs.heating_type === "Gas" ? "gas" : "heating"} bill implies about ${n0(bill)} kW; the heat pump is sized from the bill.` : null,
          eq: `Σ U × A × (${tin} − (${t})) = ${n0(parts)} W${tb ? ` + thermal bridges ${n0(tb)} W` : ""} + ventilation ${n0(envelope.ventilation_w)} W = ${n1(kw)} kW${envelope.annual_heat_demand_kwh ? `; ${n0(envelope.annual_heat_demand_kwh)} kWh heat a year` : ""}`,
          sources: (envelope.sources ?? ["IWU German building typology (TABULA)", "DIN EN 12831 heat load"]).map((x, i) => typeof x === "string" ? { key: `e${i}`, citation: x } : { key: x.key ?? `e${i}`, citation: x.citation, url: x.url }),
        };
      }
      case 8: {
        if (!plan) return null;
        // The note's plain sentences for the planner; coordinate-frame sentences are for developers.
        const raw = [plan.note, ...(Array.isArray(plan.notes) ? plan.notes : plan.notes ? [plan.notes] : [])].filter(Boolean).join(" ");
        const notes = raw.split(/(?<=\.)\s+/).filter((x) => x && !/local metres|x east|_m2|north arrow/i.test(x)).map((x) => x.charAt(0).toUpperCase() + x.slice(1)).map((x) => (/[.]$/.test(x) ? x : `${x}.`));
        const facts = [plan.floor_area_m2 != null ? `${n1(plan.floor_area_m2)} m² footprint` : "", plan.storeys != null ? `${plan.storeys} storeys` : "", plan.net_floor_area_m2 != null ? `about ${n0(plan.net_floor_area_m2)} m² living area` : ""].filter(Boolean);
        const pts = (Array.isArray(plan.cable_run) ? plan.cable_run : plan.cable_run?.points ?? plan.cable_run?.path ?? []).map(p2).filter(Boolean) as [number, number][];
        const runLen = !Array.isArray(plan.cable_run) && plan.cable_run?.length_m ? plan.cable_run.length_m : pts.slice(1).reduce((a, q, i) => a + Math.hypot(q[0] - pts[i][0], q[1] - pts[i][1]), 0);
        const run = runLen ? `; cable run about ${n1(runLen)} m in plan` : "";
        const clr = (plan.clearances ?? []).filter((c) => c.source).map((c, i) => ({ key: `c${i}`, citation: c.source as string, url: undefined as string | undefined }));
        return {
          sentence: "The footprint with where the equipment goes.",
          second: notes.length ? notes.join(" ") : null,
          eq: facts.join(", ") + run,
          items: [...(plan.equipment ?? []), ...(plan.markers ?? [])].filter((m) => m.note).map((m) => `${m.label ?? m.kind}: ${m.note}`),
          sources: [...(Array.isArray(plan.sources) ? (plan.sources as (string | { key?: string; citation: string; url?: string })[]).map((x, i) => typeof x === "string" ? { key: `p${i}`, citation: x } : { key: x.key ?? `p${i}`, citation: x.citation, url: x.url }) : [{ key: "lod2", citation: "LoD2 footprint, Bayerische Vermessungsverwaltung", url: "https://www.geodaten.bayern.de" }]), ...clr],
        };
      }
    }
    return null;
  })();

  const needsLayers = L >= 4 && L <= 6;
  const numbers: { k: string; v: string; u: string }[] = [];
  // The four numbers: from the layers' economics, else from the chosen frontier point and the model's yield for this kWp.
  const four = e ? { y: e.annual?.pv_yield_kwh ?? model?.layout?.kwh_per_year ?? null, a: e.autarky_share, c: e.capex_eur, p: e.payback_years }
    : designPt ? { y: model?.layout?.kwh_per_year ?? null, a: designPt.autarky_share, c: designPt.capex_eur, p: designPt.payback_years } : null;
  if (four && L >= 3 && L <= 6) {
    if (four.y != null) numbers.push({ k: "Yield", v: n0(four.y), u: "kWh" });
    numbers.push({ k: "Autarky", v: pct(four.a), u: "" }, { k: "Investment", v: n0(four.c), u: "EUR" }, { k: "Payback", v: four.p == null ? "none" : n1(four.p), u: four.p == null ? "" : "years" });
  }
  // One run check: modules on the roof against the design, and the yield the economics used against the numbers shown.
  const cs = layers?.consistency;
  const shownYield = response?.economics?.annual?.pv_yield_kwh ?? four?.y ?? null;
  const check = (() => {
    if (!cs || L < 2 || L > 6) return null;
    const bad: string[] = [];
    if (cs.modules_on_roof != null && cs.modules_in_design != null && cs.modules_on_roof !== cs.modules_in_design)
      bad.push(`${cs.modules_on_roof} modules on the roof, ${cs.modules_in_design} in the design`);
    if (cs.pv_yield_kwh_used != null && shownYield != null && Math.abs(cs.pv_yield_kwh_used - shownYield) > 1)
      bad.push(`yield ${n0(cs.pv_yield_kwh_used)} kWh here, ${n0(shownYield)} kWh in the design's numbers`);
    if (cs.pv_yield_kwh_used != null && cs.layout_kwh_per_year != null && Math.abs(cs.pv_yield_kwh_used - cs.layout_kwh_per_year) > 1)
      bad.push(`economics used ${n0(cs.pv_yield_kwh_used)} kWh, the roof gives ${n0(cs.layout_kwh_per_year)} kWh`);
    if (cs.design_economics_match === false) bad.push("economics are not for this design");
    if (bad.length) return { bad: true, text: `Mismatch: ${bad.join("; ")}` };
    const m = cs.modules_on_roof != null ? `${cs.modules_on_roof} modules on the roof, ${cs.modules_in_design ?? "?"} in the design` : "";
    return { bad: false, text: `${m}${m ? ", " : ""}same run${cs.shaded ? ", yield after shade" : ""}` };
  })();
  if (L === 7 && envelope) numbers.push({ k: "Heat load", v: n1(envelope.design_heat_load_kw), u: "kW" });

  const battery = layers && L === 5 ? <BatteryChart layers={layers} battery={design.battery_kwh} reduce={reduce} /> : null;
  const frontier = layers && L === 6 ? <FrontierChart frontier={layers.frontier} /> : null;
  const chart = battery ?? frontier;

  return (
    <section className={s.wrap} aria-label="How the design is computed, over the house">
      <div className={s.strip} style={{ ["--n" as string]: nSteps }} role="group" aria-label="Layers">
        {ids.map((id, i) => (
          <button key={id} type="button" className={s.step} aria-pressed={L === id} onClick={() => setLayer(id)}>
            <span className={s.k}>{i + 1}</span><span className={s.t}>{STEPS[id - 1]}</span>
          </button>
        ))}
      </div>

      <div className={s.view}>
        <div ref={host} className={s.host} />
        <svg ref={svg} className={s.flows} aria-hidden="true" />
        <div ref={overlay} className={s.overlay} aria-hidden="true" />
        {!ready && !absent && !layersErr && <div className={s.wait}>Loading the house</div>}
        {ready && busy && <div className={s.wait}>Updating for this design</div>}
        {ready && !glbOk && !glbErr && <div className={s.wait}>Loading the aerial photo</div>}
        {glbErr && <div className={s.err}>{glbErr}<button type="button" onClick={() => setRetryGlb((x) => x + 1)}>Retry</button></div>}
        {layersErr && <div className={s.err}>{layersErr}<button type="button" onClick={() => setTryN((x) => x + 1)}>Retry</button></div>}

        {(numbers.length > 0 || check) && (
          <div className={s.nwrap}>
            {numbers.length > 0 && (
              <dl className={s.numbers}>
                {numbers.map((x) => <div key={x.k}><dt>{x.k}</dt><dd>{x.v}{x.u && <span>{x.u}</span>}</dd></div>)}
              </dl>
            )}
            {check && <p className={check.bad ? `${s.check} ${s.bad}` : s.check} role={check.bad ? "alert" : undefined}>{check.text}</p>}
          </div>
        )}

        <div className={s.tools}>
          <div className={s.toggle} role="group" aria-label="View">
            <button type="button" aria-pressed={L !== 8 && view === "3d"} onClick={() => { setView("3d"); if (L === 8) setLayer(3); }}>3D</button>
            <button type="button" aria-pressed={L === 8 || view === "2d"} onClick={() => setView("2d")}>2D</button>
          </div>
          <div className={s.compass} title="North"><div ref={compass} className={s.needle}><i />N</div></div>
        </div>

        {L === 2 && (
          <div className={s.legend}>
            <div className={s.bar} style={{ background: "linear-gradient(90deg, #F4F1EA, #0D1BFE)" }} />
            <div className={s.ends}><span>{n0(Math.min(...planes.map((p) => p.yield_shaded_kwh_per_kwp ?? p.yield_kwh_per_kwp)))}</span><span>{n0(Math.max(...planes.map((p) => p.yield_shaded_kwh_per_kwp ?? p.yield_kwh_per_kwp)))} kWh/kWp</span></div>
          </div>
        )}
        {L === 7 && envelope && (
          <div className={s.legend}>
            <div className={s.bar} style={{ background: "linear-gradient(90deg, #F4F1EA, #E8730C)" }} />
            <div className={s.ends}><span>less</span><span>more W per m²</span></div>
          </div>
        )}
        {L === 4 && layers && <div className={s.clock} aria-live="off">{hh(hour.h)}</div>}
        {chart && <div className={s.side}>{chart}</div>}
      </div>

      <div className={s.caption}>
        {content ? <p className={s.sentence}>{content.sentence}</p> : null}
        {content && "second" in content && content.second ? <p className={s.sentence}>{content.second}</p> : null}
        {L === 4 && layers && (
          <div className={s.ctl}>
            {!reduce && <button type="button" onClick={() => { if (hour.playing) { scene.current?.pause(); setHour((x) => ({ ...x, playing: false })); } else { scene.current?.play(); setHour((x) => ({ ...x, playing: true })); } }}>{hour.playing ? "Pause" : "Play the day"}</button>}
            <input type="range" min={0} max={Math.max(0, layers.day.hours.length - 1)} step={1} value={Math.min(layers.day.hours.length - 1, Math.round(hour.h))} onChange={(ev) => seek(Number(ev.target.value))} aria-label="Hour of the day" />
          </div>
        )}
        {chart && <div className={s.below}>{L === 5 ? <BatteryChart layers={layers!} battery={design.battery_kwh} reduce={reduce} /> : <FrontierChart frontier={layers!.frontier} />}</div>}
        {content && <p className={s.eq}>{content.eq}</p>}
        {content && "items" in content && content.items && content.items.length > 0 && <ul className={s.items}>{content.items.map((x) => <li key={x}>{x}</li>)}</ul>}
        {content && content.sources.length > 0 && (
          <p className={s.sources}>Sources: {content.sources.map((x, i) => <span key={x.key}>{i ? "; " : ""}{x.url ? <a href={x.url} target="_blank" rel="noreferrer">{x.citation}</a> : x.citation}</span>)}</p>
        )}
        <p className={s.licence}>{LICENCE}</p>
      </div>
    </section>
  );
}
