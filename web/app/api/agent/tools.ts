import "server-only";
import { NextRequest } from "next/server";
import type Anthropic from "@anthropic-ai/sdk";
import { callEngine } from "@/lib/engine";
import { qualify, VERDICT_WORD } from "@/lib/qualify";
import type { DesignResponse, Lead, RoofResult } from "@/lib/api";
import { POST as interpret } from "@/app/api/interpret/route";

// Tools for the board agent. Reads run at once; every write comes back as a proposal the planner applies.
type Ov = Record<string, number | null | "include" | string | string[]>;
type L = Lead & { version: number; pinned?: boolean; test?: boolean; overrides?: Ov; phone?: string | null; status_label?: string; approved?: { design?: DesignResponse["design"]; economics?: DesignResponse["economics"] } | null; whatsapp?: { state?: string } };
export type Op = { lead_id: string; name: string; action: "kit" | "complete" | "send" | "ask" | "facts"; overrides?: Ov; channel?: "whatsapp" | "copy"; facts?: string[]; values?: Record<string, unknown> };
export type Row = { lead_id: string; name: string; what: string; price_from: number | null; price_to: number | null; autarky_from: number | null; autarky_to: number | null; verdict_from: string; verdict_to: string; kwp_from?: number | null; kwp_to?: number | null; kwh_from?: number | null; kwh_to?: number | null; payback_from?: number | null; payback_to?: number | null; facts?: { label: string; from: unknown; to: unknown }[] };
export type Proposal = { title: string; ops: Op[]; rows: Row[]; refused: string[]; unchanged: string[] };
export type Emit = (e: Record<string, unknown>) => void;

const S = () => new URLSearchParams();
const H = (extra?: Record<string, string>) => ({ "X-Client-Route": "agent", ...(extra ?? {}) });
const SECRET = () => ({ "X-Intake-Secret": process.env.INTAKE_SECRET ?? "" });
const err = (b: unknown) => (b && typeof b === "object" && "error" in b ? String((b as { error: unknown }).error) : JSON.stringify(b)).slice(0, 300);

async function lead(id: string): Promise<L> {
  const r = await callEngine("GET", `/api/leads/${encodeURIComponent(id)}`, S(), undefined, H());
  if (r.status !== 200) throw new Error(`Engine said: ${err(r.body)}`);
  return r.body as L;
}
const standing = (l: L): DesignResponse => (l.approved?.design ? { ...l.draft, design: l.approved.design, economics: l.approved.economics ?? l.draft.economics } : l.draft) as DesignResponse;

// One refine per question, kept while the lead's version holds.
const memo = new Map<string, Promise<DesignResponse | null>>();
function refine(l: L, ov: Ov, facts?: Record<string, unknown>): Promise<DesignResponse | null> {
  const key = `${l.lead_id}:${l.version}:${JSON.stringify(Object.entries(ov).sort())}:${JSON.stringify(facts ?? {})}`;
  let p = memo.get(key);
  if (!p) {
    p = callEngine("POST", "/api/refine", S(), { inputs: { ...l.facts, ...(facts ?? {}) }, overrides: ov }, H()).then((r) => (r.status === 200 ? (r.body as DesignResponse) : null));
    memo.set(key, p); p.then((x) => { if (!x) memo.delete(key); });
    if (memo.size > 400) memo.delete(memo.keys().next().value!);
  }
  return p;
}
const shown = async (l: L) => (l.overrides && Object.keys(l.overrides).length && !l.approved?.design ? (await refine(l, l.overrides)) ?? standing(l) : standing(l));

const roofs = new Map<string, Promise<RoofResult | null>>();
function roof(l: L): Promise<RoofResult | null> {
  const a = (l.facts as { address?: string }).address || l.address_or_postcode;
  if (!a || /^\s*\d{5}\s*$/.test(a)) return Promise.resolve(null);
  let p = roofs.get(a);
  if (!p) { p = callEngine("GET", "/api/roof", new URLSearchParams({ address: a }), undefined, H()).then((r) => (r.status === 200 ? (r.body as RoofResult) : null)); roofs.set(a, p); p.then((x) => { if (!x) roofs.delete(a); }); }
  return p;
}
const verdict = async (l: L, d: DesignResponse | null) => VERDICT_WORD[qualify(l, d, await roof(l)).verdict];

function summary(l: L, d: DesignResponse, v: string) {
  const e = d.economics;
  return {
    lead_id: l.lead_id, name: l.customer_name, address: l.address_or_postcode, status: l.status_label ?? l.status, verdict: v, pinned: !!l.pinned, test: !!l.test, version: l.version,
    design: d.design, price_eur: e?.capex_eur ?? null, autarky: e?.autarky_share ?? null, break_even_year: e?.break_even_year ?? null, saving_eur_year: e?.annual_saving_eur ?? null,
    overrides: l.overrides ?? {}, has_phone: !!l.phone, whatsapp: l.whatsapp?.state ?? "none",
    facts: Object.fromEntries(Object.entries(l.facts ?? {}).filter(([, x]) => x != null)),
  };
}

async function listRows(includeTest: boolean) {
  const r = await callEngine("GET", "/api/leads", new URLSearchParams(includeTest ? { limit: "30", include_test: "1" } : { limit: "40" }), undefined, H());
  if (r.status !== 200) throw new Error(`Engine said: ${err(r.body)}`);
  return r.body as { lead_id: string; customer_name: string; status_label: string; pinned?: boolean; test?: boolean; title: string }[];
}

// Upsell: what adding the part does to each lead's price and autarky, ranked.
async function upsell(part: "battery" | "heatpump", ids: string[] | undefined, includeTest: boolean) {
  const list = ids?.length ? ids : (await listRows(includeTest)).map((r) => r.lead_id);
  const key = part === "battery" ? "battery_kwh" : "heatpump_kw";
  const out = await Promise.all(list.slice(0, 30).map(async (id) => {
    try {
      const l = await lead(id); const base = await shown(l);
      if (base.design?.[key as "battery_kwh"]) return { lead_id: id, name: l.customer_name, has_it: true };
      const w = await refine(l, { ...(l.overrides ?? {}), [key]: "include" });
      if (!w) return { lead_id: id, name: l.customer_name, error: "refine failed" };
      const be = base.economics, we = w.economics;
      return { lead_id: id, name: l.customer_name, pinned: !!l.pinned, size: w.design?.[key as "battery_kwh"] ?? null,
        price_delta_eur: we && be ? Math.round(we.capex_eur - be.capex_eur) : null,
        autarky_from: be?.autarky_share ?? null, autarky_to: we?.autarky_share ?? null,
        autarky_delta_pts: we && be ? Math.round((we.autarky_share - be.autarky_share) * 1000) / 10 : null,
        saving_delta_eur_year: we && be ? Math.round(we.annual_saving_eur - be.annual_saving_eur) : null };
    } catch (e) { return { lead_id: id, error: (e as Error).message }; }
  }));
  const sorted = out.filter((x) => (x as { saving_delta_eur_year?: number }).saving_delta_eur_year != null)
    .sort((a, b) => ((b as { saving_delta_eur_year: number }).saving_delta_eur_year) - ((a as { saving_delta_eur_year: number }).saving_delta_eur_year));
  return [...sorted.map((x, i) => { const d = (x as { autarky_delta_pts?: number | null }).autarky_delta_pts; return { rank: i + 1, ...x, autarky_gain: d != null && d > 0 ? `+${Math.round(d)} %` : null }; }), ...out.filter((x) => !sorted.includes(x))];
}

const lastName = (n: string) => n.trim().split(/\s+/).pop()!.toLowerCase();
// Named: the planner wrote the lead's surname or id, or has that lead's page open ("ctx:<id>" rides on said).
const named = (l: { lead_id: string; customer_name: string }, said: string) => { const s = said.toLowerCase(); return s.includes(l.lead_id) || s.includes(lastName(l.customer_name)); };

const PART: Record<string, [string, string]> = { pv_kwp: ["Solar", "kWp"], battery_kwh: ["Battery", "kWh"], heatpump_kw: ["Heat pump", "kW"], wallbox_kw: ["Wallbox", "kW"], inverter_kw: ["Inverter", "kW"] };
const part = (k: string, v: unknown) => { const [n, u] = PART[k] ?? [k, ""]; return v === null ? `No ${n.toLowerCase()}` : v === "include" ? `Add ${n.toLowerCase()}` : `${n} ${v} ${u}`.trim(); };

// Builds the table the planner sees before Apply: price, autarky and verdict before and after.
export async function propose(title: string, ops: Op[], said: string): Promise<Proposal> {
  const rows: Row[] = [], keep: Op[] = [], refused: string[] = [], unchanged: string[] = [];
  await Promise.all(ops.slice(0, 30).map(async (op) => {
    let l: L; try { l = await lead(op.lead_id); } catch (e) { refused.push(`${op.name || op.lead_id}: ${(e as Error).message}`); return; }
    if (l.pinned && !named(l, said)) { refused.push(`${l.customer_name} is a pinned demo lead; name them to include them.`); return; }
    if (l.pinned && (op.action === "send" || op.action === "ask")) { refused.push(`${l.customer_name} is a pinned demo lead: no real messages.`); return; }
    const before = await shown(l);
    let after: DesignResponse | null = before, what = "";
    if (op.action === "kit") { const ov = { ...(l.overrides ?? {}), ...(op.overrides ?? {}) }; after = await refine(l, ov); what = Object.entries(op.overrides ?? {}).map(([k, v]) => part(k, v)).join(", "); }
    else if (op.action === "facts") { after = await refine(l, l.overrides ?? {}, op.values); what = Object.entries(op.values ?? {}).map(([k, v]) => `${k === "phone" ? "Phone" : FACT[k] ?? k}: ${v}`).join(", "); }
    else what = op.action === "complete" ? "Complete" : op.action === "send" ? `Send by ${op.channel ?? "whatsapp"}` : "Ask on WhatsApp";
    // A change that changes nothing offers no Apply.
    const F = l.facts as unknown as Record<string, unknown>;
    const same = op.action === "facts" ? Object.entries(op.values ?? {}).every(([k, v]) => (k === "phone" ? l.phone === v : F[k] === v))
      : op.action === "kit" && !!after && JSON.stringify(before.design) === JSON.stringify(after.design) && before.economics?.capex_eur === after.economics?.capex_eur;
    if (same) {
      unchanged.push(`${l.customer_name} already has this: ${what.charAt(0).toLowerCase()}${what.slice(1)}, nothing to apply.`); return;
    }
    const [vf, vt] = await Promise.all([verdict(l, before), verdict(l, after)]);
    rows.push({ lead_id: l.lead_id, name: l.customer_name, what, price_from: before.economics?.capex_eur ?? null, price_to: after?.economics?.capex_eur ?? null,
      autarky_from: before.economics?.autarky_share ?? null, autarky_to: after?.economics?.autarky_share ?? null, verdict_from: vf, verdict_to: after ? vt : "No design",
      kwp_from: before.design?.pv_kwp ?? null, kwp_to: after?.design?.pv_kwp ?? null, kwh_from: before.design?.battery_kwh ?? null, kwh_to: after?.design?.battery_kwh ?? null,
      payback_from: before.economics?.break_even_year ?? null, payback_to: after?.economics?.break_even_year ?? null,
      ...(op.action === "facts" ? { facts: Object.entries(op.values ?? {}).filter(([k, v]) => (k === "phone" ? l.phone !== v : F[k] !== v)).map(([k, v]) => ({ label: k === "phone" ? "Phone" : FACT[k] ?? k, from: k === "phone" ? l.phone ?? null : F[k] ?? null, to: v })) } : {}) });
    keep.push({ ...op, name: l.customer_name });
  }));
  return { title, ops: keep, rows, refused, unchanged };
}

// Runs an applied batch, one lead at a time, and returns what each override write replaced (for Undo).
export async function apply(ops: Op[], emit: Emit, said: string, undo = false) {
  const prev: Op[] = [];
  for (const op of ops) {
    try {
      const l = await lead(op.lead_id);
      if (l.pinned && !undo && !named(l, said)) throw new Error("pinned demo lead not named by the planner");
      if (l.pinned && (op.action === "send" || op.action === "ask")) throw new Error("pinned demo lead: no real messages");
      if (op.action === "kit") {
        const ov = undo ? (op.overrides ?? {}) : { ...(l.overrides ?? {}), ...(op.overrides ?? {}) };
        const r = await callEngine("POST", "/api/intake/step", S(), { lead_id: l.lead_id, overrides: ov, base_version: l.version }, H());
        if (r.status !== 200) throw new Error(`Engine said: ${err(r.body)}`);
        prev.push({ lead_id: l.lead_id, name: l.customer_name, action: "kit", overrides: l.overrides ?? {} });
      } else if (op.action === "facts") {
        const vals = op.values ?? {};
        // A phone travels as the step's own field; the rest are facts.
        const { phone, ...rest } = vals as Record<string, unknown> & { phone?: string };
        const r = await callEngine("POST", "/api/intake/step", S(), { lead_id: l.lead_id, ...(Object.keys(rest).length ? { facts_so_far: rest } : {}), ...(phone !== undefined ? { phone } : {}), source: "planner", base_version: l.version }, H());
        if (r.status !== 200) throw new Error(`Engine said: ${err(r.body)}`);
        const F = l.facts as unknown as Record<string, unknown>;
        prev.push({ lead_id: l.lead_id, name: l.customer_name, action: "facts", values: Object.fromEntries(Object.keys(vals).map((k) => [k, k === "phone" ? (l.phone ?? null) : F[k] ?? null])) });
      } else if (op.action === "complete") {
        const d = await shown(l);
        const r = await callEngine("PUT", `/api/leads/${l.lead_id}/approve`, S(), { variant: "edit", design: d.design, overrides: l.overrides ?? {}, base_version: l.version }, H());
        if (r.status !== 200) throw new Error(`Engine said: ${err(r.body)}`);
      } else if (op.action === "send") {
        const r = await callEngine("POST", `/api/leads/${l.lead_id}/send`, S(), { channel: op.channel ?? "whatsapp", base_version: l.version }, H());
        if (r.status !== 200) throw new Error(`Engine said: ${err(r.body)}`);
      } else if (op.action === "ask") {
        const r = await callEngine("POST", `/api/leads/${l.lead_id}/whatsapp/ask`, S(), { ...(op.facts?.length ? { facts: op.facts } : {}), base_version: l.version }, H(SECRET()));
        if (r.status !== 200) throw new Error(`Engine said: ${err(r.body)}`);
      }
      const what = op.action === "kit" ? Object.entries(op.overrides ?? {}).map(([k, v]) => { const [n, u] = PART[k] ?? [k, ""]; return v === null ? `${n} removed` : v === "include" ? `${n} added` : `${n} fixed at ${v} ${u}`.trim(); }).join(", ")
        : op.action === "facts" ? `Facts updated: ${Object.keys(op.values ?? {}).map((k) => FACT[k] ?? k).join(", ")}` : op.action === "complete" ? "Complete" : op.action === "send" ? "Proposal sent" : "Asked on WhatsApp";
      emit({ t: "result", lead_id: l.lead_id, name: l.customer_name, ok: true, what: undo ? "Undone" : what });
    } catch (e) { emit({ t: "result", lead_id: op.lead_id, name: op.name, ok: false, msg: (e as Error).message }); }
  }
  return prev;
}

async function createLead(text: string, test: boolean) {
  const r = await interpret(new NextRequest("http://agent.local/api/interpret", { method: "POST", body: JSON.stringify({ mode: "composer", text }), headers: { "content-type": "application/json" } }));
  const f = await r.json() as Record<string, unknown>;
  if (!r.ok) throw new Error(`Reader said: ${err(f)}`);
  const pc = f.postcode as string | undefined, addr = f.address as string | undefined;
  // The postcode goes inside the address ("Street N, 80331 München") so the engine stores it.
  const place = addr && pc && !/\b\d{5}\b/.test(addr) ? (addr.includes(",") ? addr.replace(/,\s*/, `, ${pc} `) : `${addr}, ${pc}`) : (addr ?? pc);
  if (!place) return { needs: "address", facts: f };
  if (addr) f.address = place;
  const name = (f.name as string | undefined)?.trim() || place;
  const made = await callEngine("POST", "/api/leads", S(), { customer_name: name, address_or_postcode: place, installer_id: "2a8ba8e2", source: "form", ...(test || /^test\b/i.test(name) ? { test: true } : {}), ...(f.phone ? { phone: f.phone } : {}) }, H());
  if (made.status !== 200) throw new Error(`Engine said: ${err(made.body)}`);
  const id = (made.body as { lead_id: string }).lead_id;
  const facts: Record<string, unknown> = { customer_name: name };
  for (const k of ["address", "postcode", "num_inhabitants", "heating_type", "heating_stated", "has_ev", "ev_planned", "annual_demand_kwh"]) if (f[k] !== undefined) facts[k] = f[k];
  // The composer's sources: a long text or a mail header is an email, else the planner's note; an older engine takes form or planner.
  const src = text.length > 200 || /\b(From:|Betreff|Subject)/i.test(text) ? "email" : "planner";
  let step = await callEngine("POST", "/api/intake/step", S(), { lead_id: id, facts_so_far: facts, source: src }, H());
  if (step.status === 422 && src === "email") step = await callEngine("POST", "/api/intake/step", S(), { lead_id: id, facts_so_far: facts, source: "form" }, H());
  if (step.status !== 200) throw new Error(`Engine said: ${err(step.body)}`);
  const l = await lead(id), d = await shown(l);
  return summary(l, d, await verdict(l, d));
}

// Before a site visit: the facts still open that move the design (ranked, with the figure at stake when the engine
// gives one), and the checks only a visit confirms, for the systems in this design. Reads only.
const FACT: Record<string, string> = {
  annual_demand_kwh: "Yearly electricity use", heating_type: "What heats the house", heating_demand_kwh: "Heating use a year", heating_cost_per_year_eur: "Heating bill a year",
  boiler_age_years: "Boiler age", has_ev: "Electric car now or planned", ev_annual_km: "Kilometres a year by car", num_inhabitants: "People in the household",
  has_solar: "Existing solar", existing_solar_kwp: "Size of the existing solar", has_storage: "Existing battery", preference: "What matters most: price, payback or independence",
  house_size_sqm: "Living area", house_built_year: "Year built",
};
type Blocker = { field: string; label?: string; state?: string; moves?: string | string[]; delta_eur?: number | null; delta_text?: string | null };
async function siteVisit(id: string) {
  type LB = L & { blockers?: Blocker[]; sources?: Record<string, string>; next_question?: { field?: string; question?: string; expected_swing?: string } | null };
  let l = await lead(id) as LB;
  // Blockers are computed in the background: an empty list gets one more read after a second.
  if (Array.isArray(l.blockers) && !l.blockers.length) { await new Promise((r) => setTimeout(r, 1000)); l = await lead(id) as LB; }
  const d = (await shown(l)).design;
  let questions: { fact: string; state: string; at_stake: string | null }[];
  if (Array.isArray(l.blockers) && l.blockers.length) {
    questions = [...l.blockers].sort((a, b) => Math.abs(b.delta_eur ?? 0) - Math.abs(a.delta_eur ?? 0))
      .map((b) => ({ fact: b.label ?? FACT[b.field] ?? b.field, state: b.state ?? "estimated", at_stake: b.delta_text ?? (b.delta_eur != null ? `€${Math.round(Math.abs(b.delta_eur)).toLocaleString("en-GB")}` : null) }));
  } else {
    const src = l.sources ?? {}, first = l.next_question?.field, F = l.facts as unknown as Record<string, unknown>, ht = F.heating_type as string | undefined;
    const open = Object.keys(FACT).filter((k) => src[k] === "estimated" || src[k] === "missing" || (src[k] == null && F[k] == null));
    // Heating facts matter when a heat pump is drafted or a fossil boiler could be replaced; the car's kilometres only with a wallbox.
    const moving = open.filter((k) => {
      if (k === "existing_solar_kwp" || k === "existing_storage_kwh") return false;
      if (k === "ev_annual_km") return !!d.wallbox_kw;
      if (/heating_demand|heating_cost|boiler/.test(k)) return !!d.heatpump_kw || !ht || ht === "Gas" || ht === "Oil";
      return true;
    });
    moving.sort((a, b) => (a === first ? -1 : b === first ? 1 : Object.keys(FACT).indexOf(a) - Object.keys(FACT).indexOf(b)));
    questions = moving.slice(0, 5).map((k) => ({ fact: FACT[k], state: src[k] === "missing" || src[k] == null ? "missing" : "estimated", at_stake: k === first ? (l.next_question?.expected_swing ?? null) : null }));
  }
  const checks = [
    "Meter cabinet and grid connection: space for the new meter and the feed-in",
    "Roof covering, age and condition, rafters and structural load",
    ...(d.battery_kwh ? ["Inverter and battery location, and the cable run to the meter"] : ["Inverter location, and the cable run to the meter"]),
    ...(d.heatpump_kw ? ["Heat pump outdoor unit position and noise distance to the neighbour", "Existing radiators and flow temperature"] : []),
    ...(d.wallbox_kw ? ["Wallbox location and its cable run"] : []),
    "Scaffold and access",
  ];
  return { lead_id: l.lead_id, name: l.customer_name, address: l.address_or_postcode, design: d, questions, site_checks: checks, source: Array.isArray(l.blockers) && l.blockers.length ? "engine blockers" : "lead sources" };
}

// WhatsApp ask: the exact message the engine will send (its own template), for the facts that are really open.
const ASK: Record<string, string> = {
  annual_demand_kwh: "roughly how many kWh of electricity do you use a year (it is on your yearly bill)",
  heating_type: "is the house heated with gas, oil or something else",
  has_ev: "do you drive an electric car, or plan to buy one",
  heating_demand_kwh: "roughly how much gas or oil does the heating use a year",
  has_solar: "are there already solar panels on the roof",
  num_inhabitants: "how many people live in the house",
  boiler_age_years: "roughly how old is the boiler",
};
const NOT_A_NAME = new Set(["test", "smoke", "offer", "lane", "scene", "team", "red", "demo", "check", "kit", "layout", "rebase", "accept", "motion", "approved", "audit", "p0", "slow", "undo", "north", "postcode", "lead", "new", "unknown"]);
function firstName(n: string) {
  const w = (n ?? "").split(/\s+/).map((x) => x.replace(/[.,]/g, "")).filter(Boolean);
  if (!w.length || w.some((x) => NOT_A_NAME.has(x.toLowerCase())) || !/^\p{L}+$/u.test(w[0]) || w[0].length < 2) return "there";
  return w[0][0].toUpperCase() + w[0].slice(1);
}
function composeAsk(l: L & { meta?: { installer_name?: string } }, fields: string[]) {
  const qs = fields.slice(0, 2).map((f) => ASK[f] ?? f);
  return `Hi ${firstName(l.customer_name)}, Rina here from ${(l.meta?.installer_name ?? "Isarwerk Solar").trim()}. ${qs.length === 2 ? "Two quick things" : "One quick thing"} so I can finish your design: ${qs.length === 2 ? `${qs[0]}, and ${qs[1]}` : qs[0]}?`;
}
async function draftAsk(id: string, wanted: string[], said: string, emit: Emit) {
  const l = await lead(id) as L & { sources?: Record<string, string>; blockers?: { field: string; answered_at?: string | null }[]; meta?: { installer_name?: string } };
  if (l.pinned && !named(l, said)) return { error: `${l.customer_name} is a pinned demo lead; name them to message them.` };
  if (l.pinned) return { error: `${l.customer_name} is a pinned demo lead: no real messages.` };
  if (/declin/i.test(l.status_label ?? l.status)) return { error: `${l.customer_name} declined; no ask.` };
  if (!l.phone) return { error: `${l.customer_name} has no phone number: propose it with propose_facts first.` };
  if (l.whatsapp?.state === "open") return { error: `A WhatsApp conversation with ${l.customer_name} is already open.` };
  const src = l.sources ?? {}, F = l.facts as unknown as Record<string, unknown>;
  const known = (k: string) => src[k] === "stated" || src[k] === "whatsapp";
  const skipped = wanted.filter((k) => known(k)).map((k) => ({ field: k, value: F[k] }));
  const asking = wanted.filter((k) => !known(k) && k in ASK);
  // A smarter ask: fill the second slot with the open fact that moves the design most.
  const open = [...(l.blockers ?? []).filter((b) => !b.answered_at).map((b) => b.field), ...Object.keys(ASK).filter((k) => src[k] === "estimated" || src[k] === "missing")]
    .filter((k, i, a) => k in ASK && !known(k) && a.indexOf(k) === i);
  const added: string[] = [];
  for (const k of open) { if (asking.length >= 2) break; if (!asking.includes(k)) { asking.push(k); added.push(k); } }
  if (!asking.length) return { asking: [], skipped, note: "Everything asked is already stated; nothing to send." };
  const text = composeAsk(l, asking);
  emit({ t: "message", lead_id: l.lead_id, name: l.customer_name, facts: asking, text });
  return { card_shown: true, asking, added, skipped, text, note: "The planner sees the message card with Send on WhatsApp. One short line at most: say what you added or skipped and why." };
}

const obj = (props: Record<string, unknown>, required: string[] = []) => ({ type: "object" as const, properties: props, required, additionalProperties: false });
const ids = { type: "array", items: { type: "string" } };
const OPS = { type: "array", items: obj({ lead_id: { type: "string" }, name: { type: "string" } }, ["lead_id", "name"]) };
const KIT = obj({ pv_kwp: { type: ["number", "null", "string"] }, battery_kwh: { type: ["number", "null", "string"] }, heatpump_kw: { type: ["number", "null", "string"] }, wallbox_kw: { type: ["number", "null", "string"] }, inverter_kw: { type: ["number", "null", "string"] } });

export const TOOLS: Anthropic.Tool[] = [
  { name: "list_leads", description: "The leads on the board, newest first: id, name, status, pinned. include_test adds scratch leads.", input_schema: obj({ include_test: { type: "boolean" } }) },
  { name: "get_lead", description: "One lead: facts, the design the planner sees (kit overrides applied), price, autarky, break-even year, verdict (Priority, Call first, Decline), status, version.", input_schema: obj({ id: { type: "string" } }, ["id"]) },
  { name: "design", description: "The lead's full design response: components with reasons, variants, economics.", input_schema: obj({ id: { type: "string" } }, ["id"]) },
  { name: "refine", description: "Read only: the design this lead would get with these kit overrides (number fixes the size, null removes the part, \"include\" lets the engine size it). Writes nothing.", input_schema: obj({ id: { type: "string" }, overrides: KIT }, ["id", "overrides"]) },
  { name: "upsell", description: "For every board lead (or the given ids) without the part: the yearly saving, price and autarky gain a battery or heat pump adds, ranked by yearly saving. Use for upsell questions.", input_schema: obj({ part: { type: "string", enum: ["battery", "heatpump"] }, ids, include_test: { type: "boolean" } }, ["part"]) },
  { name: "propose_kit", description: "Propose kit changes on one or more leads. Nothing is written: the planner sees a table with price and verdict before and after and an Apply button.", input_schema: obj({ title: { type: "string" }, ops: { type: "array", items: obj({ lead_id: { type: "string" }, name: { type: "string" }, overrides: KIT }, ["lead_id", "name", "overrides"]) } }, ["title", "ops"]) },
  { name: "complete", description: "Propose marking leads Complete (the planner signs off the shown design). Shown with Apply, never run directly.", input_schema: obj({ ops: OPS }, ["ops"]) },
  { name: "send", description: "Propose sending the proposal to the homeowner. Shown with Apply, never run directly. Only Complete leads can be sent.", input_schema: obj({ ops: OPS, channel: { type: "string", enum: ["whatsapp", "copy"] } }, ["ops"]) },
  { name: "ask_whatsapp", description: "Draft a WhatsApp ask to one homeowner for the facts given. Facts already stated are skipped, and the open fact that moves the design most fills a free slot (two questions per message). The planner sees a message card with Send on WhatsApp; nothing is sent by you.", input_schema: obj({ lead_id: { type: "string" }, facts: { type: "array", items: { type: "string", enum: Object.keys(ASK) } } }, ["lead_id", "facts"]) },
  { name: "create_lead", description: "Create a lead from a scrap, an email or a voice transcript, exactly as the planner gave it. Returns the new lead with its design and verdict.", input_schema: obj({ text: { type: "string" } }, ["text"]) },
  { name: "site_visit", description: "Before a site visit: the open facts that move the design, ranked with the figure at stake, and the on-site checks for the systems in this design. Reads only.", input_schema: obj({ lead_id: { type: "string" } }, ["lead_id"]) },
  { name: "propose_facts", description: "Propose changing facts the client gave (annual_demand_kwh, num_inhabitants, heating_type Gas|Oil|Heatpump|OtherNonRenewable|OtherRenewable, heating_demand_kwh, has_ev (true for a car now OR planned soon; it adds the wallbox at once, 12,000 km a year assumed unless given; never ask for mileage first), ev_planned, ev_annual_km, house_size_sqm, house_built_year, has_solar, preference) or the homeowner's phone (phone, E.164 such as +49 151 2345678; ask the planner for the number when none is given). Shown with before and after figures and Apply; Apply runs the intake step.", input_schema: obj({ lead_id: { type: "string" }, name: { type: "string" }, facts: { type: "object" } }, ["lead_id", "name", "facts"]) },
  { name: "whatsapp_draft", description: "The WhatsApp message Rina would send to ask this homeowner for missing facts, as a draft. Sends nothing; to send, call ask_whatsapp.", input_schema: obj({ lead_id: { type: "string" } }, ["lead_id"]) },
  { name: "stats", description: "How close the engine comes to the expert designs on unseen projects: the eval scoreboard.", input_schema: obj({}) },
];

export async function runTool(name: string, input: Record<string, unknown>, said: string, emit: Emit, test = false): Promise<unknown> {
  const id = String(input.id ?? "");
  switch (name) {
    case "list_leads": return listRows(!!input.include_test);
    case "get_lead": { const l = await lead(id); const d = await shown(l); return summary(l, d, await verdict(l, d)); }
    case "design": { const l = await lead(id); const d = await shown(l); return { design: d.design, economics: d.economics, explanation: d.explanation, components: d.components, variants: (d.variants ?? []).map((v) => ({ key: v.key, design: v.design, economics: v.economics })) }; }
    case "refine": { const l = await lead(id); const d = await refine(l, { ...(l.overrides ?? {}), ...(input.overrides as Ov) }); return d ? { design: d.design, economics: d.economics } : { error: "The engine refused these overrides." }; }
    case "upsell": return upsell(input.part as "battery" | "heatpump", input.ids as string[] | undefined, !!input.include_test);
    case "create_lead": { const r = await createLead(String(input.text ?? ""), test); if ("lead_id" in r) emit({ t: "created", lead_id: r.lead_id }); return r; }
    case "propose_facts": {
      const values = { ...((input.facts ?? {}) as Record<string, unknown>) };
      // An electric car now or soon sizes the wallbox and extra PV straight away: the engine needs has_ev, and assumes 12,000 km a year unless told.
      if (values.ev_planned === true || values.has_ev === true) { values.has_ev = true; values.ev_planned = true; if (values.ev_annual_km == null) values.ev_annual_km = 12000; }
      const p = await propose("Change facts", [{ lead_id: String(input.lead_id), name: String(input.name ?? ""), action: "facts", values }], said);
      if (p.ops.length || p.unchanged.length) emit({ t: "propose", ...p });
      return { shown_to_planner: p.ops.length, refused: p.refused, rows: p.rows, note: "The planner sees before and after with Apply. One short line at most." };
    }
    case "whatsapp_draft": {
      const r = await callEngine("GET", `/api/leads/${encodeURIComponent(String(input.lead_id))}/whatsapp/preview`, new URLSearchParams({ kind: "ask", origin: "https://marquee-home.vercel.app" }), undefined, H(SECRET()));
      return r.status === 200 ? r.body : { error: `Engine said: ${err(r.body)}` };
    }
    case "site_visit": return siteVisit(String(input.lead_id ?? ""));
    case "stats": { const r = await callEngine("GET", "/api/eval", S(), undefined, H()); const b = r.body as Record<string, unknown>; return Object.fromEntries(Object.entries(b ?? {}).filter(([k]) => !/per_project|rows|projects/.test(k)).map(([k, v]) => [k, v])); }
    case "ask_whatsapp": return draftAsk(String(input.lead_id ?? ""), (input.facts as string[]) ?? [], said, emit);
    case "propose_kit": case "complete": case "send": {
      const action = name === "propose_kit" ? "kit" : name;
      const ops = ((input.ops as Op[]) ?? []).map((o) => ({ ...o, action, channel: input.channel as Op["channel"], facts: input.facts as string[] | undefined })) as Op[];
      const title = String(input.title ?? (action === "complete" ? "Complete" : action === "send" ? "Send the proposal" : "Kit change"));
      const p = await propose(title, ops, said);
      if (p.ops.length || p.unchanged.length) emit({ t: "propose", ...p });
      return { shown_to_planner: p.ops.length, refused: p.refused, rows: p.rows, note: "The planner sees this table with Apply. Do not repeat the table; one short line at most." };
    }
  }
  return { error: `No tool ${name}` };
}
