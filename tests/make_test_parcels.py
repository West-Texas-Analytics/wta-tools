"""Write made-up parcel files for the Parcel Stacks test (no real district data).

    python make_test_parcels.py OUT_DIR

Writes caprock.zip (shapefile + .prj), caprock_noprj.zip (no .prj), caprock.geojson,
caprock.gpkg and fgdb.zip (a file geodatabase the page should turn away), all for a
made-up "Caprock CAD" in Texas Central State Plane feet (EPSG:2277).

Planted stacks (6 stacks, 32 rows), same as the wta-stacks Python tests:
  R1/R2   same owner, same legal              -> Duplicate account (exact)
  R3/R4   same legal, different owners; R4 starts at another corner
          (and runs the other way in GeoJSON/GeoPackage) -> Same legal, different owners
  R5/R6   different legals, R6 nudged 0.004 ft -> Different legals on one shape
  R8/R9   two-part shape, parts in the other order, state code G1 -> Mineral interests
  R10/R11 shape with a hole, no owner or legal -> Blank owner and legal
  D1..D22 22 rows on one shape                  -> Catch-all shape
  R12/R13 0.5 ft apart                          -> not a stack
plus 30 single parcels as ground.
"""
import json, sqlite3, struct, sys, zipfile
from pathlib import Path

X0, Y0 = 2_300_000.0, 10_400_000.0
FIELDS = [("PROP_ID", "C", 12), ("GEO_ID", "C", 20), ("OWNER_NAME", "C", 40), ("LEGAL_DESC", "C", 40),
          ("STATE_CD", "C", 4), ("LEGAL_ACRE", "N", 12, 3), ("MKT_VALUE", "N", 12, 0)]
PRJ = ('PROJCS["NAD_1983_StatePlane_Texas_Central_FIPS_4203_Feet",GEOGCS["GCS_North_American_1983",'
       'DATUM["D_North_American_1983",SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],'
       'UNIT["Degree",0.0174532925199433]],PROJECTION["Lambert_Conformal_Conic"],PARAMETER["False_Easting",2296583.333333333],'
       'PARAMETER["False_Northing",9842499.999999998],PARAMETER["Central_Meridian",-100.3333333333333],'
       'PARAMETER["Standard_Parallel_1",30.11666666666667],PARAMETER["Standard_Parallel_2",31.88333333333333],'
       'PARAMETER["Latitude_Of_Origin",29.66666666666667],UNIT["Foot_US",0.3048006096012192]]')


def sq(x, y, s=300.0):
    """Clockwise square (shapefile outer-ring order), closed."""
    return [(x, y), (x, y + s), (x + s, y + s), (x + s, y), (x, y)]


def parcels():
    rows = []
    def add(pid, parts, owner, legal, code="A1", acres=2.066, value=50_000, alt=None):
        rows.append(dict(PROP_ID=pid, GEO_ID=f"0100-{pid}", OWNER_NAME=owner, LEGAL_DESC=legal, STATE_CD=code,
                         LEGAL_ACRE=acres, MKT_VALUE=value, parts=parts, alt=alt or parts))
    for i in range(30):   # ground
        add(f"G{i+1}", [[sq(X0 + (i % 6) * 400, Y0 + (i // 6) * 400)]], f"OWNER {i+1}", f"BLK {i+1} LOT 1", value=20_000 + i * 1000)
    a = sq(X0, Y0 + 3000)
    add("R1", [[a]], "SMITH JOHN", "BLK 40 LOT 1")
    add("R2", [[a]], "SMITH JOHN", "BLK 40 LOT 1")
    b = sq(X0 + 400, Y0 + 3000)
    add("R3", [[b]], "JONES MARY", "BLK 41 LOT 2")
    b2 = b[2:-1] + b[:2] + [b[2]]                     # same ring, starts at another corner
    add("R4", [[b2]], "JONES PAUL", "BLK 41 LOT 2", alt=[[list(reversed(b2))]])
    c = sq(X0 + 800, Y0 + 3000)
    add("R5", [[c]], "BROWN AL", "BLK 42 LOT 3")
    add("R6", [[[(x + 0.004, y) for x, y in c]]], "BROWN AL", "BLK 42 LOT 3A")
    p1, p2 = sq(X0 + 1200, Y0 + 3000, 200), sq(X0 + 1500, Y0 + 3000, 200)
    add("R8", [[p1], [p2]], "OIL CO", "ABST 9 SEC 1", code="G1")
    add("R9", [[p2], [p1]], "MINERAL LLC", "ABST 9 SEC 1", code="G1")
    outer, hole = sq(X0 + 1800, Y0 + 3000, 400), list(reversed(sq(X0 + 1900, Y0 + 3100, 100)))
    add("R10", [[outer, hole]], "", "")
    add("R11", [[outer, hole]], "", "")
    d = sq(X0 + 2400, Y0 + 3000, 600)
    for k in range(22):
        add(f"D{k+1}", [[d]], f"UNMAPPED {k+1}", f"TRACT {k+1}", value=1000 * (k + 1))
    e = sq(X0, Y0 + 3600)
    add("R12", [[e]], "NEAR ONE", "BLK 50 LOT 1")
    add("R13", [[[(x + 0.5, y) for x, y in e]]], "NEAR TWO", "BLK 50 LOT 1")
    return rows


def shp_bytes(rows):
    recs, shx = [], []
    off = 50
    allpts = [p for r in rows for poly in r["parts"] for ring in poly for p in ring]
    bbox = (min(p[0] for p in allpts), min(p[1] for p in allpts), max(p[0] for p in allpts), max(p[1] for p in allpts))
    for i, r in enumerate(rows):
        rings = [ring for poly in r["parts"] for ring in poly]
        pts = [p for ring in rings for p in ring]
        parts, n = [], 0
        for ring in rings:
            parts.append(n); n += len(ring)
        xs, ys = [p[0] for p in pts], [p[1] for p in pts]
        body = struct.pack("<i4d2i", 5, min(xs), min(ys), max(xs), max(ys), len(rings), len(pts))
        body += struct.pack(f"<{len(parts)}i", *parts) + b"".join(struct.pack("<2d", *p) for p in pts)
        recs.append(struct.pack(">2i", i + 1, len(body) // 2) + body)
        shx.append(struct.pack(">2i", off, len(body) // 2)); off += 4 + len(body) // 2
    def header(length_words):
        return struct.pack(">7i", 9994, 0, 0, 0, 0, 0, length_words) + struct.pack("<2i4d4d", 1000, 5, *bbox, 0, 0, 0, 0)
    shp = b"".join(recs)
    return header(50 + len(shp) // 2) + shp, header(50 + 4 * len(rows)) + b"".join(shx)


def dbf_bytes(rows):
    rec_len = 1 + sum(f[2] for f in FIELDS)
    head = struct.pack("<4BIHH20x", 3, 126, 11, 6, len(rows), 32 + 32 * len(FIELDS) + 1, rec_len)
    head = head[:29] + bytes([0x57]) + head[30:]
    for f in FIELDS:
        head += struct.pack("<11sc4xBB14x", f[0].encode(), f[1].encode(), f[2], f[3] if len(f) > 3 else 0)
    head += b"\r"
    body = b""
    for r in rows:
        body += b" "
        for f in FIELDS:
            v = r[f[0]]
            if f[1] == "N":
                s = (f"{v:.{f[3]}f}" if v is not None else "").rjust(f[2])
            else:
                s = str(v or "").ljust(f[2])
            body += s.encode("cp1252")[: f[2]]
    return head + body + b"\x1a"


def wkb(parts):
    def ring(r):
        return struct.pack("<I", len(r)) + b"".join(struct.pack("<2d", *p) for p in r)
    def poly(p):
        return struct.pack("<BII", 1, 3, len(p)) + b"".join(ring(r) for r in p)
    return struct.pack("<BII", 1, 6, len(parts)) + b"".join(poly(p) for p in parts)


def write_all(out: Path):
    out.mkdir(parents=True, exist_ok=True)
    rows = parcels()
    shp, shx = shp_bytes(rows)
    dbf = dbf_bytes(rows)
    with zipfile.ZipFile(out / "caprock.zip", "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("caprock/caprock_parcels.shp", shp); z.writestr("caprock/caprock_parcels.shx", shx)
        z.writestr("caprock/caprock_parcels.dbf", dbf); z.writestr("caprock/caprock_parcels.prj", PRJ)
        z.writestr("caprock/caprock_parcels.cpg", "1252")
    with zipfile.ZipFile(out / "caprock_noprj.zip", "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("caprock_parcels.shp", shp); z.writestr("caprock_parcels.shx", shx); z.writestr("caprock_parcels.dbf", dbf)
    with zipfile.ZipFile(out / "fgdb.zip", "w") as z:
        z.writestr("caprock.gdb/a00000001.gdbtable", b"\0" * 40)
    props = [f[0] for f in FIELDS]
    feats = [{"type": "Feature", "properties": {k: (r[k] if r[k] != "" else None) for k in props},
              "geometry": {"type": "MultiPolygon", "coordinates": [[[list(p) for p in ring] for ring in poly] for poly in r["alt"]]}}
             for r in rows]
    (out / "caprock.geojson").write_text(json.dumps({"type": "FeatureCollection", "name": "caprock_parcels",
        "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:EPSG::2277"}}, "features": feats}))
    gp = out / "caprock.gpkg"
    gp.unlink(missing_ok=True)
    db = sqlite3.connect(gp)
    db.executescript("""
      CREATE TABLE gpkg_spatial_ref_sys (srs_name TEXT, srs_id INTEGER PRIMARY KEY, organization TEXT, organization_coordsys_id INTEGER, definition TEXT, description TEXT);
      CREATE TABLE gpkg_contents (table_name TEXT PRIMARY KEY, data_type TEXT, identifier TEXT, description TEXT, last_change TEXT, min_x REAL, min_y REAL, max_x REAL, max_y REAL, srs_id INTEGER);
      CREATE TABLE gpkg_geometry_columns (table_name TEXT, column_name TEXT, geometry_type_name TEXT, srs_id INTEGER, z TINYINT, m TINYINT);
      CREATE TABLE caprock_parcels (fid INTEGER PRIMARY KEY AUTOINCREMENT, geom BLOB, PROP_ID TEXT, GEO_ID TEXT, OWNER_NAME TEXT, LEGAL_DESC TEXT, STATE_CD TEXT, LEGAL_ACRE REAL, MKT_VALUE INTEGER);
      CREATE TABLE school_points (fid INTEGER PRIMARY KEY, geom BLOB, NAME TEXT);
    """)
    db.execute("INSERT INTO gpkg_spatial_ref_sys VALUES ('NAD83 / Texas Central (ftUS)', 2277, 'EPSG', 2277, 'undefined', '')")
    db.execute("INSERT INTO gpkg_contents VALUES ('caprock_parcels','features','caprock_parcels','','2026-11-06',0,0,0,0,2277)")
    db.execute("INSERT INTO gpkg_contents VALUES ('school_points','features','school_points','','2026-11-06',0,0,0,0,2277)")
    db.execute("INSERT INTO gpkg_geometry_columns VALUES ('caprock_parcels','geom','MULTIPOLYGON',2277,0,0)")
    db.execute("INSERT INTO gpkg_geometry_columns VALUES ('school_points','geom','POINT',2277,0,0)")
    for r in rows:
        blob = b"GP" + bytes([0, 1]) + struct.pack("<i", 2277) + wkb(r["alt"])
        db.execute("INSERT INTO caprock_parcels (geom, PROP_ID, GEO_ID, OWNER_NAME, LEGAL_DESC, STATE_CD, LEGAL_ACRE, MKT_VALUE) VALUES (?,?,?,?,?,?,?,?)",
                   (blob, r["PROP_ID"], r["GEO_ID"], r["OWNER_NAME"] or None, r["LEGAL_DESC"] or None, r["STATE_CD"], r["LEGAL_ACRE"], r["MKT_VALUE"]))
    db.commit(); db.close()
    return len(rows)


if __name__ == "__main__":
    print(write_all(Path(sys.argv[1])), "rows")
