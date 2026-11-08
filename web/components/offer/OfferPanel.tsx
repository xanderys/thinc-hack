// The rolling offer: four numbers, the kit, one line per installed component, the four offers, the sanity
// ticks, what to confirm on site, Approve. Always visible: beside the house on desktop, under it on a phone.
// It holds no design state of its own; every change goes through Stage (overrides, variants, Approve).
import { useEffect, useMemo, useRef, useState } from "react";
import type { Design, DesignResponse, Economics, OverrideValue, Overrides } from "@/lib/api";
import type { Variant as StageVariant } from "@/components/stage/Plan";
import type { Check, RoofModel } from "@/components/spatial/types";
import { facing } from "@/components/spatial/facing";
import { eur, n0, n1, n2, pc, type Part } from "./format";
import Tiles, { type TileMode } from "./Tiles";
import KitDiagram from "./KitDiagram";
import VariantTabs, { rowsOf } from "./VariantTabs";
import InlineOverride, { type LineField } from "./InlineOverride";
import Approve from "./Approve";
import s from "./offer.module.css";

export type OfferProps = {
  res: DesignResponse; economics: Economics; breakEven: number | null;
  cause: string | null; pending: boolean;
  variants: StageVariant[]; onVariant: (v: StageVariant) => void;
  checks?: Check[] | null; model?: RoofModel | null;
  overrides: Overrides; setOverride: (f: keyof Design, v: OverrideValue | undefined) => void;
  approvedAt: string | null; onApprove: () => void; leadId?: string | null;
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
const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);

function useReduce() {
  const [r, setR] = useState(false);
  useEffect(() => { const m = matchMedia("(prefers-reduced-motion: reduce)"); setR(m.matches); const f = () => setR(m.matches); m.addEventListener("change", f); return () => m.removeEventListener("change", f); }, []);
  return r;
}

export default function OfferPanel(p: OfferProps) {
  const { res, economics: e, breakEven, cause, pending, checks, model, overrides } = p;
  const d = res.design, a = e.annual;
  const reduce = useReduce();
  const mode: TileMode = cause && !/^Switched to/.test(cause) ? "arrow" : "fade";

  // Boxes that changed light once; the counter restarts the ring.
  const last = useRef<Design>(d);
  const [hl, setHl] = useState<{ parts: Part[]; n: number }>({ parts: [], n: 0 });
  useEffect(() => {
    const was = last.current; last.current = d;
    const parts = (Object.keys(PART) as (keyof Design)[]).filter((k) => (was[k] ?? null) !== (d[k] ?? null)).map((k) => PART[k]);
    if (parts.length && !reduce) setHl((x) => ({ parts, n: x.n + 1 }));
  }, [d.pv_kwp, d.inverter_kw, d.battery_kwh, d.wallbox_kw, d.heatpump_kw]); // eslint-disable-line react-hooks/exhaustive-deps

  // Modules and faces from the layout the house shows, when it matches the size on screen.
  const target = model?.layout && Math.abs(model.layout.kwp - (d.pv_kwp ?? 0)) < 0.2 ? model : null;
  const modules = target?.layout?.panels ?? null;
  const faces = useMemo(() => {
    const ORDER = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west", "flat"];
    const w = [...new Set((target?.planes ?? []).filter((q) => q.chosen_panels?.length).map((q) => facing(q.azimuth)))].sort((x, y) => ORDER.indexOf(x) - ORDER.indexOf(y));
    if (!w.length) return null;
    return w.length === 1 ? `${w[0]} face` : `${w.slice(0, -1).join(", ")} and ${w.at(-1)} faces`;
  }, [target]);

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

  const lines: { f: LineField; text: string }[] = [];
  if (d.pv_kwp) lines.push({ f: "pv_kwp", text: `${modules ? `${modules} modules, ` : ""}${n2(d.pv_kwp)} kWp${faces ? `, ${faces}` : ""}` });
  else if (handSet("pv_kwp") === null) lines.push({ f: "pv_kwp", text: "No solar" });
  if (d.inverter_kw) lines.push({ f: "inverter_kw", text: `${n1(d.inverter_kw)} kW inverter` });
  if (d.battery_kwh) lines.push({ f: "battery_kwh", text: `${n1(d.battery_kwh)} kWh battery` });
  else if (handSet("battery_kwh") === null) lines.push({ f: "battery_kwh", text: "No battery" });
  if (d.wallbox_kw) lines.push({ f: "wallbox_kw", text: `${n1(d.wallbox_kw)} kW wallbox` });
  else if (handSet("wallbox_kw") === null) lines.push({ f: "wallbox_kw", text: "No wallbox" });
  if (d.heatpump_kw) lines.push({ f: "heatpump_kw", text: `${n1(d.heatpump_kw)} kW heat pump` });
  else if (handSet("heatpump_kw") === null) lines.push({ f: "heatpump_kw", text: "No heat pump" });

  const rows = useMemo(() => rowsOf(p.variants), [p.variants]);
  const tiles = [
    { k: "Yield", v: a ? `${n0(a.pv_yield_kwh)} kWh` : "none" },
    { k: "Autarky", v: pc(e.autarky_share) },
    { k: "Investment", v: eur(e.capex_eur) },
    { k: "Break-even", v: breakEven == null ? "20+ years" : `${breakEven} years` },
  ];

  const ticks = (checks ?? []).filter((c) => !isRef(c));
  const ref = (checks ?? []).find(isRef);
  const val = (c: Check) => c.value == null ? "" : typeof c.value !== "number" ? String(c.value) : c.unit === "share" ? pc(c.value) : c.unit === "%" ? `${n0(c.value)} %` : `${c.value >= 100 ? n0(c.value) : n2(c.value)}${c.unit && c.unit.length < 8 ? ` ${c.unit}` : ""}`;
  const refMsg = ref && (ref.message ?? `Battery ${n2(Number(ref.value))} kWh per kWh of daily use: ${refOut(ref) ? "above" : "inside"} Reonic's guide`);

  return (
    <aside className={`${s.panel} ${p.docked ? s.docked : s.under}`} aria-label="Offer" data-cover={p.docked ? "" : undefined}>
      <Tiles items={tiles} mode={reduce ? "fade" : mode} pending={pending} />
      <KitDiagram kit={{ ...d, modules }} changed={hl.parts} flash={hl.n} />
      <ul className={s.unpriced}>
        {d.battery_kwh ? <li>Energy management and smart meter: included with the battery</li> : null}
        <li>Backup power: optional</li>
      </ul>
      <div className={s.lines}>
        {lines.map((l) => (
          <InlineOverride key={l.f} field={l.f} text={l.text} unit={UNIT[l.f]} sizes={sizes[l.f] ?? []} current={d[l.f]} set={handSet(l.f)} fixed={overrides[l.f] !== undefined}
            canNone={l.f !== "pv_kwp" && l.f !== "inverter_kw"} glyph={PART[l.f]} onChoose={choose} />
        ))}
      </div>
      <VariantTabs rows={rows} pending={pending} onPick={(r) => { if (!r.pick) return; setHand(new Set()); p.onVariant(r.pick); }} />
      {checks && checks.length > 0 && (
        <div className={s.ticks}>
          <ul>
            {ticks.map((c) => {
              const tone = isFail(c) ? "fail" : isInfo(c) ? "info" : "pass";
              return <li key={c.name} data-tone={tone} title={c.band}><i aria-hidden="true">{tone === "fail" ? "!" : tone === "pass" ? "✓" : "i"}</i>{cap(c.name)} <b>{val(c)}</b></li>;
            })}
          </ul>
          {refMsg && <p className={refOut(ref!) ? s.refS : s.passS}>{refMsg}</p>}
        </div>
      )}
      <p className={s.confirm}>Confirm on site: roof condition and shade (estimate from the surface model), meter and grid connection, battery location</p>
      <Approve leadId={p.leadId} approvedAt={p.approvedAt} onApprove={p.onApprove} stale={!!cause} />
    </aside>
  );
}
