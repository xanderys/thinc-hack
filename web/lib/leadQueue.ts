// Lead writes go one at a time per lead: each waits for the previous answer, so it carries the version that answer returned.
// A write still waiting its turn is replaced by a newer write of the same key (rapid edits of one field send only the last).
type Task<T> = { key: string; run: () => Promise<T>; waiters: { res: (v: T) => void; rej: (e: unknown) => void }[]; started: boolean };
const tails = new Map<string, Promise<unknown>>();
const waiting = new Map<string, Task<unknown>[]>();

export function serialWrite<T>(leadId: string, key: string, run: () => Promise<T>): Promise<T> {
  const list = (waiting.get(leadId) ?? []) as Task<T>[];
  const queued = list.find((t) => t.key === key && !t.started);
  if (queued) {
    queued.run = run;   // the newer edit wins; everyone waiting on the old one gets the newer answer
    return new Promise<T>((res, rej) => queued.waiters.push({ res, rej }));
  }
  const task: Task<T> = { key, run, waiters: [], started: false };
  list.push(task);
  waiting.set(leadId, list as Task<unknown>[]);
  const p = new Promise<T>((res, rej) => task.waiters.push({ res, rej }));
  const go = (tails.get(leadId) ?? Promise.resolve()).then(async () => {
    task.started = true;
    waiting.set(leadId, (waiting.get(leadId) ?? []).filter((t) => t !== task));
    try { const v = await task.run(); task.waiters.forEach((w) => w.res(v)); } catch (e) { task.waiters.forEach((w) => w.rej(e)); }
  });
  tails.set(leadId, go);
  return p;
}
