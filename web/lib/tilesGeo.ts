// House anchor maths shared by the server proxy (warming) and the client (placing the mesh): the engine's UTM 32N
// origin as WGS84 lat/lon, ellipsoidal height and the grid-to-true-north rotation. No secrets, no server code.

// ---------- UTM 32N (ETRS89, same as WGS84 at this scale) to lat/lon ----------
const A = 6378137, F = 1 / 298.257223563, K0 = 0.9996, E2 = F * (2 - F), EP2 = E2 / (1 - E2);
const LON0 = (9 * Math.PI) / 180;
export function utm32ToLatLon(e: number, n: number): { lat: number; lon: number } {
  const x = e - 500000, y = n;
  const m = y / K0, mu = m / (A * (1 - E2 / 4 - (3 * E2 * E2) / 64 - (5 * E2 ** 3) / 256));
  const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
  const p = mu + (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu) + (21 * e1 * e1 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu)
    + (151 * e1 ** 3 / 96) * Math.sin(6 * mu) + (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
  const s = Math.sin(p), c = Math.cos(p), t = Math.tan(p);
  const n1 = A / Math.sqrt(1 - E2 * s * s), t1 = t * t, c1 = EP2 * c * c, r1 = (A * (1 - E2)) / (1 - E2 * s * s) ** 1.5, d = x / (n1 * K0);
  const lat = p - (n1 * t / r1) * (d * d / 2 - (5 + 3 * t1 + 10 * c1 - 4 * c1 * c1 - 9 * EP2) * d ** 4 / 24
    + (61 + 90 * t1 + 298 * c1 + 45 * t1 * t1 - 252 * EP2 - 3 * c1 * c1) * d ** 6 / 720);
  const lon = LON0 + (d - (1 + 2 * t1 + c1) * d ** 3 / 6 + (5 - 2 * c1 + 28 * t1 - 3 * c1 * c1 + 8 * EP2 + 24 * t1 * t1) * d ** 5 / 120) / c;
  return { lat, lon };
}

export function toEcef(lat: number, lon: number, h: number): [number, number, number] {
  const s = Math.sin(lat), nn = A / Math.sqrt(1 - E2 * s * s);
  return [(nn + h) * Math.cos(lat) * Math.cos(lon), (nn + h) * Math.cos(lat) * Math.sin(lon), (nn * (1 - E2) + h) * s];
}

// Height anomaly (GCG2016 quasigeoid) around Munich is about 47.5 m: DHHN2016 heights + 47.5 = ellipsoidal.
// The client fits the mesh to the LoD2 roof after loading (tiles.ts), which absorbs the residual (about 2 m).
const GEOID_M = 47.5;

export type Anchor = { lat: number; lon: number; height: number; beta: number; geoid: number }; // radians, metres (ellipsoidal), radians, metres
export function anchorOf(origin: [number, number, number]): Anchor {
  const [e, n, z] = origin;
  const a = utm32ToLatLon(e, n), b = utm32ToLatLon(e, n + 100);
  // Bearing of grid north from true north, clockwise positive.
  const dN = (b.lat - a.lat), dE = (b.lon - a.lon) * Math.cos(a.lat);
  return { lat: a.lat, lon: a.lon, height: z + GEOID_M, beta: Math.atan2(dE, dN), geoid: GEOID_M };
}

export const isOrigin = (o: unknown): o is [number, number, number] =>
  Array.isArray(o) && o.length === 3 && o.every((x) => typeof x === "number" && Number.isFinite(x));
