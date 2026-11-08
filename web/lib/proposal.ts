// v2.5 client helpers: the planner releases a proposal, the homeowner signs, declines or asks.
import { send } from "./client";
import type { ApproveResponse, DecisionBody, DecisionResponse, Design, Lead, Variant } from "./api";

const leadPath = (id: string) => `/api/leads/${encodeURIComponent(id)}`;

/** PUT /api/leads/{id}/approve through the proxy, which adds the intake secret server side. base_version: the lead
 * version the card was showing; the engine answers 409 when the lead changed since. */
export function approveLead(id: string, variant?: Variant["key"], base?: number | string | null) {
  return send<ApproveResponse>(`${leadPath(id)}/approve`, { ...(variant ? { variant } : {}), ...(base != null ? { base_version: base } : {}) }, "approve", "PUT");
}

/** POST /api/leads/{id}/decision. Open route, no secret. Errors carry the engine's own words. */
export function decide(id: string, body: DecisionBody, base?: number | null) {
  return send<DecisionResponse>(`${leadPath(id)}/decision`, { ...body, ...(base != null ? { base_version: base } : {}) }, body.action === "sign" ? "sign" : `decision-${body.action}`);
}

/** Statuses after the planner released the proposal. */
export const RELEASED = new Set(["approved", "signed", "declined", "question"]);

/** What the homeowner is offered, as the engine rebuilds it (engine proposal_of): the approved variant of the lead's
 * draft, else the draft itself. */
export function proposalOf(l: Pick<Lead, "draft" | "approved_variant">, key?: string | null) {
  const k = key ?? l.approved_variant ?? "expert";
  const v = (l.draft?.variants ?? []).find((x) => x.key === k);
  return { key: k, design: v?.design ?? l.draft?.design, capex: v?.economics.capex_eur ?? l.draft?.economics.capex_eur ?? 0 };
}

const SIZES = ["pv_kwp", "battery_kwh", "wallbox_kw", "heatpump_kw", "inverter_kw"] as const;
/** Same components and the same price to the euro. */
export function matches(o: { design?: Design | null; capex: number }, screen: { design: Design; capex: number }) {
  return !!o.design && SIZES.every((k) => (o.design![k] ?? null) === (screen.design[k] ?? null)) && Math.round(o.capex) === Math.round(screen.capex);
}

/** The lead's offer that equals the design on screen: the planner's marked offer first, then the planners' pick, then
 * any other; null when none does (a hand edit the lead does not hold). */
export function offerKey(l: Lead, screen: { design: Design; capex: number }, want: string | null): Variant["key"] | null {
  const keys = [want, "expert", "upfront", "payback", "independence", "value"].filter((k): k is string => !!k);
  for (const k of keys) {
    const o = proposalOf(l, k);
    if ((k === "expert" || (l.draft?.variants ?? []).some((x) => x.key === k)) && matches(o, screen)) return k as Variant["key"];
  }
  return null;
}
