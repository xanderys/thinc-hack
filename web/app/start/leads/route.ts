// GET /start/leads: recent calls for the planner's inbox, newest first, live calls included.
// A call shows as "in_progress" from the moment it starts (name and address from the session's user_id
// "<customer_name>|<address_or_postcode>"), and as "done" once ElevenLabs' post-call data collection is in
// (name and address then from the dynamic variables). Open a done call with /start/lead/<id>.
// Finished calls shorter than 45 s or without a customer name are left out.
export const dynamic = "force-dynamic";

const AGENT_ID = process.env.NEXT_PUBLIC_ELEVENLABS_AGENT_ID || "agent_4201m6v70wckem7sd6nq4mkt40s4";
const API = "https://api.elevenlabs.io/v1/convai/conversations";

type Lead = {
  conversation_id: string; status: "in_progress" | "done" | "failed";
  started_at: number | null; call_secs: number | null;
  customer_name: string | null; address_or_postcode: string | null; title: string | null; lead_id: string | null;
};

let cache: { at: number; body: Lead[] } | null = null;         // list, about 2 s
const people = new Map<string, { name: string | null; address: string | null; lead: string | null; final: boolean }>(); // per conversation

const clean = (v: unknown) => (typeof v === "string" && v.trim() && v !== "not given" ? v.trim() : null);

async function who(id: string, key: string, final: boolean) {
  const known = people.get(id);
  if (known && (known.final || !final)) return known;
  const r = await fetch(`${API}/${id}`, { headers: { "xi-api-key": key }, cache: "no-store" });
  if (!r.ok) return { name: null, address: null, lead: null, final: false };
  const c = await r.json();
  const vars = c.conversation_initiation_client_data?.dynamic_variables ?? {};
  const [uName, uAddr] = typeof c.user_id === "string" ? c.user_id.split("|") : [];
  const p = {
    name: clean(vars.customer_name) ?? clean(vars.first_name) ?? clean(uName),
    address: clean(vars.address_or_postcode) ?? clean(vars.address) ?? clean(uAddr),
    lead: clean(vars.lead_id),
    final: c.status === "done" || c.status === "failed",
  };
  people.set(id, p);
  return p;
}

export async function GET() {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return Response.json({ error: "ELEVENLABS_API_KEY is not set on the server" }, { status: 500 });
  if (cache && Date.now() - cache.at < 2000) return Response.json(cache.body);

  const r = await fetch(`${API}?agent_id=${AGENT_ID}&page_size=20`, { headers: { "xi-api-key": key }, cache: "no-store" });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) return Response.json({ error: `ElevenLabs: ${JSON.stringify(body.detail ?? body)}` }, { status: r.status });

  const leads = await Promise.all((body.conversations ?? []).map(async (c: Record<string, unknown>): Promise<Lead> => {
    const status = c.status === "done" ? "done" : c.status === "failed" ? "failed" : "in_progress";
    const p = await who(String(c.conversation_id), key, status !== "in_progress");
    return {
      conversation_id: String(c.conversation_id), status,
      started_at: (c.start_time_unix_secs as number) ?? null, call_secs: (c.call_duration_secs as number) ?? null,
      customer_name: p.name, address_or_postcode: p.address, title: (c.call_summary_title as string) ?? null, lead_id: p.lead,
    };
  }));
  // Real calls only: live calls always show; finished ones need a name and at least 45 s.
  const real = leads.filter((l: Lead) => l.status === "in_progress" || (!!l.customer_name && (l.call_secs ?? 0) >= 45));
  cache = { at: Date.now(), body: real };
  return Response.json(real);
}
