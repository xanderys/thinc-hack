// v2.5 client helpers: the planner releases a proposal, the homeowner signs, declines or asks.
import { call, type Result } from "./client";
import type { ApproveResponse, DecisionBody, DecisionResponse, Variant } from "./api";

const leadPath = (id: string) => `/api/leads/${encodeURIComponent(id)}`;

/** PUT /api/leads/{id}/approve through the proxy, which adds the intake secret server side. */
export async function approveLead(id: string, variant?: Variant["key"]): Promise<Result<ApproveResponse>> {
  try {
    const res = await fetch(`${leadPath(id)}/approve`, {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(variant ? { variant } : {}),
    });
    const json = await res.json().catch(() => ({ error: `${res.status} ${res.statusText}` }));
    if (!res.ok) return { ok: false, error: json?.error || `${res.status} ${res.statusText}`.trim() };
    return { ok: true, data: json as ApproveResponse };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** POST /api/leads/{id}/decision. Open route, no secret. Errors carry the engine's own words. */
export function decide(id: string, body: DecisionBody): Promise<Result<DecisionResponse>> {
  return call<DecisionResponse>(`${leadPath(id)}/decision`, body);
}

/** Statuses after the planner released the proposal. */
export const RELEASED = new Set(["approved", "signed", "declined", "question"]);
