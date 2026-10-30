"""Write small glaciers, complexes and regions GeoParquet-shaped fixtures for the JavaScript tests.

Usage: python scripts/make_fixture_parquet.py OUT_DIR

The columns and types match the mirror's glaciers, complexes and regions tables, without geometry.
"""

import datetime as dt
import sys
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

BBOX = pa.struct([(n, pa.float64()) for n in ("xmin", "ymin", "xmax", "ymax")])
LINK = pa.struct(
    [
        ("rgi6_id", pa.string()),
        ("rgi7_reg", pa.string()),
        ("rgi6_reg", pa.string()),
        ("overlap_area_km2", pa.float64()),
        ("rgi7_area_fraction", pa.float64()),
        ("rgi6_area_fraction", pa.float64()),
        ("cluster_id", pa.int32()),
        ("n_rgi7", pa.int32()),
        ("n_rgi6", pa.int32()),
    ]
)

GLACIER_SCHEMA = pa.schema(
    [
        ("rgi_id", pa.string()),
        ("o1region", pa.string()),
        ("o2region", pa.string()),
        ("glims_id", pa.string()),
        ("anlys_id", pa.uint32()),
        ("subm_id", pa.uint16()),
        ("src_date", pa.timestamp("us")),
        ("cenlon", pa.float64()),
        ("cenlat", pa.float64()),
        ("utm_zone", pa.uint8()),
        ("area_km2", pa.float64()),
        ("primeclass", pa.uint8()),
        ("conn_lvl", pa.uint8()),
        ("surge_type", pa.uint8()),
        ("term_type", pa.uint8()),
        ("glac_name", pa.string()),
        ("is_rgi6", pa.bool_()),
        ("termlon", pa.float64()),
        ("termlat", pa.float64()),
        ("zmin_m", pa.float64()),
        ("zmax_m", pa.float64()),
        ("zmed_m", pa.float64()),
        ("zmean_m", pa.float64()),
        ("slope_deg", pa.float64()),
        ("aspect_deg", pa.float64()),
        ("aspect_sec", pa.uint8()),
        ("dem_source", pa.string()),
        ("lmax_m", pa.uint32()),
        ("display_name", pa.string()),
        ("complex_id", pa.string()),
        ("hypso_z0_m", pa.int32()),
        ("hypso_permille", pa.list_(pa.int16())),
        ("rgi6_links", pa.list_(LINK)),
        ("subm_n_outlines", pa.uint32()),
        ("subm_anlys_time", pa.timestamp("us")),
        ("subm_release_dt", pa.timestamp("us")),
        ("subm_proc_desc", pa.string()),
        ("subm_chief_affl", pa.string()),
        ("subm_submitters", pa.string()),
        ("subm_analysts", pa.string()),
        ("subm_rc_id", pa.uint16()),
        ("bbox", BBOX),
    ]
)

COMPLEX_SCHEMA = pa.schema(
    [
        ("rgi_id", pa.string()),
        ("o1region", pa.string()),
        ("o2region", pa.string()),
        ("cenlon", pa.float64()),
        ("cenlat", pa.float64()),
        ("utm_zone", pa.uint8()),
        ("area_km2", pa.float64()),
        ("glacier_ids", pa.list_(pa.string())),
        ("bbox", BBOX),
    ]
)

REGIONS_SCHEMA = pa.schema(
    [
        ("level", pa.uint8()),
        ("o1region", pa.string()),
        ("o2region", pa.string()),
        ("full_name", pa.string()),
        ("long_code", pa.string()),
        ("bbox", BBOX),
    ]
)

ALETSCH = {
    "rgi_id": "RGI2000-v7.0-G-11-02596",
    "o1region": "11",
    "o2region": "11-01",
    "glims_id": "G008032E46504N",
    "anlys_id": 753957,
    "subm_id": 731,
    "src_date": dt.datetime(2003, 8, 13, 0, 0),
    "cenlon": 7.972367555085556,
    "cenlat": 46.480362,
    "utm_zone": 32,
    "area_km2": 81.78146453981194,
    "primeclass": 0,
    "conn_lvl": 0,
    "surge_type": 0,
    "term_type": 9,
    "glac_name": "GROSSER ALETSCH GLETSCHER",
    "is_rgi6": False,
    "termlon": 8.024125568430303,
    "termlat": 46.39832730515637,
    "zmin_m": 1578.3491,
    "zmax_m": 4091.6558,
    "zmed_m": 3152.1602,
    "zmean_m": 3053.717,
    "slope_deg": 15.236502,
    "aspect_deg": 141.48456,
    "aspect_sec": 4,
    "dem_source": "COPDEM90",
    "lmax_m": 22911,
    "display_name": "Grosser Aletsch Gletscher",
    "complex_id": "RGI2000-v7.0-C-11-01323",
    "hypso_z0_m": 1625,
    "hypso_permille": [
        1, 1, 2, 3, 5, 4, 5, 5, 5, 13, 11, 14, 9, 15, 16, 17, 20, 18, 9, 12, 10,
        23, 35, 35, 22, 29, 31, 30, 28, 32, 38, 40, 46, 45, 42, 46, 50, 48, 44,
        41, 36, 23, 15, 11, 7, 4, 2, 1, 0, 1,
    ],
    "rgi6_links": [
        {
            "rgi6_id": "RGI60-11.01450",
            "rgi7_reg": "11",
            "rgi6_reg": "11",
            "overlap_area_km2": 81.60257297191961,
            "rgi7_area_fraction": 0.9978144599039205,
            "rgi6_area_fraction": 0.9926590228346783,
            "cluster_id": 81075,
            "n_rgi7": 2,
            "n_rgi6": 1,
        }
    ],
    "subm_n_outlines": 4034,
    "subm_anlys_time": dt.datetime(2021, 9, 1, 0, 0),
    "subm_release_dt": dt.datetime(2021, 10, 9, 9, 0),
    "subm_proc_desc": "Semi-automated glacier classification; The outlines are derived from 11 Landsat scenes acquired in 2003.",
    "subm_chief_affl": "University of Zurich-Irchel",
    "subm_submitters": "Paul, Frank",
    "subm_analysts": "Frey, Holger; Le Bris, Raymond; Paul, Frank; Rastner, Philipp",
    "subm_rc_id": 30,
    "bbox": {"xmin": 7.931361, "ymin": 46.397437, "xmax": 8.087402, "ymax": 46.563295},
}


def link(rgi6_id, reg, n):
    return {
        "rgi6_id": rgi6_id,
        "rgi7_reg": reg,
        "rgi6_reg": reg,
        "overlap_area_km2": 0.4 * n,
        "rgi7_area_fraction": 0.9,
        "rgi6_area_fraction": 0.8,
        "cluster_id": 1000 + n,
        "n_rgi7": 1,
        "n_rgi6": 1,
    }


def variant(n, **changes):
    row = dict(ALETSCH)
    reg = changes.pop("reg", "11")
    row.update(
        rgi_id=f"RGI2000-v7.0-G-{reg}-{n:05d}",
        o1region=reg,
        o2region=f"{reg}-01",
        glims_id=f"G00{n}000E46000N",
        cenlon=8.0 + n / 10,
        cenlat=46.0 + n / 10,
        area_km2=0.5 * n,
        glac_name=None,
        display_name=None,
        hypso_z0_m=2000 + 50 * n,
        hypso_permille=[2] * 50,
        rgi6_links=[link(f"RGI60-{reg}.{n:05d}", reg, n)],
        complex_id=f"RGI2000-v7.0-C-{reg}-{n:05d}",
        bbox={"xmin": 8.0 + n / 10, "ymin": 46.0 + n / 10, "xmax": 8.01 + n / 10, "ymax": 46.01 + n / 10},
    )
    row.update(changes)
    return row


def glacier_rows():
    return [
        ALETSCH,
        variant(1, glac_name="MORTERATSCH", display_name="Morteratsch"),
        variant(2, reg="03", glac_name="ATHABASCA GLACIER", display_name="Athabasca Glacier"),
        variant(
            3,
            complex_id=ALETSCH["complex_id"],
            rgi6_links=[link("RGI60-11.00003", "11", 3), link("RGI60-11.00004", "11", 4)],
        ),
        variant(4),
    ]


def complex_rows():
    """One complex per complex_id, sorted by ID: Aletsch's complex also holds glacier 3."""
    members = {}
    for glacier in glacier_rows():
        members.setdefault(glacier["complex_id"], []).append(glacier)
    rows = []
    for complex_id in sorted(members):
        glaciers = sorted(members[complex_id], key=lambda g: g["rgi_id"])
        first = glaciers[0]
        bbox = first["bbox"]
        if complex_id == ALETSCH["complex_id"]:
            bbox = {"xmin": 7.931361, "ymin": 46.397437, "xmax": 8.31, "ymax": 46.61}
        rows.append(
            {
                "rgi_id": complex_id,
                "o1region": first["o1region"],
                "o2region": first["o2region"],
                "cenlon": first["cenlon"],
                "cenlat": first["cenlat"],
                "utm_zone": first["utm_zone"],
                "area_km2": sum(g["area_km2"] for g in glaciers),
                "glacier_ids": [g["rgi_id"] for g in glaciers],
                "bbox": bbox,
            }
        )
    return rows


def regions_rows():
    box = lambda x0, y0, x1, y1: {"xmin": x0, "ymin": y0, "xmax": x1, "ymax": y1}
    return [
        {"level": 1, "o1region": "10", "o2region": None, "full_name": "North Asia", "long_code": "10_north_asia", "bbox": box(-180.0, 31.0, 180.0, 78.0)},
        {"level": 1, "o1region": "11", "o2region": None, "full_name": "Central Europe", "long_code": "11_central_europe", "bbox": box(-1.5, 41.0, 20.0, 48.5)},
        {"level": 2, "o1region": "11", "o2region": "11-01", "full_name": "Central Europe", "long_code": "11-01_central_europe", "bbox": box(5.9, 45.5, 10.6, 47.6)},
    ]


def write(path, rows, schema, **options):
    columns = {f.name: [row[f.name] for row in rows] for f in schema}
    pq.write_table(pa.table(columns, schema=schema), path, compression="zstd", **options)


def main(out_dir):
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    write(out / "glaciers.parquet", glacier_rows(), GLACIER_SCHEMA, row_group_size=2)
    write(out / "complexes.parquet", complex_rows(), COMPLEX_SCHEMA, row_group_size=2)
    write(out / "regions.parquet", regions_rows(), REGIONS_SCHEMA)


if __name__ == "__main__":
    main(sys.argv[1])
