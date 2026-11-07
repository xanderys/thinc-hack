import "server-only";
import Anthropic from "@anthropic-ai/sdk";

export const MODEL = "claude-sonnet-5-5";

// One structured call. Returns parsed JSON or an error in the source's words.
export async function structured<T>(system: string, user: string, schema: object, maxTokens = 4096): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, status: 503, error: "No ANTHROPIC_API_KEY in web/.env.local." };
  try {
    const msg = await new Anthropic().messages.create({
      model: MODEL, max_tokens: maxTokens, system, thinking: { type: "between_tools" },
      messages: [{ role: "user", content: user }],
      output_config: { format: { type: "json_schema", schema } },
    } as Anthropic.MessageCreateParamsNonStreaming);
    const block = msg.content.find((b) => b.type === "text");
    const raw = block && block.type === "text" ? block.text : "";
    try { return { ok: true, data: JSON.parse(raw) as T }; } catch {
      console.error("claude not json", msg.stop_reason, raw.slice(0, 300)); return { ok: false, status: 502, error: `Claude returned something that is not JSON: ${raw.slice(0, 200)}` }; }
  } catch (e) {
    const err = e as { status?: number; message?: string };
    console.error("claude", err.status, err.message);
    return { ok: false, status: err.status && err.status >= 400 ? err.status : 502, error: `Claude API: ${err.message ?? String(e)}` };
  }
}

// Numbers as written ("8,000", "10.35", "63%") normalised to plain decimals.
export function numbersIn(s: string): string[] {
  return (s.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => String(Number(n.replace(/,/g, ""))));
}
