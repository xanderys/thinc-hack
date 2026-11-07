"use client";
import { useState } from "react";
import type { Design, DesignResponse, Economics, HomeInputs, Overrides, WriteResponse } from "@/lib/api";
import House from "./House";
import Flow from "./Flow";
import { designLine, evidence, KEYS, n0, n2, NAME, named, pct, size } from "@/lib/stage";

export type Variant = { name: string; tag: string; design: Design; e: Economics | null; overrides: Overrides | null; current: boolean };

type Props = {
  res: DesignResponse; prev: DesignResponse | null; inputs: HomeInputs;
  write: WriteResponse | null; writeBusy: boolean; flag: string | null;
  variants: Variant[]; onVariant: (v: Variant) => void; busy: boolean;
};

function Est({ k, v, u, was }: { k: string; v: string; u: string; was?: string | null }) {
  return (
    <div><dt>{k}</dt><dd><span key={v} className={was ? "s-mark" : undefined}>{v}</span><span className="u">{u}</span>{was && <span className="was">was {was}</span>}</dd></div>
  );
}

export default function Plan({ res, prev, inputs, write, writeBusy, flag, variants, onVariant, busy }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const e = res.economics, pe = prev?.economics, a = e.annual, pa = pe?.annual;
  const was = (now: number, then: number | undefined | null, f: (x: number) => string) => then != null && f(then) !== f(now) ? f(then) : null;
  const moved = !!prev && JSON.stringify(prev.design) !== JSON.stringify(res.design);
  const prose = write?.grounded ? write.text : !writeBusy ? named(res.explanation.slice(0, 3).join(" ")) : null;

  return (
    <section className="s-plan" aria-label="Plan system" aria-busy={busy}>
      <p className="s-prose" aria-live="polite">
        {prose ?? <span className="s-wait">Writing</span>}
        {prose && flag && <span className="flag"> One thing to check: {named(flag)}</span>}
      </p>

      <div className="s-top">
        <div className="s-house"><House design={res.design} /></div>
        <div>
          <dl className="s-est">
            {a && <Est k="Solar yield a year" v={n0(a.pv_yield_kwh)} u="kWh" was={was(a.pv_yield_kwh, pa?.pv_yield_kwh, n0)} />}
            <Est k="Autarky" v={pct(e.autarky_share)} u="%" was={was(e.autarky_share, pe?.autarky_share, pct)} />
            <Est k="Investment" v={n0(e.capex_eur)} u="EUR" was={was(e.capex_eur, pe?.capex_eur, n0)} />
            <Est k="Payback" v={e.payback_years == null ? "None" : n2(Math.round(e.payback_years * 10) / 10)} u={e.payback_years == null ? "" : "years"} was={e.payback_years == null ? null : was(e.payback_years, pe?.payback_years, (x) => n2(Math.round(x * 10) / 10))} />
          </dl>
          <p className="s-estnote">{e.method === "hourly-simulation" ? "Estimates from an hourly simulation of a typical Munich year." : "Estimates from annual averages."}</p>
          <Flow e={e} design={res.design} hasEv={inputs.has_ev} moved={moved} />
        </div>
      </div>

      <div className="s-comps">
        {KEYS.map((k) => {
          const c = res.components[k], v = size(res.design, k), pv = prev ? size(prev.design, k) : undefined;
          const line = write?.lines?.[k] ?? (writeBusy ? null : named(c.reason));
          return (
            <div className="s-comp" key={k}>
              <span className="n">{NAME[k]}</span>
              <span className={v == null ? "s none" : "s"}>
                <span key={String(v)} className={pv !== undefined && pv !== v ? "s-mark" : undefined}>{v == null ? "None" : <>{n2(v)}<span className="u">{c.unit}</span></>}</span>
                {pv !== undefined && pv !== v && <span className="was">was {pv == null ? "none" : n2(pv)}</span>}
              </span>
              <span className="say">{line ?? <span className="s-wait">Writing</span>}</span>
              <button className="why" aria-expanded={open === k} onClick={() => setOpen(open === k ? null : k)}>Why</button>
              {open === k && <div className="ev s-in">{evidence(res, k, inputs.installer_id)} {named(c.reason)}</div>}
            </div>
          );
        })}
      </div>

      {variants.length > 1 && (
        <div className="s-variants">
          <h3 className="s-h3">Variants</h3>
          <div className="vrow">
            {variants.map((v) => (
              <button key={v.name} className={v.current ? "v on" : "v"} aria-pressed={v.current} disabled={v.current || !v.overrides} onClick={() => onVariant(v)}>
                <span className="vh"><span className="vn">{v.name}</span><span className="tagr">{v.tag}</span></span>
                <span className="vs">{designLine(v.design)}</span>
                {v.e ? (
                  <span className="vd">
                    <span><span className="dt">Yield</span><span className="dd">{v.e.annual ? `${n0(v.e.annual.pv_yield_kwh)} kWh` : "None"}</span></span>
                    <span><span className="dt">Autarky</span><span className="dd">{pct(v.e.autarky_share)}%</span></span>
                    <span><span className="dt">Investment</span><span className="dd">{n0(v.e.capex_eur)} EUR</span></span>
                    <span><span className="dt">Payback</span><span className="dd">{v.e.payback_years == null ? "None" : `${n2(Math.round(v.e.payback_years * 10) / 10)} years`}</span></span>
                  </span>
                ) : <span className="s-wait">Simulating</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
