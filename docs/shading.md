# Per-module shading

## What the engine computes
- `engine/app/shading.py`, route `GET /api/roof/shading?address=...` (or `lead_id=`, optional `kwp=`) in `engine/app/shading_routes.py`, cache `engine/.cache/shading/<hash>.json`, warm with `uv run python scripts/warm_shading.py "<address>"`.
- Every module slot on every target plane (the chosen layout is always the first n slots of a plane, so slot i is `chosen_panels[i]`). 4 sample points per module, one per quarter, 5 cm above the module.
- 288 sun positions: the 15th of each month at hh:30 local time, pvlib `solarposition` at the house's own lat/lon. Positions below the horizon, or behind the module's face, are null (no direct sun to block).
- Each ray is marched over the DOM20 window roof/model already caches (trees, neighbours; the house's own footprint is removed there) and tested against the house's own LoD2 roof and wall triangles, minus the module's own plane (dormers, other roof faces).
- `hourly[m][h]`: share of the 4 points in sun. `annual_share` and `monthly_share`: share of the module's plane-of-array irradiance kept, beam blocked by shade, diffuse kept, weighted by the PVGIS typical year in the same (month, hour) buckets. This is what Aurora and OpenSolar call solar access.
- Loss kWh a year per module = plane `yield_kwh_per_kwp` x 0.45 kWp x (1 - annual_share). Totals per plane and for the design. Draw only: layout, kWp, economics are untouched.
- Hero (Katharinenstraße 5, 82008 Unterhaching): 40 slots, 97.6 to 99.9% solar access, 1.0% loss over all slots; the roof model's plane figures are 1.3% and 0.5%. About 2 s per address once the house model is built.

## How others show it
- Aurora Solar: irradiance heat map over the roof (yellow high, red low) after simulating the sun for every daylight hour; per-panel irradiance; hover gives solar access, TOF and TSRF. Solar access = insolation with shade over insolation without; TOF = this tilt and orientation over the optimum; TSRF = solar access x TOF. [Key terms](https://help.aurorasolar.com/hc/en-us/articles/115005927847-Key-Terms-Irradiance-Solar-Access-TOF-and-TSRF), [irradiance map](https://help.aurorasolar.com/hc/en-us/articles/21137017211411-How-to-leverage-an-irradiance-map), [irradiance on modules](https://aurorasolar.com/?p=728).
- OpenSolar: shade report per panel group with annual sun access, monthly averages and an hourly grid; tapping an hour ray-traces that moment onto the panels. [3D shading analysis](https://support.opensolar.com/hc/en-us/articles/4406938900505-How-to-Interpret-3D-Shading-Analysis), [shade report](https://support.opensolar.com/hc/en-us/articles/11007607272207-Generating-a-Shade-Report).
- Autarc: shading analysis built into the planning flow, from the 3D model straight to module layout and yield, no separate import. [Shading analysis](https://www.autarc.energy/gb/products/shading-analysis), [solar planning](https://www.autarc.energy/gb/products/solar-planning).
- pvlib: `pvlib.shading.shaded_fraction1d` and `projected_solar_zenith_angle` cover row-to-row shade of regular arrays, not trees or dormers, so the ray-cast stays ours. [shaded_fraction1d](https://pvlib-python.readthedocs.io/en/stable/reference/generated/pvlib.shading.shaded_fraction1d.html).

## On screen
- Modules tinted by solar access, green at 100% to red at 60% or less; the % on each module when it is large enough on screen, on tap at phone width. 3D and 2D.
- Scrubber: month and hour (sunrise to sunset of that month), recolours by that hour's share of the module in sun; "Across the year" goes back to the annual figure. Recolour only, no shadow casting.
- Edge lengths on the roof faces in 3D while shading is on.
- Chip "Shading simulation" opens the card "Shading X %, Y kWh a year loss" with the source tag. Everything hides while the route is pending, missing or failing.
