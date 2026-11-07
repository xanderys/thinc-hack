# Brief: Photo view (Google Photorealistic 3D Tiles) on the hero card

Decided by Xander, Sat 7 Nov 2026 about 21:20 Munich. Branch `photo`. Owner: one Opus agent. Files owned: `web/components/spatial/PhotoView.tsx`, `web/components/spatial/tiles.ts`, `web/app/api/tiles/**`, `web/lib/tiles*.ts`; the toggle in `SpatialDemo.tsx` is the only shared edit, taken last after the web agent's phone fixes land on `web`.

## What
A third toggle on the hero card: 2D / 3D / Photo. Photo renders Google Photorealistic 3D Tiles (Map Tiles API, `https://tile.googleapis.com/v1/3dtiles/root.json?key=...`) inside the same three.js scene with NASA-AMMOS `3d-tiles-renderer` (npm), with our LoD2 panel layout, battery, wallbox and heat pump markers drawn on top at the same coordinates. Tiles are EPSG:4978 earth-centred: place our scene at the house's lat/lon/height (or reproject our planes onto the tile frame). Stage camera poses must keep working in Photo mode.

## Rules
- Key server-side only, through a proxy route (`/api/tiles/...`), never in the client. Env `GOOGLE_MAPS_KEY` in `web/.env.local` and on Vercel (SHIP adds it). Google is not yet answering (billing off, Map Tiles API not enabled); build against the public Google 3D Tiles demo tileset or a mock until it does.
- Pre-fetch: warm the tileset for the hero and rehearsal addresses at startup; cache tile responses server-side for the session within Google's terms. Any Munich address works live.
- Fallback: if the key, tiles or device fail, the toggle hides and the LoD2 model stays. Never a blank canvas.
- Phone: cap screen-space error, limit draw distance to about 150 m around the house.
- Nothing else changes. Test on a "Test ..." scratch lead, never demo lead db67b84935.
