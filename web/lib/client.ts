import { plainError } from "./plain";
export type Result<T> = { ok: true; data: T } | { ok: false; error: string; status?: number };

// Reads and the engine's pure calculations are safe to repeat. An engine that is slow under load answers one of them
// late or with a 502: ask again quietly (2, 4, 8 s) so the caller keeps its skeleton, and only then report the miss.
const SAFE_POST = /^\/api\/(design|ask|explain\/layers)$/;
const BACKOFF = [2000, 4000, 8000];
const missed = (r: Result<unknown>) => !r.ok && (r.status === undefined || r.status === 0 || r.status === 502 || r.status === 504);
const pause = (ms: number, signal?: AbortSignal) => new Promise<void>((res, rej) => {
  const t = setTimeout(res, ms);
  signal?.addEventListener("abort", () => { clearTimeout(t); rej(new DOMException("Aborted", "AbortError")); }, { once: true });
});

async function once<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<Result<T>> {
  try {
    const res = await fetch(path, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
    const json = await res.json().catch(() => ({ error: `${res.status} ${res.statusText}` }));
    if (!res.ok) return { ok: false, error: plainError(json?.error || `${res.status} ${res.statusText}`.trim()), status: res.status };
    return { ok: true, data: json as T };
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    return { ok: false, error: (e as Error).message };
  }
}

export async function call<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<Result<T>> {
  const retry = body === undefined || SAFE_POST.test(path.split("?")[0]);
  let r = await once<T>(path, body, signal);
  for (let n = 0; retry && missed(r) && n < BACKOFF.length; n++) {
    await pause(BACKOFF[n], signal);
    r = await once<T>(path, body, signal);
  }
  return r;
}

/** A write to the lead: names the UI action in X-Client-Route (the engine logs it) and keeps the status for 409. */
export async function send<T>(path: string, body: unknown, route: string, method: "POST" | "PUT" = "POST"): Promise<(Result<T>) & { status: number }> {
  try {
    const res = await fetch(path, { method, headers: { "content-type": "application/json", "X-Client-Route": route }, body: JSON.stringify(body ?? {}) });
    const json = await res.json().catch(() => ({ error: `${res.status} ${res.statusText}` }));
    if (!res.ok) return { ok: false, error: plainError(json?.error || `${res.status} ${res.statusText}`.trim()), status: res.status };
    return { ok: true, data: json as T, status: res.status };
  } catch (e) {
    return { ok: false, error: (e as Error).message, status: 0 };
  }
}

export const fmt = {
  n: (x: number | null | undefined, d = 2) => x == null ? "none" : x.toLocaleString("en-GB", { maximumFractionDigits: d }),
  eur: (x: number) => `€${Math.round(x).toLocaleString("en-GB")}`,
  pct: (x: number | null | undefined) => x == null ? "n/a" : `${Math.round(x * 100)}%`,
};

export const COMPONENT_NAME: Record<string, string> = {
  pv: "PV array", inverter: "Inverter", battery: "Battery", heatpump: "Heat pump", wallbox: "Wallbox",
};
