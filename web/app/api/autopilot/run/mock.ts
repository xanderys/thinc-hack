import "server-only";
// A scripted run in the brief's event shape, paced like a real one, for UI checks only.
const LEADS = [
  { id: "mock-weber", name: "Weber" }, { id: "mock-huber", name: "Huber" }, { id: "mock-koch", name: "Koch" },
];
const SCRIPT: [number, string, string, "done" | "needs_you"][] = [
  [0, "read", "Read Weber's email", "done"], [0, "measure", "Measured the roof, 23 modules fit", "done"], [0, "draft", "Draft 9.3 kWp, Priority", "done"], [0, "send", "Sent the proposal", "done"],
  [1, "read", "Read Huber's voice note", "done"], [1, "measure", "Measured the roof, 18 modules fit", "done"], [1, "ask", "Asked Huber on WhatsApp about heating", "done"], [1, "needs_you", "No reply yet", "needs_you"],
  [2, "read", "Read Koch's message", "done"], [2, "measure", "Measured the roof, 31 modules fit", "done"], [2, "needs_you", "Needs you: shared roof", "needs_you"],
];
export function mockRun(): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    async start(c) {
      const emit = (o: object) => c.enqueue(enc.encode(`data: ${JSON.stringify({ at: new Date().toISOString(), ...o })}\n\n`));
      const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
      for (const [i, step, text, state] of SCRIPT) {
        const l = LEADS[i];
        emit({ lead_id: l.id, name: l.name, step, text, glyph: ({ read: "doc", measure: "ruler", ask: "message", draft: "pencil", send: "paperplane", needs_you: "hand" } as Record<string, string>)[step], state: "active" });
        await wait(700);
        emit({ lead_id: l.id, name: l.name, step, text, glyph: ({ read: "doc", measure: "ruler", ask: "message", draft: "pencil", send: "paperplane", needs_you: "hand" } as Record<string, string>)[step], state });
        await wait(250);
      }
      emit({ lead_id: null, name: null, step: "summary", text: "1 proposal sent, 2 need you", glyph: "check", state: "done", summary: { sent: 1, needs_you: 2, asked: 1 } });
      c.close();
    },
  });
}
