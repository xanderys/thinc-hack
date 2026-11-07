"use client";
import { useEffect, useMemo, useState } from "react";
import StepHead from "@/components/stage/StepHead";
import { COMPONENT_DESIGN_FIELD, INSTALLER_NAME, type ComponentKey, type Design, type Eval, type HomeInputs, type InboxRow, type ProjectDetail, type ProjectSummary, type ValidateFlag, type ValidateResponse } from "@/lib/api";
import { call } from "@/lib/client";
import { REALITY_PROJECT } from "@/lib/demo";
import { designLine, HEATING_WORD, KEYS, n0, n2, NAME, named } from "@/lib/stage";

type Approved = { inputs: HomeInputs; draft: Design | null; approved: Design; at: string };
const pct1 = (x: number) => `${(Math.round(x * 1000) / 10).toLocaleString("en-GB")}%`;
const word = (c: number) => c >= 0.7 ? "sure" : c >= 0.5 ? "likely" : "unsure";
const UNIT: Record<ComponentKey, string> = { pv: "kWp", battery: "kWh", heatpump: "kW", wallbox: "kW" };
const reduce = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

// Eval tolerance text: "±1 kWp or ±15%, whichever is larger", "±2 kWh", "decision exact".
function within(ours: number | null, expert: number | null, tol: string) {
  if ((ours == null) !== (expert == null)) return false;
  if (ours == null || expert == null || /decision/i.test(tol)) return true;
  let t = 0;
  for (const m of tol.matchAll(/([\d.]+)\s*(%)?/g)) t = Math.max(t, m[2] ? (Number(m[1]) / 100) * expert : Number(m[1]));
  return Math.abs(ours - expert) <= t + 1e-9;
}

function Err({ src, msg, retry }: { src: string; msg: string; retry: () => void }) {
  return <div className="error" role="alert"><span><span className="src">{src} said</span>{msg}</span><button className="btn ghost" onClick={retry}>Retry</button></div>;
}

function rule(f: ValidateFlag, installer: HomeInputs["installer_id"]) {
  const k = f.component as ComponentKey, nb = f.neighbours, took = Math.round(nb.share_included * nb.n);
  const range = nb.p25 != null && nb.p75 != null ? `, between ${n2(nb.p25)} and ${n2(nb.p75)} ${UNIT[k] ?? ""}` : "";
  return `Learned from ${nb.n} similar homes at ${INSTALLER_NAME[installer]}: ${took} took ${k === "pv" ? "solar" : `a ${(NAME[k] ?? k).toLowerCase()}`}${took ? range : ""}.`;
}

function Validation() {
  const [ap, setAp] = useState<Approved | null | undefined>(undefined);
  const [res, setRes] = useState<ValidateResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [kept, setKept] = useState<number[]>([]);
  const [tick, setTick] = useState(0);
  useEffect(() => { try { const raw = sessionStorage.getItem("marquee.approved"); setAp(raw ? JSON.parse(raw) : null); } catch { setAp(null); } }, []);
  useEffect(() => {
    if (!ap) return;
    call<ValidateResponse>("/api/validate", { inputs: ap.inputs, design: ap.approved }).then((r) => { if (r.ok) { setRes(r.data); setErr(null); } else setErr(r.error); });
  }, [ap, tick]);
  if (ap === undefined) return null;
  if (ap === null) return (
    <section className="c-sec">
      <h2>Nothing approved yet.</h2>
      <p className="c-sub">Approve an offer on <a href="/">Plan</a> and it is checked here against similar homes.</p>
    </section>
  );
  const fix = (f: ValidateFlag) => {
    const field = COMPONENT_DESIGN_FIELD[f.component as ComponentKey];
    const to = f.neighbours.share_included < 0.5 ? null : f.neighbours.median_size;
    const next = { ...ap, approved: { ...ap.approved, [field]: to } };
    try { sessionStorage.setItem("marquee.approved", JSON.stringify(next)); } catch { /* still applied on this page */ }
    setKept([]); setAp(next);
  };
  const open = (res?.flags ?? []).map((f, i) => ({ f, i })).filter(({ f, i }) => f.level !== "ok" && !kept.includes(i));
  const fine = KEYS.filter((k) => !(res?.flags ?? []).some((f) => f.component === k && f.level !== "ok")).map((k, j) => j === 0 ? NAME[k] : NAME[k].toLowerCase());
  const head = !res ? "Checking the approved offer." : open.length === 0 ? "Nothing stands out against similar homes." : open.length === 1 ? "One thing to look at before it goes out." : `${open.length === 2 ? "Two" : open.length === 3 ? "Three" : open.length} things to look at before it goes out.`;
  const fieldOf = (f: ValidateFlag) => COMPONENT_DESIGN_FIELD[f.component as ComponentKey];
  return (
    <section className="c-sec">
      <h2>{head}</h2>
      <p className="c-sub">Offer as approved: <span className="num">{designLine(ap.approved)}</span></p>
      {err && <Err src="Engine" msg={err} retry={() => setTick((t) => t + 1)} />}
      {open.length > 0 && (
        <div className="c-cards">
          {open.map(({ f, i }) => {
            const to = f.neighbours.share_included < 0.5 ? null : f.neighbours.median_size, now = ap.approved[fieldOf(f)];
            const unit = UNIT[f.component as ComponentKey] ?? "";
            return (
              <div className="c-card s-in" key={i}>
                <div className="what">{NAME[f.component as ComponentKey] ?? f.component}</div>
                <p className="find">{named(f.message)}</p>
                <div className="row"><span className="k">RULE</span><span>{rule(f, ap.inputs.installer_id)}</span></div>
                <div className="row"><span className="k">FIX</span><span className="fixr">
                  {to !== now && <button className="btn" onClick={() => fix(f)}>{to == null ? "Leave it out" : `Set ${n2(to)} ${unit}`}</button>}
                  <button className="btn ghost" onClick={() => setKept((k) => [...k, i])}>Keep {now == null ? "none" : `${n2(now)} ${unit}`}</button>
                </span></div>
              </div>
            );
          })}
        </div>
      )}
      {res && fine.length > 0 && <p className="c-pass">{fine.length === 4 ? "Every part is" : `${fine.slice(0, -1).join(", ")}${fine.length > 1 ? " and " : ""}${fine[fine.length - 1]} ${fine.length > 1 ? "are" : "is"}`} in line with similar homes.</p>}
    </section>
  );
}

function Reality({ ev, id }: { ev: Eval | null; id: string | null }) {
  const [p, setP] = useState<ProjectDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => { if (id) call<ProjectDetail>(`/api/projects/${id}`).then((r) => { if (r.ok) { setP(r.data); setErr(null); } else setErr(r.error); }); }, [tick, id]);
  if (err) return <section className="c-sec"><h2>Now a home that was real.</h2><Err src="Engine" msg={err} retry={() => setTick((t) => t + 1)} /></section>;
  if (!p) return <section className="c-sec"><h2>Now a home that was real.</h2><p className="c-sub s-wait">Loading the held-out home</p></section>;
  const i = p.inputs, tol = (k: ComponentKey) => ev?.components[k]?.tolerance ?? "";
  const rows = KEYS.map((k) => { const f = COMPONENT_DESIGN_FIELD[k]; const o = p.ours.design[f], x = p.expert[f]; return { k, o, x, ok: within(o, x, tol(k)) }; });
  const misses = rows.filter((r) => !r.ok);
  const what = [`${INSTALLER_NAME[p.installer_id]}`, `${n0(i.annual_demand_kwh)} kWh a year`, i.heating_type !== "Unknown" ? `${HEATING_WORD[i.heating_type].toLowerCase()} heating${i.heating_cost_per_year_eur ? ` costing ${n0(i.heating_cost_per_year_eur)} EUR a year` : ""}` : null, i.has_ev ? "an electric car" : null].filter(Boolean).join(", ");
  return (
    <section className="c-sec">
      <h2>Now a home that was real.</h2>
      <p className="c-sub">Held out from training. {what}.</p>
      <div className="c-real">
        <table className="c-table">
          <thead><tr><th></th><th className="r">Agent&apos;s draft</th><th className="r">Senior planner</th><th></th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.k}>
              <td>{NAME[r.k]}</td>
              <td className="r num">{r.o == null ? "none" : `${n2(r.o)} ${UNIT[r.k]}`}</td>
              <td className={r.ok ? "r num" : "r num miss"}>{r.x == null ? "none" : `${n2(r.x)} ${UNIT[r.k]}`}</td>
              <td className={r.ok ? "mk" : "mk miss"}>{r.ok ? "within" : "missed"}</td>
            </tr>
          ))}</tbody>
        </table>
        <div>
          {misses.length === 0 ? <p className="c-why">Every part within tolerance of the senior planner.</p> : misses.map((m) => {
            const nb = p.ours.components[m.k].neighbours, took = Math.round(nb.share_included * nb.n);
            const lead = m.o == null ? `Only ${took} of ${nb.n} similar homes from this installer added one, so the draft left it out.` : named(p.ours.components[m.k].reason);
            return <p className="c-why" key={m.k}><b>Missed the {NAME[m.k].toLowerCase()}.</b> {lead} The record does not say why this planner chose otherwise; that judgement stays with the planner.</p>;
          })}
        </div>
      </div>
    </section>
  );
}

function Inbox({ ev, onFirst }: { ev: Eval | null; onFirst: (id: string) => void }) {
  const [rows, setRows] = useState<InboxRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [shown, setShown] = useState(0);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    (async () => {
      const r = await call<InboxRow[]>("/api/inbox?limit=20");
      if (r.ok) { setRows(r.data); setErr(null); if (r.data[0]) onFirst(r.data[0].project_id); return; }
      if (!/404|not found/i.test(r.error)) { setErr(r.error); return; }
      // Before v1.3: build the rows from the held-out list and each project's detail.
      const l = await call<ProjectSummary[]>("/api/projects?split=test&limit=20");
      if (!l.ok) { setErr(l.error); return; }
      const out: InboxRow[] = [];
      for (const s of l.data) {
        const d = await call<ProjectDetail>(`/api/projects/${s.project_id}`);
        if (!d.ok) continue;
        const inc = KEYS.filter((k) => d.data.ours.components[k].decision === "include");
        const w = Object.fromEntries(KEYS.map((k) => [k, within(d.data.ours.design[COMPONENT_DESIGN_FIELD[k]], s.expert[COMPONENT_DESIGN_FIELD[k]], ev?.components[k]?.tolerance ?? "")])) as Record<ComponentKey, boolean>;
        out.push({ project_id: s.project_id, installer_id: s.installer_id, label: "", inputs: s.inputs, draft: d.data.ours.design, expert: s.expert, confidence: inc.length ? inc.reduce((a, k) => a + d.data.ours.components[k].confidence, 0) / inc.length : 1, within: { ...w, all: KEYS.every((k) => w[k]) }, note: "" });
      }
      setRows(out);
    })();
  }, [tick, ev]); // eslint-disable-line react-hooks/exhaustive-deps
  const sorted = useMemo(() => rows ? [...rows].sort((a, b) => a.confidence - b.confidence) : [], [rows]);
  useEffect(() => {
    if (!sorted.length) return;
    if (reduce()) { setShown(sorted.length); return; }
    setShown(0);
    const step = Math.min(120, 2500 / sorted.length);
    const t = setInterval(() => setShown((n) => { if (n >= sorted.length) { clearInterval(t); return n; } return n + 1; }), step);
    return () => clearInterval(t);
  }, [sorted]);
  const vis = sorted.slice(0, shown), pvHit = vis.filter((r) => r.within.pv).length;
  return (
    <section className="c-sec">
      <h2>The agent drafted {rows ? rows.length : 20} more.</h2>
      <p className="c-sub">{ev ? `${n0(ev.split.test)} held-out signed projects, replayed through the engine. ` : ""}Least sure first.</p>
      {err && <Err src="Engine" msg={err} retry={() => setTick((t) => t + 1)} />}
      {!rows && !err && <p className="c-sub s-wait">Replaying</p>}
      {rows && (
        <div className="c-inbox">
          <div className="ir head"><span>Home</span><span>Draft</span><span>Confidence</span><span>Against the expert</span></div>
          {vis.map((r) => {
            const i = r.inputs, sub = [i.heating_type !== "Unknown" ? HEATING_WORD[i.heating_type] : "Heating not recorded", i.has_ev ? "EV" : null].filter(Boolean).join(", ");
            return (
              <div className="ir s-in" key={r.project_id} title={r.note || undefined}>
                <span className="h">{INSTALLER_NAME[r.installer_id]}, {n0(i.annual_demand_kwh)} kWh<small>{sub}</small></span>
                <span className="d">{designLine(r.draft)}</span>
                <span className={`c ${word(r.confidence)}`}>{word(r.confidence)}</span>
                <span className={r.within.all ? "r" : "r rev"}>{r.within.all ? "matches the expert" : "review"}</span>
              </div>
            );
          })}
        </div>
      )}
      {rows && <p className="c-tally" aria-live="polite">{pvHit} of {vis.length} within tolerance on solar{vis.length < sorted.length ? " so far" : ""}</p>}
    </section>
  );
}

function Score({ ev }: { ev: Eval | null }) {
  if (!ev) return null;
  const o = ev.overall, pv = ev.components.pv;
  return (
    <section className="c-sec c-score">
      <p>Across {n0(ev.split.test)} held-out projects, the whole design landed within tolerance {pct1(o.design_match_share)} of the time.
        {o.textbook_design_match_share != null && <> A textbook rule manages {pct1(o.textbook_design_match_share)}</>}
        {o.ceiling_design_match_share != null && <>, and two planners at the same installer, given near-identical homes, agree {pct1(o.ceiling_design_match_share)} of the time</>}.</p>
      {pv.within_tolerance_share != null && ev.ceiling && <p>On solar alone the draft is within tolerance {pct1(pv.within_tolerance_share)} of the time, against {pct1(ev.ceiling.pv_agreement_share)} for planners agreeing with each other.</p>}
      {ev.synthetic?.headline_short && <p>{ev.synthetic.headline_short}</p>}
      <details>
        <summary>All the numbers</summary>
        <table className="c-table small">
          <thead><tr><th></th><th className="r">Ours</th><th className="r">Planners agree</th><th className="r">Textbook</th><th>Tolerance</th></tr></thead>
          <tbody>{KEYS.map((k) => { const c = ev.components[k]; const v = (x?: number | null) => x == null ? "n/a" : pct1(x); return (
            <tr key={k}><td>{NAME[k]}</td><td className="r num">{v(c.within_tolerance_share)}</td><td className="r num">{v(c.ceiling_within_tolerance_share)}</td><td className="r num">{v(c.textbook_within_tolerance_share ?? c.baseline_within_tolerance_share)}</td><td>{c.tolerance}</td></tr>
          ); })}</tbody>
        </table>
        <p className="c-sub">{ev.split.method}</p>
        {ev.synthetic && ev.synthetic.invariants.length > 0 && (
          <table className="c-table small">
            <thead><tr><th>On {n0(ev.synthetic.n)} synthetic homes</th>{ev.synthetic.before && <th className="r">Before</th>}<th className="r">Now</th></tr></thead>
            <tbody>{ev.synthetic.invariants.map((i) => { const b = ev.synthetic?.before?.pass_share[i.name]; return (
              <tr key={i.name}><td>{i.name}</td>{ev.synthetic?.before && <td className="r num">{b == null ? "n/a" : pct1(b)}</td>}<td className="r num">{pct1(i.pass_share)}</td></tr>
            ); })}</tbody>
          </table>
        )}
        <p className="c-sub"><a href="/classic/check">The full tables</a></p>
      </details>
    </section>
  );
}

export default function Check() {
  const [ev, setEv] = useState<Eval | null>(null);
  const [real, setReal] = useState<string | null>(null);
  useEffect(() => { call<Eval>("/api/eval").then((r) => { if (r.ok) setEv(r.data); }); }, []);
  // The first inbox row is the engine's chosen hit; the fixed id covers an engine without /api/inbox.
  useEffect(() => { const t = setTimeout(() => setReal((x) => x ?? REALITY_PROJECT), 6000); return () => clearTimeout(t); }, []);
  return (
    <div className="st">
      <StepHead title="Check" at={3} />
      <Validation />
      <Reality ev={ev} id={real} />
      <Inbox ev={ev} onFirst={(id) => setReal((x) => x ?? id)} />
      <Score ev={ev} />
    </div>
  );
}
