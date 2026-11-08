"use client";
// The open card's reasoning chain: the house is the hero for the whole page, eight stages build on it.
// Each stage adds one sentence to the rail, a working-shown bar or check list where the engine has one,
// and moves the camera to the part of the house it explains. A change re-runs the chain from the stage it moved.
import { isValidElement, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import dynamic from "next/dynamic";
import type { DesignResponse, HomeInputs, ComponentKey } from "@/lib/api";
import { INSTALLER_NAME } from "@/lib/api";
import type { Layers, Bar, Check, RoofModel } from "@/components/spatial/types";
import LayersMenu from "@/components/spatial/LayersMenu";
import { findRot, rotLine } from "@/lib/rot";
import { isMultiUnit } from "@/lib/building";
import { setShadeOn, useShading } from "@/lib/shading";
import { POSES, type StageView } from "@/components/spatial/camera";
import type { Variant } from "@/components/stage/Plan";
import House from "@/components/stage/House";
import Why from "@/components/stage/Why";
import s from "./chain.module.css";
import OfferPanel, { type OfferProps } from "@/components/offer/OfferPanel";
import ShadingPanel from "@/components/spatial/ShadingScrubber";
import { EnvelopeBar, HeatPumpStep } from "@/components/spatial/EnvelopeBar";
import SystemsChips from "@/components/systems/SystemsChips";
import ProposedCard from "@/components/systems/ProposedCard";
import SystemCard from "@/components/systems/SystemCard";
import { elementsOf } from "@/lib/envelope";
import { scrub } from "@/components/offer/facts";
import { Chainline, Fig, Head, PairBars, SplitBar } from "@/components/systems/Figures";
import { setSystem, stageOf, systemOf, type SystemName } from "@/components/systems/system";

// While the 3D code loads, the hero shows the same house shimmer the view shows until its first frame.
const SpatialDemo = dynamic(() => import("@/components/spatial/SpatialDemo"), { ssr: false, loading: () => <HouseSkel /> });

const n0 = (x: number) => Math.round(x).toLocaleString("en-GB");
const n1 = (x: number) => (Math.round(x * 10) / 10).toLocaleString("en-GB");
const n2 = (x: number) => (Math.round(x * 100) / 100).toLocaleString("en-GB");
const pc = (x: number) => `${Math.round(x * 100)} %`;
const eur = (x: number) => `${x < 0 ? "-" : ""}€${n0(Math.abs(x))}`;

// Four components and the offer, in Reonic's names and colours; the old eight-stage path stays behind NEXT_PUBLIC_CHAIN=8.
const FIVE = process.env.NEXT_PUBLIC_CHAIN !== "8";
const TITLES = FIVE ? ["Panels", "Battery storage", "Wallbox", "Heat pump", "Offer"] : ["Site", "Load", "Future", "Solar", "Storage", "Extras", "Sanity", "Offer"];
const VIEWS: StageView[] = FIVE ? ["solar", "storage", "extras", "heatpump", "offer"] : ["site", "load", "future", "solar", "storage", "extras", "sanity", "offer"];
const BAR_AT: Record<Bar["key"], number> = FIVE ? { roof: 1, day: 2, charging: 3, heat_loss: 4 } : { roof: 1, heat_loss: 3, day: 5, charging: 6 };
const WHY_AT: Partial<Record<number, ComponentKey>> = FIVE ? { 1: "pv", 2: "battery", 3: "wallbox", 4: "heatpump" } : { 4: "pv", 5: "battery", 6: "wallbox" };
const N = TITLES.length;
// Systems hero: four chips drive the model, the offer is a tucked pass; NEXT_PUBLIC_SYSTEMS=0 brings back the step rail.
const SYS = FIVE && process.env.NEXT_PUBLIC_SYSTEMS !== "0";
const CHECK_AT = FIVE ? 5 : 7;
const STEP_COLOUR = ["#ffc043", "#24a148", "#1c71ef", "#e3634f", "#071b71"];
const stepStyle = (i: number) => ({ ["--step" as string]: STEP_COLOUR[i], ["--step-ink" as string]: i === 0 ? "#071b71" : "#fff" }) as CSSProperties;
const TAG: Record<string, string> = { lead: "lead", rina: "Rina", address: "address", default: "assumed" };
// One muted palette for every bar, in Reonic's heat-load order; component colours where the segment is a component.
const PALETTE = ["#f5c35a", "#5b8def", "#4fb477", "#a58bea", "#e3634f", "#f0924a", "#a1a1aa", "#71717b"];
const SEG_COLOUR: Record<string, string> = {
  "Outer walls": "#f5c35a", Windows: "#5b8def", Floor: "#4fb477", Roof: "#e3634f", Ventilation: "#f0924a", "Thermal bridges": "#a58bea",
  "solar-covered": "#ffc043", "from the battery": "#24a148", "from the grid": "#071b71",
};

type Props = {
  res: DesignResponse; prev: DesignResponse | null; inputs: HomeInputs; leadId?: string | null;
  pending?: number | null; cause?: string | null;   // an edit waiting on the engine (since); what made the design on screen
  variants: Variant[]; onVariant: (v: Variant) => void; canUndo: boolean; onUndo: () => void; decide?: ReactNode;
  redraft?: unknown;   // changes on every refinement (sentence, hand change, call step); a new design without one is not a redraft
  answered: boolean;
};

// Phone width: the Offer panel docks under the model instead of beside it (same break as chain.module.css).
function useNarrow() {
  const [r, setR] = useState(false);
  useEffect(() => { const m = matchMedia("(max-width: 760px)"); setR(m.matches); const f = () => setR(m.matches); m.addEventListener("change", f); return () => m.removeEventListener("change", f); }, []);
  return r;
}

function useReduce() {
  const [r, setR] = useState(false);
  useEffect(() => { const m = matchMedia("(prefers-reduced-motion: reduce)"); setR(m.matches); const f = () => setR(m.matches); m.addEventListener("change", f); return () => m.removeEventListener("change", f); }, []);
  return r;
}

export default function Chain({ res, prev, inputs, leadId, pending = null, cause = null, variants, onVariant, canUndo, onUndo, answered, decide, redraft }: Props) {
  const reduce = useReduce();
  const causeRef = useRef(cause); causeRef.current = cause;
  // A change made from the Offer panel or Undo keeps the planner in the Offer: no stage or camera move on the re-run.
  const hold = useRef(0);
  const holdOffer = () => { hold.current = Date.now(); };
  // Draft first: the chain plays once, on the first open of a lead; after that the design is there at once and the
  // chain waits as a collapsed strip under the model.
  const [first] = useState(() => {
    if (!leadId) return true;
    try { return !localStorage.getItem(`marquee.chain.seen.${leadId}`); } catch { return true; }
  });
  useEffect(() => { if (leadId) try { localStorage.setItem(`marquee.chain.seen.${leadId}`, "1"); } catch { /* storage blocked: the chain plays again next time */ } }, [leadId]);
  const [expanded, setExpanded] = useState(true);   // step cards always shown; the eye in the toolbar folds them
  const [stage, setStage] = useState(SYS || first ? 1 : N);
  const [auto, setAuto] = useState(first && !SYS);
  const [updated, setUpdated] = useState<number | null>(null);
  const [layers, setLayers] = useState<Layers | null>(null);
  const [moved, setMoved] = useState<Set<number>>(new Set());
  const [spatial, setSpatial] = useState<boolean | null>(null);
  const [heatmap, setHeatmap] = useState(false);
  // Panels: the sun heatmap is the roof layer under the modules, on by default; elsewhere the heatmap is its own layer.
  const [panelHeat, setPanelHeat] = useState(true);
  const [why, setWhy] = useState<{ k: ComponentKey; level: number } | null>(null);
  const [whyStep, setWhyStep] = useState<number | null>(null);
  const lastLayers = useRef<Layers | null>(null);
  const consumed = useRef<unknown>(redraft);
  const redraftRef = useRef<unknown>(redraft); redraftRef.current = redraft;
  const rootRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLDivElement>(null);
  // Phone: the step strip sticks just under the sticky house, whatever height the house has on this step.
  useEffect(() => {
    const h = heroRef.current, r = rootRef.current;
    if (!h || !r) return;
    const ro = new ResizeObserver(() => r.style.setProperty("--hero-h", `${Math.round(h.getBoundingClientRect().height)}px`));
    ro.observe(h);
    return () => ro.disconnect();
  }, []);
  // One screen on desktop: the chain takes the height left under the top bar.
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const fit = () => {
      const top = el.getBoundingClientRect().top + window.scrollY; el.style.setProperty("--chain-top", `${Math.round(top + 12)}px`);
      // Systems on a phone: the model runs from its own top to the tucked pass, measured, never under it.
      const h = heroRef.current;
      if (h) {
        const peek = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--pc-peek")) || 76;
        el.style.setProperty("--sys-hero-h", `${Math.round(window.innerHeight - (h.getBoundingClientRect().top + window.scrollY) - peek)}px`);
      }
    };
    fit();
    const ro = new ResizeObserver(fit); ro.observe(document.body);
    // The header and the facts bar above settle after mount (fonts, facts, the compact Systems layout): re-measure then.
    document.querySelectorAll(".b-open-h, .t-bar").forEach((x) => ro.observe(x));
    addEventListener("resize", fit); addEventListener("orientationchange", fit); window.visualViewport?.addEventListener("resize", fit);
    const mo = new MutationObserver(fit); mo.observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });   // --pc-peek lands later
    return () => { ro.disconnect(); mo.disconnect(); removeEventListener("resize", fit); removeEventListener("orientationchange", fit); window.visualViewport?.removeEventListener("resize", fit); };
  }, []);
  const address = inputs.address ?? inputs.roof?.matched_address;
  const installer = INSTALLER_NAME[inputs.installer_id as keyof typeof INSTALLER_NAME] ?? "this installer";

  // The chain builds one stage at a time; a tap on the rail takes over.
  useEffect(() => {
    if (!auto || stage >= N) return;
    const t = setTimeout(() => setStage((x) => Math.min(N, x + 1)), reduce ? 900 : 1700);
    return () => clearTimeout(t);
  }, [auto, stage, reduce]);

  // Without a 3D model the scene never mounts; the bars, checks and economics still come from the engine.
  const flat = !address || spatial === false;
  const flatKey = flat ? JSON.stringify([inputs, res.design]) : "";
  useEffect(() => {
    if (!flat) return;
    const ac = new AbortController();
    fetch("/api/explain/layers", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ inputs: { ...inputs, ...(address ? { address } : {}) }, design: res.design, ...(leadId ? { lead_id: leadId } : {}) }), signal: ac.signal })
      .then((r) => (r.ok ? r.json() : null)).then((l) => { if (l) onLayers(l as Layers); }).catch(() => {});
    return () => ac.abort();
  }, [flatKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // A new layers response after a change: mark the stages it moved and re-run the chain from the first one.
  function onLayers(l: Layers) {
    const was = lastLayers.current;
    lastLayers.current = l;
    setLayers(l);
    if (!was) return;
    const m = new Set<number>();
    const bk = (x: Layers) => Object.fromEntries((x.bars ?? []).map((b) => [b.key, JSON.stringify([b.total, b.segments.map((g) => g.value)])]));
    const a = bk(was), b = bk(l);
    (Object.keys(BAR_AT) as Bar["key"][]).forEach((k) => { if (a[k] !== b[k]) m.add(BAR_AT[k]); });
    if (JSON.stringify(was.checks) !== JSON.stringify(l.checks)) m.add(CHECK_AT);
    if (JSON.stringify(was.economics?.capex_eur) !== JSON.stringify(l.economics?.capex_eur) || was.economics?.autarky_share !== l.economics?.autarky_share) m.add(N);
    const d0 = was.chosen, d1 = l.chosen;
    if (d0 && d1) {
      if (d0.pv_kwp !== d1.pv_kwp) m.add(FIVE ? 1 : 4);
      if (d0.battery_kwh !== d1.battery_kwh) m.add(FIVE ? 2 : 5);
      if (d0.wallbox_kw !== d1.wallbox_kw) m.add(FIVE ? 3 : 6);
      if (d0.heatpump_kw !== d1.heatpump_kw) m.add(FIVE ? 4 : 6);
    }
    if (JSON.stringify(was.ev ?? null) !== JSON.stringify(l.ev ?? null)) { if (FIVE) { m.add(1); m.add(3); } else { m.add(2); m.add(3); } }
    if (!m.size || redraftRef.current === consumed.current) return;
    consumed.current = redraftRef.current;
    // A refinement redrafts in place: the changed layers light up and the camera goes to the first; no replay.
    setMoved(m);
    // A variant switch stays on the Offer; the strip lights what changed, the view does not move.
    if (!/^(Switched to|Undone)/.test(causeRef.current ?? "") && Date.now() - hold.current > 15000 && !(SYS && Math.min(...m) > 4)) setStage(Math.min(...m));
    setAuto(false);
    setUpdated(Date.now());
  }

  const model: RoofModel | null = layers ? (Array.isArray(layers.planes) ? null : layers.planes) : null;
  // A flat in an apartment block: the roof and the envelope are the building's, not the household's.
  const building = model ? isMultiUnit(model, inputs) : null, multi = !!building?.multi;
  const hasEnv = !multi && !!model?.envelope?.faces?.length;
  useEffect(() => {
    if (!building) return;
    dispatchEvent(new CustomEvent("marquee:building", { detail: { leadId: leadId ?? null, multi: building.multi, reason: building.reason } }));
  }, [building?.multi, building?.reason, leadId]); // eslint-disable-line react-hooks/exhaustive-deps
  // Per-panel shading lives on Panels only: it turns on there and fades out when the planner moves on.
  const shading = useShading(address, res.design.pv_kwp);
  const onPanels = FIVE && stage === 1;
  useEffect(() => { if (FIVE && !onPanels) setShadeOn(false); }, [onPanels]);
  // The planner's pick on the model (3D or Photo over the plan) holds until the stage changes.
  const [pick, setPick] = useState<{ stage: number; layer: number } | null>(null);
  const heatLayer = heatmap && !onPanels;
  const layer = heatLayer ? 2 : pick && pick.stage === stage ? pick.layer : (SYS ? [3, 5, 5, hasEnv ? 7 : 3, 3] : FIVE ? [3, 5, 5, hasEnv ? 7 : 1, 3] : [1, 4, hasEnv ? 7 : 1, 3, 5, 5, 3, 3])[stage - 1];
  const bars = useMemo(() => Object.fromEntries((layers?.bars ?? []).map((b) => [BAR_AT[b.key], b])) as Record<number, Bar>, [layers]);
  // The four numbers come from the same run as the bars and checks when it is in; the design's own until then.
  const d0 = res.design as unknown as Record<string, unknown>;
  const fresh = !layers?.chosen || (["pv_kwp", "battery_kwh", "wallbox_kw", "heatpump_kw"] as const).every((k) => (Number((layers.chosen as unknown as Record<string, unknown>)[k]) || 0) === (Number(d0[k]) || 0));
  const le = fresh ? layers?.economics : undefined;
  const e = le ? { ...res.economics, ...le, annual: { ...res.economics.annual!, ...(le.annual ?? {}) } } as typeof res.economics : res.economics, a = e.annual;
  const breakEven = le?.break_even_year ?? (e as { break_even_year?: number | null }).break_even_year ?? null;
  const d = res.design;
  const rot = rotLine(findRot(res.components.pv?.derivation, layers, res));

  const checkHead = (() => { const c = layers?.checks ?? []; const bad = c.filter(isFail).length, out = c.filter(refOut).length; return c.length ? (bad ? `${bad} of ${c.length} checks flag` : out ? "Checks pass; battery above Reonic’s guide" : `All ${c.length} checks pass`) : "Checks"; })();
  const rule = (k: string) => res.rules?.find((r) => r.name === k);
  // Modules in the design on screen: the same placed panels the face chips count, and only once the layers run is the
  // one for this design (a variant switch would otherwise show the old count against the new size).
  const placed = model?.planes?.filter((p) => p.is_target).reduce((x, p) => x + (p.chosen_panels?.length ?? 0), 0) || model?.layout?.panels || 0;
  const mods = fresh && placed ? `, ${placed} modules` : "";
  const head5: string[] = [
    `${n2(d.pv_kwp ?? 0)} kWp${mods}${multi ? ", shared roof" : ""}`,
    d.battery_kwh ? `${n1(d.battery_kwh)} kWh` : "None",
    d.wallbox_kw ? `${n1(d.wallbox_kw)} kW` : inputs.has_ev ? "None" : "None, no EV",
    multi ? "Heat load not estimated for flats" : d.heatpump_kw ? `${n1(d.heatpump_kw)} kW` : SYS ? "No heat pump in this design" : "None",
    `${eur(e.capex_eur)}${breakEven ? `, break-even in ${breakEven} years` : ""}`,
  ];
  const head8: string[] = [
    bars[1] ? (() => { const f = bars[1].segments.filter((g) => g.unit === "kWp").length; return `${n2(bars[1].total)} kWp on ${f} face${f === 1 ? "" : "s"}${multi ? ", shared roof" : ""}`; })() : address && spatial !== false ? "Roof being measured" : address ? "No 3D model here, roof assumed standard face" : "No street given, roof assumed standard face",
    `${n0(inputs.annual_demand_kwh ?? 0)} kWh a year${layers?.ev ? ` plus ${n0(layers.ev.annual_kwh)} kWh for the car` : ""}`,
    `${inputs.has_ev ? `Electric car${inputs.ev_annual_km ? `, ${n0(inputs.ev_annual_km)} km a year` : ""}` : "No electric car planned"}${multi ? "; heat load not estimated for flats" : model?.envelope ? `; heat load up to ${n1(model.envelope.design_heat_load_kw)} kW` : ""}`,
    `${n2(d.pv_kwp ?? 0)} kWp${mods}`,
    d.battery_kwh ? `${n1(d.battery_kwh)} kWh battery` : "No battery",
    [d.wallbox_kw ? `${n1(d.wallbox_kw)} kW wallbox` : "No wallbox", d.heatpump_kw ? `${n1(d.heatpump_kw)} kW heat pump` : "no heat pump"].join(", "),
    checkHead,
    `${eur(e.capex_eur)}${breakEven ? `, break-even in ${breakEven} years` : ""}`,
  ];
  const head = FIVE ? head5 : head8;
  // Panels, behind Why: what the roof takes against what the house will use, and the size against the cap.
  const useBar: Bar = { key: "roof", title: "Use", unit: "kWh", total: (inputs.annual_demand_kwh ?? 0) + (layers?.ev?.annual_kwh ?? 0),
    segments: [{ name: "household", value: inputs.annual_demand_kwh ?? 0, unit: "kWh", source_tag: "lead" }, ...(layers?.ev ? [{ name: "electric car", value: layers.ev.annual_kwh, unit: "kWh", source_tag: "default" as const }] : [])],
    sentence: layers?.ev ? "Sized for today's use plus the car." : "Sized for today's use.", sources: [] };
  const capKwp = Number(rule("cap")?.sentence.match(/(\d+)\s*kWp/)?.[1] ?? 30);
  const shade = layers?.checks?.find((c) => /shad/i.test(c.name));
  const ratio = d.battery_kwh && d.pv_kwp ? d.battery_kwh / d.pv_kwp : null;
  // Level two of each step card: one plain sentence why. Research (similar designs, sources, rules) lives behind Why.
  const plain = (t?: string | null) => {
    const f = t?.split(/(?<=\.)\s/)[0]?.trim();
    return f && f.length <= 150 && !/installer|signed|similar|tolerance|source|rule of thumb/i.test(f) ? f : null;
  };
  // Heat pump info block: the engine's reason only when it says why there is none; a reason about unknown sizing
  // inputs (boiler age, demand) does not explain the absence.
  const hpWhy = (() => {
    const r = res.components.heatpump?.reason?.replace(/^No heat pump[:,]\s*/i, "").trim();
    if (!r || /not known|unknown|age|siz|estimat|demand|bill/i.test(r)) return null;
    return plain(r.replace(/^./, (x) => x.toUpperCase()));
  })();
  const faces = bars[1] ? bars[1].segments.filter((g) => g.unit === "kWp").length : 0;
  const line2: Record<number, string | null> = {
    1: a ? `About ${n0(a.pv_yield_kwh)} kWh a year${faces ? ` from ${faces} face${faces === 1 ? "" : "s"}` : ""}, for a home using ${n0((inputs.annual_demand_kwh ?? 0) + (layers?.ev?.annual_kwh ?? 0))} kWh${layers?.ev ? " including the car" : ""}.${res.roof?.stated_direction_conflict ? ` ${res.roof.note ?? res.explanation.find((x) => /^Roof measured from the building model/.test(x)) ?? "Roof measured from the building model; the stated direction was not found."}` : ""}` : null,
    2: d.battery_kwh ? plain(bars[2]?.sentence) ?? "Carries the midday surplus into the evening." : "No battery in this design.",
    3: d.wallbox_kw ? plain(bars[3]?.sentence) ?? `Charges the car at home, ${n0(layers?.ev?.annual_kwh ?? 0)} kWh a year.` : inputs.has_ev ? "No wallbox in this design." : "No electric car, so no wallbox.",
    4: d.heatpump_kw ? "Sized from the heating bill." : !SYS ? "Not asked for." : hpWhy ?? "Heating facts not asked yet.",
  };


  // Systems: Heat pump looks from high in the south (as scene.setSystem does) so the whole kit stays in view.
  const view: StageView = SYS && stage === 4 ? "heat" : VIEWS[stage - 1];

  // One call per chip: the scene frames the system and shows its layer (scene.setSystem on branch layers).
  useEffect(() => { if (SYS) setSystem(systemOf(stage)); }, [stage]);

  const go = (n: number) => { setAuto(false); setStage(n); setWhy(null); setWhyStep(null); };
  // Phone strip tap: the other cards fold first, then the tapped card lands right under the pinned house and strip
  // (scroll-margin in the CSS); a second pass once the fold has settled corrects for the height it gave back.
  const toStep = (n: number) => {
    const el = () => rootRef.current?.querySelector<HTMLElement>(`[data-step="${n}"]`);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      el()?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
      setTimeout(() => el()?.scrollIntoView({ behavior: "auto", block: "start" }), reduce ? 0 : 450);
    }));
  };

  const tools = ({ view: v, setView, recentre, photo, zoom, north }: { view: "3d" | "2d"; setView: (x: "3d" | "2d") => void; recentre: () => void; photo?: { on: boolean; set: (on: boolean) => void }; zoom?: { can: { in: boolean; out: boolean }; by: (d: 1 | -1) => void }; north?: ReactNode }) => (
    <div className={s.toolbar} role="toolbar" aria-label="Model" data-cover>
      <LayersMenu className={s.tb} up heatmap={onPanels ? { on: panelHeat, set: setPanelHeat } : { on: heatmap, set: setHeatmap }} />
      {/* Reset view: back to the selected chip's pose (or the opening view) on the camera spring. View only: design Undo lives beside Approve. */}
      <button type="button" className={s.tb} onClick={recentre} title="Reset view" aria-label="Reset view"><Ico><path d="M7 7H3V3M3.5 7A7 7 0 1110 17" /></Ico></button>
      <button type="button" className={s.tb} aria-pressed={expanded} title="Reasoning" aria-label="Reasoning" onClick={() => { setAuto(false); setExpanded((x) => !x); }}>
        <Ico>{expanded ? <><path d="M1.5 10S5 4 10 4s8.5 6 8.5 6-3.5 6-8.5 6-8.5-6-8.5-6z" /><circle cx="10" cy="10" r="2.5" /></> : <><path d="M1.5 10S5 4 10 4s8.5 6 8.5 6-3.5 6-8.5 6-8.5-6-8.5-6z" /><circle cx="10" cy="10" r="2.5" /><path d="M3 17L17 3" /></>}</Ico>
      </button>
      {zoom && <>
        <button type="button" className={s.tb} onClick={() => zoom.by(-1)} disabled={!zoom.can.out} title="Zoom out" aria-label="Zoom out"><Ico><path d="M4 10h12" /></Ico></button>
        <button type="button" className={s.tb} onClick={() => zoom.by(1)} disabled={!zoom.can.in} title="Zoom in" aria-label="Zoom in"><Ico><path d="M10 4v12M4 10h12" /></Ico></button>
      </>}
      {north && <span className="tb-north">{north}</span>}
      <div className={s.seg} role="group" aria-label="View">
        <button type="button" aria-pressed={v === "2d"} onClick={() => { photo?.set(false); setView("2d"); }}>2D</button>
        <button type="button" aria-pressed={v === "3d" && !photo?.on} onClick={() => { photo?.set(false); setView("3d"); }}>3D</button>
        {photo && <button type="button" aria-pressed={photo.on} onClick={() => photo.set(true)}>Photo</button>}
      </div>
    </div>
  );

  // The Offer panel: beside the house on desktop (cover, so the house fits left of it), under the model on a phone.
  // Overrides and Approve come from the decide element Stage already passes, so Stage itself stays untouched.
  const dp = (isValidElement(decide) ? decide.props : null) as Partial<Pick<OfferProps, "overrides" | "setOverride" | "approvedAt" | "onApprove">> | null;
  const narrow = useNarrow();
  const offer = (docked: boolean) => (
    <OfferPanel docked={docked} res={res} economics={e} breakEven={breakEven} cause={cause} pending={!!pending}
      variants={variants} onVariant={(v) => { holdOffer(); onVariant(v); }} checks={roofFitKnown(layers?.checks ?? null, inputs.address)} checksFresh={fresh} model={model} leadId={leadId} inputs={inputs}
      undo={{ can: canUndo, run: () => { holdOffer(); onUndo(); } }} overrides={dp?.overrides ?? {}} setOverride={(f, v) => { holdOffer(); dp?.setOverride?.(f, v); }} approvedAt={dp?.approvedAt ?? null} onApprove={dp?.onApprove ?? (() => {})} />
  );
  // The step cards; with the Systems hero only the chosen system's card shows, as its info block.
  const rail = expanded && (
    <ol className={s.rail} aria-label="How the design was reached">
        {TITLES.map((t, i) => {
          const n = i + 1, open = n === stage, built = n <= stage || !auto;
          if (SYS && n !== stage) return null;
          const bar = bars[n];
          return (
            <li data-step={n} key={moved.has(n) ? `${t}-m${updated}` : t} className={`${s.item} ${open ? s.open : ""} ${built ? "" : s.pending} ${moved.has(n) ? s.flash : ""}`} style={FIVE ? stepStyle(i) : undefined}>
              <button type="button" className={s.ih} onClick={() => go(n)} aria-expanded={open}>
                <span className={s.num}>{n}</span>
                <span className={s.it}>{t}{multi && FIVE && (n <= 2 || n === N) && <span className={s.flatTag}>Single-family figure</span>}</span>
                <span className={s.ihead} data-pending={!!pending || !fresh}>{head[i]}</span>
              </button>
              {built && bar && !(FIVE && open && n <= 4) && !(FIVE && n === 3 && !d.wallbox_kw && !layers?.ev) && !(FIVE && n === 4 && (multi || (open && hasEnv))) && (open ? <BarView bar={FIVE && n === 1 && shading ? { ...bar, segments: [...bar.segments, { name: "lost to shade", value: Math.round(shading.total.loss_kwh_year), unit: "kWh a year", source_tag: "address", citation: shading.source }] } : bar} /> : <BarStrip bar={bar} />)}
              {FIVE && open && n <= 4 && (
                <div className={s.three}>
                  {multi && (n === 1 || n === 4) ? (
                    <p className={s.l2}>{n === 1 ? "Shared roof, apartment building: the single-family design does not apply." : "The walls and roof are the whole building's, so no heat pump size for one flat."}</p>
                  ) : (
                    <>
                      {line2[n] && <p className={s.l2} data-pending={!!pending || !fresh}>{line2[n]}</p>}
                      {n <= 3 && bar && !(n === 3 && !d.wallbox_kw && !layers?.ev) && <BarView bar={n === 1 && shading ? { ...bar, segments: [...bar.segments, { name: "lost to shade", value: Math.round(shading.total.loss_kwh_year), unit: "kWh a year", source_tag: "address", citation: shading.source }] } : bar} bare />}
                      {n === 4 && hasEnv && <EnvelopeBar env={model!.envelope!} bare />}
                    </>
                  )}
                  {!(n === 3 && !(WHY_AT[n] && res.components[WHY_AT[n]!]?.derivation)) && <div className={s.whyrow}>
                    <button type="button" className={s.whyb} aria-expanded={whyStep === n} onClick={() => { setWhyStep((w) => (w === n ? null : n)); setWhy(WHY_AT[n] && res.components[WHY_AT[n]!]?.derivation ? { k: WHY_AT[n]!, level: 1 } : null); }}>Why</button>
                  </div>}
                  {whyStep === n && (
                    <div className={s.whyPanel}>
                      {n === 1 && <>
                        <BarView bar={useBar} />
                        <p>{n2(d.pv_kwp ?? 0)} kWp{(d.pv_kwp ?? 0) <= capKwp ? `, inside the ${capKwp} kWp residential cap` : `, above the ${capKwp} kWp residential cap`}{shade && typeof shade.value === "number" ? `; shade ${n1(shade.value * 100)} %${shade.class ? `, ${shade.class}` : ""}` : ""}</p>
                      </>}
                      {n === 2 && <>
                        {ratio != null && <p>{n2(ratio)} kWh per kWp: {ratio < 0.7 ? "below" : ratio > 1.0 ? "above" : "inside"} the usual 0.7 to 1.0</p>}
                      </>}
                      {n === 4 && <>
                        <HeatPumpStep res={res} inputs={inputs} env={null} multi={multi} variants={variants} onVariant={onVariant} />
                      </>}
                      {why && why.k === WHY_AT[n] && <Why k={why.k} d={res.components[why.k].derivation!} level={why.level} onMore={(lv) => setWhy({ k: why.k, level: lv })} answered={answered} installer={installer} closing={false} ox={0} evKwh={inputs.has_ev ? a?.ev_charge_kwh : null} rules={!!res.rules?.length} />}
                    </div>
                  )}
                </div>
              )}
              {!FIVE && open && n === 4 && rot && <p className={s.rot}>{rot}</p>}
              {!FIVE && open && n === 7 && layers?.checks && <Checks checks={layers.checks} />}
              {open && n === N && a && <Offer res={{ ...res, economics: e }} />}
              {!(FIVE && n <= 4) && open && WHY_AT[n] && res.components[WHY_AT[n]!]?.derivation && (
                <div className={s.whyrow}>
                  <button type="button" className={s.whyb} aria-expanded={why?.k === WHY_AT[n]} onClick={() => setWhy((w) => (w?.k === WHY_AT[n] ? null : { k: WHY_AT[n]!, level: 1 }))}>Why</button>
                </div>
              )}
              {!(FIVE && n <= 4) && open && why && why.k === WHY_AT[n] && (
                <div className={s.whyPanel}>
                  <Why k={why.k} d={res.components[why.k].derivation!} level={why.level} onMore={(lv) => setWhy({ k: why.k, level: lv })} answered={answered} installer={installer} closing={false} ox={0} evKwh={inputs.has_ev ? a?.ev_charge_kwh : null} rules={!!res.rules?.length} />
                </div>
              )}
            </li>
          );
        })}
      </ol>
  );
  const sysChips = <SystemsChips active={systemOf(stage)} onPick={(k: SystemName) => go(stageOf(k))} moved={new Set([...moved].map(systemOf).filter((x): x is SystemName => !!x))} />;
  // Systems: one glass card inside the canvas per chip, with that system's calculation in flowing copy; the bars,
  // equations and Why wait behind its "i". The on-model labels (face kWp, battery kWh, wallbox kW) stay the scene's.
  const sysNow = systemOf(stage);
  const seg = (b: Bar | undefined, re: RegExp) => b?.segments.find((g) => re.test(g.name))?.value;
  const whyBlock = (n: number) => WHY_AT[n] && res.components[WHY_AT[n]!]?.derivation ? (
    <>
      <div className={s.whyrow}><button type="button" className={s.whyb} aria-expanded={why?.k === WHY_AT[n]} onClick={() => setWhy((w) => (w?.k === WHY_AT[n] ? null : { k: WHY_AT[n]!, level: 1 }))}>Why</button></div>
      {why && why.k === WHY_AT[n] && <Why k={why.k} d={res.components[why.k].derivation!} level={why.level} onMore={(lv) => setWhy({ k: why.k, level: lv })} answered={answered} installer={installer} closing={false} ox={0} evKwh={inputs.has_ev ? a?.ev_charge_kwh : null} rules={!!res.rules?.length} />}
    </>
  ) : null;
  // The Checks figures, moved from the Proposed Design card: each sits behind the i of the card it belongs to.
  const checksFor = (re: RegExp) => (roofFitKnown(layers?.checks ?? null, inputs.address) ?? []).filter((c) => re.test(c.name)).map((c) => ({ ...c, name: scrub(c.name) ?? c.name }));
  const pvChecks = checksFor(/roof fit|orient|shad/i), batChecks = checksFor(/battery/i);
  const roofBar = bars[1] && shading ? { ...bars[1], segments: [...bars[1].segments, { name: "lost to shade", value: Math.round(shading.total.loss_kwh_year), unit: "kWh a year", source_tag: "address" as const, citation: shading.source }] } : bars[1];
  const useKwh = (inputs.annual_demand_kwh ?? 0) + (layers?.ev?.annual_kwh ?? 0);
  // No sentences on the cards: figures only; every derivation sentence moved behind the i.
  const sysBody: Record<SystemName, { head: ReactNode; label: string; body: ReactNode; info: ReactNode }> = {
    panels: (() => {
      const nMod = fresh && placed ? placed : null;
      const usePara = a ? <p>About {n0(a.pv_yield_kwh)} kWh a year{faces ? ` from ${faces} face${faces === 1 ? "" : "s"}` : ""}, for a household using {n0(inputs.annual_demand_kwh ?? 0)} kWh{layers?.ev ? ` plus ${n0(layers.ev.annual_kwh)} kWh for the car, ${n0(useKwh)} kWh in all` : ""}.{e.autarky_share != null ? ` ${pc(e.autarky_share)} of that comes from the roof${d.battery_kwh ? ", with the battery" : ""}.` : ""}</p> : null;
      return {
        head: nMod ? <Head main={`${nMod} panels`} sub={`${n2(d.pv_kwp ?? 0)} kWp`} /> : <Head main={`${n2(d.pv_kwp ?? 0)} kWp`} />,
        label: `${nMod ? `${nMod} panels, ` : ""}${n2(d.pv_kwp ?? 0)} kWp`,
        body: multi ? <p>Shared roof, apartment building: the single-family design does not apply.</p>
          : a ? <PairBars roof={a.pv_yield_kwh} share={e.autarky_share ?? null} parts={[{ k: "Household", v: inputs.annual_demand_kwh ?? 0 }, ...(layers?.ev ? [{ k: "Car", v: layers.ev.annual_kwh }] : [])]} /> : null,
        info: <>
          {usePara}
          {roofBar && <BarView bar={roofBar} bare />}
          <BarView bar={useBar} bare />
          <p>{n2(d.pv_kwp ?? 0)} kWp{(d.pv_kwp ?? 0) <= capKwp ? `, inside the ${capKwp} kWp residential cap` : `, above the ${capKwp} kWp residential cap`}{shade && typeof shade.value === "number" ? `; shade ${n1(shade.value * 100)} %${shade.class ? `, ${shade.class}` : ""}` : ""}.</p>
          {pvChecks.length > 0 && <Checks checks={pvChecks} />}
          {shading?.source && <p>Shading: {shading.source}</p>}
          {res.roof?.stated_direction_conflict && <p>{res.roof.note ?? "Roof measured from the building model; the stated direction was not found."}</p>}
          {whyBlock(1)}
        </>,
      };
    })(),
    battery: (() => {
      const day = bars[2], roof = seg(day, /solar|roof/i), fromB = seg(day, /from the battery/i) ?? seg(day, /^battery$/i), grid = seg(day, /grid/i);
      const kwh = d.battery_kwh;
      return {
        head: kwh ? <Head main={`${n1(kwh)} kWh`} sub={ratio != null ? `${n2(ratio)} kWh per kWp` : null} /> : <Head main="No battery" />,
        label: kwh ? `${n1(kwh)} kWh battery` : "No battery",
        body: day && roof != null ? <SplitBar label="A spring weekday" unit="kWh" parts={[{ k: "Roof", v: roof }, { k: "Battery", v: fromB ?? 0 }, { k: "Grid", v: grid ?? 0 }]} /> : null,
        info: <>
          {day && roof != null && <p>On a spring weekday the home uses {n1(day.total)} kWh: {n1(roof)} kWh straight from the roof{fromB ? `, ${n1(fromB)} kWh from the battery` : ""}{grid != null ? ` and ${n1(grid)} kWh from the grid` : ""}.</p>}
          {kwh && ratio != null ? <p>{n1(kwh)} kWh is {ratio < 0.7 ? "below" : ratio > 1.0 ? "above" : "inside"} the usual 0.7 to 1.0 kWh per kWp for {n2(d.pv_kwp ?? 0)} kWp.</p> : !kwh ? <p>No battery in this design.</p> : null}
          {day && <BarView bar={day} />}{batChecks.length > 0 && <Checks checks={batChecks} />}{whyBlock(2)}
        </>,
      };
    })(),
    wallbox: (() => {
      // Works with both engine bar shapes: "km a year"/"charged at home" in kWh, or "Driving"/"Charged at home" as a share.
      const ch = bars[3], segOf = (re: RegExp) => ch?.segments.find((g) => re.test(g.name));
      const km = segOf(/^km\b|^driving/i)?.value ?? layers?.ev?.annual_km, kwh = segOf(/^energy\b/i)?.value ?? layers?.ev?.annual_kwh;
      const homeSeg = segOf(/^charged at home/i), homeKwh = homeSeg && /kwh/i.test(homeSeg.unit) ? homeSeg.value : null;
      const homeShare = homeSeg && !homeKwh && homeSeg.value > 0 && homeSeg.value <= 1 ? homeSeg.value : !homeSeg ? layers?.ev?.home_share ?? null : null;
      const night = segOf(/typical night/i)?.value ?? (ch && /night/i.test(ch.unit) ? ch.total : null) ?? layers?.ev?.kwh_per_night_typical;
      const wb = d.wallbox_kw;
      return {
        head: wb ? <Head main={`${n1(wb)} kW`} sub="wallbox" /> : <Head main="No wallbox" />,
        label: wb ? `${n1(wb)} kW wallbox` : "No wallbox",
        body: wb && km && kwh ? <Chainline steps={[{ v: n0(km), u: "km a year" }, { v: n0(kwh), u: "kWh a year" }, ...(night ? [{ v: n1(night), u: "kWh a night" }] : [])]} /> : null,
        info: <>
          {wb && km && kwh ? <p>{n0(km)} km a year takes about {n0(kwh)} kWh{homeKwh ? `; ${n0(homeKwh)} kWh of it is charged at home` : homeShare ? `; ${pc(homeShare)} of it is charged at home` : ""}{night ? `, about ${n1(night)} kWh a night` : ""}.</p> : <p>{line2[3]}</p>}
          {ch && (wb || layers?.ev) && <BarView bar={ch} />}{whyBlock(3)}
        </>,
      };
    })(),
    heatpump: (() => {
      const lossS = plain(bars[4]?.sentence)?.replace(/(-?\d+) C\b/g, "$1 °C").replace(/;\s*[^;]*room scan[^;]*\.$/i, ".") ?? null;
      const designT = bars[4]?.sentence?.match(/(-?\d+) C\b/)?.[1];
      const env = hasEnv ? model!.envelope! : null;
      const shares = env ? (() => {
        const { list } = elementsOf(env), by = new Map(list.map((x) => [x.key, x]));
        const roof = by.get("roof")?.share ? by.get("roof") : by.get("ceiling") ?? by.get("roof");
        return [roof, by.get("wall"), by.get("window"), by.get("floor")].filter((x): x is NonNullable<typeof x> => !!x && x.share > 0).sort((p, q) => q.share - p.share);
      })() : [];
      const hp = d.heatpump_kw;
      return {
        head: multi ? <Head main="No heat load" sub="for flats" /> : hp ? <Head main={`${n1(hp)} kW`} sub="heat pump" /> : <Head main="No heat pump" />,
        label: multi ? "Heat load not estimated for flats" : hp ? `${n1(hp)} kW heat pump` : "No heat pump",
        body: multi ? null : <>
          {shares.length > 0 && <SplitBar label="Heat loss" unit="" parts={shares.map((x) => ({ k: x.name, v: Math.round(x.share * 100), c: x.colour }))} />}
          {bars[4] && <Fig v={`${n1(bars[4].total)} kW`} u={designT ? `heat loss at ${designT} °C` : "heat loss"} />}
        </>,
        info: multi ? <p>The walls and roof are the whole building&rsquo;s, so no heat pump size for one flat.</p> : <>
          {lossS && <p>{lossS}</p>}
          <p>{hp ? "Sized from the heating bill." : hpWhy ?? "Heating facts not asked yet."}</p>
          {hasEnv && <EnvelopeBar env={model!.envelope!} bare />}
          {bars[4] && <BarView bar={bars[4]} />}
          <HeatPumpStep res={res} inputs={inputs} env={null} multi={multi} variants={variants} onVariant={onVariant} />
          {whyBlock(4)}
        </>,
      };
    })(),
  };
  const cardNow = sysNow ? sysBody[sysNow] : null;
  const sysCard = sysNow && cardNow && (
    <SystemCard sys={sysNow} head={cardNow.head} label={cardNow.label} info={cardNow.info} pending={!!pending || !fresh}
      extra={sysNow === "panels" && address && spatial !== false ? <ShadingPanel address={address} kwp={d.pv_kwp} solarStage start={{ m: 6, h: 11 }} compact /> : undefined}>
      {cardNow.body}
    </SystemCard>
  );
  // A flat in an apartment block: the engine's single-family design does not apply, so the pass shows none and Approve waits.
  const card = <ProposedCard side="bottom" id={leadId} kwp={d.pv_kwp} kwh={d.battery_kwh} price={e.capex_eur} pending={!!pending} none={multi ? "No design for this building yet" : null}>{offer(false)}</ProposedCard>;
  const overlays = (
    <>
      {!SYS && address && spatial !== false && (!FIVE || onPanels) && <div className={s.shadeCard} data-cover><div className={s.shadeOver}><ShadingPanel address={address} kwp={d.pv_kwp} solarStage={FIVE ? true : stage === 4} /></div></div>}
      {!narrow && !SYS && offer(true)}
      {SYS && expanded && sysCard}
      {!narrow && SYS && card}
    </>
  );

  return (
    <div className={`${s.root} ${expanded ? "" : s.isCollapsed} ${SYS ? "sys-on" : ""}`} ref={rootRef}>
      {/* The step strip: on a phone it is always there, pinned under the house; a tap moves the camera and scrolls
          to that step's card. On desktop it stands in for the cards when the eye folds them. */}

      {!SYS && (!expanded || narrow) && (
        <div className={`${s.collapsed} ${narrow ? s.stripPhone : ""}`}>
          <div className={s.scrub} role="group" aria-label="Steps">
            {TITLES.map((t, i) => (
              <button key={t} type="button" aria-pressed={stage === i + 1} className={moved.has(i + 1) ? s.hot : undefined} onClick={() => { go(i + 1); if (narrow && expanded) toStep(i + 1); }} style={FIVE ? stepStyle(i) : undefined}>
                <span className={s.num}>{i + 1}</span>{t}
              </button>
            ))}
          </div>
        </div>
      )}
      {!SYS && rail}
      {SYS && <div className="sys-under">{sysChips}</div>}

      <div ref={heroRef} className={`${s.hero} ${onPanels && shading ? s.heroTall : ""}`}>
        {address && spatial !== false ? (
          <SpatialDemo system={SYS ? systemOf(stage) : undefined} inputs={inputs} design={d} response={res} address={address} layer={layer} onLayerChange={(n) => setPick({ stage, layer: n })} view={heatLayer ? undefined : pick && pick.stage === stage && pick.layer !== 8 && POSES[view]?.topDown ? "solar" : view} bare leadId={leadId ?? undefined}
            onAvailable={setSpatial} onLayers={onLayers} tools={tools} sunTint={onPanels && panelHeat}>
            {overlays}
          </SpatialDemo>
        ) : (
          <div className={s.flat}>
            <House design={d} />
            {overlays}
            <p className={s.flatNote}>{address ? "No 3D model for this address; the drawing stands in." : "No street given, roof assumed standard face."}</p>
          </div>
        )}
      </div>

      {FIVE && onPanels && address && spatial !== false && !SYS && <div className={s.shadeUnder}><ShadingPanel address={address} kwp={d.pv_kwp} solarStage compact /></div>}
      {narrow && !SYS && <div className={s.offerUnder}>{offer(false)}</div>}
      {narrow && SYS && card}
      {prev && JSON.stringify(prev.design) !== JSON.stringify(res.design) && <span className={s.srOnly} aria-live="polite">Draft updated.</span>}
    </div>
  );
}

function Ico({ children }: { children: ReactNode }) {
  return <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>;
}
function HouseSkel() {
  return (
    <div className={s.heroSkel} aria-hidden="true">
      <svg viewBox="0 0 240 160"><path d="M30 84 L120 24 L210 84 V148 H30 Z" /></svg>
    </div>
  );
}
export function Chips({ d }: { d: { pv_kwp?: number | null; battery_kwh?: number | null; wallbox_kw?: number | null; heatpump_kw?: number | null } }) {
  return (
    <span className={s.chips}>
      {d.pv_kwp ? <span className={`${s.chip} ${s.cPv}`}><svg width="11" height="11" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="4" fill="currentColor" /><path d="M10 1v3M10 16v3M1 10h3M16 10h3M3.6 3.6l2.1 2.1M14.3 14.3l2.1 2.1M3.6 16.4l2.1-2.1M14.3 5.7l2.1-2.1" stroke="currentColor" strokeWidth="1.8" /></svg>{n2(d.pv_kwp)}</span> : null}
      {d.battery_kwh ? <span className={`${s.chip} ${s.cBat}`}><svg width="12" height="11" viewBox="0 0 22 20" aria-hidden="true"><rect x="1" y="5" width="17" height="10" rx="2" fill="none" stroke="currentColor" strokeWidth="1.8" /><rect x="19" y="8" width="2" height="4" fill="currentColor" /><rect x="3.5" y="7.5" width="9" height="5" fill="currentColor" /></svg>{n1(d.battery_kwh)}</span> : null}
      {d.wallbox_kw ? <span className={`${s.chip} ${s.cEv}`}>{n1(d.wallbox_kw)} kW</span> : null}
      {d.heatpump_kw ? <span className={`${s.chip} ${s.cHp}`}>{n1(d.heatpump_kw)} kW</span> : null}
    </span>
  );
}

// The engine's bars as sent; a field missing on a fresh lead must not throw when the "i" first opens.
const segsOf = (b: Bar) => (Array.isArray(b?.segments) ? b.segments : []).filter((g) => g && typeof g.name === "string");
const stackable = (b: Bar) => segsOf(b).filter((g) => g.unit === b.unit && g.value > 0);

function BarView({ bar, bare }: { bar: Bar; bare?: boolean }) {
  const segs = stackable(bar), sum = segs.reduce((x, g) => x + g.value, 0) || 1;
  const all = segsOf(bar), extra = all.filter((g) => !segs.includes(g));
  const fmt = (v: number, u: string) => (!u ? String(v) : `${u === "kWp" || u === "kW" ? n2(v) : v >= 100 ? n0(v) : n1(v)} ${u}`);
  return (
    <div className={s.bar}>
      <div className={s.barH}><span>{bar.title}</span><b>{fmt(bar.total, bar.unit)}</b></div>
      {segs.length > 1 || (segs.length === 1 && !extra.length) ? (
        <>
          <div className={s.track}>{segs.map((g, i) => <span key={g.name} title={g.citation} style={{ flex: g.value / sum, background: SEG_COLOUR[g.name] ?? PALETTE[i % PALETTE.length] }} />)}</div>
          <ul className={s.legend}>
            {segs.map((g, i) => <li key={g.name} title={g.citation}><i style={{ background: SEG_COLOUR[g.name] ?? PALETTE[i % PALETTE.length] }} />{cap(g.name)} <b>{fmt(g.value, g.unit)}</b>{!bare && <em data-t={g.source_tag}>{TAG[g.source_tag] ?? g.source_tag}</em>}</li>)}
            {extra.map((g) => <li key={g.name} title={g.citation}><i className={s.noDot} />{cap(g.name)} <b>{fmt(g.value, g.unit)}</b>{!bare && <em data-t={g.source_tag}>{TAG[g.source_tag] ?? g.source_tag}</em>}</li>)}
          </ul>
        </>
      ) : (
        <ul className={s.steps}>
          {all.map((g) => <li key={g.name} title={g.citation}><span>{cap(g.name)}</span><b>{fmt(g.value, g.unit)}</b>{!bare && <em data-t={g.source_tag}>{TAG[g.source_tag] ?? g.source_tag}</em>}</li>)}
        </ul>
      )}
      {!bare && <p className={s.barS}>{bar.sentence}</p>}
      {!bare && Array.isArray(bar.sources) && bar.sources.length > 0 && <p className={s.barSrc}>{bar.sources.join("; ")}</p>}
    </div>
  );
}

function BarStrip({ bar }: { bar: Bar }) {
  const segs = stackable(bar), sum = segs.reduce((x, g) => x + g.value, 0) || 1;
  if (segs.length < 2) return null;
  return <div className={s.strip} aria-hidden="true">{segs.map((g, i) => <span key={g.name} style={{ flex: g.value / sum, background: SEG_COLOUR[g.name] ?? PALETTE[i % PALETTE.length] }} />)}</div>;
}

const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);

// Until the engine sends level, Reonic's battery guide is still a reference, never a red failure.
const isRef = (c: Check) => c.level === "reference" || (!c.level && /battery per daily/i.test(c.name));
const isInfo = (c: Check) => c.level === "info" || !!c.informational;
const isFail = (c: Check) => !c.pass && !isRef(c) && !isInfo(c);
// A reference guide is outside when the engine says so; older engines only had pass.
const refOut = (c: Check) => isRef(c) && (c.inside_band != null ? !c.inside_band : !c.pass);

function Checks({ checks }: { checks: Check[] }) {
  const val = (c: Check) => c.value == null ? "" : typeof c.value !== "number" ? String(c.value) : c.unit === "share" ? pc(c.value) : c.unit === "%" ? `${n0(c.value)} %` : `${c.value >= 100 ? n0(c.value) : n2(c.value)}${c.unit ? ` ${c.unit}` : ""}`;
  const dcac = checks.find((c) => /dc\/ac/i.test(c.name));
  const dc = dcac && typeof dcac.value === "number" ? dcac.value : null;
  return (
    <div className={s.checks}>
      <ul>
        {checks.map((c) => {
          const tone = isInfo(c) ? "info" : isRef(c) ? (refOut(c) ? "ref" : "pass") : c.pass ? "pass" : "fail";
          const pill = { info: c.class ? cap(c.class) : "Info", pass: isRef(c) ? "Inside guide" : "Pass", ref: "Above guide", fail: "Flag" }[tone];
          return (
            <li key={c.name} className={tone === "fail" ? s.fail : tone === "ref" ? s.refRow : ""}>
              <span className={s.cn}>{cap(c.name)}</span>
              <b>{val(c)}</b>
              <span className={{ info: s.info, pass: s.pass, ref: s.ref, fail: s.flag }[tone]}>{pill}</span>
              <span className={s.band}>{c.band}</span>
              {(() => {
                const num = typeof c.value === "number" ? n2(c.value) : String(c.value);
                const m = c.message ?? (isRef(c) && /battery/i.test(c.name) ? (!refOut(c) ? `${num}, inside the guide` : `Battery ${num} kWh per kWh of daily use: above Reonic's 0.6 guide`) : null);
                return m && tone !== "info" && (tone !== "pass" || isRef(c)) ? <p className={tone === "fail" ? s.failS : tone === "ref" ? s.refS : s.passS}>{m}</p> : null;
              })()}
            </li>
          );
        })}
      </ul>
      {dc != null && (
        <div className={s.gauge}>
          <div className={s.gTrack}><span className={s.gBand} /><i style={{ left: `${Math.max(0, Math.min(100, ((dc - 50) / 100) * 100))}%` }} /></div>
          <div className={s.gScale}><span>70 %</span><span>100 %</span><span>130 %</span></div>
          <p className={s.gNote}>Module to inverter power {n0(dc)} %</p>
        </div>
      )}
    </div>
  );
}

function Offer({ res }: { res: DesignResponse }) {
  const e = res.economics, a = e.annual!;
  const charged = (a as { battery_charged_kwh?: number }).battery_charged_kwh ?? 0;
  const discharged = (a as { battery_discharged_kwh?: number }).battery_discharged_kwh ?? 0;
  const direct = Math.max(0, a.pv_yield_kwh - charged - a.fed_in_kwh);
  const flows = { direct, charged, fed: a.fed_in_kwh, discharged, imp: a.grid_import_kwh };
  // Engine v2.7: cumulative series, or the yearly one summed here.
  const ce = e as unknown as { cashflow_cumulative_eur?: number[]; cashflow_yearly_eur?: number[] };
  const cash = ce.cashflow_cumulative_eur?.length ? ce.cashflow_cumulative_eur : ce.cashflow_yearly_eur?.reduce<number[]>((o, x) => [...o, (o.at(-1) ?? 0) + x], []);
  return (
    <div className={s.offer}>
      <div className={s.two}>
        <div><span>Own consumption</span><b>{pc(e.self_consumption_share)}</b></div>
        <div><span>Autarky</span><b>{pc(e.autarky_share)}</b></div>
      </div>
      <Sankey f={flows} pv={a.pv_yield_kwh} demand={a.load_kwh} />
      {cash?.length ? <div><Cash v={cash} /><p className={s.cashL}><span>{eur(Math.min(...cash))} at the start</span><span>{eur(cash[cash.length - 1])} after {Math.min(cash.length, 20)} years</span></p></div> : null}
    </div>
  );
}

// Solar → (direct, battery, grid) → demand, gradient ribbons sized by kWh a year.
function Sankey({ f, pv, demand }: { f: { direct: number; charged: number; fed: number; discharged: number; imp: number }; pv: number; demand: number }) {
  const W = 340, H = 170, x0 = 10, x1 = 160, x2 = 320, top = 10, h = H - 20;
  const tot = Math.max(pv, demand + f.fed, 1), k = h / tot;
  const sY = top, bY = top + f.direct * k + 6, gY = bY + Math.max(f.charged, f.discharged) * k + 8;
  const ribbon = (ax: number, ay: number, bx: number, by: number, w: number, id: string) =>
    w <= 0 ? null : <path key={id} d={`M${ax},${ay} C${(ax + bx) / 2},${ay} ${(ax + bx) / 2},${by} ${bx},${by} L${bx},${by + w} C${(ax + bx) / 2},${by + w} ${(ax + bx) / 2},${ay + w} ${ax},${ay + w} Z`} fill={`url(#${id})`} opacity={0.85} />;
  const dY = top;
  return (
    <svg className={s.sankey} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Solar ${n0(pv)} kWh a year: ${n0(f.direct)} used directly, ${n0(f.charged)} into the battery, ${n0(f.fed)} to the grid; demand ${n0(demand)} kWh, ${n0(f.imp)} from the grid`}>
      <defs>
        {[["gd", "#ffc043", "#374be6"], ["gb", "#ffc043", "#24a148"], ["gf", "#ffc043", "#071b71"], ["bd", "#24a148", "#374be6"], ["id", "#071b71", "#374be6"]].map(([id, c1, c2]) => (
          <linearGradient key={id} id={id} x1="0" x2="1"><stop offset="0" stopColor={c1} /><stop offset="1" stopColor={c2} /></linearGradient>
        ))}
      </defs>
      {ribbon(x0 + 8, sY, x2, dY, f.direct * k, "gd")}
      {ribbon(x0 + 8, sY + f.direct * k, x1, bY, f.charged * k, "gb")}
      {ribbon(x0 + 8, sY + (f.direct + f.charged) * k, x1, gY, f.fed * k, "gf")}
      {ribbon(x1 + 8, bY, x2, dY + f.direct * k, f.discharged * k, "bd")}
      {ribbon(x1 + 8, gY + f.fed * k + 4, x2, dY + (f.direct + f.discharged) * k, f.imp * k, "id")}
      <rect x={x0} y={sY} width="8" height={pv * k} fill="#ffc043" rx="2" />
      <rect x={x1} y={bY} width="8" height={Math.max(f.charged, f.discharged) * k} fill="#24a148" rx="2" />
      <rect x={x1} y={gY} width="8" height={(f.fed + f.imp) * k + 4} fill="#071b71" rx="2" />
      <rect x={x2} y={dY} width="8" height={demand * k} fill="#374be6" rx="2" />
      <text x={x0 + 12} y={sY + 12} className={s.sk}>Solar {n0(pv)}</text>
      <text x={x1 + 12} y={bY + 12} className={s.sk}>Battery</text>
      <text x={x1 + 12} y={gY + 12} className={s.sk}>Grid</text>
      <text x={x2 - 4} y={dY + 12} className={s.sk} textAnchor="end">Demand {n0(demand)}</text>
    </svg>
  );
}

// Cumulative cash flow by year, undiscounted: negative years solar yellow, positive navy.
function Cash({ v }: { v: number[] }) {
  const W = 340, H = 120, max = Math.max(...v.map(Math.abs), 1), bw = W / v.length, zero = H / 2;
  return (
    <svg className={s.cash} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Cumulative cash flow over 20 years">
      <line x1="0" x2={W} y1={zero} y2={zero} stroke="#d4d4d8" />
      {v.map((x, i) => <rect key={i} x={i * bw + 1} width={bw - 2} y={x >= 0 ? zero - (x / max) * (H / 2 - 4) : zero} height={(Math.abs(x) / max) * (H / 2 - 4)} fill={x >= 0 ? "#071b71" : "#ffc043"} rx="1.5" />)}
    </svg>
  );
}

// The engine passes Roof fit when no roof was measured (nothing to compare); the planner must not read that as a tick.
function roofFitKnown<C extends { name: string; value?: unknown; pass?: boolean; level?: string }>(checks: C[] | null, address?: string | null): C[] | null {
  if (!checks) return checks;
  const street = !!address && !/^\s*\d{4,5}\s*$/.test(address) && /[a-zäöüß]{3,}/i.test(address.replace(/\b\d{5}\b.*$/, ""));
  return checks.map((c) => c.name === "Roof fit" && c.value == null
    ? { ...c, name: street ? "Roof fit unknown: roof not measured" : "Roof fit unknown: street address needed", pass: false, level: "info" }
    : c);
}
