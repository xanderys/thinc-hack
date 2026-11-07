# roof/model

Address in, a 3D model of the real house out: the LoD2 solid with every roof plane, neighbours within 30 m, the aerial photo on the roofs and ground, yearly yield per plane, and module rectangles laid on the best planes.

## Run it (from `roof/`)
- `uv run python -m model.prerender` builds the hero and the four check.py houses, with PNG previews in `.cache/model/previews/<key>.png`
- `uv run uvicorn model.app:app --port 8766`
  - `GET /model?address=...&kwp=9` returns the planes JSON plus `glb_url`
  - `GET /model/file?address=...` serves the `.glb` (`model/gltf-binary`)
- Python: `roof.model(address, kwp=None)` returns `{glb_path, planes_json_path, textured, licence, source, key, model}`. Raises `roof.NotFound` with the source's own words when there is no LoD2 building.

## Output
- `.cache/model/<key>.glb`: glTF 2.0. Nodes `roof_p1`, `roof_p2`, ... (target planes, ids match the JSON), `context_roofs` (textured), `context_roofs_grey` (outside the photo), `walls` (light grey), `ground` (80 x 80 m, textured). Axes are glTF: x east, y up, z south, metres, origin at the target's footprint centroid on its lowest ground point. Hero: 580 triangles, 1.1 MB.
- `.cache/model/<key>.json`: `planes[]` with `id`, `is_target`, `polygon` (3D ring, local metres x east, y north, z up), `pitch`, `azimuth` (clockwise from north, null when flat), `area_m2`, `yield_kwh_per_kwp`, `sun` (0 to 1, yield over the best Munich plane), `max_panels` (70% of area / 2 m2), `fits_panels` (rectangles that actually fit), `chosen_panels` (module corners, 3D local metres, 8 cm above the roof). Plus `layout` (`panels`, `kwp`, `kwh_per_year`, `short_by_panels`), `textured`, `licence`, `origin_utm32`, `triangles`.
- `lay_out(planes, kwp)`: fills target planes in order of yield until kwp is reached; planes under sun 0.6 (north faces) are never used. `kwp=None` fills every usable plane. Modules are 450 W, 1.134 x 1.762 m portrait, 30 cm from every edge, eaves row first; flat roofs follow the longest edge.

## Sources and licences
- **Geometry**: Bayern LoD2 CityGML, `https://download1.bayernwolke.de/a/lod2/citygml/{E_km}_{N_km}.gml`. Each tile is parsed once into `.cache/model/tiles/<tile>.geom.json.gz` (1 to 3 MB) and the GML deleted.
- **Texture**: DOP20 colour orthophoto, WMS `https://geoservices.bayern.de/od/wms/dop/v1/dop20`, layer `by_dop20c`, EPSG:25832, one 1,024 px JPEG per address over 80 x 80 m, cached in `.cache/model/ortho/`. If the WMS cannot be reached the model is exported untextured with `textured: false` and the next call retries.
- **Licence**: both are CC BY 4.0 (the WMS capabilities state `AccessConstraints: CC BY 4.0`, `Fees: kostenfrei`; terms at https://www.geodaten.bayern.de/odd/m/3/html/nutzungsbedingungen.html). Attribution line, shown wherever the model is shown:

  `Bayerische Vermessungsverwaltung – www.geodaten.bayern.de, CC BY 4.0`

  CC BY 4.0 also asks us to link the licence (https://creativecommons.org/licenses/by/4.0/) and say the data was changed (we triangulate, crop and texture it).
- **Sun**: pvlib ModelChain with the engine's settings (PVWatts, 14% losses, 96% inverter) on the Munich PVGIS typical year (`engine/.cache/pvgis/48.137_11.575.csv`, else `engine/app/hourly/munich_tmy.csv`). Flat roofs are rated as 15 degree south racks. Results are memoised by pitch (1 degree) and azimuth (5 degrees) in `.cache/model/yield.json`.

## Limits
- DOP20 is an orthophoto, not a true orthophoto: tall roofs lean, so the photo can sit up to about 1 m off the roof edge.
- The engine can mount `model.app` routes or call `roof.model()` directly; `roof/` must be on `sys.path`.
