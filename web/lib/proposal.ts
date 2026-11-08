// v2.5 client helpers: the planner releases a proposal, the homeowner signs, declines or asks.
import { send } from "./client";
import type { ApproveResponse, DecisionBody, DecisionResponse, Design, Lead, Overrides, Variant } from "./api";

const leadPath = (id: string) => `/api/leads/${encodeURIComponent(id)}`;

/** PUT /api/leads/{id}/approve through the proxy, which adds the intake secret server side (v2.11). The body names what
 * was on screen: an offer by key and its design_hash, or "edit" with the design and overrides. base_version: the lead
 * version the card was showing; the engine answers 409 when the lead changed since or the selection differs. */
export function approveLead(id: string, sel: ApproveSelection, base?: number | string | null) {
  return send<ApproveResponse>(`${leadPath(id)}/approve`, { ...sel, ...(base != null ? { base_version: base } : {}) }, "approve", "PUT");
}
export type ApproveSelection =
  | { variant: Variant["key"]; design_hash: string }
  | { variant: "edit"; design: Design; overrides?: Overrides };

/** POST /api/leads/{id}/decision. Open route, no secret. Errors carry the engine's own words. */
export function decide(id: string, body: DecisionBody, base?: number | null) {
  return send<DecisionResponse>(`${leadPath(id)}/decision`, { ...body, ...(base != null ? { base_version: base } : {}) }, body.action === "sign" ? "sign" : `decision-${body.action}`);
}

/** Statuses after the planner released the proposal. */
export const RELEASED = new Set(["approved", "sent", "signed", "declined", "question"]);

const SIZES = ["pv_kwp", "battery_kwh", "wallbox_kw", "heatpump_kw", "inverter_kw"] as const;
/** Same components and the same price to the euro. */
export function matches(o: { design?: Design | null; capex: number }, screen: { design: Design; capex: number }) {
  return !!o.design && SIZES.every((k) => (o.design![k] ?? null) === (screen.design[k] ?? null)) && Math.round(o.capex) === Math.round(screen.capex);
}

/** The lead's own offer that equals the design on screen, with its design_hash: the planner's marked offer first, then
 * the planners' pick, then any other; null when none does (a hand edit, sent as "edit"). */
export function offerOf(l: Lead, screen: { design: Design; capex: number }, want: string | null): { key: Variant["key"]; hash: string } | null {
  const vs = l.draft?.variants ?? [];
  const order = [want, "expert", "upfront", "payback", "independence", "value"].filter((k): k is string => !!k);
  for (const k of order) {
    const v = vs.find((x) => x.key === k);
    if (v?.design_hash && matches({ design: v.design, capex: v.economics.capex_eur }, screen)) return { key: v.key, hash: v.design_hash };
  }
  return null;
}
