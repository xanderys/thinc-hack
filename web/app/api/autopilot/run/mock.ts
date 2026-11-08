import "server-only";
// A scripted run in the brief's event shape, paced like a real one, for UI checks only.
const LEADS = [
  { id: "mock-weber", name: "Weber" }, { id: "mock-fischer", name: "Fischer" }, { id: "mock-becker", name: "Becker" }, { id: "mock-hoffmann", name: "Hoffmann" },
];
const SCRIPT: [number, string, string, "done" | "needs_you"][] = [
  [0, "read", "Read Weber's email", "done"], [0, "measure", "Measured the roof, 23 modules fit", "done"], [0, "draft", "Draft 10.65 kWp, Priority", "done"], [0, "send", "Sent the proposal", "done"],
  [1, "read", "Read Fischer's voice note", "done"], [1, "measure", "Measured the roof, 18 modules fit", "done"], [1, "ask", "Asked Fischer on WhatsApp about heating", "done"], [1, "draft", "Draft 8.33 kWp, Priority", "done"], [1, "send", "Sent the proposal", "done"],
  [2, "read", "Read Becker's note", "done"], [2, "measure", "Measured the roof, 26 modules fit", "done"], [2, "draft", "Draft 12.04 kWp, Priority", "done"], [2, "send", "Sent the proposal", "done"],
  [3, "read", "Read Hoffmann's email", "done"], [3, "measure", "Measured the roof, 31 modules fit", "done"], [3, "needs_you", "Needs you: shared roof, a house or a flat?", "needs_you"],
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
        await wait(450);
        emit({ lead_id: l.id, name: l.name, step, text, glyph: ({ read: "doc", measure: "ruler", ask: "message", draft: "pencil", send: "paperplane", needs_you: "hand" } as Record<string, string>)[step], state });
        await wait(150);
      }
      emit({ lead_id: null, name: null, step: "summary", text: "3 proposals sent, 1 needs you", glyph: "check", state: "done", summary: { sent: 3, needs_you: 1, asked: 1 } });
      c.close();
    },
  });
}
