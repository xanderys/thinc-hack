"use client";
import { use, useEffect, useRef, useState } from "react";
import type { Design, HomeInputs, Lead, Priors } from "@/lib/api";
import { HEATING_WORD, n0, n2 } from "@/lib/stage";

const FIELD: Partial<Record<keyof HomeInputs, string>> = {
  annual_demand_kwh: "Annual use", num_inhabitants: "Household", has_ev: "Electric car", ev_annual_km: "Car distance", has_wallbox: "Existing wallbox",
  heating_type: "Heating", house_size_sqm: "Floor area", house_built_year: "Year built", electricity_price_ct_kwh: "Price", has_solar: "Existing solar",
  existing_solar_kwp: "Existing solar", has_storage: "Existing battery", existing_storage_kwh: "Existing battery", heating_demand_kwh: "Heat demand",
};
const UNIT: Partial<Record<keyof HomeInputs, string>> = { annual_demand_kwh: " kWh", house_size_sqm: " m²", electricity_price_ct_kwh: " ct/kWh", ev_annual_km: " km", heating_demand_kwh: " kWh", existing_solar_kwp: " kWp", existing_storage_kwh: " kWh" };
const fact = (k: keyof HomeInputs, v: unknown) =>
  typeof v === "boolean" ? (v ? "Yes" : "No") : k === "heating_type" ? HEATING_WORD[v as keyof typeof HEATING_WORD] ?? String(v)
  : k === "num_inhabitants" ? `${v} people` : k === "house_built_year" ? String(v) : typeof v === "number" ? `${n0(v)}${UNIT[k] ?? ""}` : String(v);
const ROWS: { k: keyof Design; name: string; u: string; comp: string }[] = [
  { k: "pv_kwp", name: "Solar", u: "kWp", comp: "pv" }, { k: "battery_kwh", name: "Battery", u: "kWh", comp: "battery" },
  { k: "heatpump_kw", name: "Heat pump", u: "kW", comp: "heatpump" }, { k: "wallbox_kw", name: "Wallbox", u: "kW", comp: "wallbox" },
];

// One smooth spring, no bounce (critically damped, about 500 ms). Reduce Motion jumps.
function Spring({ to, fmt }: { to: number; fmt: (x: number) => string }) {
  const [x, setX] = useState(to);
  const from = useRef(to);
  useEffect(() => {
    if (from.current === to) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) { from.current = to; setX(to); return; }
    const a = from.current, t0 = performance.now(), w = 2 * Math.PI / 0.5;
    let raf = 0;
    const step = (t: number) => {
      const s = (t - t0) / 1000, k = 1 - (1 + w * s) * Math.exp(-w * s);
      if (s > 1.2) { from.current = to; setX(to); return; }
      setX(a + (to - a) * k); raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); from.current = to; };
  }, [to]);
  return <>{fmt(x)}</>;
}

export default function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [lead, setLead] = useState<Lead | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [priors, setPriors] = useState<Priors | null>(null);
  const [retry, setRetry] = useState(0);
  const [approvedAt, setApprovedAt] = useState<string | null>(null);

  useEffect(() => {
    let stop = false, done = false;
    const load = async () => {
      if (done) return;
      const r = await fetch(`/api/leads/${id}`, { cache: "no-store" }).catch((e) => { if (!stop) setErr(String(e)); return null; });
      if (!r || stop) return;
      const b = await r.json().catch(() => ({ detail: `Lead returned ${r.status}` }));
      if (!r.ok) { setErr(typeof b.detail === "string" ? b.detail : b.error ?? `Lead returned ${r.status}`); return; }
      setErr(null); setLead(b); if (b.status === "done") done = true;
    };
    load();
    const t = setInterval(load, 2500);
    return () => { stop = true; clearInterval(t); };
  }, [id, retry]);
  useEffect(() => { fetch("/api/intake/priors").then((r) => r.ok ? r.json() : null).then(setPriors).catch(() => {}); }, []);

  const last = lead?.history.at(-1);
  const why = (comp: string) => last?.changed.find((c) => c.component === comp)?.why;
  const asked = new Set(lead?.history.map((h) => h.field));
  const facts = lead ? (Object.keys(FIELD) as (keyof HomeInputs)[]).filter((k) => lead.facts[k] != null && !(k === "existing_solar_kwp" && lead.facts.has_solar) && !((k === "has_wallbox" || k === "has_solar" || k === "has_storage") && lead.facts[k] === false) && !(k === "existing_storage_kwh" && lead.facts.has_storage)) : [];
  const top = priors?.order.filter((o) => o.mean_swing > 0).slice(0, 3).map((o) => (FIELD[o.field as keyof HomeInputs] ?? o.field).toLowerCase());
  const e = lead?.draft.economics;

  function approve() {
    if (!lead) return;
    const at = new Date();
    try { sessionStorage.setItem("marquee.approved", JSON.stringify({ inputs: lead.facts, draft: lead.draft.design, approved: lead.draft.design, at: at.toISOString() })); } catch { /* storage blocked */ }
    setApprovedAt(at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }));
  }

  return (
    <div className="st l-page">
      <header className="l-head">
        <a href="/" className="l-back">Planner</a>
        <h1>{lead ? `${lead.customer_name}, ${lead.address_or_postcode}` : "Lead"}</h1>
        {lead && <p className={`l-state ${lead.status}`}>{lead.status === "done" ? "First design ready" : lead.status === "in_call" ? <><span className="dot" aria-hidden />On the call with Rina</> : "Waiting for the call"}</p>}
        {lead && lead.status === "in_call" && lead.next_question && <p className="l-ask">Asking: {lead.next_question.question}</p>}
      </header>
      {err && <div className="error" role="alert"><span><span className="src">Engine said</span>{err}</span><button className="btn ghost" onClick={() => setRetry((x) => x + 1)}>Retry</button></div>}
      {!lead && !err && <p className="s-quiet s-wait">Loading the lead</p>}
      {lead && (
        <div className="l-grid">
          <section className="l-facts">
            <h3 className="s-h3">Facts</h3>
            <dl>
              {facts.map((k) => <div key={k} className={asked.has(k) ? "s-in l-new" : undefined}><dt>{FIELD[k]}</dt><dd>{fact(k, lead.facts[k])}</dd></div>)}
            </dl>
            <p className="l-meta"><span>Questions asked: {lead.questions_asked}</span>
              {priors && <span>Learned from {n0(priors.n_steps_logged)} answered questions{top?.length ? `; most telling: ${top.join(", ")}` : ""}</span>}</p>
          </section>
          <section className="l-design">
            <h3 className="s-h3">Draft</h3>
            <ul className="l-comps">
              {ROWS.map((r) => {
                const v = lead.draft.design[r.k] as number | null;
                const w = why(r.comp);
                return (
                  <li key={r.k}>
                    <span className="n">{r.name}</span>
                    <span className="s num">{v == null ? "None" : <><Spring to={v} fmt={n2} /><span className="u">{r.u}</span></>}</span>
                    {w && <span key={`${last?.step}-${r.k}`} className="w s-in">{w}</span>}
                  </li>
                );
              })}
            </ul>
            {e && (
              <dl className="l-econ">
                <div><dt>Self-sufficiency</dt><dd className="num"><Spring to={e.autarky_share * 100} fmt={(x) => `${Math.round(x)}%`} /></dd></div>
                <div><dt>Investment</dt><dd className="num"><Spring to={e.capex_eur} fmt={(x) => `${n0(x)} EUR`} /></dd></div>
                <div><dt>Payback</dt><dd className="num">{e.payback_years == null ? "None" : <Spring to={e.payback_years} fmt={(x) => `${(Math.round(x * 10) / 10).toLocaleString("en-GB")} years`} />}</dd></div>
              </dl>
            )}
            {lead.status === "done" && (approvedAt
              ? <span className="s-approved s-mark">Approved {approvedAt}<a href="/check">See what really happened</a></span>
              : <button className="btn" onClick={approve}>Approve</button>)}
          </section>
        </div>
      )}
    </div>
  );
}
