// GET /start/leads: recent homeowner calls for the planner's inbox (newest first). Open one with /start/lead/<id>.
export const dynamic = "force-dynamic";

const AGENT_ID = process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID || "agent_4201m6v70wckem7sd6nq4mkt40s4";

export async function GET() {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return Response.json({ error: "ELEVENLABS_API_KEY is not set on the server" }, { status: 500 });
  const r = await fetch(`https://api.elevenlabs.io/v1/convai/conversations?agent_id=${AGENT_ID}&page_size=20`, { headers: { "xi-api-key": key }, cache: "no-store" });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) return Response.json({ error: `ElevenLabs: ${JSON.stringify(body.detail ?? body)}` }, { status: r.status });
  return Response.json((body.conversations ?? []).map((c: Record<string, unknown>) => ({
    conversation_id: c.conversation_id,
    started_at: c.start_time_unix_secs,
    call_secs: c.call_duration_secs,
    status: c.status,
    title: c.call_summary_title ?? null,
  })));
}
