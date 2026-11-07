"""Fill the shading cache: uv run python scripts/warm_shading.py "Katharinenstraße 5, 82008 Unterhaching" [more addresses]"""
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app import shading  # noqa: E402

for a in sys.argv[1:] or ["Katharinenstraße 5, 82008 Unterhaching"]:
    t = time.time()
    d = shading.compute(a)
    r = shading.result(d, shading.chosen_counts(a, None))
    print(f"{a}: {time.time() - t:.1f} s, {r['total']['modules']} modules, shading {r['total']['shade_share']:.1%}, "
          f"{r['total']['loss_kwh_year']} kWh a year loss ({d['surface']})")
    for p in r["planes"]:
        print(f"  {p['id']}: {p['modules']} modules, {p['shade_share']:.1%}, {p['loss_kwh_year']} kWh, edges {p['edges_m']}")
    shares = sorted((m["annual_share"], m["plane_id"], m["index"]) for m in r["modules"])
    print("  lowest:", shares[:5], "highest:", shares[-3:])
