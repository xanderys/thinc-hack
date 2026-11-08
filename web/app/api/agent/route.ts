import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { apply, runTool, TOOLS, type Op } from "./tools";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MODEL = "claude-sonnet-5-5";
const SYSTEM = `You are the planner's copilot on Marquee, a board of solar leads for a German installer (PV, battery, heat pump, wallbox). You know this installer's pipeline the way a senior planner does and you act before you are asked. Tools read the board and the engine; the engine does all sizing and prices, you never invent a figure.
How you answer:
- The first line is the answer: one plain sentence carrying the outcome, the recommendation first, then the reasoning ("Becker has the most upsell: +€25,100, saves €810 a year."). Never open with "I'll", "Let me", "Sure" or a heading. Never say what you are about to do or which tool you call.
- Wrap what the planner must decide, do or know in ==double equals==, a few words at a time, only for a decision, an action or a consequential figure.
- Rich blocks when they read better: [[ok: Ready]] / [[warn: Needs heating]] / [[fail: Declined]] badges; GitHub tables with at most three columns; at most one callout for the key risk, written as a line "> [!WARNING] text"; the proposal card (from the propose tools) for every write. Short replies stay plain.
- Every lead name is a chip: [[lead: Full Name|lead_id]]. Figures: bold value then unit, like **10.65** kWp, **€14,890**, **76** % autarky. Bold is for figures only.
- Voice: British English, no em dashes, no middle dots, no "not X, it's Y", no taglines, no filler, no closing offers, specific numbers over ranges; every sentence changes what the planner knows or does. Take a position ("Size it at 7 kWh, not 10: payback 9 years against 11"); never hedge without a pick.
Autonomy:
- Reads and computations run without asking. Anything that writes to a lead or messages a client is proposed with one-tap Apply and stays undoable: call propose_kit, propose_facts, complete, send or ask_whatsapp, then add one short line at most. Never send a WhatsApp without the planner's tap.
- Pinned demo leads (Huber, Lindner, Moser) are included in a write only when the planner names them in their message or has their lead page open.
Intents:
- A scrap, a pasted email or a voice transcript about a new house goes to create_lead as given; reply with the chip, the verdict badge and the kit in one or two lines.
- Upsell: call upsell for battery and for heat pump; one table (Lead, Saving a year, Autarky gain) in the tool's order, autarky gain as "+40 %" or empty, never negative points.
- "I'm visiting <name>": find the lead with list_leads by first or last name (include_test if none match); several matches: one line of lead chips to pick from; then site_visit, and answer with the lead chip, a numbered list of questions (fact, then the figure at stake in bold when given) and a list of site checks. Write nothing.
- Design questions ("why 10 kWh", "what if no battery"): answer from design (the component's reason and figures) and, for what-if, a refine comparison in a small table. Read only unless the planner asks for the change.
- Client facts ("she has 5 people") go to propose_facts. "Draft a WhatsApp" calls whatsapp_draft and quotes the draft as a blockquote; it is sent only through ask_whatsapp and Apply.
- Heat pump price: one sourced whole-job market price whatever the size, €33,500 installed (reduco 2026), less the 30 % BEG subsidy, capped at €8,400 (30 % of €28,000), less €10,000 for an avoided gas or oil boiler: €25,100 net without a fossil boiler to replace, €15,100 with one. Never imply the price scales with kW; when sizes differ, say it is the same installed job. Take every price from the tools, which read the same rates as the kit sheet.
- "What did I change?" is answered from the board records in the conversation: each Apply and Undo with its lead, change and Berlin time ("Battery 10 to 5 kWh at 11:52, undone at 11:53.").
- "The one I asked about earlier" resolves from the lead chips in the earlier conversation.`;

type Msg = { role: "user" | "assistant" | "event"; content: string };
const enc = new TextEncoder();

function stream(run: (emit: (e: Record<string, unknown>) => void) => Promise<void>) {
  const body = new ReadableStream({
    async start(c) {
      const emit = (e: Record<string, unknown>) => c.enqueue(enc.encode(JSON.stringify(e) + "\n"));
      try { await run(emit); } catch (e) { emit({ t: "error", src: "Agent said", msg: (e as Error).message }); }
      emit({ t: "done" }); c.close();
    },
  });
  return new Response(body, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}

export async function POST(req: NextRequest) {
  let b: { messages?: Msg[]; apply?: Op[]; undo?: Op[]; said?: string; test?: boolean; context?: { lead_id?: string; name?: string } };
  try { b = await req.json(); } catch { return NextResponse.json({ error: "Body is not JSON" }, { status: 400 }); }

  if (b.apply || b.undo) {
    const undo = !!b.undo, ops = (b.undo ?? b.apply)!;
    return stream(async (emit) => { const prev = await apply(ops, emit, String(b.said ?? ""), undo); emit({ t: "applied", undo: prev }); });
  }
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "No ANTHROPIC_API_KEY on this server." }, { status: 503 });
  const history = (b.messages ?? []).filter((m) => m.content?.trim()).slice(-30);
  if (!history.length || history[history.length - 1].role !== "user") return NextResponse.json({ error: "Write a message first." }, { status: 400 });
  // The open lead page counts as naming that lead.
  const said = history[history.length - 1].content + (b.context?.lead_id ? ` [${b.context.lead_id}]` : "");

  return stream(async (emit) => {
    const client = new Anthropic();
    // Earlier turns travel as one transcript in a single user message: replayed assistant text without its thinking
    // made Sonnet 5.5 end the next turn empty.
    const earlier = history.slice(0, -1).map((m) => `${m.role === "user" ? "Planner" : m.role === "event" ? "Board record (applied or undone by the planner's tap, Berlin time)" : "You"}: ${m.content}`).join("\n\n");
    const ctx = b.context?.lead_id ? `The planner has the lead page of ${b.context.name ?? "a lead"} (lead_id ${b.context.lead_id}) open: "this", "the house", "her" or "him" and any kit, part, panel, brand or fact change mean this lead.\n\n` : "The planner is on the board of all leads.\n\n";
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: ctx + (earlier ? `Earlier in this conversation:\n\n${earlier}\n\nThe planner now says:\n\n${said}` : said) }];
    let retried = false;
    for (let turn = 0; turn < 8; turn++) {
      const s = client.messages.stream({
        model: MODEL, max_tokens: 8000, system: SYSTEM, tools: TOOLS, messages,
        thinking: { type: "between_tools" }, output_config: { effort: "medium" },
      } as unknown as Anthropic.MessageStreamParams);
      // Narration before a tool call is short: hold the first 160 characters, stream after that.
      let held = "", live = false;
      s.on("text", (d) => { if (live) return emit({ t: "text", d }); held += d; if (held.length > 160) { live = true; emit({ t: "text", d: held }); } });
      const msg = await s.finalMessage();
      const said_ = msg.content.some((c) => c.type === "text" && c.text.trim());
      if (msg.stop_reason !== "tool_use" && !said_) {
        // An empty answer: ask once more, then say why in the model's words.
        if (!retried) { retried = true; turn--; continue; }
        emit({ t: "error", src: "Claude stopped", msg: `${msg.stop_reason}${(msg as { stop_details?: { category?: string } }).stop_details?.category ? ` (${(msg as { stop_details?: { category?: string } }).stop_details!.category})` : ""}, with no answer. Ask again.` });
        break;
      }
      messages.push({ role: "assistant", content: msg.content });
      if (msg.stop_reason !== "tool_use") { if (!live && held) emit({ t: "text", d: held }); break; }
      const uses = msg.content.filter((c): c is Anthropic.ToolUseBlock => c.type === "tool_use");
      emit({ t: "tools", names: uses.map((u) => u.name) });
      const results = await Promise.all(uses.map(async (u) => {
        try { return { type: "tool_result" as const, tool_use_id: u.id, content: JSON.stringify(await runTool(u.name, u.input as Record<string, unknown>, said, emit, !!b.test)).slice(0, 30000) }; }
        catch (e) { return { type: "tool_result" as const, tool_use_id: u.id, content: (e as Error).message, is_error: true }; }
      }));
      messages.push({ role: "user", content: results });
    }
  });
}
