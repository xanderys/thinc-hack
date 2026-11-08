// One read of the engine per question, shared by every component on the page: /api/design for a set of facts and
// read-only /api/refine (no lead_id) for facts plus fixed sizes. Same body, same promise: re-renders, chip changes,
// card folds and remounts (React's dev double effects included) never call twice. Failures are not kept, so a retry
// asks again. An abort only stops the caller waiting; the shared request finishes for the next one.
import type { DesignResponse, HomeInputs, Overrides, RefineResponse } from "./api";
import { call, type Result } from "./client";

const stable = (x: unknown): unknown => Array.isArray(x) ? x.map(stable)
  : x && typeof x === "object" ? Object.fromEntries(Object.entries(x as Record<string, unknown>).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, stable(v)]))
  : x;
const memo = new Map<string, Promise<Result<unknown>>>();
const LIMIT = 64;

function shared<T>(path: string, body: unknown, signal?: AbortSignal): Promise<Result<T>> {
  const key = path + JSON.stringify(stable(body));
  let p = memo.get(key) as Promise<Result<T>> | undefined;
  if (!p) {
    p = call<T>(path, body);
    memo.set(key, p as Promise<Result<unknown>>);
    if (memo.size > LIMIT) memo.delete(memo.keys().next().value!);
    p.then((r) => { if (!r.ok) memo.delete(key); }, () => memo.delete(key));
  }
  if (!signal) return p;
  return new Promise((ok, no) => {
    if (signal.aborted) return no(new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", () => no(new DOMException("Aborted", "AbortError")), { once: true });
    p!.then(ok, no);
  });
}

export const designOf = (inputs: HomeInputs, signal?: AbortSignal) => shared<DesignResponse>("/api/design", { inputs }, signal);
export const refineOf = (inputs: HomeInputs, overrides: Overrides, signal?: AbortSignal) => shared<RefineResponse>("/api/refine", { inputs, overrides }, signal);
// A design the page already holds (the lead's stored draft) answers the same question without a call.
export function seedDesign(inputs: HomeInputs, r: DesignResponse) {
  const key = "/api/design" + JSON.stringify(stable({ inputs }));
  if (!memo.has(key)) memo.set(key, Promise.resolve({ ok: true, data: r } as Result<unknown>));
}
