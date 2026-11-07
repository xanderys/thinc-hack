"use client";
// A board card's picture: the lead's 3D model with its modules, rendered once off-screen and cached per lead and
// design (IndexedDB, newest 80 kept). One render at a time for the whole board; the line drawing under it stays
// until the picture is ready, and stays for good when the lead has no model (postcode only, no LoD2 building).
import { useEffect, useState } from "react";
import type { Design, Lead } from "@/lib/api";

const DB = "marquee-thumbs", STORE = "t", KEEP = 80, W = 384, H = 128; // 3:1, the phone card; wider cards crop only the sides

// ---------- cache ----------
let dbP: Promise<IDBDatabase | null> | null = null;
function db() {
  return (dbP ??= new Promise((ok) => {
    try {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onsuccess = () => ok(r.result);
      r.onerror = () => ok(null);
    } catch { ok(null); }
  }));
}
async function get(k: string): Promise<string | null> {
  const d = await db();
  if (!d) return null;
  return new Promise((ok) => {
    try { const r = d.transaction(STORE).objectStore(STORE).get(k); r.onsuccess = () => ok((r.result as { url?: string } | undefined)?.url ?? null); r.onerror = () => ok(null); } catch { ok(null); }
  });
}
async function put(k: string, url: string) {
  const d = await db();
  if (!d) return;
  try {
    const s = d.transaction(STORE, "readwrite").objectStore(STORE);
    s.put({ url, at: Date.now() }, k);
    // Size cap: drop the oldest beyond KEEP.
    const all = s.getAll(), keys = s.getAllKeys();
    let n = 0;
    const done = () => {
      if (++n < 2) return;
      const rows = (all.result as { at: number }[]).map((v, i) => ({ at: v.at, k: keys.result[i] })).sort((x, y) => y.at - x.at);
      rows.slice(KEEP).forEach((x) => s.delete(x.k));
    };
    all.onsuccess = done; keys.onsuccess = done;
  } catch { /* storage blocked: render again next time */ }
}

// ---------- one render at a time ----------
let chain: Promise<unknown> = Promise.resolve();
function queue<T>(job: () => Promise<T>): Promise<T> {
  const p = chain.then(job, job);
  chain = p.catch(() => null);
  return p;
}

const hash = (s: string) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return h.toString(36); };

function inputsOf(lead: Lead) {
  const place = lead.address_or_postcode ?? "", address = lead.facts.address ?? (/^\s*\d{5}\s*$/.test(place) ? null : place);
  return address ? { inputs: { ...lead.facts, address }, address } : null;
}

async function make(lead: Lead, design: Design): Promise<string | null> {
  const x = inputsOf(lead);
  if (!x) return null;
  const r = await fetch("/api/explain/layers", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ inputs: x.inputs, design }) });
  if (!r.ok) return null;
  const body = await r.json().catch(() => null) as { planes?: unknown } | null;
  const pl = body?.planes as { planes?: unknown[] } | unknown[] | undefined;
  const model = Array.isArray(pl) ? { address: x.address, planes: pl } : pl?.planes ? pl : null;
  if (!model || !(model as { planes: { is_target?: boolean }[] }).planes.some((p) => p.is_target)) return null;
  const { renderThumb } = await import("@/components/spatial/thumb");
  return renderThumb(model as Parameters<typeof renderThumb>[0], `/spatial-demo/glb?address=${encodeURIComponent(x.address)}`, W, H);
}

export default function ModelThumb({ lead, design }: { lead?: Lead; design: Design }) {
  const [url, setUrl] = useState<string | null>(null);
  const [on, setOn] = useState(false);
  const key = lead ? `v5:${lead.lead_id}:${hash(JSON.stringify([design, lead.facts, lead.address_or_postcode]))}` : "";
  useEffect(() => {
    if (!lead || !key) return;
    let dead = false;
    setOn(false);
    get(key).then((hit) => {
      if (dead) return;
      if (hit) { setUrl(hit); return; }
      // A network or engine hiccup gets one more try 15 s later; the line drawing stays meanwhile.
      const attempt = (n: number) => queue(() => (dead ? Promise.resolve(null) : make(lead, design))).then((u) => {
        if (!u) return;
        put(key, u);
        if (!dead) setUrl(u);
      }).catch((e) => {
        console.warn(`Card picture off for ${lead.lead_id}: ${(e as Error).message}`);
        if (n < 1 && !dead) setTimeout(() => { if (!dead) attempt(n + 1); }, 15000);
      });
      attempt(0);
    });
    return () => { dead = true; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!url) return null;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={`h-photo h-model${on ? " on" : ""}`} src={url} alt="" decoding="async" onLoad={() => setOn(true)} />;
}
