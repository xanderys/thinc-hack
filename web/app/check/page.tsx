"use client";
import { useEffect, useState } from "react";
import { COMPONENT_DESIGN_FIELD, type ComponentKey, type Eval, type ProjectDetail, type ProjectSummary } from "@/lib/api";
import { call, fmt, COMPONENT_NAME } from "@/lib/client";
import { HEATING, LOAD_PROFILES } from "@/components/HomeForm";

const KEYS: ComponentKey[] = ["pv", "battery", "heatpump", "wallbox"];
const DEFAULT_TOL: Record<ComponentKey, string> = { pv: "±1 kWp", battery: "±2.5 kWh", heatpump: "±2 kW", wallbox: "exact" };

function within(ours: number | null, expert: number | null, tol: string) {
  if ((ours == null) !== (expert == null)) return false;
  if (ours == null || expert == null) return true;
  const m = tol.match(/([\d.]+)\s*(%)?/);
  if (!m || /exact/i.test(tol)) return ours === expert;
  const t = Number(m[1]);
  return Math.abs(ours - expert) <= (m[2] ? (t / 100) * expert : t) + 1e-9;
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

  const tol = (k: ComponentKey) => ev?.components[k]?.tolerance ?? DEFAULT_TOL[k];
  const inp = detail?.inputs;

  return (
    <div>
      <div className="pick">
        <div className="field">
          <label htmlFor="project">Held-out project</label>
          <select id="project" value={id} onChange={(e) => setId(e.target.value)} disabled={!list}>
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
          {inp.has_ev ? <>, EV {inp.ev_annual_km ? <span className="num">{inp.ev_annual_km.toLocaleString("en-GB")} km</span> : null}</> : null}.
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
                  <td className={ok ? "mark-ok" : "mark-off"}>{ok ? "✓ Within" : "✗ Off"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {detail && <ul className="explain">{detail.ours.components.pv.reason && KEYS.map((k) => <li key={k}><strong>{COMPONENT_NAME[k]}.</strong> {detail.ours.components[k].reason}</li>)}</ul>}

      <div className="section">
        <div className="sheet-head"><h1>Scoreboard</h1>{ev && <span className="meta">{ev.split.test} held-out projects, {ev.split.method}</span>}</div>
        {evErr && <ErrorBox msg={evErr} onRetry={() => setTick((t) => t + 1)} />}
        {ev && (
          <>
            <div className="two">
              <div>
                <dl className="figures">
                  <div><dt>Whole design matches</dt><dd className="num big">{fmt.pct(ev.overall.design_match_share)}</dd></div>
                  <div><dt>Rule-of-thumb baseline</dt><dd className="num big" style={{ color: "var(--ink-3)" }}>{fmt.pct(ev.overall.baseline_design_match_share)}</dd></div>
                </dl>
                <p className="note">{ev.overall.definition}</p>
              </div>
              <div>
                <h2>Per installer</h2>
                <table className="data">
                  <thead><tr><th>Installer</th><th className="num">Projects</th><th className="num">Match</th></tr></thead>
                  <tbody>{Object.entries(ev.per_installer).map(([k, v]) => (
                    <tr key={k}><td className="num">{k}</td><td className="num">{v.test}</td><td className="num">{fmt.pct(v.design_match_share)}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            </div>

            <div className="section scroll">
              <h2>By component</h2>
              <table className="data">
                <thead><tr><th>Component</th><th className="num">Decision right</th><th className="num">Baseline</th><th className="num">Size error</th><th className="num">Baseline</th><th className="num">Within tolerance</th></tr></thead>
                <tbody>{KEYS.map((k) => {
                  const c = ev.components[k];
                  return (
                    <tr key={k}>
                      <td>{COMPONENT_NAME[k]}</td>
                      <td className="num">{fmt.pct(c.decision_accuracy)}</td>
                      <td className="num" style={{ color: "var(--ink-3)" }}>{fmt.pct(c.baseline_decision_accuracy)}</td>
                      <td className="num">{c.size_mae == null ? "n/a" : `${fmt.n(c.size_mae)} ${c.unit}`}</td>
                      <td className="num" style={{ color: "var(--ink-3)" }}>{c.baseline_size_mae == null ? "n/a" : `${fmt.n(c.baseline_size_mae)} ${c.unit}`}</td>
                      <td className="num">{fmt.pct(c.within_tolerance_share)} <span style={{ color: "var(--ink-3)" }}>({c.tolerance})</span></td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>

            <div className="section scroll">
              <h2>Largest deviations</h2>
              <table className="data">
                <thead><tr><th>Project</th><th>Component</th><th className="num">Ours</th><th className="num">Expert</th><th>Note</th></tr></thead>
                <tbody>{ev.deviations.map((d, k) => (
                  <tr key={k}>
                    <td className="num"><button className="btn ghost" style={{ padding: "2px 8px" }} onClick={() => { setId(d.project_id); window.scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); }}>{d.project_id}</button></td>
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
