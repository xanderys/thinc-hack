"use client";
// Progressive, layered explanation of a design over the real house model.
// Usage: <SpatialDemo inputs={inputs} design={design} address={address} layer={n} onLayerChange={setN} />
// Renders nothing when the engine has no 3D model for the address; onAvailable(false) tells the parent to keep its drawing.
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import type { Design, DesignResponse, HomeInputs, OverrideValue } from "@/lib/api";
import { call } from "@/lib/client";
import type { Envelope, Layers, PanelRect, RoofModel, RoofPlane } from "./types";
import { labelOf, p2, planesOf } from "./types";
import type { SpatialScene } from "./scene";
import type { System } from "./systems";
import { POSES, UNIT_POSES, type StageView } from "./camera";
import { BatteryChart, FrontierChart } from "./charts";
import { facing } from "./facing";
import { usePhoto } from "./PhotoView";
import { snapKey } from "./snapshot";
import LayersMenu from "./LayersMenu";
import { isOrigin } from "@/lib/tilesGeo";
import { isMultiUnit } from "@/lib/building";
import { setImagery, type Imagery } from "./whiteMode";
import s from "./spatial.module.css";
import EditLayer from "./EditLayer";
import { MODULE_WP, countOf, dropStoredPicks, idsOf, kwpKey, picksOf, slotsOf, withPicks, type Picks } from "./editing";
import ShadingPanel from "./ShadingScrubber";
import { useShadeView, useShading } from "@/lib/shading";

export type Endpoints = { glb?: string; layers?: string; layersGet?: boolean };  // layersGet: the homeowner page reads its layers with a GET, never a POST

const modelOf = (x: Layers["planes"] | null | undefined): RoofModel | null =>
  !x ? null : Array.isArray(x) ? { address: "", planes: x } : x.planes ? x : null;

type Props = {
  inputs: HomeInputs; design: Design; address: string;
  layer?: number; onLayerChange?: (n: number) => void; onAvailable?: (ok: boolean) => void;
  endpoints?: Endpoints;
  response?: DesignResponse | null;   // optional: the heat layer reads the heat pump derivation from it
  view?: StageView;                   // optional: the reasoning stage the camera should frame (camera.ts)
  bare?: boolean;                     // the reasoning chain draws its own chrome: canvas, labels and compass only
  homeowner?: boolean;                // the homeowner's proposal: no numbers tile, check line, equation, plan notes or sources; sans font
  leadId?: string;                    // sent with the layers call so call facts tag as Rina
  onLayers?: (l: Layers) => void;     // the one layers response, for bars, checks and the energy numbers
  sunTint?: boolean;                  // tint the roof faces by sun with the modules showing (per-panel shading not in yet)
  tools?: (c: { view: "3d" | "2d"; setView: (v: "3d" | "2d") => void; recentre: () => void; photo?: { on: boolean; set: (on: boolean) => void }; zoom?: { can: { in: boolean; out: boolean }; by: (d: 1 | -1) => void }; north?: ReactNode }) => ReactNode;
  children?: ReactNode;               // overlays drawn over the canvas
  system?: System | null;             // the Systems chip: its layer on the model and its camera (systems.ts)
  onScene?: (sc: SpatialScene | null) => void; // the live scene, for callers that drive it directly (scene.setSystem)
  // The planner's on-model editing (EditLayer.tsx); never on the homeowner page. setKit sends several fields as one
  // edit (pv_kwp with layout_slots); slots is the lead's stored layout_slots.
  edit?: { setOverride: (f: keyof Design, v: OverrideValue | undefined) => void; setKit?: (p: Record<string, OverrideValue | string[] | undefined>) => void; slots?: string[] | null };
};

// Layer ids are fixed (7 Heat, 8 Plan); a step shows only when its data is present.
const STEPS = ["Roof", "Sun", "Panels", "A day", "Battery", "Value", "Heat", "Plan"];
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

export default function SpatialDemo({ inputs, design, address, layer: ctrl, onLayerChange, onAvailable, endpoints, response, view: stage, bare, homeowner, leadId, onLayers, tools, sunTint, children, system, onScene, edit }: Props) {
  // A card can render a frame before its design is in: draw nothing of the design until it is.
  design = design ?? ({ pv_kwp: 0, battery_kwh: 0, wallbox_kw: 0, heatpump_kw: 0, inverter_kw: 0 } as unknown as Design);
  const reduce = useReduce();
  const [own, setOwn] = useState(1);
  const layer = ctrl ?? own;
  const setLayer = (n: number) => { if (onLayerChange) onLayerChange(n); if (ctrl == null) setOwn(n); };

  const [layers, setLayers] = useState<Layers | null>(null);
  const [zoomCan, setZoomCan] = useState({ in: true, out: true });
  const [absent, setAbsent] = useState(false);
  const [layersErr, setLayersErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tryN, setTryN] = useState(0);
  const [glbErr, setGlbErr] = useState<string | null>(null);
  const [glbOk, setGlbOk] = useState(false);
  const [ready, setReady] = useState(false);
  const [sysNow, setSysNow] = useState<System | null>(null);   // the Systems chip on screen, for the edit layer
  const editSys = (system ?? sysNow) as "panels" | "battery" | "wallbox" | "heatpump" | null;
  const [hour, setHour] = useState<{ h: number; playing: boolean }>({ h: 12, playing: false });
  const [view, setView] = useState<"3d" | "2d">("3d");

  const viewEl = useRef<HTMLDivElement>(null);
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
    fetch(layersUrl, endpoints?.layersGet ? { method: "GET", signal: ac.signal } : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ inputs: { ...inputs, address }, design, ...(leadId ? { lead_id: leadId } : {}) }), signal: ac.signal })
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        setBusy(false);
        const m = body ? modelOf(body.planes) : null;
        if (res.status === 404 || (res.ok && !m?.planes?.some((p) => p.is_target))) { setAbsent(true); setLayers(null); onAvailable?.(false); return; }
        if (!res.ok) { setLayersErr(body?.error || `Engine answered ${res.status}`); if (tryN < 1) timer = setTimeout(() => setTryN((x) => x + 1), 20000); return; }
        setAbsent(false); setLayers(body as Layers); onAvailable?.(true); onLayers?.(body as Layers);
      })
      .catch((e) => { if ((e as Error).name !== "AbortError") { setBusy(false); setLayersErr((e as Error).message); } });
    return () => { ac.abort(); if (timer) clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layersKey, layersUrl, tryN]);

  // On-model editing: the planner's slot picks for the design on screen (editing.ts). A tap shows at once; the
  // stored picks for this kWp take over when the engine's answer for the new count is in. Undo finds the picks
  // stored for the kWp it returns to.
  const editLead = edit && !homeowner ? leadId ?? "demo" : null;
  useEffect(() => { dropStoredPicks(); }, []);
  const [live, setLive] = useState<{ kwp: number; picks: Picks; until: number } | null>(null);
  // The tap's own layout stands in only until the engine's design reaches its kWp; after that the lead's layout_slots
  // lead (so an Undo, which lands on another kWp, shows the layout it restored).
  useEffect(() => { if (live && kwpKey(design.pv_kwp) === kwpKey(live.kwp)) setLive(null); }, [design.pv_kwp, live]);
  const wantN = Math.round(((design.pv_kwp ?? 0) * 1000) / MODULE_WP);
  // Order: a tap still on its way to the engine, then the lead's layout_slots. The lead is the only stored source; a
  // layout whose module count is not the design's is discarded (the engine's own layout shows).
  const faceIds = useMemo(() => {
    const m = layers ? modelOf(layers.planes) : null;
    return m ? m.planes.filter((p) => p.is_target).map((p) => p.id) : [];
  }, [layers]);
  const fromLead = edit?.slots?.length && faceIds.length ? picksOf(edit.slots, faceIds) : null;
  const picks: Picks | null = !editLead ? null
    : live && live.until > Date.now() && kwpKey(live.kwp) !== kwpKey(design.pv_kwp) ? live.picks
    : fromLead && countOf(fromLead) === wantN ? fromLead : null;
  const picksKey = picks ? JSON.stringify(picks) : "";
  const model = useMemo(() => {
    const m = layers ? modelOf(layers.planes) : null;
    return m && picks ? { ...m, planes: withPicks(m.planes, picks) } : m;
  }, [layers, picksKey]); // eslint-disable-line react-hooks/exhaustive-deps
  // The cards read the same layout as the model: hand them the planes with the picks in.
  useEffect(() => {
    if (!layers || !picks || !model) return;
    onLayers?.({ ...layers, planes: Array.isArray(layers.planes) ? model.planes : { ...layers.planes, planes: model.planes } });
  }, [model]); // eslint-disable-line react-hooks/exhaustive-deps
  modelRef.current = model;
  const hasModel = !!model;
  // Once the view has a scene it keeps it while a reload briefly empties the layers: no teardown, no new canvas.
  const everModel = useRef(false);
  if (hasModel) everModel.current = true;
  const wantScene = everModel.current;
  // three.js, loaded only once there is a model to show.
  useEffect(() => {
    if (!wantScene || !host.current || !overlay.current || !svg.current) return;
    let dead = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    import("./scene").then(({ SpatialScene }) => {
      if (dead || !host.current || !overlay.current || !svg.current) return;
      const sc = new SpatialScene(host.current, overlay.current, svg.current, {
        reduce, compass: compass.current, onHour: (h, playing) => setHour({ h, playing }), onView: (m) => setView(m), onZoom: setZoomCan,
      });
      if (modelRef.current) sc.setModel(modelRef.current);
      scene.current = sc;
      // Development and headless checks only: where the house sits against the free rect.
      if (process.env.NODE_ENV !== "production") (window as unknown as { __marqueeFrame?: () => unknown }).__marqueeFrame = () => sc.frameReport();
      setReady(true);
      setGlbErr(null);
      // A cold engine can miss the first glb request: one quiet retry after 4 s before the error shows.
      const load = (n: number) => sc.loadGlb(glbUrl, (e) => {
        if (dead) return;
        if (e && n < 1) { retry = setTimeout(() => { if (!dead) load(n + 1); }, 4000); return; }
        setGlbErr(e); setGlbOk(!e);
      });
      load(0);
    });
    return () => { dead = true; if (retry) clearTimeout(retry); scene.current?.dispose(); scene.current = null; setReady(false); setGlbOk(false); prevLayer.current = 0; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantScene, glbUrl, reduce, retryGlb]);

  // A new design re-reads the planes; the scene keeps its glb and camera.
  // A new house bumps modelGen (camera, system and pose effects re-run); a new design on the same house does not.
  useEffect(() => { if (model && scene.current && ready) { if (scene.current.setModel(model)) setModelGen((x) => x + 1); } }, [model, ready]);

  const planes: RoofPlane[] = model?.planes ?? [];
  const panelList = useMemo(() => planes.filter((p) => p.is_target).flatMap((p) => p.chosen_panels.map((r: PanelRect) => ({ p, r }))), [planes]);
  const counts = useMemo(() => Object.fromEntries(planes.filter((p) => p.is_target).map((p) => [p.id, p.chosen_panels.length])), [planes]);
  // Flats: the heat load is not estimated (the chain says so), so there is no envelope to draw, no x-ray and no legend.
  const flat = !!model && isMultiUnit(model, inputs).multi;
  const envelope: Envelope | null = (!flat && model?.envelope && model.envelope.faces?.length ? model.envelope : null);
  const plan = model?.plan && model.plan.outline?.length ? model.plan : null;
  const ids = [1, 2, 3, 4, 5, 6, ...(envelope ? [7] : []), ...(plan ? [8] : [])];
  const nSteps = ids.length;
  const L = ids.includes(layer) ? layer : 1;
  // In 3D the Google mesh replaces the LoD2 house when it loads (PhotoView.tsx); never on the plan layer.
  // Ground picture and imagery dates for the layers menu (satGround.ts, whiteMode.ts).
  const groundOrigin = (model as unknown as { origin_utm32?: unknown } | null)?.origin_utm32;
  const groundKey = isOrigin(groundOrigin) ? groundOrigin.join(",") : "";
  // Handed to the scene whenever both exist, in any order; the scene starts it once its glb is in.
  useEffect(() => { if (ready && isOrigin(groundOrigin)) scene.current?.groundFor(groundOrigin); }, [ready, groundKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const l = layers as unknown as { imagery?: Imagery; planes?: { imagery?: Imagery } } | null; setImagery(l?.imagery ?? l?.planes?.imagery ?? null); }, [layers]);
  // Overlays marked data-cover inside the view (the number card, the shading strip) report their rects; each takes
  // the side of the canvas that costs the house least, and the scene fits the house into what is left. The free
  // area is also published as CSS variables (--free-l, --free-t, --free-w, --free-h) so a loading skeleton can sit
  // exactly where the house will appear.
  useEffect(() => {
    const v = viewEl.current, sc = scene.current;
    if (!v || !sc) return;
    const M = 8; // px between an overlay and the house
    const measure = () => {
      const V = v.getBoundingClientRect(), W = V.width, H = V.height;
      if (W < 2 || H < 2) return;
      const ins = { top: 0, right: 0, bottom: 0, left: 0 };
      v.querySelectorAll<HTMLElement>("[data-cover]").forEach((el) => {
        const r = el.getBoundingClientRect();
        const x0 = Math.max(0, r.left - V.left), x1 = Math.min(W, r.right - V.left), y0 = Math.max(0, r.top - V.top), y1 = Math.min(H, r.bottom - V.top);
        if (x1 - x0 < 4 || y1 - y0 < 4) return; // not over the model
        const opts: [keyof typeof ins, number, number][] = [];
        if (y0 <= H * 0.25) opts.push(["top", y1 + M, (y1 + M) * W]);
        if (y1 >= H * 0.75) opts.push(["bottom", H - y0 + M, (H - y0 + M) * W]);
        if (x0 <= W * 0.25) opts.push(["left", x1 + M, (x1 + M) * H]);
        if (x1 >= W * 0.75) opts.push(["right", W - x0 + M, (W - x0 + M) * H]);
        const best = opts.sort((a, b) => a[2] - b[2])[0];
        if (best) ins[best[0]] = Math.max(ins[best[0]], best[1]);
      });
      sc.setInsets(ins);
      const fw = Math.max(W * 0.45, W - ins.left - ins.right), fh = Math.max(H * 0.45, H - ins.top - ins.bottom);
      v.style.setProperty("--free-l", `${Math.min(ins.left, W - fw)}px`); v.style.setProperty("--free-t", `${Math.min(ins.top, H - fh)}px`);
      v.style.setProperty("--free-w", `${fw}px`); v.style.setProperty("--free-h", `${fh}px`);
    };
    let raf = 0;
    const soon = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(measure); };
    const ro = new ResizeObserver(soon);
    const watch = () => { ro.disconnect(); ro.observe(v); v.querySelectorAll("[data-cover]").forEach((el) => ro.observe(el)); soon(); };
    const mo = new MutationObserver(watch);
    mo.observe(v, { childList: true }); // overlays are direct children of the view; labels below never trigger it
    watch();
    return () => { cancelAnimationFrame(raf); ro.disconnect(); mo.disconnect(); };
  }, [ready]);

  const photo = usePhoto((model as unknown as { origin_utm32?: unknown } | null)?.origin_utm32, ready ? scene.current : null, view === "3d" && L !== 8, {
    creditBottom: bare ? 22 : 104, planes,
    snapKey: snapKey(leadId ?? "demo", layersKey, typeof window === "undefined" ? 1.6 : (host.current?.clientWidth ?? 16) / Math.max(1, host.current?.clientHeight ?? 10)),
  });

  // Panels change with the design: re-place them (animated only when the panels layer is showing).
  const panelKey = panelList.map(({ p, r }) => `${p.id}|${JSON.stringify(r)}`).join(";");
  useEffect(() => {
    const sc = scene.current;
    if (!sc || !ready) return;
    sc.setPanels(panelList, !reduce && L === 3, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelKey, ready, modelGen]);

  // Per-module shading (lib/shading.ts): tints only when the route is ready and the planner turned it on.
  const shading = useShading(address, kwp), shadeView = useShadeView();
  useEffect(() => { if (ready) scene.current?.setShading(shading, shadeView.on, shadeView.at); }, [shading, shadeView.on, shadeView.at, ready, panelKey, modelGen]);

  // Apply the layer.
  useEffect(() => {
    const sc = scene.current;
    if (!sc || !ready) return;
    const prev = prevLayer.current;
    prevLayer.current = L;
    sc.setHeat(null);
    if (L !== 7) sc.setXray(null);
    sc.show({ outlines: L <= 3, panels: L >= 3 && L !== 7, kit: L >= 4 && L <= 6, sun: L === 4, battery: L === 5 && !!design.battery_kwh ? "lit" : "plain" });
    sc.setTint(L === 2 || (sunTint && L === 3) ? "yield" : "off");
    sc.setWallbox(!!design.wallbox_kw);
    sc.setBattery(!!design.battery_kwh);
    sc.setBatteryKwh(design.battery_kwh);
    sc.setUnits({ inverter: !!design.inverter_kw, heatpump: !!design.heatpump_kw, layer: L >= 4 && L <= 7 });
    if (L === 3 && prev !== 3 && prev < 3) sc.setPanels(panelList, !reduce);
    if (L === 4 && layers) sc.setDay(layers.day.hours, !reduce); else sc.setDay(null, false);
    if (L === 1) sc.setLabels(sc.planeLabels("roof"));
    else if (L === 2) sc.setLabels(sc.planeLabels("sun"));
    else if (L === 3) { const all = Object.values(counts ?? {}).reduce((x, y) => x + y, 0); sc.setLabels(sc.planeLabels("panels", counts, all && design.pv_kwp ? design.pv_kwp / all : undefined)); }
    else if (L === 7) sc.setLabels(sc.setXray(envelope));
    else if (L === 5) {
      // Battery step: the battery carries its size; Wallbox step: the wallbox does, or nothing.
      const f = (x: number) => x.toLocaleString("en-GB", { maximumFractionDigits: 1 });
      // While the planner edits a unit on the model, its own control carries the size: no second label.
      const own = (k: string) => !!edit && !homeowner && editSys === k;
      const bt = stage !== "extras" && design.battery_kwh && !own("battery") ? `${f(design.battery_kwh)} kWh` : null;
      const wb = stage !== "storage" && design.wallbox_kw && !own("wallbox") ? `${f(design.wallbox_kw)} kW` : null;
      sc.setLabels(sc.kitLabels(bt, wb));
    }
    else sc.setLabels([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [L, ready, layers, panelKey, glbOk, !!envelope, modelGen, design.wallbox_kw, design.battery_kwh, design.inverter_kw, design.heatpump_kw, stage, sunTint, editSys]);

  // The plan layer is always top-down; the other layers keep the planner's choice.
  useEffect(() => { scene.current?.setView(L === 8 ? "2d" : view); scene.current?.setPlan(L === 8 ? plan : null); }, [view, ready, L, plan]);

  // Systems chips (systems.ts): the envelope is kept for the Heat pump x-ray, and the chosen system drives the layer
  // and the camera; null hands back to the layers above. The live scene goes to callers that drive it directly.
  useEffect(() => { if (ready) scene.current?.setEnvelope(envelope); }, [envelope, ready, modelGen]);
  useEffect(() => { if (ready && system !== undefined) scene.current?.setSystem(system); }, [system, ready, modelGen]);
  // The Systems chips (components/systems/system.ts) announce the choice as a window event "marquee:system"
  // { name } and keep the latest in window.__marqueeSystem; the scene follows it unless a system prop is given.
  useEffect(() => {
    if (!ready || system !== undefined) return;
    const ok = (n: unknown): n is System | null => n === null || n === "panels" || n === "battery" || n === "wallbox" || n === "heatpump";
    const apply = (n: unknown) => { if (ok(n)) { scene.current?.setSystem(n); setSysNow(n); } };
    const w = window as unknown as { __marqueeSystem?: unknown };
    if (w.__marqueeSystem !== undefined) apply(w.__marqueeSystem);
    const on = (e: Event) => apply((e as CustomEvent<{ name?: unknown }>).detail?.name ?? null);
    window.addEventListener("marquee:system", on);
    return () => window.removeEventListener("marquee:system", on);
  }, [ready, modelGen, system]);
  useEffect(() => { onScene?.(ready ? scene.current : null); }, [ready, modelGen, onScene]);

  // The camera follows the reasoning: each stage flies to its pose; the 2D/3D pill still overrides afterwards.
  // With a unit chip active the camera keeps that unit's wall (UNIT_POSES), not the stage's high view.
  useEffect(() => {
    if (!stage || !ready) return;
    const u = editSys === "battery" || editSys === "wallbox" || editSys === "heatpump" ? editSys : null;
    scene.current?.flyTo(u ? UNIT_POSES[u] : POSES[stage]);
  }, [stage, ready, modelGen, editSys]);

  // On-model editing: a slot tap adds or takes off one module and sends pv_kwp through the chooser's path.
  const faces = useMemo(() => (editLead && model ? model.planes.filter((p) => p.is_target).map(slotsOf) : []), [editLead, model]);
  const toggleSlot = useCallback((plane: string, i: number) => {
    if (!edit || !editLead) return;
    const now: Picks = Object.fromEntries(faces.map((f) => [f.plane.id, [...f.placed]]));
    const cur = now[plane] ?? [];
    now[plane] = cur.includes(i) ? cur.filter((x) => x !== i) : [...cur, i].sort((a, b) => a - b);
    const n = countOf(now);
    if (n < 1) return; // the design keeps at least one module; the chooser's None is not offered for solar either
    const kwp = Math.round(n * MODULE_WP) / 1000;
    setLive({ kwp, picks: now, until: Date.now() + 20000 });
    if (edit.setKit) edit.setKit({ pv_kwp: kwp, layout_slots: idsOf(now) });
    else edit.setOverride("pv_kwp", kwp);
  }, [edit, editLead, faces]);
  const setUnit = useCallback((f: keyof Design, v: OverrideValue) => edit?.setOverride(f, v), [edit]);

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
          eq: target.map((p) => `${p.pitch < 3 ? "flat" : `faces ${facing(p.azimuth)}`}, ${n1(p.area_m2)} m², ${Math.round(p.pitch)}° pitch`).join("; ") + ` → ${n1(area)} m² fits ${fit} modules`,
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
          eq: `${c ? `recommended ${n2(c.kwp)} kWp + ${n1(c.kwh)} kWh: €${n0(c.capex_eur)} → €${n0(c.npv_20y_eur)}` : ""}${best && best !== c ? `; best value ${n2(best.kwp)} kWp + ${n1(best.kwh)} kWh: ${n0(best.capex_eur)} EUR → ${n0(best.npv_20y_eur)} EUR` : ""}${alts.length ? `; ${alts.join("; ")}` : ""}${layers.objective.sentence ? `. ${layers.objective.sentence}` : ""}`,
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
    numbers.push({ k: "Autarky", v: pct(four.a), u: "" }, { k: "Investment", v: `€${n0(four.c)}`, u: "" }, { k: "Payback", v: four.p == null ? "none" : n1(four.p), u: four.p == null ? "" : "years" });
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

  // Zoom: a stacked + and − beside Face north; the scene clamps to the pinch and wheel limits and reports them.
  const zoomPair = (
    <div className={s.zoom} role="group" aria-label="Zoom">
      <button type="button" title="Zoom in" aria-label="Zoom in" disabled={!zoomCan.in} onClick={() => scene.current?.zoomBy(1)}>
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M7 2v10M2 7h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
      </button>
      <button type="button" title="Zoom out" aria-label="Zoom out" disabled={!zoomCan.out} onClick={() => scene.current?.zoomBy(-1)}>
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><path d="M2 7h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
      </button>
    </div>
  );
  // + and − on the keyboard do the same while the model has focus.
  const onKey = (e: ReactKeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement).closest("input, textarea, select, [contenteditable]")) return;
    const dir = e.key === "+" || e.key === "=" ? 1 : e.key === "-" || e.key === "−" || e.key === "_" ? -1 : 0;
    if (!dir) return;
    e.preventDefault(); scene.current?.zoomBy(dir as 1 | -1);
  };

  return (
    <section className={homeowner ? `${s.wrap} ${s.homeowner}` : s.wrap} aria-label="How the design is computed, over the house">
      {!bare && <div className={s.strip} style={{ ["--n" as string]: nSteps }} role="group" aria-label="Layers">
        {ids.map((id, i) => (
          <button key={id} type="button" className={s.step} aria-pressed={L === id} onClick={() => setLayer(id)}>
            <span className={s.k}>{i + 1}</span><span className={s.t}>{STEPS[id - 1]}</span>
          </button>
        ))}
      </div>}

      <div ref={viewEl} className={bare ? `${s.view} ${s.bareView}` : s.view}>
        <div ref={host} className={s.host} tabIndex={0} aria-label="3D model of the house; plus and minus zoom" onKeyDown={onKey} />
        <svg ref={svg} className={s.flows} aria-hidden="true" />
        <div ref={overlay} className={s.overlay} aria-hidden="true" />
        {photo.under}
        {!ready && !absent && !layersErr && <>
          <svg className={s.houseSkel} viewBox="0 0 240 160" aria-hidden><defs><linearGradient id="hsk" x1="0" x2="1"><stop offset="0" stopColor="#e3e6ef" /><stop offset="0.5" stopColor="#f3f4f8" /><stop offset="1" stopColor="#e3e6ef" /><animate attributeName="x1" values="-1;1" dur="1.2s" repeatCount="indefinite" /><animate attributeName="x2" values="0;2" dur="1.2s" repeatCount="indefinite" /></linearGradient></defs><path d="M30 84 L120 24 L210 84 V148 H30 Z" fill="url(#hsk)" /></svg>
        </>}
        {glbErr && <div className={s.err}>{glbErr}<button type="button" onClick={() => setRetryGlb((x) => x + 1)}>Retry</button></div>}
        {layersErr && <div className={s.err}>{layersErr}<button type="button" onClick={() => setTryN((x) => x + 1)}>Retry</button></div>}

        {!bare && !homeowner && (numbers.length > 0 || check) && (
          <div className={s.nwrap} data-cover>
            {numbers.length > 0 && (
              <dl className={s.numbers}>
                {numbers.map((x) => <div key={x.k}><dt>{x.k}</dt><dd>{x.v}{x.u && <span>{x.u}</span>}</dd></div>)}
              </dl>
            )}
            {check && <p className={check.bad ? `${s.check} ${s.bad}` : s.check} role={check.bad ? "alert" : undefined}>{check.text}</p>}
          </div>
        )}

        {bare && tools?.({ view: L === 8 ? "2d" : view, setView: (v) => { setView(v); if (v === "3d" && L === 8) setLayer(3); }, recentre: () => scene.current?.refit(),
          // Photo: the third view, offered while the Google mesh can show here; picking it is the 3D view with the mesh.
          photo: photo.possible || photo.want ? { on: photo.want && view === "3d" && L !== 8, set: (on: boolean) => { photo.setOn(on); if (on) { setView("3d"); if (L === 8) setLayer(3); } } } : undefined,
          // One toolbar: zoom and Face north ride in the caller's toolbar row (the needle keeps this view's ref).
          zoom: { can: zoomCan, by: (d) => scene.current?.zoomBy(d) },
          north: <button type="button" className={s.compass} title="Face north" aria-label="Face north" onClick={() => scene.current?.faceNorth()}><div ref={compass} className={s.needle}><i />N</div></button> })}
        {bare && !tools && <div className={`${s.tools} ${s.toolsBare}`}>{zoomPair}<button type="button" className={s.compass} title="Face north" aria-label="Face north" onClick={() => scene.current?.faceNorth()}><div ref={compass} className={s.needle}><i />N</div></button></div>}
        {!bare && <div className={s.tools}>
          <div className={s.toggle} role="group" aria-label="View">
            <button type="button" aria-pressed={L !== 8 && view === "3d"} onClick={() => { setView("3d"); if (L === 8) setLayer(3); }}>3D</button>
            <button type="button" aria-pressed={L === 8 || view === "2d"} onClick={() => setView("2d")}>2D</button>
          </div>
          <LayersMenu className={s.layersBtn} />
          <button type="button" className={s.compass} title="Reset view" aria-label="Reset view" onClick={() => scene.current?.refit()}>
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 7H3V3M3.5 7A7 7 0 1110 17" /></svg>
          </button>
          {zoomPair}
          <button type="button" className={s.compass} title="Face north" aria-label="Face north" onClick={() => scene.current?.faceNorth()}><div ref={compass} className={s.needle}><i />N</div></button>
        </div>}

        {!bare && L === 2 && (
          <div className={s.legend}>
            <div className={s.bar} style={{ background: "linear-gradient(90deg, #F4F1EA, #0D1BFE)" }} />
            <div className={s.ends}><span>{n0(Math.min(...planes.map((p) => p.yield_shaded_kwh_per_kwp ?? p.yield_kwh_per_kwp)))}</span><span>{n0(Math.max(...planes.map((p) => p.yield_shaded_kwh_per_kwp ?? p.yield_kwh_per_kwp)))} kWh/kWp</span></div>
          </div>
        )}
        {!bare && L === 7 && envelope && (
          <div className={s.legend}>
            <div className={s.bar} style={{ background: "linear-gradient(90deg, #F4F1EA, #E8730C)" }} />
            <div className={s.ends}><span>less</span><span>more W per m²</span></div>
          </div>
        )}
        {!bare && L === 4 && layers && <div className={s.clock} aria-live="off">{hh(hour.h)}</div>}
        {!bare && chart && <div className={s.side}>{chart}</div>}
        {!bare && <ShadingPanel address={address} kwp={kwp} float />}
        {photo.overlay}
        {editLead && ready && scene.current && view === "3d" && L !== 8 && !photo.on && (
          <EditLayer scene={scene.current} sys={editSys} faces={faces} design={design} onToggle={toggleSlot} onSet={setUnit} />
        )}
        {children}
      </div>

      {!bare && <div className={s.caption}>
        {content ? <p className={s.sentence}>{content.sentence}</p> : null}
        {content && "second" in content && content.second ? <p className={s.sentence}>{content.second}</p> : null}
        {L === 4 && layers && (
          <div className={s.ctl}>
            {!reduce && <button type="button" onClick={() => { if (hour.playing) { scene.current?.pause(); setHour((x) => ({ ...x, playing: false })); } else { scene.current?.play(); setHour((x) => ({ ...x, playing: true })); } }}>{hour.playing ? "Pause" : "Play the day"}</button>}
            <input type="range" min={0} max={Math.max(0, layers.day.hours.length - 1)} step={1} value={Math.min(layers.day.hours.length - 1, Math.round(hour.h))} onChange={(ev) => seek(Number(ev.target.value))} aria-label="Hour of the day" />
          </div>
        )}
        {chart && <div className={s.below}>{L === 5 ? <BatteryChart layers={layers!} battery={design.battery_kwh} reduce={reduce} /> : <FrontierChart frontier={layers!.frontier} />}</div>}
        {content && !homeowner && <p className={s.eq}>{content.eq}</p>}
        {content && !homeowner && "items" in content && content.items && content.items.length > 0 && <ul className={s.items}>{content.items.map((x) => <li key={x}>{x}</li>)}</ul>}
        {content && !homeowner && content.sources.length > 0 && (
          <p className={s.sources}>Sources: {content.sources.map((x, i) => <span key={x.key}>{i ? "; " : ""}{x.url ? <a href={x.url} target="_blank" rel="noreferrer">{x.citation}</a> : x.citation}</span>)}</p>
        )}
      </div>}
    </section>
  );
}
