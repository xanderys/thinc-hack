"use client";
import { useRef, useState } from "react";
import type { Design, DesignResponse, Economics, HomeInputs, Overrides, WriteResponse } from "@/lib/api";
import House from "./House";
import dynamic from "next/dynamic";
const SpatialDemo = dynamic(() => import("@/components/spatial/SpatialDemo"), { ssr: false });
import Flow from "./Flow";
import Rules from "./Rules";
import Why from "./Why";
import { INSTALLER_NAME } from "@/lib/api";
import { designLine, evidence, KEYS, n0, n2, NAME, named, pct, size } from "@/lib/stage";

export type Variant = { name: string; tag: string; design: Design; e: Economics | null; overrides: Overrides | null; current: boolean; note?: string };

type Props = {
  res: DesignResponse; prev: DesignResponse | null; inputs: HomeInputs;
  write: WriteResponse | null; writeBusy: boolean; flag: string | null;
  variants: Variant[]; onVariant: (v: Variant) => void; busy: boolean; answered: boolean;
};

function Est({ k, v, u, was }: { k: string; v: string; u: string; was?: string | null }) {
  return (
    <div><dt>{k}</dt><dd><span key={v} className={was ? "s-mark" : undefined}>{v}</span><span className="u">{u}</span>{was && <span className="was">was {was}</span>}</dd></div>
  );
}

export default function Plan({ res, prev, inputs, write, writeBusy, flag, variants, onVariant, busy, answered }: Props) {
  const [open, setOpen] = useState<string | null>(null);
  const [level, setLevel] = useState(1);
  const [closing, setClosing] = useState(false);
  const [ox, setOx] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The real house in 3D when the engine has a model for the address; the line drawing otherwise. Opens on Panels.
  const [spatial, setSpatial] = useState(false);
  const [layer3, setLayer3] = useState(3);
  const address = inputs.address ?? inputs.roof?.matched_address;
  const installer = INSTALLER_NAME[inputs.installer_id as keyof typeof INSTALLER_NAME] ?? "this installer";
  // Opens out of the tapped number and closes back into it; a tap mid-close reopens at once.
  const toggle = (k: string, el: HTMLElement | null) => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (el) { const r = el.getBoundingClientRect(); setOx(r.left + r.width / 2); }
    if (open === k && !closing) {
      setClosing(true);
      const rm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      timer.current = setTimeout(() => { setOpen(null); setClosing(false); setLevel(1); }, rm ? 200 : 500);
    } else { if (open !== k) setLevel(1); setOpen(k); setClosing(false); }
  };
  const e = res.economics, pe = prev?.economics, a = e.annual, pa = pe?.annual;
  const was = (now: number, then: number | undefined | null, f: (x: number) => string) => then != null && f(then) !== f(now) ? f(then) : null;
  const moved = !!prev && JSON.stringify(prev.design) !== JSON.stringify(res.design);
  const roofMsg = res.plausibility.find((p) => /^The roof fits/.test(p.message))?.message;
  const roofLine = roofMsg ? { text: roofMsg.replace(/\s*\(([^)]*)\)\.?$/, "."), credit: roofMsg.match(/\(([^)]*)\)\.?$/)?.[1] } : null;
  const prose = write?.grounded ? write.text : !writeBusy ? named(res.explanation.slice(0, 3).join(" ")) : null;

  return (
    <section className="s-plan" aria-label="Plan system" aria-busy={busy}>
      <p className="s-steps">Read, asked one thing, designed, checked, drafted. The planner signs off.</p>
      <p className="s-prose" aria-live="polite">
        {prose ?? <span className="s-wait">Writing</span>}
        {prose && <span className={flag ? "flag" : "flag none"}> {flag ? <>One thing to check: {named(flag)}</> : "Nothing to check."}</span>}
      </p>

      {address && (
        <div className="s-spatial">
          <SpatialDemo inputs={inputs} design={res.design} address={address} response={res} layer={layer3} onLayerChange={setLayer3} onAvailable={setSpatial} />
        </div>
      )}
      <div className={spatial ? "s-top solo" : "s-top"}>
        <div className="s-house">
          {!spatial && <House design={res.design} />}
          {roofLine && <p className="s-roof" title={roofLine.credit}>{roofLine.text}</p>}
        </div>
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
                {c.derivation ? (
                  <button className={open === k && !closing ? "num-b open" : "num-b"} aria-expanded={open === k && !closing} aria-label={`Why ${NAME[k]} ${v == null ? "none" : n2(v)}`} onClick={(ev) => toggle(k, ev.currentTarget)}>
                    <span key={String(v)} className={pv !== undefined && pv !== v ? "s-mark" : undefined}>{v == null ? "None" : <>{n2(v)}<span className="u">{c.unit}</span></>}</span>
                  </button>
                ) : <span key={String(v)} className={pv !== undefined && pv !== v ? "s-mark" : undefined}>{v == null ? "None" : <>{n2(v)}<span className="u">{c.unit}</span></>}</span>}
                {pv !== undefined && pv !== v && <span className="was">was {pv == null ? "none" : n2(pv)}</span>}
              </span>
              <span className="say">{line ?? <span className="s-wait">Writing</span>}</span>
              <button className="why" aria-expanded={open === k && !closing} onClick={(ev) => toggle(k, (ev.currentTarget.parentElement?.querySelector(".num-b") as HTMLElement | null) ?? ev.currentTarget)}>Why</button>
              {open === k && (c.derivation
                ? <Why k={k} d={c.derivation} level={level} onMore={setLevel} answered={answered} installer={installer} closing={closing} ox={ox} evKwh={inputs.has_ev ? res.economics.annual?.ev_charge_kwh : null} rules={!!res.rules?.length} />
                : <div className="ev s-in">{evidence(res, k, inputs.installer_id)} {named(c.reason)}</div>)}
            </div>
          );
        })}
      </div>
      <Rules rules={res.rules} installer={installer} />

      {variants.length > 1 && (
        <div className="s-variants">
          <h3 className="s-h3">Offer variants</h3>
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
                {v.note && <span className="vnote">{v.note}</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
