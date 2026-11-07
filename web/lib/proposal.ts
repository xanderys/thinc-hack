// v2.5 client helpers: the planner releases a proposal, the homeowner signs, declines or asks.
import { send } from "./client";
import type { ApproveResponse, DecisionBody, DecisionResponse, Variant } from "./api";

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
