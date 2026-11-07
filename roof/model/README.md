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
- Shade, per target plane: `shade` (`{"1": [24 fractions], ..., "12": [...]}`, the 15th of each month, local clock hours, null at night), `shade_loss_share` (share of the year's plane irradiance lost; beam blocked, diffuse kept), `yield_shaded_kwh_per_kwp`, `sun_shaded`, `shade_reason` (e.g. "shaded by trees to the south-west after 13:00 all year"). `shade_source` at the top says whether trees were modelled.
- `envelope`: faces (`roofN`, `wall_<dir>`, `window_<dir>`, `floor`) with `area_m2`, `u_value`, `source`, `loss_w`; `thermal_bridges_w`, `ventilation_w`, `design_heat_load_kw`, `annual_heat_demand_kwh` and its source, `build_year`, `build_year_source` (`lead` | `zensus` | `default` 1975), `typology`. Pass the lead's year as `build_year` (Python argument or query parameter).
- `street`: null, with `street_note` saying why (see below).
- `lay_out(planes, kwp)`: fills target planes in order of shaded yield until kwp is reached; planes whose shaded yield is under 0.6 of the best Munich plane are skipped, each with `skipped` giving the reason (north face, or the shade reason and the share lost). `kwp=None` fills every usable plane. Modules are 450 W, 1.134 x 1.762 m portrait, 30 cm from every edge, eaves row first; flat roofs follow the longest edge.

## Sources and licences
- **Geometry**: Bayern LoD2 CityGML, `https://download1.bayernwolke.de/a/lod2/citygml/{E_km}_{N_km}.gml`. Each tile is parsed once into `.cache/model/tiles/<tile>.geom.json.gz` (1 to 3 MB) and the GML deleted.
- **Texture**: DOP20 colour orthophoto, WMS `https://geoservices.bayern.de/od/wms/dop/v1/dop20`, layer `by_dop20c`, EPSG:25832, one 1,024 px JPEG per address over 80 x 80 m, cached in `.cache/model/ortho/`. If the WMS cannot be reached the model is exported untextured with `textured: false` and the next call retries.
- **Licence**: both are CC BY 4.0 (the WMS capabilities state `AccessConstraints: CC BY 4.0`, `Fees: kostenfrei`; terms at https://www.geodaten.bayern.de/odd/m/3/html/nutzungsbedingungen.html). Attribution line, shown wherever the model is shown:

  `Bayerische Vermessungsverwaltung – www.geodaten.bayern.de, CC BY 4.0`

  CC BY 4.0 also asks us to link the licence (https://creativecommons.org/licenses/by/4.0/) and say the data was changed (we triangulate, crop and texture it).
- **Sun**: pvlib ModelChain with the engine's settings (PVWatts, 14% losses, 96% inverter) on the Munich PVGIS typical year (`engine/.cache/pvgis/48.137_11.575.csv`, else `engine/app/hourly/munich_tmy.csv`). Flat roofs are rated as 15 degree south racks. Results are memoised by pitch (1 degree) and azimuth (5 degrees) in `.cache/model/yield.json`.

- **Shade**: DOM20, Digitales Oberflächenmodell 20 cm (LDBV; trees and buildings), 1 km GeoTIFF tiles at `https://download1.bayernwolke.de/a/dom20/DOM/32{E_km}_{N_km}_20_DOM.tif` (EPSG:25832, 30 to 50 MB each). We read only a 150 x 150 m window per address over HTTP range requests (rasterio), max-pool it to 40 cm and cache it in `.cache/model/dom/<key>.npz`. Licence CC BY 4.0, same attribution line (product list `https://geodaten.bayern.de/opengeodata/json/opengeodata_produkte.json`, entry `dom20`). Rays leave up to 48 points per plane, 30 cm above the roof, every 40 cm toward the sun (pvlib solar position, Munich) for 150 m; the target's own footprint is removed from the DOM so a plane never shades itself on DOM noise. Hits inside a LoD2 footprint count as buildings, the rest as trees. If DOM20 cannot be read, LoD2 neighbours alone cast shade and `shade_source` says "LoD2 neighbours only".
- **Envelope**: U-values from IWU, Deutsche Wohngebäudetypologie (Loga, Stein, Diefenbach, Born 2015), Anhang C.1 "Flächen und U-Werte der Beispielgebäude", Einfamilienhaus, Ist-Zustand, TABULA codes DE.N.SFH.01 to 12.Gen (roof, wall, floor, window, door, thermal bridge supplement), e.g. EFH_H 1984 to 1994: 0.40, 0.50, 0.60, 3.20, 3.00, 0.10 W/m2K. Heat load by the simplified DIN EN 12831 method: 20 C inside, -16 C Munich design, floor times 0.5 (TABULA b_tr), 0.5 air changes on 0.8 of the LoD2 volume, windows assumed 20% of each wall, walls shared with a neighbour excluded. Annual demand: (H_T + H_V) times heating degree hours below 15 C in the PVGIS typical year, minus 3 W/m2 internal gains; no solar gains.
- **Street proof**: not given. MaStR (Marktstammdatenregister, Bundesnetzagentur, Datenlizenz Deutschland Namensnennung 2.0, dl-de/by-2-0) answers without registration but hides street and house number for private units, so only a postcode count is possible (82008: 1,147 PV units, in `street_note`). A colour test on DOP20 flagged 2 of 84 roofs around the hero, both shadows, and missed every array visible in the photo, so it is not used.

## Limits
- DOP20 is an orthophoto, not a true orthophoto: tall roofs lean, so the photo can sit up to about 1 m off the roof edge.
- The envelope uses unrenovated typology U-values on the whole LoD2 solid: a renovated house, or one dwelling in a larger building, loses less.
- The engine can mount `model.app` routes or call `roof.model()` directly; `roof/` must be on `sys.path`.
