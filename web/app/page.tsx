"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Lead from "@/components/stage/Lead";
import Plan, { type Variant } from "@/components/stage/Plan";
import StepHead from "@/components/stage/StepHead";
import type { AskQuestion, AskResponse, DesignResponse, HomeInputs, InstallerId, Overrides, ReadResponse, RefineResponse, WriteResponse } from "@/lib/api";
import { call } from "@/lib/client";
import { HERO_LEAD } from "@/lib/demo";
import { buildFacts, DEFAULTS, pickFlag, variantName } from "@/lib/stage";

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export default function Stage() {
  const [lead, setLead] = useState(HERO_LEAD);
  const [read, setRead] = useState<ReadResponse | null>(null);
  const [readBusy, setReadBusy] = useState(false);
  const [readErr, setReadErr] = useState<string | null>(null);
  const [installer, setInstaller] = useState<InstallerId>("2a8ba8e2");
  const [question, setQuestion] = useState<AskQuestion | null | undefined>(undefined); // undefined while asking
  const [askErr, setAskErr] = useState<string | null>(null);
  const [answer, setAnswer] = useState<unknown>(undefined);
  const [changed, setChanged] = useState<Partial<HomeInputs>>({});    // from sentences, Moment 3
  const [overrides, setOverrides] = useState<Overrides>({});
  const [res, setRes] = useState<DesignResponse | null>(null);
  const [prev, setPrev] = useState<DesignResponse | null>(null);
  const [drafted, setDrafted] = useState<DesignResponse | null>(null);  // the agent's own draft, no overrides
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const [write, setWrite] = useState<WriteResponse | null>(null);
  const [writeBusy, setWriteBusy] = useState(false);
  const [pvOnly, setPvOnly] = useState<RefineResponse | null>(null);
  const last = useRef<DesignResponse | null>(null);

  const inputs: HomeInputs = useMemo(() => {
    const base: HomeInputs = { ...DEFAULTS, ...(read?.inputs ?? {}), installer_id: installer };
    if (question && answer !== undefined) (base as unknown as Record<string, unknown>)[question.field] = answer;
    return { ...base, ...changed };
  }, [read, installer, question, answer, changed]);
  const ready = !!read && question !== undefined && (question === null || answer !== undefined);

  // Shortcut d loads the hero lead.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.key !== "d" || e.metaKey || e.ctrlKey || /INPUT|TEXTAREA|SELECT/.test(t.tagName)) return;
      setLead(HERO_LEAD); setRead(null);
    };
    addEventListener("keydown", on); return () => removeEventListener("keydown", on);
  }, []);

  async function doRead() {
    setReadBusy(true); setReadErr(null);
    const r = await call<ReadResponse>("/api/read", { lead });
    setReadBusy(false);
    if (!r.ok) { setReadErr(r.error); return; }
    setQuestion(undefined); setAnswer(undefined); setChanged({}); setOverrides({}); setRes(null); setPrev(null); last.current = null;
    setRead(r.data);
    const base: HomeInputs = { ...DEFAULTS, ...r.data.inputs, installer_id: installer };
    // A restarting engine answers 502 for about 35 s: wait and ask again rather than skip the question.
    for (let k = 0; ; k++) {
      const a = await call<AskResponse>("/api/ask", { inputs: base, unknown: r.data.unknown });
      if (a.ok) { setQuestion(a.data.questions[0] ?? null); setAskErr(null); return; }
      if (/404|not found/i.test(a.error)) { setQuestion(null); setAskErr(null); return; }
      if (k >= 7) { setQuestion(null); setAskErr(a.error); return; }
      setAskErr(`${a.error} Asking again.`);
      await new Promise((ok) => setTimeout(ok, 6000));
    }
  }

  // Design, or refine when the planner has fixed something.
  useEffect(() => {
    if (!ready) return;
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const fixed = Object.keys(overrides).length > 0;
        const r = fixed ? await call<RefineResponse>("/api/refine", { inputs, overrides }, ctl.signal) : await call<DesignResponse>("/api/design", { inputs }, ctl.signal);
        if (r.ok) {
          setPrev(last.current); last.current = r.data; setRes(r.data); setErr(null);
          if (!fixed) setDrafted(r.data);
        } else setErr(r.error);
        setBusy(false);
      } catch { /* superseded */ }
    }, 150);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [ready, inputs, overrides, retry]);

  useEffect(() => {
    if (!err?.includes("restarting")) return;
    const t = setTimeout(() => setRetry((x) => x + 1), 8000);
    return () => clearTimeout(t);
  }, [err, retry]);

  // Prose and component lines, grounded in the engine's facts.
  const facts = useMemo(() => res ? buildFacts(inputs, res) : null, [res]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!facts) return;
    const ctl = new AbortController();
    setWriteBusy(true); setWrite(null);
    call<WriteResponse>("/api/write", { facts, mode: "planner" }, ctl.signal)
      .then((r) => { setWrite(r.ok ? r.data : null); setWriteBusy(false); })
      .catch(() => {});
    return () => ctl.abort();
  }, [facts]);

  // The PV-only variant for the current home.
  useEffect(() => {
    setPvOnly(null);
    if (!res || res.design.battery_kwh == null) return;
    const ctl = new AbortController();
    call<RefineResponse>("/api/refine", { inputs, overrides: { ...overrides, battery_kwh: null } }, ctl.signal)
      .then((r) => { if (r.ok) setPvOnly(r.data); }).catch(() => {});
    return () => ctl.abort();
  }, [res]); // eslint-disable-line react-hooks/exhaustive-deps

  const variants: Variant[] = useMemo(() => {
    if (!res) return [];
    const fixed = Object.keys(overrides).length > 0;
    const out: Variant[] = [{ name: variantName(res.design), tag: fixed ? "Chosen" : "Recommended", design: res.design, e: res.economics, overrides: null, current: true }];
    if (fixed && drafted && !same(drafted.design, res.design)) out.push({ name: variantName(drafted.design, res.design), tag: "Recommended", design: drafted.design, e: drafted.economics, overrides: {}, current: false });
    const o = res.optimum;
    if (o && !same(o.design, res.design)) out.push({ name: variantName(o.design, res.design), tag: "Earns most", design: o.design, e: o.economics, overrides: { ...overrides, pv_kwp: o.design.pv_kwp, battery_kwh: o.design.battery_kwh }, current: false });
    if (res.design.battery_kwh != null) out.push({ name: "PV only", tag: "Cheapest", design: pvOnly?.design ?? { ...res.design, battery_kwh: null }, e: pvOnly?.economics ?? null, overrides: { ...overrides, battery_kwh: null }, current: false });
    return out.filter((v, k) => out.findIndex((w) => w.name === v.name) === k);
  }, [res, drafted, pvOnly, overrides]);

  const onVariant = useCallback((v: Variant) => { if (v.overrides) setOverrides(v.overrides); }, []);
  const flag = res ? pickFlag(res) : null;
  const at = !read ? 0 : res ? 1 : 0;

  return (
    <div className="st">
      <StepHead title={res ? "Plan system" : "Lead"} at={at} />
      <div className="s-stage">
        <Lead lead={lead} setLead={setLead} read={read} busy={readBusy} error={readErr} onRead={doRead} onEdit={() => setRead(null)}
          inputs={inputs} changed={changed} setInstaller={setInstaller}
          question={question ?? null} answer={answer} onAnswer={setAnswer} askError={askErr} />
        <div className="s-main">
          {err && <div className="error" role="alert"><span><span className="src">Engine said</span>{err}</span><button className="btn ghost" onClick={() => setRetry((x) => x + 1)}>Retry</button></div>}
          {res && <Plan res={res} prev={prev} inputs={inputs} write={write} writeBusy={writeBusy} flag={flag} variants={variants} onVariant={onVariant} busy={busy} />}
        </div>
      </div>
    </div>
  );
}
