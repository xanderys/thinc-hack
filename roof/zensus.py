"""Zensus 2022 100 m cell lookup: building age class and heating type for a coordinate.

Source: Statistisches Bundesamt, Zensus 2022, "Gebaeude nach Baujahr in Mikrozensus-Klassen" and
"Gebaeude mit Wohnraum nach ueberwiegender Heizungsart" in Gitterzellen (CSV in zip, 100 m cells,
INSPIRE ids CRS3035RES100mN<northing>E<easting> in EPSG:3035, lower-left corner).
`python zensus.py build` downloads both (about 40 MB) into .cache/zensus/ and indexes the Munich
region into .cache/zensus/munich.sqlite. `lookup(lat, lon)` then takes under 5 ms.
"""
from __future__ import annotations

import csv, sqlite3, sys, zipfile
from pathlib import Path

import httpx
from pyproj import Transformer

HERE = Path(__file__).parent
DIR = HERE / ".cache" / "zensus"
DB = DIR / "munich.sqlite"
BASE = "https://www.destatis.de/static/DE/zensus/" + "gitter" + "daten/"
FILES = {"age": "Gebaeude_nach_Baujahr_in_Mikrozensus_Klassen",
         "heat": "Gebaeude_mit_Wohnraum_nach_ueberwiegender_Heizungsart"}
BBOX = (47.8, 11.0, 48.5, 12.1)   # lat0, lon0, lat1, lon1: Munich and its ring of suburbs
TO_LAEA = Transformer.from_crs(4326, 3035, always_xy=True)

AGE = [("Vor1919", "before 1919", 1905), ("a1919bis1948", "1919 to 1948", 1934),
       ("a1949bis1978", "1949 to 1978", 1964), ("a1979bis1990", "1979 to 1990", 1985),
       ("a1991bis2000", "1991 to 2000", 1996), ("a2001bis2010", "2001 to 2010", 2006),
       ("a2011bis2019", "2011 to 2019", 2015), ("a2020undspaeter", "2020 or later", 2021)]
HEAT = [("Fernheizung", "district heating"), ("Etagenheizung", "floor heating (one per flat)"),
        ("Blockheizung", "block heating"), ("Zentralheizung", "central heating"),
        ("Einzel_Mehrraumoefen", "single-room stoves"), ("keine_Heizung", "no heating")]
LABEL = "estimated from address (Zensus 2022, 100 m cell)"


def _num(v: str) -> int:
    return int(v) if v.strip().isdigit() else 0   # "–" means none


def _csv_path(kind: str) -> Path:
    name = FILES[kind]
    z = DIR / "raw" / f"{name}.zip"
    out = DIR / "raw" / name
    if not out.exists():
        if not z.exists():
            z.parent.mkdir(parents=True, exist_ok=True)
            with httpx.stream("GET", BASE + name + ".zip", headers={"User-Agent": "Mozilla/5.0"},
                              follow_redirects=True, timeout=300) as r:
                r.raise_for_status()
                with open(z, "wb") as f:
                    for c in r.iter_bytes(1 << 20):
                        f.write(c)
        zipfile.ZipFile(z).extractall(out)
    return next(out.rglob("*100m*.csv"))


def build() -> None:
    (e0, n0), (e1, n1) = [TO_LAEA.transform(lo, la) for la, lo in (BBOX[:2], BBOX[2:])]
    DB.unlink(missing_ok=True)
    con = sqlite3.connect(DB)
    con.execute("create table age (e int, n int, " + ",".join(f"{k} int" for k, _, _ in AGE) + ", primary key (e, n))")
    con.execute("create table heat (e int, n int, " + ",".join(f"{k} int" for k, _ in HEAT) + ", primary key (e, n))")
    for kind, cols in (("age", [k for k, _, _ in AGE]), ("heat", [k for k, _ in HEAT])):
        rows = []
        with open(_csv_path(kind), encoding="utf-8-sig") as f:
            for row in csv.DictReader(f, delimiter=";"):
                x, y = int(row["x_mp_100m"]), int(row["y_mp_100m"])
                if e0 <= x <= e1 and n0 <= y <= n1:
                    rows.append((x // 100 * 100, y // 100 * 100, *[_num(row[c]) for c in cols]))
        con.executemany(f"insert into {kind} values ({','.join('?' * (2 + len(cols)))})", rows)
        print(kind, len(rows), "cells")
    con.commit(); con.close()


def _sum(con, table: str, cols: list[str], e: int, n: int, ring: int) -> list[int]:
    q = f"select {','.join(f'coalesce(sum({c}),0)' for c in cols)} from {table} " \
        f"where e between ? and ? and n between ? and ?"
    return list(con.execute(q, (e - 100 * ring, e + 100 * ring, n - 100 * ring, n + 100 * ring)).fetchone())


def lookup(lat: float, lon: float) -> dict | None:
    """Modal building age class and dominant heating type of the 100 m cell, or None when not available."""
    if not DB.exists() or not (BBOX[0] <= lat <= BBOX[2] and BBOX[1] <= lon <= BBOX[3]):
        return None
    x, y = TO_LAEA.transform(lon, lat)
    e, n = int(x // 100) * 100, int(y // 100) * 100
    con = sqlite3.connect(f"file:{DB}?mode=ro", uri=True)
    try:
        out: dict = {"zensus_confidence": LABEL}
        for ring in (0, 1):   # own cell first, then the 3 x 3 block when the cell has no counts
            a = _sum(con, "age", [k for k, _, _ in AGE], e, n, ring)
            h = _sum(con, "heat", [k for k, _ in HEAT], e, n, ring)
            if sum(a) or sum(h):
                break
        else:
            return None
        if sum(a):
            i = max(range(len(a)), key=a.__getitem__)
            out.update(build_year_class=AGE[i][1], build_year_estimate=AGE[i][2])
        if sum(h):
            out["heating_class"] = HEAT[max(range(len(h)), key=h.__getitem__)][1]
        if ring:
            out["zensus_confidence"] = LABEL.replace("100 m cell", "3 x 3 block of 100 m cells")
        return out
    finally:
        con.close()


if __name__ == "__main__":
    if sys.argv[1:] == ["build"]:
        build()
    else:
        print(lookup(float(sys.argv[1]), float(sys.argv[2])))
