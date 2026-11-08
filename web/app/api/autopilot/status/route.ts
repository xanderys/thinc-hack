import { ap, json } from "../_engine";
export const dynamic = "force-dynamic";
export async function GET() {
  if (process.env.AUTOPILOT_MOCK === "1") return Response.json({ running: false, started_at: null, events_n: 0, last: null });
  return json(await ap("GET", "/api/autopilot/status"));
}
