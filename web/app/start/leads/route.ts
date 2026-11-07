// GET /start/leads: recent homeowner calls for the planner's inbox (newest first). Open one with /start/lead/<id>.
// A call still running reports status "in_progress" with the caller's name and location from its dynamic variables.
export const dynamic = "force-dynamic";

const AGENT_ID = process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID || "agent_4201m6v70wckem7sd6nq4mkt40s4";
const LIVE = new Set(["initiated", "in-progress", "in_progress"]);

export async function GET() {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return Response.json({ error: "ELEVENLABS_API_KEY is not set on the server" }, { status: 500 });
  const h = { "xi-api-key": key };
  const r = await fetch(`https://api.elevenlabs.io/v1/convai/conversations?agent_id=${AGENT_ID}&page_size=20`, { headers: h, cache: "no-store" });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) return Response.json({ error: `ElevenLabs: ${JSON.stringify(body.detail ?? body)}` }, { status: r.status });
  const rows = await Promise.all((body.conversations ?? []).map(async (c: Record<string, unknown>) => {
    const live = LIVE.has(String(c.status));
    let name: string | null = null, location: string | null = null;
    if (live) {
      const d = await fetch(`https://api.elevenlabs.io/v1/convai/conversations/${c.conversation_id}`, { headers: h, cache: "no-store" }).then((x) => x.json()).catch(() => null);
      const v = d?.conversation_initiation_client_data?.dynamic_variables ?? {};
      const ok = (x: unknown) => (typeof x === "string" && x && x !== "not given" ? x : null);
      name = ok(v.customer_name) ?? ok(v.first_name);
      location = ok(v.address_or_postcode) ?? ok(v.address);
    }
    return {
      conversation_id: c.conversation_id,
      started_at: c.start_time_unix_secs,
      call_secs: c.call_duration_secs,
      status: live ? "in_progress" : c.status === "done" ? "done" : c.status,
      title: c.call_summary_title ?? null,
      name, location,
    };
  }));
  return Response.json(rows);
}
