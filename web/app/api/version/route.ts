export const dynamic = "force-dynamic";
// The deployed build's id; the same value the client was built with, inlined at build time.
export function GET() {
  return Response.json({ build: process.env.NEXT_PUBLIC_BUILD_ID ?? "dev" }, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
