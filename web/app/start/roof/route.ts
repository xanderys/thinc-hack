// GET /start/roof?address=...: the engine's roof lookup, proxied so the widget never needs ENGINE_URL.
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const address = new URL(req.url).searchParams.get("address")?.trim();
  const engine = process.env.ENGINE_URL;
  if (!address) return Response.json({ error: "address is required" }, { status: 400 });
  if (!engine) return Response.json({ error: "ENGINE_URL is not set on the server" }, { status: 500 });
  // A postcode alone gets the engine's postcode lookup (sun and typical homes, no roof planes).
  const pc = address.match(/^(?:D-?)?(\d{5})$/i);
  const q = pc ? `postcode=${pc[1]}` : `address=${encodeURIComponent(address)}`;
  const r = await fetch(`${engine}/api/roof?${q}`, { cache: "no-store" }).catch((e) => e as Error);
  if (r instanceof Error) return Response.json({ error: r.message }, { status: 502 });
  const body = await r.json().catch(() => ({ error: `engine returned ${r.status}` }));
  return Response.json(body, { status: r.status });
}
