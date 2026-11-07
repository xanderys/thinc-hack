"use client";
// The open card's reasoning chain: the house is the hero for the whole page, eight stages build on it.
// Each stage adds one sentence to the rail, a working-shown bar or check list where the engine has one,
// and moves the camera to the part of the house it explains. A change re-runs the chain from the stage it moved.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import type { DesignResponse, HomeInputs, ComponentKey } from "@/lib/api";
import { INSTALLER_NAME } from "@/lib/api";
import type { Layers, Bar, Check, RoofModel } from "@/components/spatial/types";
import { findRot, rotLine } from "@/lib/rot";
import { POSES, type StageView } from "@/components/spatial/camera";
import type { Variant } from "@/components/stage/Plan";
import House from "@/components/stage/House";
import Why from "@/components/stage/Why";
import s from "./chain.module.css";

const SpatialDemo = dynamic(() => import("@/components/spatial/SpatialDemo"), { ssr: false });

const n0 = (x: number) => Math.round(x).toLocaleString("en-GB");
const n1 = (x: number) => (Math.round(x * 10) / 10).toLocaleString("en-GB");
const n2 = (x: number) => (Math.round(x * 100) / 100).toLocaleString("en-GB");
const pc = (x: number) => `${Math.round(x * 100)} %`;
const eur = (x: number) => `${x < 0 ? "-" : ""}€${n0(Math.abs(x))}`;

const TITLES = ["Site", "Load", "Future", "Solar", "Storage", "Extras", "Sanity", "Offer"];
const VIEWS: StageView[] = ["site", "load", "future", "solar", "storage", "extras", "sanity", "offer"];
const BAR_AT: Record<Bar["key"], number> = { roof: 1, heat_loss: 3, day: 5, charging: 6 };
const WHY_AT: Partial<Record<number, ComponentKey>> = { 4: "pv", 5: "battery", 6: "wallbox" };
const TAG: Record<string, string> = { lead: "lead", rina: "Rina", address: "address", default: "assumed" };
// One muted palette for every bar, in Reonic's heat-load order; component colours where the segment is a component.
const PALETTE = ["#f5c35a", "#5b8def", "#4fb477", "#a58bea", "#e3634f", "#f0924a", "#a1a1aa", "#71717b"];
const SEG_COLOUR: Record<string, string> = {
  "Outer walls": "#f5c35a", Windows: "#5b8def", Floor: "#4fb477", Roof: "#e3634f", Ventilation: "#f0924a", "Thermal bridges": "#a58bea",
  "solar-covered": "#ffc043", "from the battery": "#24a148", "from the grid": "#071b71",
};

type Props = {
  res: DesignResponse; prev: DesignResponse | null; inputs: HomeInputs; leadId?: string | null;
  variants: Variant[]; onVariant: (v: Variant) => void; canUndo: boolean; onUndo: () => void; decide?: ReactNode;
  answered: boolean; refine: ReactNode;
};

function useReduce() {
  const [r, setR] = useState(false);
  useEffect(() => { const m = matchMedia("(prefers-reduced-motion: reduce)"); setR(m.matches); const f = () => setR(m.matches); m.addEventListener("change", f); return () => m.removeEventListener("change", f); }, []);
  return r;
}

export default function Chain({ res, prev, inputs, leadId, variants, onVariant, canUndo, onUndo, answered, refine, decide }: Props) {
  const reduce = useReduce();
  const [stage, setStage] = useState(1);
  const [auto, setAuto] = useState(true);
  const [layers, setLayers] = useState<Layers | null>(null);
  const [moved, setMoved] = useState<Set<number>>(new Set());
  const [spatial, setSpatial] = useState<boolean | null>(null);
  const [heatmap, setHeatmap] = useState(false);
  const [why, setWhy] = useState<{ k: ComponentKey; level: number } | null>(null);
  const lastLayers = useRef<Layers | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  // One screen on desktop: the chain takes the height left under the top bar.
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const fit = () => { const top = el.getBoundingClientRect().top + window.scrollY; el.style.setProperty("--chain-top", `${Math.round(top + 12)}px`); };
    fit();
    const ro = new ResizeObserver(fit); ro.observe(document.body);
    return () => ro.disconnect();
  }, []);
  const address = inputs.address ?? inputs.roof?.matched_address;
  const installer = INSTALLER_NAME[inputs.installer_id as keyof typeof INSTALLER_NAME] ?? "this installer";

  // The chain builds one stage at a time; a tap on the rail takes over.
  useEffect(() => {
    if (!auto || stage >= 8) return;
    const t = setTimeout(() => setStage((x) => Math.min(8, x + 1)), reduce ? 900 : 1700);
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
    if (JSON.stringify(was.checks) !== JSON.stringify(l.checks)) m.add(7);
    if (JSON.stringify(was.economics?.capex_eur) !== JSON.stringify(l.economics?.capex_eur) || was.economics?.autarky_share !== l.economics?.autarky_share) m.add(8);
    const d0 = was.chosen, d1 = l.chosen;
    if (d0 && d1) {
      if (d0.pv_kwp !== d1.pv_kwp) m.add(4);
      if (d0.battery_kwh !== d1.battery_kwh) m.add(5);
      if (d0.wallbox_kw !== d1.wallbox_kw || d0.heatpump_kw !== d1.heatpump_kw) m.add(6);
    }
    if (JSON.stringify(was.ev ?? null) !== JSON.stringify(l.ev ?? null)) { m.add(2); m.add(3); }
    if (!m.size) return;
    setMoved(m);
    setStage(Math.min(...m));
    setAuto(true);
  }

  const model: RoofModel | null = layers ? (Array.isArray(layers.planes) ? null : layers.planes) : null;
  const hasEnv = !!model?.envelope?.faces?.length, hasPlan = !!model?.plan?.outline?.length;
  // The planner's pick on the model (3D or Photo over the plan) holds until the stage changes.
  const [pick, setPick] = useState<{ stage: number; layer: number } | null>(null);
  const layer = heatmap ? 2 : pick && pick.stage === stage ? pick.layer : [1, 4, hasEnv ? 7 : 1, 3, 5, 5, hasPlan ? 8 : 3, hasPlan ? 8 : 3][stage - 1];
  const bars = useMemo(() => Object.fromEntries((layers?.bars ?? []).map((b) => [BAR_AT[b.key], b])) as Record<number, Bar>, [layers]);
  // The four numbers come from the same run as the bars and checks when it is in; the design's own until then.
  const le = layers?.economics;
  const e = le ? { ...res.economics, ...le, annual: { ...res.economics.annual!, ...(le.annual ?? {}) } } as typeof res.economics : res.economics, a = e.annual;
  const breakEven = layers?.economics?.break_even_year ?? (e as { break_even_year?: number | null }).break_even_year ?? null;
  const d = res.design;
  const rot = rotLine(findRot(res.components.pv?.derivation, layers, res));

  const head: string[] = [
    bars[1] ? `${n2(bars[1].total)} kWp on ${bars[1].segments.filter((g) => g.unit === "kWp").length} faces` : address && spatial !== false ? "Roof being measured" : address ? "No 3D model here, roof assumed standard face" : "No street given, roof assumed standard face",
    `${n0(inputs.annual_demand_kwh ?? 0)} kWh a year${layers?.ev ? ` plus ${n0(layers.ev.annual_kwh)} kWh for the car` : ""}`,
    `${inputs.has_ev ? `Electric car${inputs.ev_annual_km ? `, ${n0(inputs.ev_annual_km)} km a year` : ""}` : "No electric car planned"}${model?.envelope ? `; heat load up to ${n1(model.envelope.design_heat_load_kw)} kW` : ""}`,
    `${n2(d.pv_kwp ?? 0)} kWp${model?.layout?.panels ? `, ${model.layout.panels} modules` : ""}`,
    d.battery_kwh ? `${n1(d.battery_kwh)} kWh battery` : "No battery",
    [d.wallbox_kw ? `${n1(d.wallbox_kw)} kW wallbox` : "No wallbox", d.heatpump_kw ? `${n1(d.heatpump_kw)} kW heat pump` : "no heat pump"].join(", "),
    (() => { const c = layers?.checks ?? []; const bad = c.filter(isFail).length, out = c.filter(refOut).length; return c.length ? (bad ? `${bad} of ${c.length} checks flag` : out ? "Checks pass; battery above Reonic’s guide" : `All ${c.length} checks pass`) : "Checks"; })(),
    `${eur(e.capex_eur)}${breakEven ? `, break-even in ${breakEven} years` : ""}`,
  ];

  const view = VIEWS[stage - 1];
  const kpis = [
    { k: "Yield", v: a ? `${n0(a.pv_yield_kwh)} kWh` : "none" },
    { k: "Autarky", v: pc(e.autarky_share) },
    { k: "Investment", v: eur(e.capex_eur) },
    { k: "Break-even", v: breakEven == null ? "over 20 years" : `${breakEven} years` },
  ];

  const go = (n: number) => { setAuto(false); setStage(n); setWhy(null); };

  const tools = ({ view: v, setView, photo }: { view: "3d" | "2d"; setView: (x: "3d" | "2d") => void; photo?: { on: boolean; set: (on: boolean) => void } }) => (
    <div className={s.toolbar} role="toolbar" aria-label="Model">
      <Inert label="Select"><path d="M5 3l12 7-5 1.5L9.5 17z" /></Inert>
      <Inert label="Pan"><path d="M7 11V5.5a1.5 1.5 0 013 0V10m0-1.5V4a1.5 1.5 0 013 0v5m0-3a1.5 1.5 0 013 0v6c0 3.5-2.5 6-6 6s-5-1.5-6.5-4L3 11.5a1.5 1.5 0 012.5-1.5L7 12" /></Inert>
      <Inert label="Measure"><path d="M3 14L14 3l3 3L6 17zM6 11l1.5 1.5M8.5 8.5L10 10M11 6l1.5 1.5" /></Inert>
      <span className={s.sep} />
      <button type="button" className={s.tb} onClick={onUndo} disabled={!canUndo} title="Undo" aria-label="Undo"><Ico><path d="M7 7H3V3M3.5 7A7 7 0 1110 17" /></Ico></button>
      <span className={s.sep} />
      <button type="button" className={s.tb} aria-pressed={heatmap} onClick={() => setHeatmap((x) => !x)} title="Sun heatmap" aria-label="Sun heatmap"><Ico><path d="M10 2l8 4-8 4-8-4zM2 10l8 4 8-4M2 14l8 4 8-4" /></Ico></button>
      <div className={s.seg} role="group" aria-label="View">
        <button type="button" aria-pressed={v === "2d"} onClick={() => setView("2d")}>2D</button>
        <button type="button" aria-pressed={v === "3d" && !photo?.on} onClick={() => setView("3d")}>3D</button>
        {photo && <button type="button" aria-pressed={photo.on} onClick={() => photo.set(true)}>Photo</button>}
      </div>
      <button type="button" className={s.save} aria-disabled="true" title="Saved with Approve">Save</button>
    </div>
  );

  const overlays = (
    <>
      <div className={s.sim}>
        <p className={s.simH}><Bolt /> Simulation</p>
        <dl className={s.kpis}>{kpis.map((x) => <div key={x.k}><dt>{x.k}</dt><dd>{x.v}</dd></div>)}</dl>
      </div>
      {stage === 8 && variants.length > 0 && (
        <div className={s.variants}>
          <p className={s.varH}>Variants</p>
          <p className={s.varC}>the residential version of Reonic&apos;s optimiser sliders</p>
          {variants.map((v) => (
            <div key={v.name} className={s.vrow}>
              <div><b>{v.name}</b><Chips d={v.design} /></div>
              <div className={s.vprice}>{v.e ? eur(v.e.capex_eur) : ""}</div>
              {v.current ? <span className={s.vsel}>Selected</span> : <button type="button" className={s.vbtn} onClick={() => onVariant(v)} disabled={!v.overrides}>Select</button>}
            </div>
          ))}
        </div>
      )}
    </>
  );

  return (
    <div className={s.root} ref={rootRef}>
      <ol className={s.rail} aria-label="How the design was reached">
        {TITLES.map((t, i) => {
          const n = i + 1, open = n === stage, built = n <= stage || !auto;
          const bar = bars[n];
          return (
            <li key={t} className={`${s.item} ${open ? s.open : ""} ${built ? "" : s.pending}`}>
              <button type="button" className={s.ih} onClick={() => go(n)} aria-expanded={open}>
                <span className={s.num}>{n}</span>
                <span className={s.it}>{t}{moved.has(n) && <span className={s.moved}>Moved</span>}</span>
                <span className={s.ihead}>{head[i]}</span>
              </button>
              {built && bar && (open ? <BarView bar={bar} /> : <BarStrip bar={bar} />)}
              {open && n === 4 && rot && <p className={s.rot}>{rot}</p>}
              {open && n === 7 && layers?.checks && <Checks checks={layers.checks} />}
              {open && n === 8 && a && <Offer res={{ ...res, economics: e }} />}
              {open && n === 8 && variants.length > 0 && (
                <div className={s.varList}>
                  <p className={s.varC}>the residential version of Reonic&apos;s optimiser sliders</p>
                  {variants.map((v) => (
                    <div key={v.name} className={s.vrow}>
                      <div><b>{v.name}</b><Chips d={v.design} /></div>
                      <div className={s.vprice}>{v.e ? eur(v.e.capex_eur) : ""}</div>
                      {v.current ? <span className={s.vsel}>Selected</span> : <button type="button" className={s.vbtn} onClick={() => onVariant(v)} disabled={!v.overrides}>Select</button>}
                    </div>
                  ))}
                </div>
              )}
              {open && n === 8 && decide && <div className={s.decide}>{decide}</div>}
              {open && WHY_AT[n] && res.components[WHY_AT[n]!]?.derivation && (
                <div className={s.whyrow}>
                  <button type="button" className={s.whyb} aria-expanded={why?.k === WHY_AT[n]} onClick={() => setWhy((w) => (w?.k === WHY_AT[n] ? null : { k: WHY_AT[n]!, level: 1 }))}>Why</button>
                </div>
              )}
              {open && why && why.k === WHY_AT[n] && (
                <div className={s.whyPanel}>
                  <Why k={why.k} d={res.components[why.k].derivation!} level={why.level} onMore={(lv) => setWhy({ k: why.k, level: lv })} answered={answered} installer={installer} closing={false} ox={0} evKwh={inputs.has_ev ? a?.ev_charge_kwh : null} rules={!!res.rules?.length} />
                </div>
              )}
            </li>
          );
        })}
      </ol>

      <div className={s.hero}>
        {address && spatial !== false ? (
          <SpatialDemo inputs={inputs} design={d} response={res} address={address} layer={layer} onLayerChange={(n) => setPick({ stage, layer: n })} view={heatmap ? undefined : pick && pick.stage === stage && pick.layer !== 8 && POSES[view]?.topDown ? "solar" : view} bare leadId={leadId ?? undefined}
            onAvailable={setSpatial} onLayers={onLayers} tools={tools}>
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

      <div className={s.say}>{refine}</div>
      {prev && JSON.stringify(prev.design) !== JSON.stringify(res.design) && <span className={s.srOnly} aria-live="polite">The design changed; the chain re-ran.</span>}
    </div>
  );
}

function Ico({ children }: { children: ReactNode }) {
  return <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>;
}
function Inert({ label, children }: { label: string; children: ReactNode }) {
  return <button type="button" className={`${s.tb} ${s.inert}`} aria-disabled="true" title={`${label}: not in this demo`} aria-label={`${label}, not in this demo`}><Ico>{children}</Ico></button>;
}
function Bolt() {
  return <svg width="14" height="14" viewBox="0 0 20 20" aria-hidden="true"><path d="M11 1L3 12h6l-1 7 8-11h-6z" fill="#374be6" /></svg>;
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

const stackable = (b: Bar) => b.segments.filter((g) => g.unit === b.unit && g.value > 0);

function BarView({ bar }: { bar: Bar }) {
  const segs = stackable(bar), sum = segs.reduce((x, g) => x + g.value, 0) || 1;
  const extra = bar.segments.filter((g) => !segs.includes(g));
  const fmt = (v: number, u: string) => (!u ? String(v) : `${u === "kWp" || u === "kW" ? n2(v) : v >= 100 ? n0(v) : n1(v)} ${u}`);
  return (
    <div className={s.bar}>
      <div className={s.barH}><span>{bar.title}</span><b>{fmt(bar.total, bar.unit)}</b></div>
      {segs.length > 1 || (segs.length === 1 && !extra.length) ? (
        <>
          <div className={s.track}>{segs.map((g, i) => <span key={g.name} title={g.citation} style={{ flex: g.value / sum, background: SEG_COLOUR[g.name] ?? PALETTE[i % PALETTE.length] }} />)}</div>
          <ul className={s.legend}>
            {segs.map((g, i) => <li key={g.name} title={g.citation}><i style={{ background: SEG_COLOUR[g.name] ?? PALETTE[i % PALETTE.length] }} />{cap(g.name)} <b>{fmt(g.value, g.unit)}</b><em data-t={g.source_tag}>{TAG[g.source_tag] ?? g.source_tag}</em></li>)}
            {extra.map((g) => <li key={g.name} title={g.citation}><i className={s.noDot} />{cap(g.name)} <b>{fmt(g.value, g.unit)}</b><em data-t={g.source_tag}>{TAG[g.source_tag] ?? g.source_tag}</em></li>)}
          </ul>
        </>
      ) : (
        <ul className={s.steps}>
          {bar.segments.map((g) => <li key={g.name} title={g.citation}><span>{cap(g.name)}</span><b>{fmt(g.value, g.unit)}</b><em data-t={g.source_tag}>{TAG[g.source_tag] ?? g.source_tag}</em></li>)}
        </ul>
      )}
      <p className={s.barS}>{bar.sentence}</p>
      {bar.sources.length > 0 && <p className={s.barSrc}>{bar.sources.join("; ")}</p>}
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
