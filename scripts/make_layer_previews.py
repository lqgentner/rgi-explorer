"""Write js/previews.js: the layer previews' SVG paths, cut from the RGI data.

Each preview is a 48 px square of Web Mercator around a fixed place, so the
layer panel shows real outlines instead of drawings. The script needs
geopandas, which this repository's environment does not hold. Run it from the
rgi-catalog checkout's environment, with that checkout's staging directory:

    pixi run -m ../rgi-catalog python scripts/make_layer_previews.py \
        ../rgi-catalog/staging/v7.0 js/previews.js
"""

import json
import math
import re
import sys
from pathlib import Path

import geopandas as gpd
import numpy as np
from shapely import box, clip_by_rect, transform

SIZE = 48
# The smallest change in pixels that the paths keep.
TOLERANCE = 0.5

# A preview's place: its center as lon and lat, and its width in degrees.
REGIONS = ((82.0, 36.0), 34.0)  # Where High Mountain Asia's regions meet.
ALETSCH = ((8.03, 46.49), 0.1)


def mercator(lon, lat):
    """Web Mercator in units of the world's width."""
    y = math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))
    return lon / 360, y / (2 * math.pi)


def window(place):
    """The lon/lat bbox to read and a function that maps a geometry to pixels."""
    (lon, lat), width = place
    cx, cy = mercator(lon, lat)
    half = width / 360 / 2
    scale = SIZE / (2 * half)

    def to_pixels(geometry):
        def project(lonlat):
            mx = lonlat[:, 0] / 360
            my = np.log(np.tan(np.pi / 4 + np.radians(lonlat[:, 1]) / 2)) / (2 * np.pi)
            return np.column_stack(((mx - cx + half) * scale, (cy + half - my) * scale))

        return clip_by_rect(transform(geometry, project), -1, -1, SIZE + 1, SIZE + 1)

    north = math.degrees(math.atan(math.sinh((cy + half) * 2 * math.pi)))
    south = math.degrees(math.atan(math.sinh((cy - half) * 2 * math.pi)))
    return (lon - width / 2, south, lon + width / 2, north), to_pixels


def path(geometries):
    """One SVG path for lines and polygon boundaries, rounded to 0.1 px."""
    parts = []

    def line(coords, close):
        points = [f"{x:.1f} {y:.1f}" for x, y in coords]
        if len(points) > 1:
            parts.append("M" + "L".join(points) + ("Z" if close else ""))

    def walk(geometry):
        geometry = geometry.simplify(TOLERANCE)
        kind = geometry.geom_type
        if kind == "Polygon":
            line(geometry.exterior.coords[:-1], True)
            for ring in geometry.interiors:
                line(ring.coords[:-1], True)
        elif kind == "LineString":
            line(geometry.coords, False)
        elif kind.startswith("Multi") or kind == "GeometryCollection":
            for part in geometry.geoms:
                walk(part)

    for geometry in geometries:
        if geometry is not None and not geometry.is_empty:
            walk(geometry)
    return re.sub(r"\.0(?!\d)", "", "".join(parts))


def read(directory, name, bbox, columns=()):
    """The rows of one collection's GeoParquet file inside a lon/lat bbox."""
    file = directory / name / f"rgi7.0-{name}.parquet"
    frame = gpd.read_parquet(file, columns=[*columns, "geometry"], bbox=bbox)
    return frame[frame.intersects(box(*bbox))]


def main(directory, out):
    """Write the previews module."""
    directory = Path(directory)
    previews = {}

    bbox, pixels = window(REGIONS)
    regions = read(directory, "regions", bbox, ["level"])
    previews["regions"] = {
        f"region{level}": path(pixels(g.boundary) for g in regions[regions.level == level].geometry)
        for level in (2, 1)
    }

    bbox, pixels = window(ALETSCH)
    glaciers = path(pixels(g) for g in read(directory, "glaciers", bbox).geometry)
    lines = read(directory, "centerlines", bbox, ["is_main"])
    previews["centerlines"] = {
        "centerline": path(pixels(g) for g in lines[~lines.is_main].geometry),
        "centerlineMain": path(pixels(g) for g in lines[lines.is_main].geometry),
    }
    divides = read(directory, "intersects", bbox)
    previews["intersects"] = {"divide": path(pixels(g) for g in divides.geometry)}

    body = json.dumps(previews, indent=2)
    Path(out).write_text(
        "/*\n"
        " * SVG paths for the layer previews, in a 48 px square. Generated from the RGI\n"
        " * data by scripts/make_layer_previews.py; do not edit by hand.\n"
        " */\n\n"
        "/** The glacier outlines under the centerlines and ice divides previews. */\n"
        f"export const GLACIERS = {json.dumps(glaciers)};\n\n"
        f"export const PREVIEWS = {body};\n"
    )


if __name__ == "__main__":
    main(*sys.argv[1:3])
