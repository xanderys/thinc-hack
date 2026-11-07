"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import HomeForm from "@/components/HomeForm";
import DesignSheet from "@/components/DesignSheet";
import ValidatePanel from "@/components/ValidatePanel";
import OptimumBlock from "@/components/OptimumBlock";
import type { Design, DesignResponse, HomeInputs, InterpretChange, InterpretResponse, RefineResponse } from "@/lib/api";
import { call, fmt, COMPONENT_NAME } from "@/lib/client";
import type { DiffItem, InterpretOverride, OverrideValue, Overrides } from "@/lib/api";

const DESIGN_KEY: Record<keyof Design, string> = { pv_kwp: "pv", inverter_kw: "inverter", battery_kwh: "battery", heatpump_kw: "heatpump", wallbox_kw: "wallbox" };
const COMPONENT_FIELD: Record<string, keyof Design> = { pv: "pv_kwp", inverter: "inverter_kw", battery: "battery_kwh", heatpump: "heatpump_kw", wallbox: "wallbox_kw" };

const START: HomeInputs = {
  installer_id: "2a8ba8e2", annual_demand_kwh: 5000, load_profile: "FamilyOfFour", num_inhabitants: 4,
  house_size_sqm: 140, house_built_year: 1985, has_ev: false, has_wallbox: false, heating_type: "Gas",
  electricity_price_ct_kwh: 32, has_solar: false, has_storage: false,
};

const FIELD_LABEL: Partial<Record<keyof HomeInputs, string>> = {
  annual_demand_kwh: "Demand", num_inhabitants: "Inhabitants", has_ev: "EV", ev_annual_km: "EV distance",
  has_wallbox: "Wallbox", heating_type: "Heating", house_size_sqm: "Floor area", house_built_year: "Year built",
  electricity_price_ct_kwh: "Price", has_solar: "Solar", existing_solar_kwp: "Existing solar",
  has_storage: "Battery", existing_storage_kwh: "Existing battery", load_profile: "Load profile", installer_id: "Installer",
};
function describe(a: HomeInputs, b: HomeInputs) {
  const keys = (Object.keys({ ...a, ...b }) as (keyof HomeInputs)[]).filter((k) => a[k] !== b[k]);
  if (keys.length === 0) return "Recomputed.";
  return keys.slice(0, 3).map((k) => `${FIELD_LABEL[k] ?? k} ${show(a[k])} to ${show(b[k])}`).join(", ") + ".";
}
const showOv = (x: OverrideValue) => x === "include" ? "include" : x == null ? "none" : `fixed at ${x.toLocaleString("en-GB")}`;
const show = (x: unknown) => x == null ? "none" : typeof x === "boolean" ? (x ? "yes" : "no") : typeof x === "number" ? x.toLocaleString("en-GB") : String(x);

export default function Planner() {
  const [inputs, setInputs] = useState<HomeInputs>(START);
  const [overrides, setOverrides] = useState<Overrides>({});
  const [validate, setValidate] = useState(false);
  const [res, setRes] = useState<DesignResponse | RefineResponse | null>(null);
  const [prev, setPrev] = useState<Design | null>(null);
  const [moved, setMoved] = useState<DiffItem[]>([]);
  const cause = useRef<string>("");
  const lastInputs = useRef<HomeInputs>(START);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const last = useRef<Design | null>(null);

  const [sentence, setSentence] = useState("");
  const [chips, setChips] = useState<InterpretChange[]>([]);
  const [ovChips, setOvChips] = useState<InterpretOverride[]>([]);
  const [llm, setLlm] = useState<boolean | null>(null);
  const [llmBusy, setLlmBusy] = useState(false);
  const [llmError, setLlmError] = useState<string | null>(null);

  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get("home");
    if (!raw) return;
    try { const h = JSON.parse(raw) as Partial<HomeInputs>; cause.current = "Loaded a held-out home."; setInputs({ ...START, num_inhabitants: undefined, house_size_sqm: undefined, house_built_year: undefined, ...h }); } catch { /* ignore a malformed link */ }
  }, []);

  useEffect(() => { call<{ available: boolean }>("/api/interpret").then((r) => setLlm(r.ok ? r.data.available : false)); }, []);

  useEffect(() => {
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      setBusy(true);
      const fixed = Object.keys(overrides).length > 0;
      try {
        const r = fixed
          ? await call<RefineResponse>("/api/refine", { inputs, overrides }, ctl.signal)
          : await call<DesignResponse>("/api/design", { inputs }, ctl.signal);
        if (r.ok) {
          const before = last.current;
          const engineDiff: DiffItem[] = "diff" in r.data ? (r.data as RefineResponse).diff : [];
          const why = cause.current || describe(lastInputs.current, inputs);
          const local: DiffItem[] = before ? (Object.keys(DESIGN_KEY) as (keyof Design)[])
            .filter((k) => before[k] !== r.data.design[k] && !engineDiff.some((d) => d.component === DESIGN_KEY[k]))
            .map((k) => ({ component: DESIGN_KEY[k], from: before[k], to: r.data.design[k], why })) : [];
          const fresh = engineDiff.filter((d) => !before || !(d.component in COMPONENT_FIELD) || before[COMPONENT_FIELD[d.component]] !== d.to);
          if (before) setMoved([...fresh, ...local].filter((d) => d.from !== d.to));
          cause.current = ""; lastInputs.current = inputs;
          setPrev(before);
          last.current = r.data.design;
          setRes(r.data);
          setVersion((v) => v + 1);
          setError(null);
        } else setError(r.error);
        setBusy(false);
      } catch { /* aborted by a newer change */ }
    }, 300);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [inputs, overrides, retry]);

  useEffect(() => {
    if (!error?.includes("restarting")) return;
    const t = setTimeout(() => setRetry((x) => x + 1), 8000);
    return () => clearTimeout(t);
  }, [error, retry]);

  const setOverride = useCallback((field: keyof Design, value: OverrideValue | undefined) => {
    cause.current = "Set by the planner.";
    setOvChips((c) => c.filter((x) => x.field !== field));
    setOverrides((o) => {
      const n = { ...o };
      if (value === undefined) delete n[field]; else n[field] = value;
      return n;
    });
  }, []);

  async function interpret() {
    setLlmBusy(true); setLlmError(null);
    const r = await call<InterpretResponse>("/api/interpret", { sentence, inputs, design: res?.design ?? {}, overrides, typical: res ? Object.fromEntries((Object.keys(res.components) as (keyof typeof res.components)[]).map((k) => [COMPONENT_FIELD[k], res.components[k].neighbours.median_size])) : {} });
    setLlmBusy(false);
    if (!r.ok) { setLlmError(r.error); return; }
    const ovs = r.data.overrides ?? [];
    if (r.data.changes.length === 0 && ovs.length === 0) { setLlmError("Nothing in that sentence changes the home."); return; }
    cause.current = `"${sentence.trim()}"`;
    setChips((c) => [...c.filter((x) => !r.data.changes.some((y) => y.field === x.field)), ...r.data.changes]);
    setOvChips((c) => [...c.filter((x) => !ovs.some((y) => y.field === x.field)), ...ovs]);
    if (ovs.length) setOverrides((o) => { const n = { ...o }; for (const v of ovs) n[v.field] = v.to; return n; });
    setInputs(r.data.inputs);
    setSentence("");
  }

  function removeOvChip(ch: InterpretOverride) {
    setOvChips((c) => c.filter((x) => x !== ch));
    cause.current = "Planner choice removed.";
    setOverrides((o) => { const n = { ...o }; if (ch.from === undefined) delete n[ch.field]; else n[ch.field] = ch.from; return n; });
  }

  function removeChip(ch: InterpretChange) {
    setChips((c) => c.filter((x) => x !== ch));
    setInputs((i) => {
      const n = { ...i } as Record<string, unknown>;
      if (ch.from == null) delete n[ch.field]; else n[ch.field] = ch.from;
      return n as unknown as HomeInputs;
    });
  }

  const diff = moved;
  const reasons = new Set(res ? Object.values(res.components).map((c) => c.reason) : []);
  const e = res?.economics;

  return (
    <div className="planner">
      <aside>
        <HomeForm value={inputs} onChange={setInputs} />
      </aside>

      <div>
        <div className="sheet-head">
          <h1>{validate ? "Your design" : "Proposed system"}</h1>
          <span className="status" aria-live="polite">{busy && !validate ? "Recomputing" : ""}</span>
        </div>
        <span className="seg mode" role="group" aria-label="Mode">
          <button type="button" aria-pressed={!validate} onClick={() => setValidate(false)}>Propose</button>
          <button type="button" aria-pressed={validate} onClick={() => setValidate(true)}>Validate my design</button>
        </span>

        {validate ? <ValidatePanel inputs={inputs} start={res?.design ?? null} /> : <>

        {error && (
          <div className="error" role="alert">
            <span><span className="src">Engine said</span>{error}</span>
            <button className="btn ghost" onClick={() => setRetry((x) => x + 1)}>Retry</button>
          </div>
        )}

        {!res && !error && (
          <div aria-hidden>
            {[0, 1, 2, 3].map((k) => (
              <div className="comp" key={k}><div className="skeleton">PV array</div><div className="skeleton size">00.0</div><div className="skeleton">Reason sentence placeholder for loading</div></div>
            ))}
          </div>
        )}

        {res && (
          <>
            <DesignSheet res={res} prev={prev} version={version} overrides={overrides} setOverride={setOverride} />

            <div className="refine">
              <h2>Tell it what changes</h2>
              {llm === false ? (
                <p className="note">Sentence input is off: no ANTHROPIC_API_KEY in web/.env.local. The fields and Fix controls still work.</p>
              ) : (
                <form className="say" onSubmit={(ev) => { ev.preventDefault(); if (sentence.trim()) interpret(); }}>
                  <input value={sentence} onChange={(ev) => setSentence(ev.target.value)} placeholder="The family buys an EV next year"
                    aria-label="Describe a change to the home" disabled={llmBusy} />
                  <button className="btn" type="submit" disabled={llmBusy || !sentence.trim()}>{llmBusy ? "Reading" : "Apply"}</button>
                </form>
              )}
              {llmError && <div className="error" role="alert"><span><span className="src">Interpreter said</span>{llmError}</span></div>}
              {(chips.length > 0 || ovChips.length > 0) && (
                <div className="chips">
                  {chips.map((c) => (
                    <span className="chip" key={`${c.field}-${String(c.to)}`} title={c.note}>
                      <span>{FIELD_LABEL[c.field] ?? c.field}: <span className="num">{show(c.from)}</span> to <span className="num">{show(c.to)}</span></span>
                      <button aria-label={`Undo ${FIELD_LABEL[c.field] ?? c.field}`} onClick={() => removeChip(c)}>×</button>
                    </span>
                  ))}
                  {ovChips.map((c) => (
                    <span className="chip" key={`${c.field}-${String(c.to)}`} title={c.note}>
                      <span>{COMPONENT_NAME[DESIGN_KEY[c.field]]}: <span className="num">{showOv(c.to)}</span></span>
                      <button aria-label={`Undo ${COMPONENT_NAME[DESIGN_KEY[c.field]]}`} onClick={() => removeOvChip(c)}>×</button>
                    </span>
                  ))}
                </div>
              )}

              {diff.length > 0 && (
                <div className="scroll">
                  <table className="diff">
                    <thead><tr><th>What moved</th><th>From</th><th></th><th>To</th><th>Why</th></tr></thead>
                    <tbody>
                      {diff.map((d, k) => (
                        <tr key={k}>
                          <td>{COMPONENT_NAME[d.component] ?? d.component}</td>
                          <td className="num">{fmt.n(d.from)}</td>
                          <td className="arrow" aria-hidden>→</td>
                          <td className="num">{fmt.n(d.to)}</td>
                          <td>{d.why}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="two">
              <div>
                <h2>{e?.method === "hourly-simulation" ? "Economics, hourly simulation" : "Rough economics"}</h2>
                {e && (
                  <>
                    <dl className="figures">
                      <div><dt>Investment</dt><dd className="num">{fmt.eur(e.capex_eur)}</dd></div>
                      <div><dt>Saving a year</dt><dd className="num">{fmt.eur(e.annual_saving_eur)}</dd></div>
                      <div><dt>Payback</dt><dd className="num">{e.payback_years == null ? "n/a" : `${fmt.n(e.payback_years)} yrs`}</dd></div>
                      <div><dt>Self-consumption</dt><dd className="num">{fmt.pct(e.self_consumption_share)}</dd></div>
                      <div><dt>Autarky</dt><dd className="num">{fmt.pct(e.autarky_share)}</dd></div>
                    </dl>
                    <details><summary>Assumptions</summary><ul>{e.assumptions.map((a, k) => <li key={k}>{a}</li>)}</ul></details>
                  </>
                )}
              </div>
              <div>
                <h2>Plausibility</h2>
                <ul className="flags">
                  {res.plausibility.map((p, k) => (
                    <li key={k} className={p.level}><span className="lvl">{p.level === "ok" ? "OK" : "Check"}</span><span>{p.message}</span></li>
                  ))}
                </ul>
                <ul className="explain">{res.explanation.filter((x) => !reasons.has(x)).map((x, k) => <li key={k}>{x}</li>)}</ul>
              </div>
            </div>

            {res.optimum && <OptimumBlock design={res.design} economics={res.economics} optimum={res.optimum} />}
          </>
        )}
        </>}
      </div>
    </div>
  );
}
