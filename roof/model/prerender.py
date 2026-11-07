"""Build and preview the hero and the four other check.py houses. Run from roof/: uv run python -m model.prerender"""
import time

import roof as R
from model import model, preview

HERO = "Katharinenstraße 5, 82008 Unterhaching"
ADDRESSES = [HERO, "Wilhelm-Keim-Straße 4a, 82031 Grünwald", "Neufeldstraße 6, 81243 München",
             "Evereststraße 68, 81825 München", "Fliederstraße 81, 82110 Germering"]

for a in ADDRESSES:
    t = time.time()
    r = model(a)
    m = r["model"]
    png = preview.render(r["glb_path"], r["planes_json_path"], str(R.CACHE / "model" / "previews" / f"{r['key']}.png"))
    tp = [p for p in m["planes"] if p["is_target"]]
    print(f"{a}: {m['triangles']} tris, {len(tp)} target planes, {m['context_buildings']} neighbours, "
          f"textured {m['textured']}, layout {m['layout']['kwp']} kWp {m['layout']['kwh_per_year']} kWh, "
          f"{time.time() - t:.1f} s\n  {r['glb_path']}\n  {png}")
