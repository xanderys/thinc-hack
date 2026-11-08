import "server-only";
// Google Photorealistic 3D Tiles through our own proxy: the key stays on the server, every JSON's child
// URIs are rewritten to /api/tiles/v1/... with the session token baked in, and responses are cached in
// memory for the life of the server process. Also the house anchor: the engine's UTM 32N origin as WGS84
// lat/lon, ellipsoidal height and the grid-to-true-north rotation, so the local scene lands on the tiles.

const GOOGLE = "https://tile.googleapis.com";
export const tilesKey = () => process.env.GOOGLE_MAPS_KEY || "";
import { toEcef, type Anchor } from "./tilesGeo";
export { anchorOf, toEcef, utm32ToLatLon, type Anchor } from "./tilesGeo";

// ---------- the proxy ----------
type Hit = { body: Uint8Array; type: string; at: number };
const cache = new Map<string, Hit>();
let cacheBytes = 0;
const CACHE_MAX = 256 * 1024 * 1024;
function put(k: string, h: Hit) {
  if (cache.has(k)) return;
  cache.set(k, h); cacheBytes += h.body.byteLength;
  for (const [key, v] of cache) { if (cacheBytes <= CACHE_MAX) break; cache.delete(key); cacheBytes -= v.body.byteLength; }
}

const ROOT_TTL = 30 * 60 * 1000; // a session lasts about three hours; refresh the root well inside that
let root: { json: string; session: string; at: number } | null = null;

// Child URIs to our proxy, with the session token on every one.
export function rewrite(json: string, session: string) {
  return json.replace(/"uri"\s*:\s*"\/v1\/([^"]*)"/g, (_m, rest: string) => {
    const withS = /[?&]session=/.test(rest) ? rest : `${rest}${rest.includes("?") ? "&" : "?"}session=${session}`;
    return `"uri":"/api/tiles/v1/${withS}"`;
  });
}

export class TilesError extends Error { constructor(msg: string, public status: number) { super(msg); } }

async function upstream(path: string, session: string | null): Promise<Hit> {
  const key = tilesKey();
  if (!key) throw new TilesError("No Google Maps key on the server", 503);
  const qs = new URLSearchParams({ key, ...(session ? { session } : {}) });
  const res = await fetch(`${GOOGLE}/v1/${path}?${qs}`, { signal: AbortSignal.timeout(15000), cache: "no-store" });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    let msg = `Google answered ${res.status}`;
    try { msg = JSON.parse(t).error?.message || msg; } catch {}
    throw new TilesError(msg, res.status);
  }
  return { body: new Uint8Array(await res.arrayBuffer()), type: res.headers.get("content-type") || "application/octet-stream", at: Date.now() };
}

export async function getRoot(): Promise<{ json: string; session: string }> {
  if (root && Date.now() - root.at < ROOT_TTL) return root;
  const h = await upstream("3dtiles/root.json", null);
  const text = new TextDecoder().decode(h.body);
  const session = text.match(/[?&]session=([^"&]+)/)?.[1] ?? "";
  root = { json: rewrite(text, session), session, at: Date.now() };
  return root;
}

// One tile or nested tileset. JSON gets its URIs rewritten with the session of this request.
export async function getTile(path: string, session: string | null): Promise<Hit> {
  const s = session || (await getRoot()).session;
  let h = cache.get(path);
  if (!h) { h = await upstream(path, s); put(path, h); }
  if (path.endsWith(".json") || h.type.includes("json")) {
    return { ...h, body: new TextEncoder().encode(rewrite(new TextDecoder().decode(h.body), s)), type: "application/json" };
  }
  return h;
}

// ---------- warming: walk the tree down to the house so the first Photo tap is served from memory ----------
type Node = { boundingVolume?: { box?: number[] }; geometricError?: number; content?: { uri?: string }; children?: Node[] };
const warmed = new Map<string, Promise<{ fetched: number; ms: number }>>();
function inBox(box: number[], p: [number, number, number], margin: number) {
  const d = [p[0] - box[0], p[1] - box[1], p[2] - box[2]];
  for (let i = 0; i < 3; i++) {
    const ax = [box[3 + i * 3], box[4 + i * 3], box[5 + i * 3]], len = Math.hypot(ax[0], ax[1], ax[2]) || 1;
    if (Math.abs((d[0] * ax[0] + d[1] * ax[1] + d[2] * ax[2]) / len) > len + margin) return false;
  }
  return true;
}
const pathOf = (uri: string) => {
  const u = new URL(uri, "http://x");
  return { path: u.pathname.replace(/^\/api\/tiles\/v1\//, ""), session: u.searchParams.get("session") };
};

export function warm(id: string, a: Anchor, opts = { margin: 120, minError: 2, max: 400 }) {
  const hit = warmed.get(id);
  if (hit) return hit;
  const run = (async () => {
    const t0 = Date.now();
    const p = toEcef(a.lat, a.lon, a.height);
    const queue: Node[] = [JSON.parse((await getRoot()).json).root];
    let fetched = 0;
    while (queue.length && fetched < opts.max) {
      const batch = queue.splice(0, 8);
      await Promise.all(batch.map(async (n) => {
        const box = n.boundingVolume?.box;
        if (box && !inBox(box, p, opts.margin)) return;
        if (n.content?.uri) {
          const { path, session } = pathOf(n.content.uri);
          try {
            const h = await getTile(path, session); fetched++;
            if (path.endsWith(".json")) queue.push(JSON.parse(new TextDecoder().decode(h.body)).root);
          } catch { return; }
        }
        if ((n.geometricError ?? 0) > opts.minError) queue.push(...(n.children ?? []));
      }));
    }
    return { fetched, ms: Date.now() - t0 };
  })();
  run.catch(() => warmed.delete(id));
  warmed.set(id, run);
  return run;
}
