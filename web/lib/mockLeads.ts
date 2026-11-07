import "server-only";
// Stand-in for engine v1.9 leads until the engine serves them (LEADS_MOCK=1). A scripted call answers one question every 5 s.
import type { Design, HomeInputs, Lead, LeadChange, LeadCreated, LeadRow, NextQuestion, Priors } from "./api";
import { mockDesign } from "./mock";

const DEFAULTS: HomeInputs = { installer_id: "2a8ba8e2", annual_demand_kwh: 4500, load_profile: "H0", has_ev: false, has_wallbox: false, heating_type: "Unknown", has_solar: false, has_storage: false };
const SCRIPT: { field: keyof HomeInputs; value: unknown; question: string; why: string }[] = [
  { field: "annual_demand_kwh", value: 5000, question: "How much electricity does the house use a year?", why: "Sets the solar size most." },
  { field: "has_ev", value: true, question: "Is an electric car coming?", why: "A car adds about 2,700 kWh a year and a wallbox." },
  { field: "heating_type", value: "Gas", question: "How is the house heated?", why: "Decides whether a heat pump belongs in the offer." },
  { field: "num_inhabitants", value: 4, question: "How many people live there?", why: "Shapes the evening load the battery covers." },
];
const STEP_MS = 5000;
const leads = new Map<string, { created: number; name: string; place: string; facts: HomeInputs }>();
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
  const done = steps >= SCRIPT.length;
  return {
    lead_id: id, status: done ? "done" : "in_call", customer_name: l.name, address_or_postcode: l.place, facts, draft: mockDesign(facts),
    history, next_question: done ? null : nq(steps), questions_asked: steps,
    created_at: new Date(l.created).toISOString(), updated_at: new Date().toISOString(),
  };
}

export function mockListLeads(limit = 20): LeadRow[] {
  return [...leads.entries()].reverse().slice(0, limit).map(([id]) => {
    const l = mockGetLead(id)!;
    return { lead_id: id, status: l.status, title: `${l.customer_name}, ${l.address_or_postcode}`, customer_name: l.customer_name, address_or_postcode: l.address_or_postcode, created_at: l.created_at };
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
