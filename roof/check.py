"""Run five Munich-area houses through every source and print one line each."""
import time

from roof import SOURCES, lookup

ADDRESSES = [
    "Wilhelm-Keim-Straße 4a, 82031 Grünwald",
    "Neufeldstraße 6, 81243 München",          # Pasing
    "Evereststraße 68, 81825 München",         # Trudering
    "Katharinenstraße 5, 82008 Unterhaching",
    "Fliederstraße 81, 82110 Germering",
]

for a in ADDRESSES:
    print(a)
    for src in SOURCES:
        t = time.time()
        r = lookup(a, src)
        ms = (time.time() - t) * 1000
        if r.source == "none":
            print(f"  {src:13} -- {r.notes[-1]}  ({ms:.0f} ms)")
            continue
        segs = ", ".join(f"{s.area_m2:.0f}m2@{s.pitch:.0f}/{s.azimuth if s.azimuth is not None else ('flat' if s.pitch < 5 else '?')}"
                         for s in r.segments[:6])
        print(f"  {src:13} foot {r.footprint_m2} roof {r.roof_area_m2} usable {r.usable_area_m2} "
              f"panels {r.max_panels} [{r.confidence}] floor {r.floor_area_m2} m2 x{r.storeys} [{r.floor_area_confidence}] {r.dwellings_class} built {r.build_year_class} ~{r.build_year_estimate} heat {r.heating_class} {segs}  ({ms:.0f} ms)")
