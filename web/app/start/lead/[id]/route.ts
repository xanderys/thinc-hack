// GET /start/lead/<conversation_id>: the homeowner's form and call, merged, with the engine design.
// Needs ELEVENLABS_API_KEY and ENGINE_URL in the server env. Stores nothing.
import { factsFromVariables, mergeIntake, toHomeInputs, type InstallerId, type IntakeFacts } from "../../intake";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) return Response.json({ error: "ELEVENLABS_API_KEY is not set on the server" }, { status: 500 });
  if (!/^conv_[a-z0-9]+$/i.test(id)) return Response.json({ error: "Not a conversation id" }, { status: 400 });

  const r = await fetch(`https://api.elevenlabs.io/v1/convai/conversations/${id}`, { headers: { "xi-api-key": key }, cache: "no-store" });
  const conv = await r.json().catch(() => ({}));
  if (!r.ok) return Response.json({ error: `ElevenLabs: ${JSON.stringify(conv.detail ?? conv)}` }, { status: r.status });

  const vars: Record<string, unknown> = conv.conversation_initiation_client_data?.dynamic_variables ?? {};
  let call: Partial<IntakeFacts> | undefined;
  for (const t of conv.transcript ?? [])
    for (const c of t.tool_calls ?? [])
      if (c.tool_name === "submit_intake") call = JSON.parse(c.params_as_json);

  const { facts, sources } = mergeIntake(factsFromVariables(vars), call);
  const installer = (vars.installer_id === "23c108b7" ? "23c108b7" : "2a8ba8e2") as InstallerId;
  const inputs = toHomeInputs(facts, installer, facts.address);

  const engine = process.env.ENGINE_URL;
  let design: unknown = null, design_error: string | null = null;
  if (!engine) design_error = "ENGINE_URL is not set on the server";
  else {
    const d = await fetch(`${engine}/api/design`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ inputs }), cache: "no-store" });
    const body = await d.json().catch(() => ({ error: `engine returned ${d.status}` }));
    if (d.ok) design = body; else design_error = body.error ?? `engine returned ${d.status}`;
  }

  return Response.json({
    conversation_id: id,
    status: conv.status,
    started_at: conv.metadata?.start_time_unix_secs ?? null,
    call_secs: conv.metadata?.call_duration_secs ?? null,
    complete: !!call,
    facts, sources, inputs, design, design_error,
  });
}
