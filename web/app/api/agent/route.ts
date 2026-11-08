import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { apply, runTool, TOOLS, type Op } from "./tools";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MODEL = "claude-sonnet-5-5";
const SYSTEM = `You are the planner's assistant on Marquee, a board of solar leads for a German installer (PV, battery, heat pump, wallbox). Tools read the board and the engine; the engine does all sizing and prices, you never invent a figure.
Answer in Markdown, essential text only, British English, no em dashes, no headings, no preamble, no closing offer. Never say what you are about to do or which tool you call. Bold is for figures only: never bold a word, a label or a lead-in. Prefer one table plus one plain sentence over bullets.
- Tables: GitHub tables, at most four columns, most important first.
- Status: [[ok: text]], [[warn: text]], [[fail: text]] badges.
- Every lead name is written as a chip: [[lead: Full Name|lead_id]].
- Figures: bold value then unit, like **10.65** kWp, **€14,890**, **76** % autarky, **+12** pts.
- Writes (kit changes, Complete, send, WhatsApp asks) are never run by you: call propose_kit, complete, send or ask_whatsapp, which show the planner a table with Apply. After proposing, add one short line at most.
- Pinned demo leads (Huber, Lindner, Moser) are included in a write only when the planner names them in their message.
- A scrap, a pasted email or a voice transcript about a new house goes to create_lead as given; reply with the chip, the verdict badge and the kit in one or two lines.
- Upsell questions: call upsell for battery and for heat pump, rank by price added, show the table.`;

type Msg = { role: "user" | "assistant"; content: string };
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
  let b: { messages?: Msg[]; apply?: Op[]; undo?: Op[]; said?: string; test?: boolean };
  try { b = await req.json(); } catch { return NextResponse.json({ error: "Body is not JSON" }, { status: 400 }); }

  if (b.apply || b.undo) {
    const undo = !!b.undo, ops = (b.undo ?? b.apply)!;
    return stream(async (emit) => { const prev = await apply(ops, emit, String(b.said ?? ""), undo); emit({ t: "applied", undo: prev.map((p) => ({ lead_id: p.lead_id, name: p.name, action: "kit", overrides: p.overrides })) }); });
  }
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "No ANTHROPIC_API_KEY on this server." }, { status: 503 });
  const history = (b.messages ?? []).filter((m) => m.content?.trim()).slice(-20);
  if (!history.length || history[history.length - 1].role !== "user") return NextResponse.json({ error: "Write a message first." }, { status: 400 });
  const said = history[history.length - 1].content;

  return stream(async (emit) => {
    const client = new Anthropic();
    const messages: Anthropic.MessageParam[] = history.map((m) => ({ role: m.role, content: m.content }));
    for (let turn = 0; turn < 8; turn++) {
      const s = client.messages.stream({
        model: MODEL, max_tokens: 8000, system: SYSTEM, tools: TOOLS, messages,
        thinking: { type: "between_tools" }, output_config: { effort: "medium" },
      } as unknown as Anthropic.MessageStreamParams);
      s.on("text", (d) => emit({ t: "text", d }));
      const msg = await s.finalMessage();
      messages.push({ role: "assistant", content: msg.content });
      if (msg.stop_reason !== "tool_use") break;
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
