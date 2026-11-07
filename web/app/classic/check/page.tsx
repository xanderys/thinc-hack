"use client";
import { useEffect, useState } from "react";
import { COMPONENT_DESIGN_FIELD, type ComponentKey, type Eval, type ProjectDetail, type ProjectSummary } from "@/lib/api";
import { call, fmt, COMPONENT_NAME } from "@/lib/client";
import { HEATING, LOAD_PROFILES } from "@/components/HomeForm";

const KEYS: ComponentKey[] = ["pv", "battery", "heatpump", "wallbox"];

// Reads the engine's tolerance text: "decision exact", "±2 kWh", "±1 kWp or ±15%, whichever is larger".
function within(ours: number | null, expert: number | null, tol: string) {
  if ((ours == null) !== (expert == null)) return false;
  if (ours == null || expert == null || /decision/i.test(tol)) return true;
  if (/^exact/i.test(tol)) return ours === expert;
  let t = 0;
  for (const m of tol.matchAll(/([\d.]+)\s*(%)?/g)) t = Math.max(t, m[2] ? (Number(m[1]) / 100) * expert : Number(m[1]));
  return Math.abs(ours - expert) <= t + 1e-9;
}

function ErrorBox({ msg, onRetry }: { msg: string; onRetry: () => void }) {
  return <div className="error" role="alert"><span><span className="src">Engine said</span>{msg}</span><button className="btn ghost" onClick={onRetry}>Retry</button></div>;
}

export default function Check() {
  const [list, setList] = useState<ProjectSummary[] | null>(null);
  const [listErr, setListErr] = useState<string | null>(null);
  const [id, setId] = useState<string>("");
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [detailErr, setDetailErr] = useState<string | null>(null);
  const [ev, setEv] = useState<Eval | null>(null);
  const [evErr, setEvErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [facts, setFacts] = useState<{ label: string; text: string }[]>([]);
  useEffect(() => { call<{ facts: { label: string; text: string }[] }>("/api/insights").then((r) => { if (r.ok) setFacts(r.data.facts); }); }, []);

  useEffect(() => {
    call<ProjectSummary[]>("/api/projects?split=test&limit=50").then((r) => {
      if (r.ok) { setList(r.data); setListErr(null); if (r.data[0]) setId((x) => x || r.data[0].project_id); } else setListErr(r.error);
    });
    call<Eval>("/api/eval").then((r) => { if (r.ok) { setEv(r.data); setEvErr(null); } else setEvErr(r.error); });
  }, [tick]);

  useEffect(() => {
    if (!id) return;
    setDetail(null);
    call<ProjectDetail>(`/api/projects/${encodeURIComponent(id)}`).then((r) => { if (r.ok) { setDetail(r.data); setDetailErr(null); } else setDetailErr(r.error); });
  }, [id, tick]);

  const tol = (k: ComponentKey) => ev?.components[k]?.tolerance ?? "";
  const inp = detail?.inputs;

  return (
    <div>
      <div className="pick">
        <div className="field">
          <label htmlFor="project">Held-out project</label>
          <select id="project" value={id} onChange={(e) => setId(e.target.value)} disabled={!list}>
            {id && list && !list.some((p) => p.project_id === id) && <option value={id}>{id}</option>}
            {(list ?? []).map((p) => (
              <option key={p.project_id} value={p.project_id}>
                {p.project_id}, {p.inputs.annual_demand_kwh.toLocaleString("en-GB")} kWh{p.inputs.has_ev ? ", EV" : ""}, {HEATING[p.inputs.heating_type]}
              </option>
            ))}
          </select>
        </div>
      </div>
      {listErr && <ErrorBox msg={listErr} onRetry={() => setTick((t) => t + 1)} />}
      {detailErr && <ErrorBox msg={detailErr} onRetry={() => setTick((t) => t + 1)} />}

      {inp && (
        <p className="inputs-line">
          Installer {detail!.installer_id}, <span className="num">{inp.annual_demand_kwh.toLocaleString("en-GB")}</span> kWh, {LOAD_PROFILES[inp.load_profile]}
          {inp.num_inhabitants ? <>, {inp.num_inhabitants} people</> : null}, {HEATING[inp.heating_type]} heating
          {inp.has_ev ? <>, EV {inp.ev_annual_km ? <span className="num">{inp.ev_annual_km.toLocaleString("en-GB")} km</span> : null}</> : null}.{" "}<a className="open" href={`/classic?home=${encodeURIComponent(JSON.stringify(Object.fromEntries(Object.entries(inp).filter(([, v]) => v != null))))}`}>Open in planner</a>
        </p>
      )}

      <div className="scroll">
        <table className="data">
          <thead><tr><th>Component</th><th className="num">Ours</th><th className="num">Expert</th><th>Tolerance</th><th>Match</th></tr></thead>
          <tbody>
            {KEYS.map((k) => {
              const f = COMPONENT_DESIGN_FIELD[k];
              if (!detail) return <tr key={k}><td>{COMPONENT_NAME[k]}</td><td className="num"><span className="skeleton">00.0</span></td><td className="num"><span className="skeleton">00.0</span></td><td>{tol(k)}</td><td></td></tr>;
              const ours = detail.ours.design[f], expert = detail.expert[f];
              const ok = within(ours, expert, tol(k));
              const unit = detail.ours.components[k].unit;
              return (
                <tr key={k}>
                  <td>{COMPONENT_NAME[k]}</td>
                  <td className="num">{ours == null ? "none" : `${fmt.n(ours)} ${unit}`}</td>
                  <td className="num">{expert == null ? "none" : `${fmt.n(expert)} ${unit}`}</td>
                  <td>{tol(k)}</td>
                  <td className={ok ? "mark-ok" : "mark-off"}>{ok ? "Within" : "Off"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {detail && <ul className="explain">{detail.ours.components.pv.reason && KEYS.map((k) => <li key={k} className="row"><span className="lbl">{COMPONENT_NAME[k]}</span><span>{detail.ours.components[k].reason}</span></li>)}</ul>}

      <div className="section">
        <div className="sheet-head"><h1>Scoreboard</h1>{ev && <span className="meta">{ev.split.test} held-out projects, {ev.split.method}</span>}</div>
        {evErr && <ErrorBox msg={evErr} onRetry={() => setTick((t) => t + 1)} />}
        {ev && (
          <>
            <div className="two">
              <div>
                <dl className="figures">
                  <div><dt>Whole design matches</dt><dd className="num big">{fmt.pct(ev.overall.design_match_share)}</dd></div>
                  {ev.overall.ceiling_design_match_share != null && <div><dt>Ceiling</dt><dd className="num big">{fmt.pct(ev.overall.ceiling_design_match_share)}</dd></div>}
                  <div><dt>{ev.overall.textbook_design_match_share != null ? "Textbook rule" : "Rule-of-thumb baseline"}</dt><dd className="num big" style={{ color: "var(--ink-3)" }}>{fmt.pct(ev.overall.textbook_design_match_share ?? ev.overall.baseline_design_match_share)}</dd></div>
                  {ev.overall.floor_slope_design_match_share != null && <div><dt>Floor plus slope</dt><dd className="num big" style={{ color: "var(--ink-3)" }}>{fmt.pct(ev.overall.floor_slope_design_match_share)}</dd></div>}
                </dl>
                <p className="note">{ev.overall.definition}</p>
              </div>
              <div>
                <h2>Per installer</h2>
                <table className="data">
                  <thead><tr><th>Installer</th><th className="num">Projects</th><th className="num">Match</th><th className="num">Baseline</th></tr></thead>
                  <tbody>{Object.entries(ev.per_installer).map(([k, v]) => (
                    <tr key={k}><td className="mono">{k}</td><td className="num">{v.test}</td><td className="num">{fmt.pct(v.design_match_share)}</td><td className="num" style={{ color: "var(--ink-3)" }}>{v.baseline_design_match_share == null ? "n/a" : fmt.pct(v.baseline_design_match_share)}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            </div>

            {ev.ceiling && (
              <div className="section">
                <h2>How often planners agree with themselves</h2>
                <dl className="figures">
                  <div><dt>PV</dt><dd className="num">{fmt.pct(ev.ceiling.pv_agreement_share)}</dd></div>
                  <div><dt>Battery</dt><dd className="num">{fmt.pct(ev.ceiling.battery_agreement_share)}</dd></div>
                </dl>
                <p className="note">{ev.ceiling.method}</p>
              </div>
            )}

            {KEYS.some((k) => ev.components[k].ceiling_within_tolerance_share != null || ev.components[k].textbook_within_tolerance_share != null || ev.components[k].floor_slope_within_tolerance_share != null) && (
              <div className="section scroll">
                <h2>Within tolerance</h2>
                <table className="data">
                  <thead><tr><th>Component</th><th className="num">Ours</th><th className="num">Ceiling</th><th className="num">Textbook</th><th className="num">Floor plus slope</th></tr></thead>
                  <tbody>{KEYS.map((k) => {
                    const c = ev.components[k];
                    const v = (x: number | null | undefined) => x == null ? "n/a" : fmt.pct(x);
                    return (
                      <tr key={k}>
                        <td>{COMPONENT_NAME[k]}</td>
                        <td className="num">{v(c.within_tolerance_share)}</td>
                        <td className="num">{v(c.ceiling_within_tolerance_share)}</td>
                        <td className="num" style={{ color: "var(--ink-3)" }}>{v(c.textbook_within_tolerance_share ?? c.baseline_within_tolerance_share)}</td>
                        <td className="num" style={{ color: "var(--ink-3)" }}>{v(c.floor_slope_within_tolerance_share)}</td>
                      </tr>
                    );
                  })}</tbody>
                </table>
              </div>
            )}

            <div className="section scroll">
              <h2>By component</h2>
              <table className="data">
                <thead><tr><th>Component</th><th className="num">Decision right</th><th className="num">Size error</th><th className="num">Within tolerance</th><th>Tolerance</th></tr></thead>
                <tbody>{KEYS.map((k) => {
                  const c = ev.components[k];
                  const size = (x: number | null) => x == null ? "n/a" : `${fmt.n(x)} ${c.unit}`;
                  return (
                    <tr key={k}>
                      <td>{COMPONENT_NAME[k]}</td>
                      <td className="num">{fmt.pct(c.decision_accuracy)}<span className="base">{fmt.pct(c.baseline_decision_accuracy)}</span></td>
                      <td className="num">{size(c.size_mae)}<span className="base">{size(c.baseline_size_mae)}</span></td>
                      <td className="num">{fmt.pct(c.within_tolerance_share)}{c.baseline_within_tolerance_share !== undefined && <span className="base">{fmt.pct(c.baseline_within_tolerance_share)}</span>}</td>
                      <td className="tol">{c.tolerance}</td>
                    </tr>
                  );
                })}</tbody>
              </table>
              <p className="note">Lower line in each cell: textbook rule.</p>
            </div>

            {facts.length > 0 && (
              <div className="section">
                <h2>Where we differ from experts</h2>
                <ul className="facts">
                  {facts.map((f) => <li key={f.label}><span className="lbl">{f.label}</span><span>{f.text}</span></li>)}
                  {ev.ceiling && ev.components.pv.within_tolerance_share != null && (
                    <li><span className="lbl">Live scoreboard</span><span>PV within tolerance: ours <span className="num">{fmt.pct(ev.components.pv.within_tolerance_share)}</span>, planners against their own similar homes <span className="num">{fmt.pct(ev.ceiling.pv_agreement_share)}</span>.</span></li>
                  )}
                </ul>
                <p className="note">Source: docs/data-insights.md and /api/eval.</p>
              </div>
            )}

            <div className="section scroll">
              <h2>Largest deviations</h2>
              <table className="data">
                <thead><tr><th>Project</th><th>Component</th><th className="num">Ours</th><th className="num">Expert</th><th>Note</th></tr></thead>
                <tbody>{ev.deviations.map((d, k) => (
                  <tr key={k}>
                    <td><button className="btn ghost mono" style={{ padding: "2px 8px" }} onClick={() => { setId(d.project_id); window.scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); }}>{d.project_id}</button></td>
                    <td>{COMPONENT_NAME[d.component] ?? d.component}</td>
                    <td className="num">{fmt.n(d.ours)}</td>
                    <td className="num">{fmt.n(d.expert)}</td>
                    <td>{d.note}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
