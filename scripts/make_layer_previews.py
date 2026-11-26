"""Write js/previews.js: the layer previews' SVG paths, cut from the RGI data.

The centerlines and intersects previews share one 48 px square of Web Mercator
at the west margin of Hardangerjøkulen, where two outlet lobes meet the land:
the centerlines run down the lobes and the divides run between them. The
glaciers there are generalised as one coverage, so that an edge two glaciers
share stays shared, and the divides are those shared edges: they follow the
outlines and end at the ice edge.

The regions preview is Scandinavia squared: region 08 and its subregions,
stretched linearly in longitude and latitude to fill the square, with straight
lines and the glaciers as dots. js/layers.js fits the dashes to each line.

The script needs geopandas and shapely 2.1 or newer, which this repository's
environment does not hold. Run it from the rgi-catalog checkout's environment,
with that checkout's staging directory:

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
import pyarrow.parquet as pq
import shapely
from shapely import box, clip_by_rect

SIZE = 48

# A preview's place: its center as lon and lat, and its width in degrees.
# Two outlet lobes on the west margin of Hardangerjøkulen, about 2.85 km across.
MARGIN = ((7.358, 60.5222), 0.052)
# The generalisation, in pixels: the coverage's simplification tolerance and
# the rounds of corner cutting that smooth each edge.
SIMPLIFY = 1.0
SMOOTH = 2
# Glacier parts smaller than this, in square pixels, are left out.
MIN_PART = 4.0
# The glaciers are generalised in a square this much wider than the preview on
# each side, so that the cut at its edge stays out of view.
PAD = 8
# A glacier's lines show only when its main centerline runs this far in view.
MIN_MAIN = 12.0
# Shorter pieces of centerline are left out.
MIN_LINE = 2.5

SCANDINAVIA = "08"
# The squared region's distance from the preview's edge, in pixels.
INSET = 4
# The glacier dots: one per cell of this size, of this radius, in pixels.
DOT_CELL = 1.5


def mercator(lon, lat):
    """Web Mercator in units of the world's width."""
    y = math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))
    return lon / 360, y / (2 * math.pi)


def window(place):
    """The lon/lat bbox in view, that bbox with PAD around it, and a function that maps a geometry to pixels."""
    (lon, lat), width = place
    cx, cy = mercator(lon, lat)
    half = width / 360 / 2
    scale = SIZE / (2 * half)

    def project(lonlat):
        mx = lonlat[:, 0] / 360
        my = np.log(np.tan(np.pi / 4 + np.radians(lonlat[:, 1]) / 2)) / (2 * np.pi)
        return np.column_stack(((mx - cx + half) * scale, (cy + half - my) * scale))

    def to_pixels(geometry):
        return clip_by_rect(shapely.transform(geometry, project), -PAD, -PAD, SIZE + PAD, SIZE + PAD)

    def bbox(margin):
        reach = half * (1 + 2 * margin / SIZE)
        north = math.degrees(math.atan(math.sinh((cy + reach) * 2 * math.pi)))
        south = math.degrees(math.atan(math.sinh((cy - reach) * 2 * math.pi)))
        return (lon - reach * 360, south, lon + reach * 360, north)

    return bbox(0), bbox(PAD), to_pixels


def parts(geometry):
    """The single parts of a geometry."""
    if geometry.is_empty:
        return []
    return list(geometry.geoms) if hasattr(geometry, "geoms") else [geometry]


def path(geometries):
    """One SVG path for lines and polygon boundaries in view, rounded to 0.1 px."""
    out = []

    def line(coords, close):
        points = [f"{x:.1f} {y:.1f}" for x, y in coords]
        if len(points) > 1:
            out.append("M" + "L".join(points) + ("Z" if close else ""))

    for geometry in geometries:
        for part in parts(clip_by_rect(geometry, -1, -1, SIZE + 1, SIZE + 1)):
            if part.geom_type == "Polygon":
                line(part.exterior.coords[:-1], True)
                for ring in part.interiors:
                    line(ring.coords[:-1], True)
            elif part.geom_type == "LineString":
                line(part.coords, False)
    return re.sub(r"\.0(?!\d)", "", "".join(out))


def read(directory, name, bbox, columns=()):
    """The rows of one collection's GeoParquet file inside a lon/lat bbox."""
    file = directory / name / f"rgi7.0-{name}.parquet"
    frame = gpd.read_parquet(file, columns=[*columns, "geometry"], bbox=bbox)
    return frame[frame.intersects(box(*bbox))]


def smooth(line):
    """Chaikin's corner cutting, SMOOTH rounds; an open line keeps its ends, so neighbours meet."""
    coords = np.asarray(line.coords, dtype=float)
    closed = len(coords) > 3 and np.allclose(coords[0], coords[-1])
    points = coords[:-1] if closed else coords
    if len(points) < 3:
        return line
    for _ in range(SMOOTH):
        if closed:
            a, b = points, np.roll(points, -1, axis=0)
        else:
            a, b = points[:-1], points[1:]
        cut = np.empty((2 * len(a), 2))
        cut[0::2], cut[1::2] = 0.75 * a + 0.25 * b, 0.25 * a + 0.75 * b
        points = cut if closed else np.vstack([points[0], cut[1:-1], points[-1]])
    return shapely.LineString(np.vstack([points, points[:1]]) if closed else points)


def glacier_previews(directory):
    """The glacier outlines, divides and centerlines at MARGIN, generalised together."""
    bbox, padded, pixels = window(MARGIN)
    glaciers = read(directory, "glaciers", bbox, ["rgi_id"])
    pieces = [(rid, p) for rid, g in zip(glaciers.rgi_id, glaciers.geometry) for p in parts(pixels(g))]
    pieces = [(rid, p) for rid, p in pieces if p.geom_type == "Polygon" and p.area >= MIN_PART]
    coverage = np.array([p for _, p in pieces], dtype=object)
    if not shapely.coverage_is_valid(coverage):
        raise SystemExit("the glaciers in the preview overlap; coverage_simplify needs a valid coverage")
    simple = [(rid, g) for (rid, _), g in zip(pieces, shapely.coverage_simplify(coverage, SIMPLIFY)) if not g.is_empty]

    # The divides must be RGI intersects: every pair of glaciers that share an edge has a row.
    intersects = read(directory, "intersects", padded, ["rgi_g_id_1", "rgi_g_id_2"])
    pairs = {frozenset(p) for p in zip(intersects.rgi_g_id_1, intersects.rgi_g_id_2)}
    for i, (a, pa) in enumerate(pieces):
        for b, pb in pieces[i + 1 :]:
            if a != b and pa.boundary.intersection(pb.boundary).length > 0.5 and frozenset((a, b)) not in pairs:
                raise SystemExit(f"{a} and {b} share an edge without an intersect")

    # The edges between the coverage's nodes, each smoothed once, so that neighbours stay in step.
    rings = [shapely.LineString(r.coords) for _, g in simple for p in parts(g) for r in [p.exterior, *p.interiors]]
    edges = parts(shapely.line_merge(shapely.node(shapely.MultiLineString(rings))))
    bounds = [g.boundary for _, g in simple]
    tree = shapely.STRtree(bounds)
    smoothed, divides = [], []
    for edge in edges:
        middle = edge.interpolate(0.5, normalized=True)
        sides = [i for i in tree.query(middle.buffer(1e-6)) if bounds[i].distance(middle) < 1e-6]
        line = smooth(edge)
        smoothed.append(line)
        if len({simple[i][0] for i in sides}) >= 2:
            divides.append(line)
    ice = shapely.union_all([g for _, g in simple])
    faces = [f for f in parts(shapely.polygonize(smoothed)) if ice.contains(f.representative_point())]
    # Smoothing must not lose ice in view: edges that cross after it leave faces
    # out of polygonize. Corner cutting at the padded square's corners is out of view.
    def area_in_view(g):
        return clip_by_rect(g, 0, 0, SIZE, SIZE).area

    if abs(area_in_view(shapely.union_all(faces)) - area_in_view(ice)) > 0.02 * area_in_view(ice):
        raise SystemExit("the smoothed glacier outlines no longer close; lower SMOOTH or move MARGIN")
    ice = shapely.union_all(faces)

    lines = read(directory, "centerlines", bbox, ["rgi_g_id", "is_main"])

    def generalised(geometry, min_length=MIN_LINE):
        out = []
        for part in parts(pixels(geometry)):
            part = smooth(part.simplify(SIMPLIFY)).intersection(ice)
            out += [p for p in parts(part) if p.length > min_length]
        return out

    def in_view(geometry):
        return sum(clip_by_rect(p, 0, 0, SIZE, SIZE).length for p in generalised(geometry, 0))

    mains = lines[lines.is_main]
    shown = {rid for rid, g in zip(mains.rgi_g_id, mains.geometry) if in_view(g) >= MIN_MAIN}
    lines = lines[lines.rgi_g_id.isin(shown)]
    centerlines = {
        "centerline": path(p for g in lines[~lines.is_main].geometry for p in generalised(g)),
        "centerlineMain": path(p for g in lines[lines.is_main].geometry for p in generalised(g)),
    }
    return path(faces), centerlines, {"divide": path(divides)}


def segments(boxes, outer):
    """The edges of `boxes` that do not lie on `outer`, as straight lines merged where they meet."""
    lines = {}
    for x0, y0, x1, y1 in boxes:
        for key, a, b in ((("h", y0), x0, x1), (("h", y1), x0, x1), (("v", x0), y0, y1), (("v", x1), y0, y1)):
            lines.setdefault(key, []).append((min(a, b), max(a, b)))
    ox0, oy0, ox1, oy1 = outer
    out = []
    for (kind, at), spans in sorted(lines.items()):
        if at in ((oy0, oy1) if kind == "h" else (ox0, ox1)):
            continue
        spans.sort()
        merged = [list(spans[0])]
        for a, b in spans[1:]:
            if a <= merged[-1][1]:
                merged[-1][1] = max(merged[-1][1], b)
            else:
                merged.append([a, b])
        for a, b in merged:
            out.append(((a, at), (b, at)) if kind == "h" else ((at, a), (at, b)))
    return out


def region_previews(directory):
    """Scandinavia squared: its outline, its subregions' lines and its glaciers as dots."""
    regions = gpd.read_parquet(directory / "regions" / "rgi7.0-regions.parquet")
    regions = regions[regions.o1region == SCANDINAVIA]
    x0, y0, x1, y1 = outer = tuple(regions[regions.level == 1].total_bounds)
    sx = (SIZE - 2 * INSET) / (x1 - x0)
    sy = (SIZE - 2 * INSET) / (y1 - y0)

    def to_square(lon, lat):
        return INSET + (lon - x0) * sx, INSET + (y1 - lat) * sy

    def lines(segs):
        d = "".join("M{:.1f} {:.1f}L{:.1f} {:.1f}".format(*to_square(*a), *to_square(*b)) for a, b in segs)
        return re.sub(r"\.0(?!\d)", "", d)

    # The subregions as their bounding boxes. Two of them meet along a jagged
    # line, which the square draws straight at its mean longitude.
    subregions = regions[regions.level == 2].sort_values("o2region")
    south = subregions[subregions.geometry.bounds.miny <= y0]
    if len(south) != 2:
        raise SystemExit(f"expected two subregions on Scandinavia's south edge, found {len(south)}")
    seam = south.geometry.iloc[0].boundary.intersection(south.geometry.iloc[1].boundary)
    split = seam.centroid.x
    sb = south.total_bounds
    boxes = [tuple(b) for b in subregions[subregions.geometry.bounds.miny > y0].geometry.bounds.values]
    boxes.append(tuple(sb))
    inner = segments(boxes, outer) + [((split, sb[1]), (split, sb[3]))]
    rim = [((x0, y1), (x1, y1)), ((x1, y1), (x1, y0)), ((x1, y0), (x0, y0)), ((x0, y0), (x0, y1))]

    file = directory / "glaciers" / "rgi7.0-glaciers.parquet"
    glaciers = pq.read_table(file, columns=["o1region", "cenlon", "cenlat"], filters=[("o1region", "==", SCANDINAVIA)])
    cells = sorted({
        tuple(round(v / DOT_CELL) * DOT_CELL for v in to_square(lon, lat))
        for lon, lat in zip(glaciers["cenlon"].to_pylist(), glaciers["cenlat"].to_pylist())
    })
    dots = "".join(f"M{x:.1f} {y:.1f}L{x:.1f} {y:.1f}" for x, y in cells)
    return {"glaciers": re.sub(r"\.0(?!\d)", "", dots), "region2": lines(inner), "region1": lines(rim)}


def main(directory, out):
    """Write the previews module."""
    directory = Path(directory)
    glaciers, centerlines, intersects = glacier_previews(directory)
    previews = {"regions": region_previews(directory), "centerlines": centerlines, "intersects": intersects}
    # A part with nothing in view, such as branch centerlines, is left out.
    previews = {name: {part: d for part, d in paths.items() if d} for name, paths in previews.items()}
    body = json.dumps(previews, indent=2)
    Path(out).write_text(
        "/*\n"
        " * SVG paths for the layer previews, in a 48 px square. Generated from the RGI\n"
        " * data by scripts/make_layer_previews.py; do not edit by hand.\n"
        " */\n\n"
        "/** The generalised glacier outlines under the centerlines and intersects previews. */\n"
        f"export const GLACIERS = {json.dumps(glaciers)};\n\n"
        f"export const PREVIEWS = {body};\n"
    )


if __name__ == "__main__":
    main(*sys.argv[1:3])
