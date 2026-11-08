import type { Lead } from "./api";

// v2.14: the facts a lead's WhatsApp replies stated, from the lead's sources map and its history.
export function whatsappFields(l: Pick<Lead, "sources" | "history"> | null | undefined): string[] {
  if (!l) return [];
  const out = new Set<string>();
  for (const [f, src] of Object.entries(l.sources ?? {})) if (src === "whatsapp") out.add(f);
  for (const h of l.history ?? []) if (h.source === "whatsapp" && h.field) out.add(h.field);
  return [...out];
}

// The same as read.origin tags, so a facts chip can mark "via WhatsApp".
export const whatsappOrigin = (l: Parameters<typeof whatsappFields>[0]) =>
  Object.fromEntries(whatsappFields(l).map((f) => [f, "whatsapp" as const])) as Record<string, "whatsapp">;

// Fired by the WhatsApp chip whenever the lead it polls moves on; the open card folds it in like a live call.
export const LEAD_LIVE = "marquee:lead-live";
