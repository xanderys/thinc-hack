// Front-of-house photo. Street View's default heading follows the road from the nearest pano, which at the hero
// address shows the garage; here the heading points from the pano to the building itself. The key stays server side.
// Google's attribution is burned into the jpeg.
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const cache = new Map<string, { at: number; type: string; body: ArrayBuffer } | null>();
const DAY = 86_400_000;
const rad = (d: number) => (d * Math.PI) / 180;

// Initial great-circle bearing from a to b, degrees 0 to 360.
function bearing(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const φ1 = rad(a.lat), φ2 = rad(b.lat), Δλ = rad(b.lng - a.lng);
  const y = Math.sin(Δλ) * Math.cos(φ2), x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

const none = (error: string, status = 404) => NextResponse.json({ error }, { status });
// No photo for this address is an answer, not an error: 204, no body.
const nophoto = () => new NextResponse(null, { status: 204, headers: { "cache-control": "public, max-age=300" } });

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address")?.trim();
  if (!address) return none("No address", 400);
  const key = process.env.GOOGLE_MAPS_KEY;
  if (!key) return none("No GOOGLE_MAPS_KEY on the server", 503);
  const hit = cache.get(address);
  if (hit === null) return nophoto();
  if (hit && Date.now() - hit.at < DAY) return new NextResponse(hit.body, { headers: { "content-type": hit.type, "cache-control": "public, max-age=86400" } });

  const base = process.env.ENGINE_URL || "http://localhost:8000";
  try {
    const roof = await fetch(`${base}/api/roof?address=${encodeURIComponent(address)}`, { signal: AbortSignal.timeout(20000), cache: "no-store" });
    if (!roof.ok) return roof.status === 404 ? nophoto() : none(`Engine answered ${roof.status}`, 502);
    const r = await roof.json() as { lat?: number | null; lon?: number | null; pending?: boolean };
    if (r.lat == null || r.lon == null) return nophoto();
    const house = { lat: r.lat, lng: r.lon };

    type Meta = { status: string; pano_id?: string; location?: { lat: number; lng: number }; error_message?: string };
    const look = async () => (await (await fetch(`https://maps.googleapis.com/maps/api/streetview/metadata?location=${house.lat},${house.lng}&source=outdoor&radius=60&key=${key}`, { signal: AbortSignal.timeout(8000), cache: "no-store" })).json()) as Meta;
    let m = await look();
    if (m.status === "UNKNOWN_ERROR") m = await look();   // Google: transient, a retry may succeed
    if (m.status !== "OK" || !m.pano_id || !m.location) {
      if (m.status === "ZERO_RESULTS" || m.status === "NOT_FOUND") cache.set(address, null);
      return m.status === "ZERO_RESULTS" || m.status === "NOT_FOUND" ? nophoto() : none(`Street View: ${m.status}${m.error_message ? `, ${m.error_message}` : ""}`, 502);
    }

    // A pano further than 50 m from the building sees the street, a garage or trees, not the facade: no photo.
    const far = Math.hypot((m.location.lat - house.lat) * 111_320, (m.location.lng - house.lng) * 111_320 * Math.cos(rad(house.lat)));
    if (far > 50) { cache.set(address, null); return nophoto(); }
    const h = bearing(m.location, house).toFixed(1);
    const img = await fetch(`https://maps.googleapis.com/maps/api/streetview?size=640x400&pano=${m.pano_id}&heading=${h}&pitch=5&fov=80&key=${key}`, { signal: AbortSignal.timeout(10000), cache: "no-store" });
    const type = img.headers.get("content-type") ?? "";
    if (!img.ok || !type.startsWith("image/")) return none(`Street View image: ${img.status}`, 502);
    const body = await img.arrayBuffer();
    cache.set(address, { at: Date.now(), type, body });
    return new NextResponse(body, { headers: { "content-type": type, "cache-control": "public, max-age=86400" } });
  } catch (e) {
    return none(`Photo not reachable: ${(e as Error).message}`, 502);
  }
}
