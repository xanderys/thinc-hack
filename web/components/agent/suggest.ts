// Psychic suggestions, no model tokens: 1 to 3 chips from what the screen already holds.
import type { CopilotContext } from "./context";

export type Suggestion = { label: string; message?: string; event?: string };
type Blocker = { field: string; label?: string; answered_at?: string | null };
export type SuggestLead = { lead_id: string; customer_name: string; status_label?: string; blockers?: Blocker[]; whatsapp?: { state?: string } | null; next_question?: { field?: string } | null; pinned?: boolean };
export type SuggestRow = { lead_id: string; status_label?: string; whatsapp_state?: string };

const first = (n: string) => n.trim().split(/\s+/)[0];
const and = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

export function suggest(context: CopilotContext, lead?: SuggestLead | null, board?: SuggestRow[] | null): Suggestion[] {
  const out: Suggestion[] = [];
  if (context.leadId && lead) {
    const open = (lead.blockers ?? []).filter((b) => !b.answered_at).slice(0, 2).map((b) => (b.label ?? b.field).toLowerCase());
    const busy = lead.whatsapp?.state === "open";
    if (open.length && !busy) { const t = `Ask ${first(lead.customer_name)} about ${and(open)} on WhatsApp`; out.push({ label: t, message: t }); }
    if (lead.status_label === "Ready" || (lead.status_label === "Complete" && !open.length)) out.push({ label: "Send the proposal", message: `Send the proposal to ${lead.customer_name}` });
    if (!open.length && lead.status_label === "Draft" && !lead.next_question) out.push({ label: "Mark it Complete", message: `Mark ${lead.customer_name} Complete` });
    out.push({ label: `I'm visiting ${first(lead.customer_name)}`, message: `I'm visiting ${lead.customer_name} now, remind me of key questions and site checks` });
  } else if (board) {
    const need = board.filter((r) => r.status_label === "Draft" || r.status_label === "Question" || r.status_label === "Ready").length;
    if (need) out.push({ label: `${need} lead${need === 1 ? "" : "s"} need${need === 1 ? "s" : ""} you`, message: "Which leads need me, and what should I do first?" });
    out.push({ label: "Run autopilot", event: "marquee:run-autopilot" });
    out.push({ label: "Upsell potential", message: "Who has the most upsell potential?" });
  }
  return out.slice(0, 3);
}
