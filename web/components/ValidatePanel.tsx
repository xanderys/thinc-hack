"use client";
import { useEffect, useState } from "react";
import { COMPONENT_DESIGN_FIELD, type ComponentKey, type Design, type HomeInputs, type ValidateResponse } from "@/lib/api";
import { call, fmt } from "@/lib/client";

const ROWS: { key: ComponentKey; name: string; unit: string; step: number }[] = [
  { key: "pv", name: "PV array", unit: "kWp", step: 0.5 },
  { key: "battery", name: "Battery", unit: "kWh", step: 0.5 },
  { key: "heatpump", name: "Heat pump", unit: "kW", step: 0.5 },
  { key: "wallbox", name: "Wallbox", unit: "kW", step: 11 },
];
const LEVEL = { ok: "OK", unusual: "Unusual", implausible: "Implausible" } as const;

const toStr = (x: number | null | undefined) => x == null ? "" : String(Math.round(x * 100) / 100);

export default function ValidatePanel({ inputs, start }: { inputs: HomeInputs; start: Design | null }) {
  const [draft, setDraft] = useState<Record<ComponentKey, string>>(() => ({
    pv: toStr(start?.pv_kwp), battery: toStr(start?.battery_kwh), heatpump: toStr(start?.heatpump_kw), wallbox: toStr(start?.wallbox_kw),
  }));
  const [inverter, setInverter] = useState(toStr(start?.inverter_kw));
  const [res, setRes] = useState<ValidateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const ctl = new AbortController();
    const num = (s: string) => { const n = Number(s); return s.trim() === "" || !Number.isFinite(n) || n <= 0 ? null : n; };
    const design: Design = {
      pv_kwp: num(draft.pv), inverter_kw: num(draft.pv) == null ? null : num(inverter),
      battery_kwh: num(draft.battery), heatpump_kw: num(draft.heatpump), wallbox_kw: num(draft.wallbox),
    };
    const t = setTimeout(async () => {
      try {
        const r = await call<ValidateResponse>("/api/validate", { inputs, design }, ctl.signal);
        if (r.ok) { setRes(r.data); setError(null); } else setError(r.error);
      } catch { /* superseded */ }
    }, 300);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [draft, inverter, inputs, retry]);

  return (
    <section aria-label="Validate a design">
      {error && (
        <div className="error" role="alert">
          <span><span className="src">Engine said</span>{error}</span>
          <button className="btn ghost" onClick={() => setRetry((x) => x + 1)}>Retry</button>
        </div>
      )}
      {ROWS.map(({ key, name, unit, step }) => {
        const f = res?.flags.find((x) => x.component === key);
        const nb = f?.neighbours;
        const id = `val-${key}`;
        return (
          <div className={`comp val ${f?.level ?? ""}`} key={key}>
            <div className="name"><label htmlFor={id}>{name}</label>
              <small>Empty means none</small>
            </div>
            <div className="fix">
              <input id={id} type="number" className="num" min={0} step={step} value={draft[key]} placeholder="none"
                onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))} />
              <span className="unit">{unit}</span>
              {key === "pv" && <>
                <input type="number" className="num" aria-label="Inverter in kW" min={0} step={0.5} value={inverter} placeholder="inverter"
                  onChange={(e) => setInverter(e.target.value)} />
                <span className="unit">kW inverter</span>
              </>}
            </div>
            <div className="body" aria-live="polite">
              {f && <p><span className="lvl">{LEVEL[f.level]}</span> {f.message}</p>}
              {nb && (
                <p className="evidence">
                  Homes like this one: <span className="num">{nb.n}</span>, <span className="num">{fmt.pct(nb.share_included)}</span> include one
                  {nb.median_size != null && <>, median <span className="num">{fmt.n(nb.median_size)} {unit}</span></>}
                  {nb.p25 != null && nb.p75 != null && <> (<span className="num">{fmt.n(nb.p25)}</span> to <span className="num">{fmt.n(nb.p75)}</span>)</>}.
                </p>
              )}
            </div>
          </div>
        );
      })}
    </section>
  );
}
