# Photo view (Google Photorealistic 3D Tiles)

Third view on the hero card: 2D / 3D / Photo. Same three.js scene, same camera poses; the Google photo mesh replaces the LoD2 glb and our panels, battery, wallbox and labels draw over it.

## Files
- `web/lib/tiles.ts` (server): UTM 32N to WGS84, anchor (lat, lon, ellipsoidal height, grid convergence), Google proxy with in-memory cache (256 MB cap), tree warm-up.
- `web/app/api/tiles/[...path]/route.ts`: `status`, `warm`, `v1/3dtiles/root.json`, `v1/<tile>`. Key from env `GOOGLE_MAPS_KEY`, never sent to the browser.
- `web/components/spatial/tiles.ts`: `PhotoLayer` (TilesRenderer plus plugins, draw order, ground fit, attribution, 6 s timeout).
- `web/components/spatial/PhotoView.tsx`: `usePhoto(address, scene, active)`; the toggle and overlay.
- Shared edits: `SpatialDemo.tsx` (hook, Photo button, `photo` passed to `tools`), `Chain.tsx` (Photo button in the hero toolbar).

## How it works
- Proxy: Google returns child URIs as `/v1/3dtiles/...`; every JSON is rewritten to `/api/tiles/v1/...` with `session=` baked in (Google only puts it on the root's children). Root is refreshed every 30 min (sessions last about 3 h).
- Warm: the first request to the route in a server process walks the tree down to the hero house (Katharinenstraße 5, 82008 Unterhaching) within 120 m to geometric error 2 m, about 220 files in 7 s. `GET /api/tiles/warm?address=...` warms any other address; `status` warms the address it is asked about.
- Frame: the engine's `origin_utm32` (E, N, DHHN height) becomes lat/lon by inverse UTM; height + 47.5 m geoid (Munich, EGM2008/GCG2016). `ReorientationPlugin` puts that point at the origin with east to -X and north to +Z; a holder rotates by pi + beta (beta = UTM grid convergence, about 1.94° here) so tiles match our grid frame (east +X, north -Z). After the first tiles land, a ring of 12 downward rays beside the house sets the ground (25th percentile, only if within 8 m).
- Draw order: photo tiles (renderOrder -10), then a depth clear, then a depth-only copy of our LoD2 house, then our overlays. Panels never sink into the lumpy photo roof, and still hide behind the house.
- Phone (`max-width 640px` or coarse pointer): errorTarget 40 (desktop 20, Google's recommended), smaller LRU cache. A `LoadRegionPlugin` sphere mask of 150 m around the house limits what loads. Leaving Photo disposes the tiles.
- Fallback: no key, root fails, no house anchor, no WebGL2 or textures under 4096, or no tiles within 6 s: the Photo button hides and the LoD2 model stays. The LoD2 model stays on screen while the photo loads.
- Attribution: copyright strings from each visible tile's glTF `asset.copyright`, counted by visibility and sorted by frequency, shown on the canvas as "Google · ..." (required by the Map Tiles policies).
- Draco decoder from gstatic (`www.gstatic.com/draco/versioned/decoders/1.5.7/`).

## Sources used
- 3d-tiles-renderer 0.5.3 README and source (`ReorientationPlugin`, `GoogleCloudAuthPlugin`, `LoadRegionPlugin`, `TilesRenderer` events): https://github.com/NASA-AMMOS/3DTilesRendererJS
- Google Map Tiles API, Photorealistic 3D Tiles (root, session, attribution policy): https://developers.google.com/maps/documentation/tile/3d-tiles and https://developers.google.com/maps/documentation/tile/policies

## White context (whiteContext.ts, tileLod.ts)
- Look: the target house keeps Google's texture inside its footprint (meshFrame.footprint, the hull of its roof planes) plus 1 m; everything else in the mesh is painted flat white in the tile shader, shaded by its face normal (screen derivatives; faces within about 30° of level stay pure white, walls get a soft key light and darken slightly near the ground). Neighbours' LoD2 footprints are painted into the same shader as faint grey hairlines on the ground. Panels, markers, outlines and labels draw on top as before.
- Frame: the mask is tested in scene space, the frame the holder (rotation pi + beta, fitted offset) brings the tiles into; it re-reads `meshFrame` whenever its `version` bumps.
- Detail: tileLod.ts wraps the renderer's screen-space error and scales it by (25 m / distance)^1.6 beyond 25 m of the house (floor 0.06), so the white context loads coarse; the house's own full-detail region still wins. LRU cache 40 to 80 MB on phones, 90 to 180 MB on desktop.
- Fallback (no tiles): the LoD2 roof keeps its DOP20 texture; walls, neighbour slabs and the ground go white; neighbours' footprints are drawn as grey lines.
- Terms, checked 7 Nov 2026: Google's Map Tiles API policies (https://developers.google.com/maps/documentation/tile/policies) and the Google Maps Platform Terms (https://cloud.google.com/maps-platform/terms, 3.2.1 to 3.2.3) contain no clause against restyling or recolouring rendered 3D Tiles. The "modify" restriction in 3.2.1(a) is about the Services' source code; 3.2.2(b) forbids modifying or obscuring the attribution; 3.2.3 forbids extracting, tracing or building models from the content. Recolouring in the shader extracts nothing, and the "Google · ..." attribution stays on the canvas, so the full white treatment ships rather than the desaturate-and-fade fallback. The EEA terms (https://cloud.google.com/terms/maps-platform/eea) render client-side and could not be read by script; check them by hand before a commercial launch.
