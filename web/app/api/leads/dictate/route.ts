import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Hold-to-talk through WalaoFlow: the browser sends the clip as 16 kHz mono PCM16; this route replays it over
// WalaoFlow's dictation socket with the device token (server side only) and returns the cleaned text.
export async function POST(req: NextRequest) {
  const ws = process.env.WALAOFLOW_WS, token = process.env.WALAOFLOW_DEVICE_TOKEN;
  if (!ws || !token) return NextResponse.json({ error: "WalaoFlow is not configured here." }, { status: 503 });
  const pcm = Buffer.from(await req.arrayBuffer());
  if (pcm.length < 3200) return NextResponse.json({ error: "No audio was recorded." }, { status: 400 });
  type WSInit = new (url: string, init?: unknown) => WebSocket;
  return await new Promise<NextResponse>((resolve) => {
    let settled = false;
    const done = (body: unknown, status = 200) => { if (settled) return; settled = true; clearTimeout(timer); try { sock.close(); } catch { /* already closed */ } resolve(NextResponse.json(body, { status })); };
    const timer = setTimeout(() => done({ error: "WalaoFlow did not answer in 40 s." }, 504), 40000);
    let sock: WebSocket;
    try { sock = new (WebSocket as unknown as WSInit)(ws, { headers: { Authorization: `Bearer ${token}` } }); }
    catch (e) { clearTimeout(timer); return resolve(NextResponse.json({ error: `WalaoFlow socket: ${(e as Error).message}` }, { status: 502 })); }
    sock.binaryType = "arraybuffer";
    sock.onopen = () => sock.send(JSON.stringify({ type: "start", id: crypto.randomUUID(), audio: { encoding: "linear16", sampleRate: 16000, channels: 1 }, app: { name: "marquee" } }));
    sock.onmessage = (e) => {
      let m: { type?: string; text?: string; message?: string };
      try { m = JSON.parse(String(e.data)); } catch { return; }
      if (m.type === "ready") {
        for (let i = 0; i < pcm.length; i += 6400) sock.send(pcm.subarray(i, i + 6400));
        sock.send(JSON.stringify({ type: "finish" }));
      } else if (m.type === "done") done({ text: String(m.text ?? "").trim() });
      else if (m.type === "error") done({ error: `WalaoFlow said: ${m.message ?? "error"}` }, 502);
    };
    sock.onerror = () => done({ error: "WalaoFlow is unreachable." }, 502);
    sock.onclose = (e) => done({ error: `WalaoFlow closed the socket (${e.code}).` }, 502);
  });
}
