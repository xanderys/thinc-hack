# Brief: per-panel shading, Autarc-style

Decided by Xander, Sat 7 Nov 2026 about 21:45 Munich. Branch `shading`. One Opus agent. Merged only if it works by 06:00 Munich. DRAW ONLY: layout, kWp, battery, economics and the scoreboard do not change.

## Engine (additive, owned files: `engine/roof/shading.py`, `engine/app/shading_routes.py`, `engine/scripts/warm_shading.py`)
- Per module: sunshine share per hour across the year on a representative set (12 months x 24 hours = 288 sun positions, pvlib solar position for the house lat/lon), by ray-casting from 4 sample points per module against the DOM20 surface model (trees, neighbours, chimneys as the surface resolves them) plus the LoD2 dormers as blockers. Reuse the existing DOM20 shade ray-cast in `engine/roof/`.
- Output per module: annual sunshine %, monthly %, shaded-yield loss in kWh a year (plane yield x module share x shade loss); totals per plane and for the design: "Shading X %, Y kWh a year loss". Also roof edge lengths per plane from the polygons.
- Route `GET /api/roof/shading?address=...` (also `lead_id=`), cached per address on disk under `engine/.cache/shading/`, `{ status: "ready" | "pending", ... }`; heavy compute in a background thread, never blocks the design. The router is mounted by REONIC ENGINE in the 07:29 batch (one include line in `engine/app/main.py`, not yours). `warm_shading.py <address>` pre-computes the cache for the hero and rehearsal homes.

## Web (owned files: `web/components/spatial/shading.ts`, `web/components/spatial/ShadingScrubber.tsx`, `web/lib/shading.ts`; minimal hooks in `scene.ts`, `SpatialDemo.tsx`, `Chain.tsx` taken last after a rebase on `origin/web`)
- Each module tinted by its annual sunshine % on a green (100) to red (under 60) scale, the % on the module at 3D zoom and on tap at phone size; empty roof as today. 3D and 2D.
- Scrubber: hour of day (sunrise to sunset) and month; recolour the modules by that hour's share (real shadow casting only if it stays smooth on a phone). The Solar stage of the chain lands on "across the year".
- Dimension labels on the roof edges in 3D, like the existing plan labels.
- Chip "Shading simulation" with the card "Shading X %, Y kWh a year loss" beside the four numbers; source tag "estimated from the Bavarian surface model". Hidden while the route is pending or absent.
- Motion per `apple-motion`: one spring, bounce 0; scrubber 1:1 with the finger; Reduce Motion instant.
