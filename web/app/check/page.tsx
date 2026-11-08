"use client";
import { useEffect, useMemo, useState } from "react";
import StepHead from "@/components/stage/StepHead";
import { CONST, human } from "@/components/stage/Rules";
import { COMPONENT_DESIGN_FIELD, INSTALLER_NAME, type ComponentKey, type Design, type Eval, type HomeInputs, type InboxRow, type InstallerId, type ProjectDetail, type ProjectSummary, type RecommenderScore, type Rule, type ValidateFlag, type ValidateResponse } from "@/lib/api";
import { call } from "@/lib/client";
import { REALITY_MISS, REALITY_PROJECT } from "@/lib/demo";
import { designLine, HEATING_WORD, KEYS, n0, n2, NAME, named } from "@/lib/stage";
import s from "./check.module.css";

// Fields /api/eval sends beyond lib/api.ts (docs/api.md v2.7).
type Row4 = { population: string; ground_truth: string; band: string; engine: string; n: number; pv: number; battery: number; wallbox: number; heatpump?: number; all_four: number };
type EvalX = Eval & {
  baselines?: Record<string, { rule: string }>;
  ceiling?: Eval["ceiling"] & { covered_test_share?: number };
  final_test?: { source: string; significance: string; production: string; rows: Row4[] };
  recommenders_labels?: Record<string, string>;
  recommenders_note?: string;
  second_look?: { source: string; verdict: string };
  rule_of_thumb_comparison?: { reonic_kwp_per_mwh: number; planners_kwp_per_mwh: Record<string, number>; note: string };
  deviation_quality?: Eval["deviation_quality"] & { ours_better_npv?: number; expert_better_npv?: number; median_npv_gain_eur?: number };
  exam_note?: string;
};

const REPO = "https://github.com/xanderys/thinc-hack/blob";
const gh = (path: string, branch = "main") => `${REPO}/${branch}/${path}`;
const pct1 = (x: number | null | undefined) => x == null ? "n/a" : `${(x * 100).toFixed(1)}%`;
// Rule names as the shared Rules disclosure labels them.
const RULE: Record<string, string> = { bat_kwp: "Battery per kWp", bat_day: "Battery per daily use", inv: "Inverter", hp: "Heat pump", wb: "Wallbox", fill: "Roof fill", cap: "Roof capacity", orient: "Orientation", inverter: "Inverter" };
const UNIT: Record<ComponentKey, string> = { pv: "kWp", battery: "kWh", heatpump: "kW", wallbox: "kW" };
const sz = (x: number | null | undefined, u: string) => x == null ? "none" : `${n2(x)} ${u}`;
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

function Src({ children }: { children: React.ReactNode }) {
  return <p className={s.src}>Source: {children}</p>;
}
const Api = ({ path }: { path: string }) => <a href={path} target="_blank" rel="noreferrer"><code>GET {path}</code></a>;
const Doc = ({ path, branch }: { path: string; branch?: string }) => <a href={gh(path, branch)} target="_blank" rel="noreferrer"><code>{path}{branch ? ` (${branch})` : ""}</code></a>;

function Headline({ ev, err, retry }: { ev: EvalX | null; err: string | null; retry: () => void }) {
  if (err) return <section className={s.sec}><h2>Scoreboard</h2><Err src="Engine" msg={err} retry={retry} /></section>;
  if (!ev) return <section className={s.head} aria-busy="true"><h2>Scoreboard</h2><p className={s.wait} style={{ color: "rgba(255,255,255,.7)" }}>Loading</p></section>;
  const o = ev.overall;
  // One named population: the sealed test half (633 homes), production engine, lowest option, our bands.
  const ft = ev.final_test, prod = ft?.production.replace(/-readout$/, "");
  const half = ft?.rows.filter((r) => r.population === "test half" && r.ground_truth === "lowest option" && r.band === "ours") ?? [];
  const sealed = half.find((r) => r.engine === prod), textbook = half.find((r) => r.engine === "textbook");
  return (
    <section className={s.head}>
      <h2>Whole design within tolerance on {n0(sealed?.n ?? ev.split.test)} {sealed ? "sealed held-out signed homes, scored once" : "held-out signed projects"}</h2>
      <dl className={s.figs}>
        <div className={s.us}><dt>Marquee draft</dt><dd>{pct1(sealed?.all_four ?? o.design_match_share)}</dd></div>
        {!sealed && o.ceiling_design_match_share != null && <div className={s.them}><dt>Agreement with designs for similar recorded homes</dt><dd>{pct1(o.ceiling_design_match_share)}</dd></div>}
        {sealed ? textbook && <div className={s.them}><dt>Textbook rule</dt><dd>{pct1(textbook.all_four)}</dd></div>
          : <div className={s.them}><dt>Textbook rule</dt><dd>{pct1(o.textbook_design_match_share ?? o.baseline_design_match_share)}</dd></div>}
      </dl>
      <p className={s.src}>{o.definition}{sealed ? `, on the test half the rules were not fitted on (${sealed.engine}, lowest offered option)` : ""}. Source: {sealed ? <><Doc path="engine/lab/reports/final_test_v2.md" />, </> : null}<a href="/api/eval" target="_blank" rel="noreferrer"><code>GET /api/eval</code></a></p>
    </section>
  );
}

type Approved = { lead_id?: string | null; inputs: HomeInputs; draft: Design | null; approved: Design; at: string };

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
  useEffect(() => {
    let raw: Approved | null = null;
    try { const t = sessionStorage.getItem("marquee.approved"); raw = t ? JSON.parse(t) : null; } catch { /* storage blocked */ }
    if (!raw?.lead_id) { setAp(raw); return; }
    // Test leads are hidden from the lead list: an approval on one never shows here.
    call<{ lead_id: string }[]>("/api/leads").then((r) => setAp(r.ok && r.data.some((l) => l.lead_id === raw!.lead_id) ? raw : r.ok ? null : raw));
  }, []);
  useEffect(() => {
    if (!ap) return;
    call<ValidateResponse>("/api/validate", { inputs: ap.inputs, design: ap.approved }).then((r) => { if (r.ok) { setRes(r.data); setErr(null); } else setErr(r.error); });
  }, [ap, tick]);
  if (!ap) return null;
  const fieldOf = (f: ValidateFlag) => COMPONENT_DESIGN_FIELD[f.component as ComponentKey];
  const fix = (f: ValidateFlag) => {
    const to = f.neighbours.share_included < 0.5 ? null : f.neighbours.median_size;
    const next = { ...ap, approved: { ...ap.approved, [fieldOf(f)]: to } };
    try { sessionStorage.setItem("marquee.approved", JSON.stringify(next)); } catch { /* still applied on this page */ }
    setKept([]); setAp(next);
  };
  const open = (res?.flags ?? []).map((f, i) => ({ f, i })).filter(({ f, i }) => f.level !== "ok" && !kept.includes(i));
  const fine = KEYS.filter((k) => !(res?.flags ?? []).some((f) => f.component === k && f.level !== "ok")).map((k, j) => j === 0 ? NAME[k] : NAME[k].toLowerCase());
  const head = !res ? "Checking the approved offer" : open.length === 0 ? "Approved offer: nothing stands out against similar homes" : `Approved offer: ${open.length === 1 ? "one thing" : `${open.length} things`} to look at`;
  return (
    <section className={s.sec}>
      <h2>{head}</h2>
      <p className={s.lede}><span className={s.mono}>{designLine(ap.approved)}</span></p>
      {err && <Err src="Engine" msg={err} retry={() => setTick((t) => t + 1)} />}
      {open.length > 0 && (
        <div className={s.cards}>
          {open.map(({ f, i }) => {
            const to = f.neighbours.share_included < 0.5 ? null : f.neighbours.median_size, now = ap.approved[fieldOf(f)];
            const unit = UNIT[f.component as ComponentKey] ?? "";
            return (
              <div className={`${s.card} s-in`} key={i}>
                <div className={s.what}>{NAME[f.component as ComponentKey] ?? f.component}</div>
                <p className={s.find}>{named(f.message)}</p>
                <div className={s.row}><span className={s.k}>RULE</span><span>{rule(f, ap.inputs.installer_id)}</span></div>
                <div className={s.row}><span className={s.k}>FIX</span><span className={s.fixr}>
                  {to !== now && <button className="btn" onClick={() => fix(f)}>{to == null ? "Leave it out" : `Set ${n2(to)} ${unit}`}</button>}
                  <button className="btn ghost" onClick={() => setKept((k) => [...k, i])}>Keep {now == null ? "none" : `${n2(now)} ${unit}`}</button>
                </span></div>
              </div>
            );
          })}
        </div>
      )}
      {res && fine.length > 0 && <p className={s.pass}>{fine.length === 4 ? "Every part is" : `${fine.slice(0, -1).join(", ")}${fine.length > 1 ? " and " : ""}${fine[fine.length - 1]} ${fine.length > 1 ? "are" : "is"}`} in line with similar homes.</p>}
      <Src><code>POST /api/validate</code></Src>
    </section>
  );
}

function RulesTable({ rules, installer }: { rules: Rule[]; installer: string }) {
  return (
    <div className={`${s.panel} ${s.scroll}`}>
      <table className={s.t}>
        <thead><tr><th>Rule</th><th>Reonic textbook</th><th>Fitted rule ({installer})</th><th className={s.r}>This draft</th></tr></thead>
        <tbody>{rules.map((r) => (
          <tr key={r.name}>
            <td>{r.name in NAME ? NAME[r.name as ComponentKey] : human(r.name, RULE)}</td>
            <td className={s.wrap}>{r.textbook ? <>{r.textbook.value != null && <span className={s.mono}>{n2(r.textbook.value)} {r.textbook.unit} </span>}{r.textbook.url ? <a href={r.textbook.url} target="_blank" rel="noreferrer">{r.textbook.source}</a> : r.textbook.source}</> : r.sentence}</td>
            <td className={s.wrap}>{r.rule?.text ?? (r.constants?.length ? r.constants.map((c) => `${human(c.name, CONST)} ${Array.isArray(c.value) ? c.value.join(", ") : c.value}${c.unit ? ` ${c.unit}` : ""}`).join("; ") : "")}</td>
            <td className={`${s.r} ${s.n}`}>{r.design?.value != null ? `${n2(r.design.value)} ${r.design.unit}` : ""}</td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function Reality({ ev, id, onOther }: { ev: EvalX | null; id: string; onOther: () => void }) {
  const [p, setP] = useState<ProjectDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => { setP(null); call<ProjectDetail>(`/api/projects/${id}`).then((r) => { if (r.ok) { setP(r.data); setErr(null); } else setErr(r.error); }); }, [tick, id]);
  const title = <h2>One held-out home, draft against the senior planner</h2>;
  if (err) return <section className={s.sec}>{title}<Err src="Engine" msg={err} retry={() => setTick((t) => t + 1)} /></section>;
  if (!p) return <section className={s.sec}>{title}<p className={s.wait}>Loading the held-out home</p></section>;
  const i = p.inputs, tol = (k: ComponentKey) => ev?.components[k]?.tolerance ?? "";
  const rows = KEYS.map((k) => { const f = COMPONENT_DESIGN_FIELD[k]; const o = p.ours.design[f], x = p.expert[f]; return { k, o, x, ok: within(o, x, tol(k)) }; });
  const misses = rows.filter((r) => !r.ok);
  const what = [INSTALLER_NAME[p.installer_id], `${n0(i.annual_demand_kwh)} kWh a year`, i.heating_type !== "Unknown" ? `${HEATING_WORD[i.heating_type].toLowerCase()} heating${i.heating_cost_per_year_eur ? ` at €${n0(i.heating_cost_per_year_eur)} a year` : ""}` : null, i.has_ev ? "an electric car" : null].filter(Boolean).join(", ");
  return (
    <>
      <section className={s.sec}>
        {title}
        <p className={s.lede}>Held out from training. {what}.</p>
        <div className={`${s.panel} ${s.scroll}`}>
          <table className={s.t}>
            <thead><tr><th>Part</th><th className={s.r}>Draft</th><th className={s.r}>Senior planner</th><th>Tolerance</th><th className={s.r}>Result</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.k}>
                <td>{NAME[r.k]}</td>
                <td className={`${s.r} ${s.n}`}>{sz(r.o, UNIT[r.k])}</td>
                <td className={`${s.r} ${s.n}${r.ok ? "" : ` ${s.miss}`}`}>{sz(r.x, UNIT[r.k])}</td>
                <td className={s.dim}>{tol(r.k)}</td>
                <td className={`${s.r}${r.ok ? "" : ` ${s.miss}`}`}>{r.ok ? "within" : "missed"}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        {misses.map((m) => {
          const nb = p.ours.components[m.k].neighbours, took = Math.round(nb.share_included * nb.n);
          const lead = m.o == null ? `Only ${took} of ${nb.n} similar homes from this installer added one, so the draft left it out.` : named(p.ours.components[m.k].reason);
          return <p className={`${s.note} ${s.miss}`} key={m.k}><b>{NAME[m.k]} missed.</b> {lead}</p>;
        })}
        <button className={s.link} onClick={onOther}>Another held-out home</button>
        <Src><Api path={`/api/projects/${p.project_id}`} /></Src>
      </section>
      {!!p.ours.rules?.length && (
        <section className={s.sec}>
          <h2>Rules behind this draft</h2>
          <RulesTable rules={p.ours.rules} installer={INSTALLER_NAME[p.installer_id]} />
          <Src><Api path={`/api/projects/${p.project_id}`} /> (<code>ours.rules</code>), <Doc path="docs/rules-readout.md" /></Src>
        </section>
      )}
    </>
  );
}

// Every part outside tolerance, named with the sizes and by how much, from the row's own fields.
function miss(r: InboxRow) {
  return KEYS.filter((k) => r.within[k] === false).map((k) => {
    const f = COMPONENT_DESIGN_FIELD[k], e = r.expert[f] as number | null, d = r.draft[f] as number | null, u = UNIT[k];
    if (d == null) return `${NAME[k]}: expert fitted ${sz(e, u)}, draft left it out.`;
    if (e == null) return `${NAME[k]}: draft added ${sz(d, u)}, expert fitted none.`;
    const diff = n2(Math.abs(d - e));
    if (sz(d, u) === sz(e, u)) return `${NAME[k]}: draft ${sz(d, u)}, expert ${sz(e, u)}, flagged outside tolerance by rounding.`;
    return `${NAME[k]}: draft ${sz(d, u)}, expert ${sz(e, u)}, ${diff} ${u} ${d > e ? "over" : "under"}.`;
  }).join(" ");
}

function Replay({ ev }: { ev: EvalX | null }) {
  const [rows, setRows] = useState<InboxRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [shown, setShown] = useState(0);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    (async () => {
      const r = await call<InboxRow[]>("/api/inbox?limit=20");
      if (r.ok) { setRows(r.data); setErr(null); return; }
      if (!/404|not found/i.test(r.error)) { setErr(r.error); return; }
      // Before v1.3: build the rows from the held-out list and each project's detail.
      const l = await call<ProjectSummary[]>("/api/projects?split=test&limit=20");
      if (!l.ok) { setErr(l.error); return; }
      const out: InboxRow[] = [];
      for (const x of l.data) {
        const d = await call<ProjectDetail>(`/api/projects/${x.project_id}`);
        if (!d.ok) continue;
        const inc = KEYS.filter((k) => d.data.ours.components[k].decision === "include");
        const w = Object.fromEntries(KEYS.map((k) => [k, within(d.data.ours.design[COMPONENT_DESIGN_FIELD[k]], x.expert[COMPONENT_DESIGN_FIELD[k]], ev?.components[k]?.tolerance ?? "")])) as Record<ComponentKey, boolean>;
        out.push({ project_id: x.project_id, installer_id: x.installer_id, label: "", inputs: x.inputs, draft: d.data.ours.design, expert: x.expert, confidence: inc.length ? inc.reduce((a, k) => a + d.data.ours.components[k].confidence, 0) / inc.length : 1, within: { ...w, all: KEYS.every((k) => w[k]) }, note: "" });
      }
      setRows(out);
    })();
  }, [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const sorted = useMemo(() => rows ?? [], [rows]);
  const ok = rows ? rows.filter((r) => r.within.all).length : 0;
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
    <section className={s.sec}>
      <h2>{rows ? `Held-out replay: ${ok} of ${rows.length} drafts match the senior planner` : "Held-out replay"}</h2>
      <p className={s.lede}>Twenty held-out signed projects run through the engine. Rows marked review say where the draft differs.</p>
      {err && <Err src="Engine" msg={err} retry={() => setTick((t) => t + 1)} />}
      {!rows && !err && <p className={s.wait}>Replaying</p>}
      {rows && (
        <div className={s.panel}>
          <div className={`${s.ir} ${s.th}`}><span>Home</span><span>Draft</span><span style={{ textAlign: "right" }}>Against the expert</span></div>
          {vis.map((r) => {
            const i = r.inputs, sub = [i.heating_type !== "Unknown" ? HEATING_WORD[i.heating_type] : "Heating not recorded", i.has_ev ? "EV" : null].filter(Boolean).join(", ");
            return (
              <div className={`${s.ir} s-in`} key={r.project_id} title={r.note || undefined}>
                <span>{INSTALLER_NAME[r.installer_id]}, {n0(i.annual_demand_kwh)} kWh<small>{sub}</small></span>
                <span className={s.d}>{designLine(r.draft)}</span>
                <span className={r.within.all ? s.ok : s.rev}>{r.within.all ? "matches" : "review"}</span>
                {!r.within.all && <span className={s.why}>{miss(r)}</span>}
              </div>
            );
          })}
        </div>
      )}
      {rows && <p className={s.tally} aria-live="polite">{pvHit} of {vis.length} within tolerance on solar{vis.length < sorted.length ? " so far" : ""}</p>}
      <Src><Api path="/api/inbox?limit=20" /></Src>
    </section>
  );
}

function ByComponent({ ev }: { ev: EvalX }) {
  const ft = ev.final_test;
  const half = ft?.rows.filter((r) => r.population === "test half" && r.ground_truth === "lowest option" && r.band === "ours") ?? [];
  const prod = ft?.production.replace(/-readout$/, "");
  const us = half.find((r) => r.engine === prod), tb = half.find((r) => r.engine === "textbook");
  if (!us) return null;
  const val = (r: typeof us | undefined, k: ComponentKey) => r ? pct1((r as unknown as Record<string, number>)[k === "heatpump" ? "heatpump" : k === "pv" ? "pv" : k]) : "";
  return (
    <section className={s.sec}>
      <h2>Per part, sealed test half</h2>
      <p className={s.lede}>Share of the {n0(us.n)} sealed held-out homes within tolerance, per part.</p>
      <div className={`${s.panel} ${s.scroll}`}>
        <table className={s.t}>
          <thead><tr><th>Part</th><th className={s.r}>Draft</th><th className={s.r}>Textbook</th><th>Tolerance</th></tr></thead>
          <tbody>
            <tr className={s.prod}><td>Whole design</td><td className={`${s.r} ${s.n}`}>{pct1(us.all_four)}</td><td className={`${s.r} ${s.n} ${s.dim}`}>{tb ? pct1(tb.all_four) : ""}</td><td className={s.dim}>all four at once</td></tr>
            {KEYS.map((k) => (
              <tr key={k}><td>{NAME[k]}</td><td className={`${s.r} ${s.n}`}>{val(us, k)}</td><td className={`${s.r} ${s.n} ${s.dim}`}>{val(tb, k)}</td><td className={s.dim}>{ev.components[k]?.tolerance}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <Src><Api path="/api/eval" /> (<code>final_test</code>), <Doc path="engine/lab/reports/final_test_v2.md" /></Src>
    </section>
  );
}

function Recommenders({ ev }: { ev: EvalX }) {
  const ft = ev.final_test;
  const rows = ft?.rows.filter((r) => r.population === "test half" && r.ground_truth === "lowest option" && r.band === "ours") ?? [];
  const rr = (ev.recommenders as Record<string, RecommenderScore & { n?: number }> | undefined)?.reonic_rule;
  if (!rows.length) return null;
  const prod = ft!.production.replace(/-readout$/, "");
  return (
    <section className={s.sec}>
      <h2>Rule sets against the black box, sealed test</h2>
      <p className={s.lede}>Scored once on the test half the rules were not fitted on. Production is {ft!.production}.</p>
      <div className={`${s.panel} ${s.scroll}`}>
        <table className={s.t}>
          <thead><tr><th>Engine</th><th className={s.r}>Homes</th><th className={s.r}>Whole design</th><th className={s.r}>Solar</th><th className={s.r}>Battery</th><th className={s.r}>Wallbox</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.engine} className={r.engine === prod ? s.prod : undefined}><td>{r.engine}</td><td className={`${s.r} ${s.n}`}>{n0(r.n)}</td><td className={`${s.r} ${s.n}`}>{pct1(r.all_four)}</td><td className={`${s.r} ${s.n}`}>{pct1(r.pv)}</td><td className={`${s.r} ${s.n}`}>{pct1(r.battery)}</td><td className={`${s.r} ${s.n}`}>{pct1(r.wallbox)}</td></tr>
            ))}
            {rr && <tr><td>Reonic rule of thumb</td><td className={`${s.r} ${s.n}`}>{rr.n != null ? n0(rr.n) : ""}</td><td className={`${s.r} ${s.n}`}>{pct1(rr.design_match_share)}</td><td className={`${s.r} ${s.n}`}>{pct1(rr.pv_within)}</td><td className={`${s.r} ${s.n}`}>{pct1(rr.battery_within)}</td><td className={`${s.r} ${s.n}`}>{pct1(rr.wallbox_decision)}</td></tr>}
          </tbody>
        </table>
      </div>
      <ul className={s.note} style={{ paddingLeft: 18 }}>
        <li>{ft!.significance}</li>
        {ev.recommenders_labels?.reonic_rule && <li>{ev.recommenders_labels.reonic_rule}.</li>}
        {ev.second_look && <li>Second look: {ev.second_look.verdict}</li>}
        {ev.exam_note && <li>{ev.exam_note}</li>}
      </ul>
      <Src><Api path="/api/eval" /> (<code>final_test</code>), <Doc path="engine/lab/reports/final_test.md" branch="engine-lab" />, <Doc path="engine/lab/reports/final_test_v2.md" branch="engine-lab" /></Src>
    </section>
  );
}

function Deviations({ ev }: { ev: EvalX }) {
  const q = ev.deviation_quality;
  return (
    <section className={s.sec}>
      <h2>Where the draft differs from the expert</h2>
      {q && q.n_differ > 0 && (<>
        <p className={s.lede}>On {n0(q.n_differ)} homes where solar, battery or wallbox is outside tolerance, both designs run through the same hourly simulation.</p>
        <div className={`${s.panel} ${s.scroll}`}>
          <table className={s.t}>
            <thead><tr><th>Better on</th><th className={s.r}>Draft</th><th className={s.r}>Expert</th></tr></thead>
            <tbody>
              {q.ours_better_npv != null && <tr><td>20-year net present value</td><td className={`${s.r} ${s.n}`}>{n0(q.ours_better_npv)}</td><td className={`${s.r} ${s.n}`}>{n0(q.expert_better_npv ?? 0)}</td></tr>}
              <tr><td>Payback</td><td className={`${s.r} ${s.n}`}>{n0(q.ours_better_payback)}</td><td className={`${s.r} ${s.n}`}>{n0(q.expert_better_payback)}</td></tr>
              <tr><td>Autarky</td><td className={`${s.r} ${s.n}`}>{n0(q.ours_better_autarky)}</td><td className={`${s.r} ${s.n}`}>{n0(q.expert_better_autarky)}</td></tr>
            </tbody>
          </table>
        </div>
        <p className={s.note}>{q.median_npv_gain_eur != null && `Median net present value gain €${n0(q.median_npv_gain_eur)}. `}{q.method}.</p>
      </>)}
      {ev.deviations.length > 0 && (<>
        <h3>Largest single deviations</h3>
        <div className={s.panel}>
          {ev.deviations.map((d, k) => {
            const u = UNIT[d.component as ComponentKey] ?? "";
            return (
              <div className={s.dev} key={k}>
                <div className={s.top}><span>{NAME[d.component as ComponentKey] ?? d.component}</span><span className={s.n}>draft {sz(d.ours, u)}, expert {sz(d.expert, u)}</span><span className={s.mono} style={{ color: "var(--ink-3)", marginLeft: "auto" }}>{d.project_id}</span></div>
                <p>{d.note}</p>
              </div>
            );
          })}
        </div>
      </>)}
      <Src><Api path="/api/eval" /> (<code>deviation_quality</code>, <code>deviations</code>)</Src>
    </section>
  );
}

function Synthetic({ ev }: { ev: EvalX }) {
  const y = ev.synthetic;
  if (!y) return null;
  return (
    <section className={s.sec}>
      <h2>Synthetic suite</h2>
      <p className={s.lede}>{y.headline}</p>
      {y.invariants.length > 0 && (
        <div className={`${s.panel} ${s.scroll}`}>
          <table className={s.t}>
            <thead><tr><th>Invariant</th><th>Group</th><th className={s.r}>Checked</th>{y.before && <th className={s.r}>Before</th>}<th className={s.r}>Now</th></tr></thead>
            <tbody>{y.invariants.map((i) => { const b = y.before?.pass_share[i.name]; return (
              <tr key={i.name}><td>{i.name}</td><td className={s.dim}>{i.group}</td><td className={`${s.r} ${s.n} ${s.dim}`}>{n0(i.n_checked)}</td>{y.before && <td className={`${s.r} ${s.n} ${s.dim}`}>{pct1(b)}</td>}<td className={`${s.r} ${s.n}`}>{pct1(i.pass_share)}</td></tr>
            ); })}</tbody>
          </table>
        </div>
      )}
      <Src><Api path="/api/eval" /> (<code>synthetic</code>), <Doc path="docs/synthetic.md" /></Src>
    </section>
  );
}

function ResetDemo() {
  const [busy, setBusy] = useState(false);
  const [out, setOut] = useState<{ ok: boolean; line: string }[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const run = async () => {
    setBusy(true); setErr(null); setOut(null);
    const r = await call<{ lines: { ok: boolean; line: string }[] }>("/api/leads/reset-pinned", {});
    setBusy(false);
    if (r.ok) setOut(r.data.lines); else setErr(r.error);
  };
  return (
    <section className={s.reset} aria-label="Demo leads">
      <button className="btn ghost" onClick={run} disabled={busy}>{busy ? "Resetting" : "Reset demo leads"}</button>
      {err && <Err src="Engine" msg={err} retry={run} />}
      {out && <ul>{out.map((l, i) => <li key={i}>{l.line}</li>)}</ul>}
    </section>
  );
}

export default function Check() {
  const [ev, setEv] = useState<EvalX | null>(null);
  const [evErr, setEvErr] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [real, setReal] = useState<string>(REALITY_PROJECT);
  useEffect(() => { call<EvalX>("/api/eval").then((r) => { if (r.ok) { setEv(r.data); setEvErr(null); } else setEvErr(r.error); }); }, [tick]);
  return (
    <div className={`st ${s.page}`}>
      <StepHead title="Check" at={3} />
      <Headline ev={ev} err={evErr} retry={() => setTick((t) => t + 1)} />
      <Validation />
      <Reality ev={ev} id={real} onOther={() => setReal((x) => x === REALITY_PROJECT ? REALITY_MISS : REALITY_PROJECT)} />
      <Replay ev={ev} />
      {ev && <>
        <ByComponent ev={ev} />
        <Recommenders ev={ev} />
        <Deviations ev={ev} />
      </>}
      {ev && <Synthetic ev={ev} />}
      <ResetDemo />
    </div>
  );
}
