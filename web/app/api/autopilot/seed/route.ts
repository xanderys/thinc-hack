import { ap, json } from "../_engine";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
export async function POST() { return json(await ap("POST", "/api/autopilot/seed", {}, 110000)); }
