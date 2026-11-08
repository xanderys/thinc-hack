# Brief: white context in the mesh view (Autarc-style)

Decided by Xander, Sat 7 Nov 2026 about 22:30 Munich. Branch `white`. One Opus agent, in parallel with the draping agent on branch `photo`. Ships when green, merged through the orchestrator.

File ownership: this agent owns a shader/material module (`web/components/spatial/whiteContext.ts`, `web/components/spatial/tileLod.ts`) and the tile LOD policy; the draping agent (branch `photo`) owns alignment and module placement (`tiles.ts` anchor code, module drape). Neither edits the other's files; hooks into `PhotoView.tsx` / `tiles.ts` are taken last after a rebase on `origin/photo`.

1. Mask = the target house footprint from LoD2 plus about 1 m margin, in the same aligned frame the draping fix produces. Inside the mask Google's textured mesh stays; outside it a shader paints the mesh flat white with soft ambient-occlusion-like shading and no texture.
2. Detail tiers: full screen-space detail inside about 25 m of the house, coarse tiles beyond (they are white, geometry barely matters). This is the lag fix as well.
3. Ground: white with the neighbours' footprints as faint grey outlines, no aerial photo.
4. Panels, markers, plane outlines and dimensions draw on top; labels get a hairline so they read on white.
5. Fallback mode (no tiles) gets the same look: textured roof on a white massing model, white slabs, white ground.
6. Check Google's Map Tiles terms on restyling photorealistic imagery before shipping and keep the attribution on screen; if the terms forbid recolouring the imagery, fall back to desaturating plus fading the context and say so.
Verify hero and demo leads at 390 px.

## Correction (Xander, Sat 7 Nov 2026 about 23:30 Munich): white is a view option, not the default
Default stays the real-world look: satellite ground, neighbours flat (footprints or low slabs), the target house real (Google mesh where tiles cover it, Bavarian model otherwise). White context (house real, everything else flat white, coarse tiles) is a toggle on the layers menu ("White context"), and may serve as the low-lag mode on weak phones.

Satellite ground resolution, sharper, in this order; report which land:
1. Stop downsizing our own DOP20 texture: fetch tiles at native 20 cm, larger texture (2048 to 4096 per tile group), anisotropic filtering, no mipmap blur on the ground plane.
2. Add Google 2D satellite tiles at max zoom (about 15 cm/px in Munich, often newer) as the ground texture option via the same Map Tiles key, attribution kept.
3. Check whether Bavaria (LDBV) or the City of Munich publishes a 10 cm orthophoto as open data; if yes and the licence allows, use it for the hero area.
