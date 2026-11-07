export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

export async function call<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<Result<T>> {
  try {
    const res = await fetch(path, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
    const json = await res.json().catch(() => ({ error: `${res.status} ${res.statusText}` }));
    if (!res.ok) return { ok: false, error: json?.error || `${res.status} ${res.statusText}`.trim() };
    return { ok: true, data: json as T };
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    return { ok: false, error: (e as Error).message };
  }
}

export const fmt = {
  n: (x: number | null | undefined, d = 2) => x == null ? "none" : x.toLocaleString("en-GB", { maximumFractionDigits: d }),
  eur: (x: number) => `${Math.round(x).toLocaleString("en-GB")} EUR`,
  pct: (x: number | null | undefined) => x == null ? "n/a" : `${Math.round(x * 100)}%`,
};

export const COMPONENT_NAME: Record<string, string> = {
  pv: "PV array", inverter: "Inverter", battery: "Battery", heatpump: "Heat pump", wallbox: "Wallbox",
};
