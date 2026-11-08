import type { Lead } from "@/lib/api";

export type LeadLike = Pick<Lead, "lead_id" | "facts" | "address_or_postcode"> & { sources?: Record<string, string>; phone?: string | null; version?: number };
export type GapField = "annual_demand_kwh" | "heating_type" | "has_ev" | "num_inhabitants" | "address";
export const GAP_LABEL: Record<GapField, string> = { annual_demand_kwh: "yearly use", heating_type: "heating type", has_ev: "electric car", num_inhabitants: "people", address: "address" };
const ORDER: GapField[] = ["address", "annual_demand_kwh", "heating_type", "has_ev", "num_inhabitants"];
const isPc = (x?: string | null) => !x || /^\s*\d{5}\s*$/.test(x);

/** Facts the design needs that the lead lacks or only estimates, from the lead's sources map. */
export function gapsOf(l: LeadLike, address?: string): GapField[] {
  const f = l.facts as unknown as Record<string, unknown>, s = l.sources ?? {};
  return ORDER.filter((k) => {
    if (k === "address") return isPc(address ?? l.address_or_postcode) && !f.address;
    if (s[k] === "stated" || s[k] === "whatsapp") return false;
    if (s[k] === "estimated") return true;
    const v = f[k];
    return v == null || v === "" || v === "Unknown";
  });
}
