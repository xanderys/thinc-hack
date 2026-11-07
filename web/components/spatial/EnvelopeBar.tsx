"use client";
// Heat pump step: the heat-loss bar by element (the x-ray's numbers and colours), the step sentence and the
// "With heat pump" variant row, which re-runs the design through /api/refine with the heat pump included.
import { useEffect, useState } from "react";
import type { DesignResponse, HomeInputs, Overrides } from "@/lib/api";
import { call } from "@/lib/client";
import type { Envelope } from "./types";
import { constantsOf, elementsOf, windowNote } from "@/lib/envelope";
import type { Variant } from "@/components/stage/Plan";
import s from "./EnvelopeBar.module.css";

const n0 = (x: number) => Math.round(x).toLocaleString("en-GB");
const n1 = (x: number) => (Math.round(x * 10) / 10).toLocaleString("en-GB");
const eur = (x: number) => `${x < 0 ? "-" : ""}€${n0(Math.abs(x))}`;
const deg = (x: number) => `${x < 0 ? "−" : ""}${Math.abs(x)} °C`;

const pc = (x: number) => `${Math.round(x * 100)} %`;

// Leads on the shares (the same numbers and colours as the x-ray); the envelope total is an upper bound, in small type.
export function EnvelopeBar({ env }: { env: Envelope }) {
  const { list, total } = elementsOf(env);
  const c = constantsOf(env);
  const win = windowNote(env);
  return (
    <div className={s.bar}>
      <div className={s.head}><span>Where the heat goes</span></div>
      <div className={s.track}>{list.filter((e) => e.w > 0).map((e) => <span key={e.key} style={{ flex: e.w, background: e.colour }} title={`${e.name} ${pc(e.share)}, ${n0(e.w)} W`} />)}</div>
      <ul className={s.legend}>
        {list.map((e) => (
          <li key={e.key} title={e.note ?? undefined}><i style={{ background: e.colour }} />{e.name} <b>{pc(e.share)}</b><span className={s.w}>{n0(e.w)} W{e.key === "window" && win ? `, ${win}` : e.w === 0 && e.note ? `, ${e.note}` : ""}</span></li>
        ))}
      </ul>
      <p className={s.tag}>Upper bound from the envelope, {n1(total / 1000)} kW at {deg(c.design_outdoor_c)}; estimated from address{env.build_year ? `, built ${env.build_year}` : ""}</p>
      <details className={s.consts}>
        <summary>Constants</summary>
        <p title={c.bivalence_source ?? undefined}>Bivalence point <b>{deg(c.bivalence_c)}</b></p>
        <p title={c.hot_water_source ?? undefined}>Hot water <b>{n1(c.hot_water_kw_per_person)} kW</b> per person</p>
      </details>
    </div>
  );
}

type StepProps = {
  res: DesignResponse; inputs: HomeInputs; env: Envelope | null; multi: boolean;
  variants: Variant[]; onVariant: (v: Variant) => void;
};

export function HeatPumpStep({ res, inputs, env, multi, variants, onVariant }: StepProps) {
  const d = res.design, has = !!d.heatpump_kw;
  const cur = variants.find((v) => v.current)?.overrides ?? {};
  const overrides: Overrides = { ...cur, heatpump_kw: "include" };
  const key = JSON.stringify([inputs, overrides, d]);
  const [alt, setAlt] = useState<{ key: string; r: DesignResponse } | null>(null);
  useEffect(() => {
    if (has) return;
    const ac = new AbortController();
    call<DesignResponse>("/api/refine", { inputs, overrides }, ac.signal)
      .then((r) => { if (r.ok && r.data.design.heatpump_kw) setAlt({ key, r: r.data }); })
      .catch(() => {});
    return () => ac.abort();
  }, [key, has]); // eslint-disable-line react-hooks/exhaustive-deps
  const a = alt && alt.key === key ? alt.r : null;
  const plus = a ? a.economics.capex_eur - res.economics.capex_eur : null;

  return (
    <div className={s.step}>
      {has ? (
        <p className={s.sentence}><b>{n1(d.heatpump_kw!)} kW</b> heat pump, sized from the heating bill.</p>
      ) : (
        <p className={s.sentence}>None, not asked.{a && plus != null ? <> If asked: <b>{n1(a.design.heatpump_kw!)} kW</b>, +{eur(plus)}.</> : null}</p>
      )}
      {/* Apartment buildings: the chain says why there is no heat load (Chain.tsx). */}
      {!multi && env ? <EnvelopeBar env={env} /> : null}
      {!has && a && plus != null && (
        <div className={s.vrow}>
          <div>With heat pump: <b>{n1(a.design.heatpump_kw!)} kW</b>, +{eur(plus)}{a.economics.payback_years != null ? `, payback ${n1(a.economics.payback_years)} years` : ""}</div>
          <button type="button" className={s.vbtn}
            onClick={() => onVariant({ name: "With heat pump", tag: "heatpump", design: a.design, e: a.economics, overrides, current: false })}>Select</button>
        </div>
      )}
    </div>
  );
}
