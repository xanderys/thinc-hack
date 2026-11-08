// The rolling offer: four numbers, the parts list (each line a chooser), the four offers, the sanity
// ticks, what to confirm on site, Approve. Always visible: beside the house on desktop, under it on a phone.
// It holds no design state of its own; every change goes through Stage (overrides, variants, Approve).
import { useEffect, useMemo, useRef, useState } from "react";
import type { Design, DesignResponse, Economics, HomeInputs, Lead, OverrideValue, Overrides, Variant as EngineVariant } from "@/lib/api";
import { call } from "@/lib/client";
import type { Variant as StageVariant } from "@/components/stage/Plan";
import type { Check, RoofModel } from "@/components/spatial/types";
import { eur, n0, n2, pc, type Part } from "./format";
import Tiles, { type TileMode } from "./Tiles";
import KitSheet from "./KitSheet";
import VariantTabs, { rowsOf, type Row } from "./VariantTabs";
import InlineOverride from "./InlineOverride";
import Approve from "./Approve";
import { scrub } from "./facts";
import s from "./offer.module.css";

export type OfferProps = {
  res: DesignResponse; economics: Economics; breakEven: number | null;
  cause: string | null; pending: boolean;
  variants: StageVariant[]; onVariant: (v: StageVariant) => void;
  checks?: Check[] | null; checksFresh?: boolean; model?: RoofModel | null;
  overrides: Overrides; setOverride: (f: keyof Design, v: OverrideValue | undefined) => void;
  approvedAt: string | null; onApprove: (want?: unknown) => Promise<string | null> | void; leadId?: string | null;
  inputs?: HomeInputs;   // the facts the design on screen was drawn from; a fact change re-reads the offers
  undo?: { can: boolean; run: () => void };   // Undo beside Approve (the last edit to the design)
  docked?: boolean;   // inside the canvas on desktop: marks itself as cover so the house fits beside it
};

const PART: Record<keyof Design, Part> = { pv_kwp: "pv", inverter_kw: "inverter", battery_kwh: "battery", wallbox_kw: "wallbox", heatpump_kw: "heatpump" };
const UNIT: Record<keyof Design, string> = { pv_kwp: "kWp", inverter_kw: "kW", battery_kwh: "kWh", wallbox_kw: "kW", heatpump_kw: "kW" };
const COMP: Partial<Record<keyof Design, "pv" | "battery" | "wallbox" | "heatpump">> = { pv_kwp: "pv", battery_kwh: "battery", wallbox_kw: "wallbox", heatpump_kw: "heatpump" };

// Until the engine sends level, Reonic's battery guide is a reference line, never a red failure.
const isRef = (c: Check) => c.level === "reference" || (!c.level && /battery per daily/i.test(c.name));
const isInfo = (c: Check) => c.level === "info" || !!c.informational;
const isFail = (c: Check) => !c.pass && !isRef(c) && !isInfo(c);
const refOut = (c: Check) => isRef(c) && (c.inside_band != null ? !c.inside_band : !c.pass);

// Engine offers in Stage's variant shape, so a pick runs through Stage's onVariant like any other.
function asStage(vs: EngineVariant[], d: Design): StageVariant[] {
  const same = (x: Design) => JSON.stringify(x) === JSON.stringify(d);
  return vs.map((v) => ({ name: v.label.split(" (")[0], tag: "", design: v.design, e: v.economics, note: v.note, current: same(v.design),
    overrides: v.key === "expert" ? {} : { pv_kwp: v.design.pv_kwp, battery_kwh: v.design.battery_kwh, wallbox_kw: v.design.wallbox_kw, heatpump_kw: v.design.heatpump_kw } }));
}

function useReduce() {
  const [r, setR] = useState(false);
  useEffect(() => { const m = matchMedia("(prefers-reduced-motion: reduce)"); setR(m.matches); const f = () => setR(m.matches); m.addEventListener("change", f); return () => m.removeEventListener("change", f); }, []);
  return r;
}

export default function OfferPanel(p: OfferProps) {
  const { res, economics: e, breakEven, cause, pending, checks, model, overrides } = p;
  const d = res.design, a = e.annual;
  const reduce = useReduce();
  // Docked: the panel ends above the sentence bar and the model toolbar wherever they sit, so nothing floats over
  // its tabs and a click or tap lands on what it shows.
  const box = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = box.current, host = el?.offsetParent as HTMLElement | null;
    if (!p.docked || !el || !host) return;
    const covers = () => [...document.querySelectorAll<HTMLElement>('[class*="chain_say__"], [role="toolbar"][aria-label="Model"]')];
    const fit = () => {
      const h = host.getBoundingClientRect(), me = el.getBoundingClientRect();
      let bottom = 64;
      for (const c of covers()) {
        const r = c.getBoundingClientRect();
        if (!r.height || r.right <= me.left || r.left >= me.right || r.top >= h.bottom || r.bottom <= me.top) continue;
        bottom = Math.max(bottom, Math.round(h.bottom - r.top + 12));
      }
      el.style.setProperty("--offer-bottom", `${bottom}px`);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(host); covers().forEach((c) => ro.observe(c));
    addEventListener("resize", fit);
    return () => { ro.disconnect(); removeEventListener("resize", fit); };
  }, [p.docked]);
  const mode: TileMode = cause && !/^Switched to/.test(cause) ? "arrow" : "fade";

  // Boxes that changed light once; the counter restarts the ring.
  const last = useRef<Design>(d);
  const [hl, setHl] = useState<{ parts: Part[]; n: number }>({ parts: [], n: 0 });
  useEffect(() => {
    const was = last.current; last.current = d;
    const parts = (Object.keys(PART) as (keyof Design)[]).filter((k) => (was[k] ?? null) !== (d[k] ?? null)).map((k) => PART[k]);
    if (parts.length && !reduce) setHl((x) => ({ parts, n: x.n + 1 }));
  }, [d.pv_kwp, d.inverter_kw, d.battery_kwh, d.wallbox_kw, d.heatpump_kw]); // eslint-disable-line react-hooks/exhaustive-deps

  // Modules from the layout the house shows, when it matches the size on screen.
  const target = model?.layout && Math.abs(model.layout.kwp - (d.pv_kwp ?? 0)) < 0.2 ? model : null;
  const modules = target?.layout?.panels ?? null;

  // Package sizes the installer sells for each component: the engine's alternatives and the offers' sizes.
  const sizes = useMemo(() => {
    const out: Partial<Record<keyof Design, number[]>> = {};
    (Object.keys(PART) as (keyof Design)[]).forEach((f) => {
      const c = COMP[f] ? res.components[COMP[f]!] : null;
      const xs = [...(c?.alternatives ?? []).map((x) => x.size), ...(res.variants ?? []).map((v) => v.design[f]), d[f]]
        .filter((x): x is number => typeof x === "number" && x > 0);
      out[f] = [...new Set(xs.map((x) => Math.round(x * 100) / 100))].sort((x, y) => x - y);
    });
    return out;
  }, [res]); // eslint-disable-line react-hooks/exhaustive-deps

  // Locks belong to what the planner chose on a line; a variant's sizes are the variant, not a lock.
  const [hand, setHand] = useState<Set<keyof Design>>(new Set());
  const choose = (f: keyof Design, v: OverrideValue | undefined) => {
    setHand((h) => { const n = new Set(h); if (v === undefined) n.delete(f); else n.add(f); return n; });
    p.setOverride(f, v);
  };
  const handSet = (f: keyof Design) => (hand.has(f) ? overrides[f] : undefined);

  // One source for the four offers: the engine's recommendation for the facts on screen, read without any fixed
  // sizes (a refine reports its offers relative to the sizes it was given, so its planners' pick is the edit).
  // Select, inline override, Undo and sentence only move the mark; "Your edit" follows the design on screen.
  const factsKey = JSON.stringify(p.inputs ?? null);
  const opening = useRef<Row[] | null>(null);   // until the first read lands: the offers of the draft the card opened with
  if (!opening.current) opening.current = rowsOf(p.variants).filter((r) => r.key !== "edit");
  const [offers, setOffers] = useState<{ key: string; rows: Row[] } | null>(null);
  useEffect(() => {
    if (!p.inputs) return;
    const ac = new AbortController();
    call<DesignResponse>("/api/design", { inputs: p.inputs }, ac.signal).then((r) => {
      if (r.ok && r.data.variants?.length) setOffers({ key: factsKey, rows: rowsOf(asStage(r.data.variants, r.data.design)).filter((x) => x.key !== "edit") });
    }).catch(() => {});
    return () => ac.abort();
  }, [factsKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const offersPending = !!p.inputs && offers?.key !== factsKey;
  // The approved offer, as the lead stores it, so a reopened card marks the tab the homeowner was sent.
  const [approved, setApproved] = useState<Lead["approved"] | null>(null);
  const rows = useMemo(() => {
    const same = (x: Design, y: Partial<Design> = d) => (["pv_kwp", "battery_kwh", "wallbox_kw", "heatpump_kw"] as const).every((k) => (x[k] ?? null) === (y[k] ?? null));
    const mark = <R extends Row>(r: R): R => ({ ...r, approved: !cause && !!approved?.design && same(r.design, approved.design) && (approved.variant === r.key || approved.variant === "edit" || r.key === "edit") });
    const four = (offers?.rows ?? opening.current ?? []).map((r) => ({ ...r, selected: same(r.design) }));
    if (!four.length || four.some((r) => r.selected)) return four.map(mark);
    return [...four, { key: "edit" as const, name: "Your edit", line: "as you changed it", design: d, e, pick: null, selected: true }].map(mark);
  }, [offers, d, e, approved, cause]); // eslint-disable-line react-hooks/exhaustive-deps
  const tiles = [
    { k: "Yield", v: a ? `${n0(a.pv_yield_kwh)} kWh` : "none" },
    { k: "Autarky", v: pc(e.autarky_share) },
    { k: "Investment", v: eur(e.capex_eur) },
    { k: "Break-even", v: breakEven == null ? "20+ years" : `${breakEven} years` },
  ];

  const ticks = (checks ?? []).filter((c) => !isRef(c) && scrub(c.name));
  const ref = (checks ?? []).find(isRef);
  const val = (c: Check) => c.value == null ? "" : typeof c.value !== "number" ? String(c.value) : c.unit === "share" ? pc(c.value) : c.unit === "%" ? `${n0(c.value)} %` : `${c.value >= 100 ? n0(c.value) : n2(c.value)}${c.unit && c.unit.length < 8 ? ` ${c.unit}` : ""}`;
  const refMsg = ref && (scrub(ref.message) ?? `Battery ${n2(Number(ref.value))} kWh per kWh of daily use`);

  return (
    <aside ref={box} className={`${s.panel} ${p.docked ? s.docked : s.under}`} aria-label="Offer" data-cover={p.docked ? "" : undefined}>
      <Tiles items={tiles} mode={reduce ? "fade" : mode} pending={pending} />
      <KitSheet kit={{ ...d, modules }} total={e.capex_eur} note="Estimates until the site visit" changed={hl.parts} flash={hl.n}
        edit={(f, label) => (
          <InlineOverride field={f} text={label} unit={UNIT[f]} sizes={sizes[f] ?? []} current={d[f]} set={handSet(f)} fixed={overrides[f] !== undefined}
            canNone={f !== "pv_kwp" && f !== "inverter_kw"} onChoose={choose} />
        )} />
      <VariantTabs rows={rows} pending={pending || offersPending} onPick={(r) => { if (!r.pick) return; setHand(new Set()); p.onVariant(r.pick); }} />
      {checks && checks.length > 0 && (
        <details className={`${s.ticks} ${s.checks}`} data-pending={pending || p.checksFresh === false || undefined}>
          <summary>Checks</summary>
          <ul>
            {ticks.map((c) => {
              const tone = isFail(c) ? "fail" : isInfo(c) ? "info" : "pass";
              return <li key={c.name} data-tone={tone}><i aria-hidden="true">{tone === "fail" ? "!" : tone === "pass" ? "✓" : "i"}</i>{scrub(c.name)} <b>{val(c)}</b></li>;
            })}
          </ul>
          {refMsg && <p className={refOut(ref!) ? s.refS : s.passS}>{refMsg}</p>}
        </details>
      )}
      <p className={s.confirm}>Confirm on site: roof condition and shade (estimated from the 3D model), meter and grid connection, battery location</p>
      <Approve leadId={p.leadId} approvedAt={p.approvedAt} onApprove={p.onApprove} stale={!!cause} want={rows.find((r) => r.selected && r.key !== "edit")?.key ?? null} onApproved={setApproved} undo={p.undo} />
    </aside>
  );
}
