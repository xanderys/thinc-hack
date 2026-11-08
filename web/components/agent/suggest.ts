// Psychic suggestions, no model tokens: 1 to 3 chips from what the screen already holds.
import type { CopilotContext } from "./context";

export type Suggestion = { label: string; message?: string; event?: string };
type Blocker = { field: string; label?: string; answered_at?: string | null };
export type SuggestLead = { lead_id: string; customer_name: string; status_label?: string; blockers?: Blocker[]; whatsapp?: { state?: string } | null; next_question?: { field?: string } | null; pinned?: boolean; phone?: string | null };
export type SuggestRow = { lead_id: string; status_label?: string; whatsapp_state?: string };

const and = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

export function suggest(context: CopilotContext, lead?: SuggestLead | null, board?: SuggestRow[] | null): Suggestion[] {
  const out: Suggestion[] = [];
  if (context.leadId && lead) {
    const name = lead.customer_name.trim();   // the full name, as a planner says it
    // Declined: nothing to send or ask, only why, or reopening it.
    if (/declin/i.test(lead.status_label ?? "")) return [
      { label: "Why declined", message: `Why did ${name} decline, and what would change it?` },
      { label: "Reopen", message: `Reopen ${name}: what would a new offer need?` },
    ];
    const open = (lead.blockers ?? []).filter((b) => !b.answered_at).slice(0, 2).map((b) => (b.label ?? b.field).toLowerCase());
    const busy = lead.whatsapp?.state === "open";
    const wantsSend = lead.status_label === "Ready" || (lead.status_label === "Complete" && !open.length);
    if (!lead.phone) {
      // Nothing can reach this lead yet: one chip for the number instead of any send or ask.
      if ((open.length && !busy) || wantsSend) out.push({ label: "Add a phone number", message: `Add a phone number for ${name}` });
    } else {
      if (open.length && !busy) { const t = `Ask ${name} about ${and(open)} on WhatsApp`; out.push({ label: t, message: t }); }
      if (wantsSend) out.push({ label: "Send the proposal", message: `Send the proposal to ${name}` });
    }
    if (!open.length && lead.status_label === "Draft" && !lead.next_question) out.push({ label: "Mark it Complete", message: `Mark ${name} Complete` });
    out.push({ label: `I'm visiting ${name}`, message: `I'm visiting ${name} now, remind me of key questions and site checks` });
  } else if (board) {
    const need = board.filter((r) => r.status_label === "Draft" || r.status_label === "Question" || r.status_label === "Ready").length;
    if (need) out.push({ label: `${need} lead${need === 1 ? "" : "s"} need${need === 1 ? "s" : ""} you`, message: "Which leads need me, and what should I do first?" });
    out.push({ label: "Run autopilot", event: "marquee:run-autopilot" });
    out.push({ label: "Upsell potential", message: "Who has the most upsell potential?" });
  }
  return out.slice(0, 3);
}
