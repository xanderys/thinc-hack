import { ap, json } from "../_engine";
export const dynamic = "force-dynamic";
export async function GET() { return json(await ap("GET", "/api/autopilot/status")); }
