import "server-only";
// Stand-in for engine v1.9 leads until the engine serves them (LEADS_MOCK=1). A scripted call answers one question every 5 s.
import { createHash } from "node:crypto";
import type { ApproveResponse, DecisionBody, DecisionResponse, Design, DesignResponse, HomeInputs, Lead, LeadChange, LeadCreated, LeadDecision, LeadRow, LeadStatus, NextQuestion, Priors, Variant } from "./api";
import { mockDesign as mockDesignBase } from "./mock";

// v2.5: the mock draft carries variants and a break-even year the way the engine's does.
function mockDesign(i: HomeInputs): DesignResponse {
  const r = mockDesignBase(i), d = r.design, e = r.economics;
  const be = (x: DesignResponse["economics"]) => ({ ...x, break_even_year: x.payback_years == null ? null : Math.ceil(x.payback_years) });
  const variants: Variant[] = [{ key: "expert", label: "Planners' design", design: d, economics: be(e), note: "" }];
  if (d.pv_kwp != null && d.battery_kwh != null) {
    const bat = d.battery_kwh + 5, capex = e.capex_eur + 5 * 450;
    variants.push({ key: "independence", label: "Most independence", design: { ...d, battery_kwh: bat }, note: "",
      economics: be({ ...e, capex_eur: capex, autarky_share: Math.min(0.9, Math.round((e.autarky_share + 0.08) * 100) / 100), payback_years: e.payback_years == null ? null : Math.round((e.payback_years + 1.4) * 10) / 10 }) });
    variants.push({ key: "upfront", label: "Lowest upfront cost", design: { ...d, battery_kwh: null }, note: "",
      economics: be({ ...e, capex_eur: e.capex_eur - d.battery_kwh * 450, autarky_share: Math.max(0.2, Math.round((e.autarky_share - 0.18) * 100) / 100), payback_years: e.payback_years == null ? null : Math.round((e.payback_years - 0.9) * 10) / 10 }) });
  }
  return { ...r, economics: be(e), variants };
}

// Same rule as the engine: sha256 over {design, variant, investment_eur}, keys sorted, compact JSON.
function proposalOf(draft: DesignResponse, key: string) {
  const v = draft.variants?.find((x) => x.key === key);
  const d = v?.design ?? draft.design, capex = (v?.economics ?? draft.economics).capex_eur ?? 0;
  const design = { battery_kwh: d.battery_kwh, heatpump_kw: d.heatpump_kw, inverter_kw: d.inverter_kw, pv_kwp: d.pv_kwp, wallbox_kw: d.wallbox_kw };
  return { design, variant: v || key === "expert" ? key : "expert", investment_eur: Math.round(capex * 100) / 100 };
}
const hashOf = (draft: DesignResponse, key: string) => {
  const p = proposalOf(draft, key);
  return createHash("sha256").update(JSON.stringify({ design: p.design, investment_eur: p.investment_eur, variant: p.variant })).digest("hex");
};

const DEFAULTS: HomeInputs = { installer_id: "2a8ba8e2", annual_demand_kwh: 4500, load_profile: "H0", has_ev: false, has_wallbox: false, heating_type: "Unknown", has_solar: false, has_storage: false };
const SCRIPT: { field: keyof HomeInputs; value: unknown; question: string; why: string }[] = [
  { field: "annual_demand_kwh", value: 5000, question: "How much electricity does the house use a year?", why: "Sets the solar size most." },
  { field: "heating_type", value: "Gas", question: "How is the house heated?", why: "Decides whether a heat pump belongs in the offer." },
  { field: "num_inhabitants", value: 4, question: "How many people live there?", why: "Shapes the evening load the battery covers." },
];
const STEP_MS = 5000;
// On globalThis so dev reloads keep the scripted leads.
type Rec = {
  created: number; name: string; place: string; facts: HomeInputs; extra?: { facts: Partial<HomeInputs>; at: number }[];
  status?: LeadStatus; approvedAt?: string | null; approvedVariant?: Variant["key"] | null; decision?: Omit<LeadDecision, "matches_current"> | null; touched?: number;
};
const leads: Map<string, Rec> = ((globalThis as unknown as { __mockLeads?: Map<string, Rec> }).__mockLeads ??= new Map());
const NAME: Record<string, string> = { pv_kwp: "pv", inverter_kw: "inverter", battery_kwh: "battery", heatpump_kw: "heatpump", wallbox_kw: "wallbox" };

function nq(i: number): NextQuestion | null {
  const s = SCRIPT[i];
  return s ? { field: s.field, question: s.question, why: s.why, expected_swing: "beyond tolerance" } : null;
}

export function mockCreateLead(body: { customer_name: string; address_or_postcode: string; installer_id?: string; facts?: Partial<HomeInputs> }): LeadCreated {
  const id = `lead_${Math.random().toString(36).slice(2, 10)}`;
  const facts = { ...DEFAULTS, ...(body.facts ?? {}), installer_id: (body.installer_id ?? "2a8ba8e2") as HomeInputs["installer_id"] };
  leads.set(id, { created: Date.now(), name: body.customer_name, place: body.address_or_postcode, facts });
  return { lead_id: id, draft: mockDesign(facts), facts, unknown: SCRIPT.map((s) => s.field), next_question: nq(0) };
}

export function mockGetLead(id: string): Lead | null {
  const l = leads.get(id);
  if (!l) return null;
  const steps = Math.min(SCRIPT.length, Math.floor((Date.now() - l.created) / STEP_MS));
  let facts = { ...l.facts }, before: Design = mockDesign(facts).design;
  const history: Lead["history"] = [];
  for (let k = 0; k < steps; k++) {
    const s = SCRIPT[k];
    facts = { ...facts, [s.field]: s.value, ...(s.field === "has_ev" ? { ev_annual_km: 15000 } : {}) };
    const after = mockDesign(facts).design;
    const changed: LeadChange[] = (Object.keys(after) as (keyof Design)[]).filter((f) => after[f] !== before[f])
      .map((f) => ({ component: NAME[f], from: before[f], to: after[f], why: s.why }));
    history.push({ step: k + 1, field: s.field, answer: s.value, changed, at: new Date(l.created + (k + 1) * STEP_MS).toISOString() });
    before = after;
  }
  for (const x of l.extra ?? []) {
    facts = { ...facts, ...x.facts };
    const after = mockDesign(facts).design;
    const changed: LeadChange[] = (Object.keys(after) as (keyof Design)[]).filter((f) => after[f] !== before[f])
      .map((f) => ({ component: NAME[f], from: before[f], to: after[f], why: "Changed by the planner." }));
    history.push({ step: history.length + 1, field: Object.keys(x.facts)[0] ?? "planner", answer: Object.values(x.facts)[0], changed, at: new Date(x.at).toISOString() });
    before = after;
  }
  const done = steps >= SCRIPT.length;
  const draft = mockDesign(facts), hash = hashOf(draft, l.approvedVariant ?? "expert");
  // The engine logs a decision as a history row with no step.
  if (l.decision) history.push({ step: null as unknown as number, field: null as unknown as string, answer: {}, changed: [], at: l.decision!.decided_at });
  return {
    lead_id: id, status: l.status ?? (done ? "done" : "in_call"), customer_name: l.name, address_or_postcode: l.place, facts, draft,
    proposal_hash: hash, approved_at: l.approvedAt ?? null, approved_variant: l.approvedVariant ?? null,
    decision: l.decision ? { ...l.decision, matches_current: l.decision.proposal_hash === hash } : null,
    history, next_question: done ? null : nq(steps), questions_asked: steps,
    created_at: new Date(l.created).toISOString(), updated_at: new Date(Math.max(l.created + steps * STEP_MS, l.touched ?? 0, ...(l.extra ?? []).map((x) => x.at))).toISOString(),
  };
}

export function mockListLeads(limit = 20): LeadRow[] {
  return [...leads.entries()].reverse().slice(0, limit).map(([id]) => {
    const l = mockGetLead(id)!;
    return { lead_id: id, status: l.status, title: `${l.customer_name}, ${l.address_or_postcode}`, customer_name: l.customer_name, address_or_postcode: l.address_or_postcode, created_at: l.created_at, decision: l.decision, proposal_hash: l.proposal_hash };
  });
}

export function mockPriors(): Priors {
  return { n_steps_logged: 214, order: [
    { field: "annual_demand_kwh", mean_swing: 2.4, times_asked: 61 },
    { field: "has_ev", mean_swing: 2.1, times_asked: 58 },
    { field: "heating_type", mean_swing: 1.3, times_asked: 47 },
    { field: "num_inhabitants", mean_swing: 0.6, times_asked: 48 },
  ] };
}

export function mockStep(body: { lead_id: string; facts_so_far: Partial<HomeInputs> }) {
  const l = leads.get(body.lead_id);
  if (!l) return null;
  const before = mockGetLead(body.lead_id)!;
  (l.extra ??= []).push({ facts: body.facts_so_far, at: Date.now() });
  const g = mockGetLead(body.lead_id)!;
  // As the engine: a change in what the homeowner is offered drops the lead to done; approved or signed must be released again.
  if (l.status && g.proposal_hash !== before.proposal_hash) {
    if (l.status === "approved" || l.status === "signed") l.approvedAt = null;
    l.status = undefined;
  }
  return { design: g.draft.design, draft: g.draft, changed: g.history.at(-1)?.changed ?? [], next_question: g.next_question, done: g.status === "done", step: g.history.length };
}

type Out = { status: number; body: unknown };
const err = (status: number, error: string): Out => ({ status, body: { error } });

export function mockApprove(id: string, body: { variant?: Variant["key"] } | undefined): Out {
  const l = leads.get(id), g = l && mockGetLead(id);
  if (!l || !g) return err(404, `No lead with id ${id}`);
  const variant = body?.variant ?? "expert";
  if (variant !== "expert" && !g.draft.variants?.some((v) => v.key === variant)) return err(422, `This lead has no ${variant} variant.`);
  l.status = "approved"; l.approvedAt = new Date().toISOString(); l.approvedVariant = variant; l.touched = Date.now();
  const res: ApproveResponse & { ok: true } = { ok: true, status: "approved", approved_at: l.approvedAt, approved_variant: variant, proposal_hash: hashOf(g.draft, variant) };
  return { status: 200, body: res };
}

export function mockDecision(id: string, b: DecisionBody): Out {
  const l = leads.get(id), g = l && mockGetLead(id);
  if (!l || !g) return err(404, `No lead with id ${id}`);
  if (b.action === "sign") {
    if (g.status !== "approved" && g.status !== "signed") return err(409, "The planner has not released this proposal yet.");
    if (!b.accepted) return err(422, "Signing needs accepted: true.");
    if (!(b.name ?? "").trim()) return err(422, "Signing needs the signer's name.");
  }
  if (b.action === "question" && !(b.question ?? "").trim()) return err(422, "A question needs its text.");
  let has = false;
  if (b.signature_png) {
    const [head, b64 = ""] = b.signature_png.split(",");
    if (!head.startsWith("data:image/png;base64")) return err(422, "signature_png must be a PNG data URL (data:image/png;base64,...).");
    const raw = Buffer.from(b64, "base64");
    if (raw.length > 200_000) return err(413, `The signature image is ${Math.round(raw.length / 1000)} KB; the limit is 200 KB.`);
    if (raw[0] !== 0x89 || raw.toString("latin1", 1, 4) !== "PNG") return err(422, "signature_png is not a PNG image.");
    has = true;
  }
  const t = new Date().toISOString(), status = ({ sign: "signed", decline: "declined", question: "question" } as const)[b.action];
  l.status = status; l.touched = Date.now();
  l.decision = { action: b.action, name: (b.name ?? "").trim() || null, decided_at: t, proposal_hash: b.proposal_hash, has_signature: has, ...(b.action === "question" ? { question: b.question!.trim().slice(0, 2000) } : {}) };
  const res: DecisionResponse & { matches_current: boolean } = { ok: true, status, decided_at: t, proposal_hash: b.proposal_hash, matches_current: b.proposal_hash === g.proposal_hash };
  return { status: 200, body: res };
}
