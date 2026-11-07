# roof

German street address in, roof area, roof planes and a panel count out.

## Run it
- `uv sync`
- `uv run python roof.py "Fliederstraße 81, 82110 Germering"` prints one result as JSON
- `uv run python check.py` runs five Munich-area houses through every source
- `uv run uvicorn app:app --port 8765`, then `GET /roof?address=...&source=bayern_lod2|google_solar|osm`

## Sources, best first
1. **Bavarian LoD2** (`bayern_lod2`, measured): open CityGML from the Bayerische Vermessungsverwaltung, every building in Bavaria with real roof planes. Tiles are 2 km x 2 km in EPSG:25832 at `https://download1.bayernwolke.de/a/lod2/citygml/{E_km}_{N_km}.gml` (even km, 3 to 160 MB). The first address in a tile downloads and indexes it (3 to 10 s), keeps a 1 to 3 MB index in `.cache/lod2/` and deletes the GML; after that a lookup takes under 100 ms. Pre-index the demo tiles before the pitch. Licence: CC BY 4.0, credit "Bayerische Vermessungsverwaltung".
2. **Google Solar API** (`google_solar`, measured): runs when `GOOGLE_SOLAR_API_KEY` is in the environment or `roof/.env`. Uses `buildingInsights:findClosest` at MEDIUM quality; `maxArrayAreaMeters2` sets the usable area.
3. **OpenStreetMap** (`osm`, footprint): Nominatim geocode (1 request per second), the building polygon from Nominatim or the OSM API map call, Overpass as a last resort. Roof = footprint / cos(pitch), pitch from `roof:angle` or `roof:shape`, else a 35 degree gable. OSM often maps a pair of semi-detached houses as one polygon, so treat it as an upper bound.

## Rules
- Modules: 450 W, 2 m2. Usable = 80% of non-north planes (azimuth 60 to 300, or flat) when measured; 70% of the roof, times 75% for unknown orientation, when only a footprint is known.
- Every external response is cached under `.cache/` (gitignored). A miss returns `source: "none"` with each source's own words in `notes`; the first note is always the matched address, so show it to the planner.

## Estimated from address
- `floor_area_m2`, `storeys`, `floor_area_confidence`: LoD2 footprint x storeys (`storeysAboveGround`, else measured height / 3 m, clamped to 1 to 3) x 0.72 (net-to-gross, changed from 0.8). Only on the `bayern_lod2` source.
- `build_year_class`, `build_year_estimate` (class midpoint), `heating_class`, `zensus_confidence`: Zensus 2022 100 m cell (Statistisches Bundesamt, buildings by age class in Mikrozensus classes, buildings by predominant heating type). The heating class is the system type (central, district, floor, stoves), not the fuel.
- One-off setup: `uv run python zensus.py build` downloads two zips (about 40 MB, 3 s) from `https://www.destatis.de/static/DE/zensus/gitterdaten/`: `Gebaeude_nach_Baujahr_in_Mikrozensus_Klassen.zip` and `Gebaeude_mit_Wohnraum_nach_ueberwiegender_Heizungsart.zip`, and indexes the Munich region (lat 47.8 to 48.5, lon 11.0 to 12.1) into `.cache/zensus/munich.sqlite`. Without it, or outside the region, the fields stay null and a note says so. Counts in the grid are perturbed by the statistics office, so the modal class of a cell is a hint. Cells with no counts fall back to their 3 x 3 block.
- Multi-unit fix: two more grids, `Durchschnittliche_Flaeche_je_Wohnung_in_Gitterzellen.zip` (average flat size, `avg_flat_m2`) and `Gebaeude_nach_Anzahl_der_Wohnungen_im_Gebaeude.zip` (`dwellings_class`, the modal class in the cell). When that class is 3 or more dwellings, or, only when the class is unknown, footprint x storeys exceeds 350 m2 (a "1 dwelling" or "2 dwellings" cell always keeps the building figure), `floor_area_m2` becomes the cell's average flat size with `floor_area_confidence` "estimated from address (Zensus average flat size)", and a note keeps the whole-building figure.
