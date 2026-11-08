import { NextRequest, NextResponse } from "next/server";
import { ENGINE_URL } from "@/lib/engine";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// The composer's hold-to-talk: the audio goes to the engine's speech to text as multipart; the engine's own words come back on any error.
export async function POST(req: NextRequest) {
  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ error: "Body is not multipart audio" }, { status: 400 }); }
  const audio = form.get("audio") ?? form.get("file");
  if (!(audio instanceof Blob) || audio.size === 0) return NextResponse.json({ error: "No audio was recorded." }, { status: 400 });
  const out = new FormData();
  out.append("file", new Blob([await audio.arrayBuffer()], { type: audio.type || "audio/webm" }), "voice.webm");
  try {
    const res = await fetch(`${ENGINE_URL}/api/leads/transcribe`, {
      method: "POST", body: out, cache: "no-store", signal: AbortSignal.timeout(50000),
      headers: process.env.INTAKE_SECRET ? { "X-Intake-Secret": process.env.INTAKE_SECRET } : {},
    });
    const t = await res.text();
    let j: unknown; try { j = JSON.parse(t); } catch { j = { error: t.trim() || `Engine answered ${res.status}${res.statusText ? ` ${res.statusText}` : ""}.` }; }
    if (!res.ok && !(j && typeof j === "object" && "error" in j)) {
      const d = (j as { detail?: unknown })?.detail;
      j = { error: typeof d === "string" ? d : `Engine answered ${res.status}${res.statusText ? ` ${res.statusText}` : ""}.` };
    }
    return NextResponse.json(j, { status: res.status });
  } catch (e) {
    return NextResponse.json({ error: `Engine unreachable at ${ENGINE_URL}: ${(e as Error).message}` }, { status: 502 });
  }
}
