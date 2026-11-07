"use client";
import { useEffect, useState } from "react";
import { COMPONENT_DESIGN_FIELD, type ComponentKey, type Design, type DesignResponse, type OverrideValue, type Overrides } from "@/lib/api";
import { fmt } from "@/lib/client";

const ROWS: { key: ComponentKey; name: string; step: number }[] = [
  { key: "pv", name: "PV array", step: 0.5 },
  { key: "battery", name: "Battery", step: 2.5 },
  { key: "heatpump", name: "Heat pump", step: 1 },
  { key: "wallbox", name: "Wallbox", step: 11 },
];

type Props = {
  res: DesignResponse;
  prev: Design | null;
  version: number;
  overrides: Overrides;
  setOverride: (field: keyof Design, value: OverrideValue | undefined) => void;
};

function Value({ value, unit, was, version }: { value: number | null; unit: string; was: number | null | undefined; version: number }) {
  const moved = was !== undefined && was !== value;
  return (
    <div>
      <span key={moved ? version : "still"} className={`size num${value == null ? " none" : ""}${moved ? " moved" : ""}`}>
        {value == null ? "None" : <>{fmt.n(value)}<span className="u">{unit}</span></>}
      </span>
      {moved && <span className="was num">was {was == null ? "none" : `${fmt.n(was)} ${unit}`}</span>}
    </div>
  );
}

const clean = (x: number | null | undefined) => x == null ? "" : String(Math.round(x * 100) / 100);

function Fix({ field, current, unit, step, overrides, setOverride }: {
  field: keyof Design; current: number | null; unit: string; step: number;
  overrides: Overrides; setOverride: Props["setOverride"];
}) {
  const fixed = field in overrides;
  const mode = !fixed ? "auto" : overrides[field] === "include" ? "include" : overrides[field] == null ? "none" : "value";
  const fixedNum = typeof overrides[field] === "number" ? overrides[field] as number : null;
  const [draft, setDraft] = useState<string>(clean(fixedNum ?? current));
  useEffect(() => { if (mode !== "value") setDraft(clean(current)); }, [current, mode]);
  const commit = (s: string) => { const n = Number(s); if (s !== "" && Number.isFinite(n) && n > 0) setOverride(field, n); };
  return (
    <div className="fix">
      <span className="label">Planner</span>
      <span className="seg" role="group" aria-label="Fix this component">
        <button type="button" aria-pressed={mode === "auto"} onClick={() => setOverride(field, undefined)}>Auto</button>
        <button type="button" aria-pressed={mode === "include"} onClick={() => setOverride(field, "include")}>Include</button>
        <button type="button" aria-pressed={mode === "none"} onClick={() => setOverride(field, null)}>None</button>
        <button type="button" aria-pressed={mode === "value"} onClick={() => commit(draft || String(current ?? step))}>Fix at</button>
      </span>
      <input type="number" className="num" aria-label={`Fixed size in ${unit}`} step="any" min={0} value={draft}
        onChange={(e) => { setDraft(e.target.value); if (mode === "value") commit(e.target.value); }} />
      <span className="unit">{unit}</span>
    </div>
  );
}

export default function DesignSheet({ res, prev, version, overrides, setOverride }: Props) {
  return (
    <section aria-label="Design">
      {ROWS.map(({ key, name, step }) => {
        const c = res.components[key];
        const field = COMPONENT_DESIGN_FIELD[key];
        const value = res.design[field];
        const nb = c.neighbours;
        const alt = c.alternatives[0];
        return (
          <div className="comp" key={key}>
            <div className="name">{name}
              <small>{field in overrides ? (overrides[field] === "include" ? "Included by planner" : "Fixed by planner") : `Confidence ${fmt.pct(c.confidence)}`}</small>
            </div>
            <Value value={value} unit={c.unit} was={prev?.[field]} version={version} />
            <div className="body">
              <p>{c.reason}</p>
              {key === "pv" && res.design.inverter_kw != null && (
                <p className="evidence">Inverter <span className="num">{fmt.n(res.design.inverter_kw)} kW</span>
                  {prev && prev.inverter_kw !== res.design.inverter_kw && <span className="was num" style={{ display: "inline", marginLeft: 8 }}>was {fmt.n(prev.inverter_kw)} kW</span>}
                </p>
              )}
              <p className="evidence">
                Homes like this one: <span className="num">{nb.n}</span>, <span className="num">{fmt.pct(nb.share_included)}</span> include one
                {nb.median_size != null && <>, median <span className="num">{fmt.n(nb.median_size)} {c.unit}</span></>}
                {nb.p25 != null && nb.p75 != null && <> (<span className="num">{fmt.n(nb.p25)}</span> to <span className="num">{fmt.n(nb.p75)}</span>)</>}.
                {alt && <> Also seen: {alt.label} (<span className="num">{fmt.pct(alt.share)}</span>).</>}
              </p>
            </div>
            <Fix field={field} current={value} unit={c.unit} step={step} overrides={overrides} setOverride={setOverride} />
          </div>
        );
      })}
    </section>
  );
}
