/*
 * The page's own style for the RGI layers. It reads the catalog's PMTiles file
 * but not the catalog's styles: glaciers are white with a grey outline, and
 * regions are dashed outlines without a fill. The outlines come from the
 * `region-boundaries` layer, which holds each border once: the `regions`
 * polygons hold a shared border twice, and two dash patterns over one line
 * look solid.
 */

/** Source layers that a toggle shows and hides, keyed by the toggle's name. */
export const TOGGLES = {
  regions: ["region-boundaries", "region-labels"],
  centerlines: ["centerlines"],
  intersects: ["intersects"],
};

/** The zoom from which the map draws the second-order region outlines. */
export const REGION2_MINZOOM = 3;

/** The region outlines' dashes, in line widths: dash, gap. */
export const REGION_DASH = { 1: [4, 2], 2: [5, 3] };

/** The colors the map and the layer previews share. */
export const PALETTE = {
  glacier: "#ffffff",
  glacierOutline: "#80868b",
  region1: "#5f6368",
  region2: "#9aa0a6",
  centerline: "#b8860b",
  centerlineOnImagery: "#ddaa33",
  divide: "#009e73",
  label: "#3c4043",
  halo: "#ffffff",
  casing: "#202124",
};

/** A width that follows the zoom: `low` at zoom 8, `high` from zoom 12 and at zoom 0. */
const byZoom = (high, low) => ["interpolate", ["linear"], ["zoom"], 0, high, 8, low, 12, high];

/*
 * The width of the glacier outlines and of the divides, per base map. A divide
 * is a stretch of outline that two glaciers share, so it is as wide as one and
 * set apart by its color. The standard map's grey lines have no casing and are
 * wider.
 */
export const OUTLINE_WIDTH = { standard: byZoom(1.5, 0.75), imagery: byZoom(1, 0.5) };

const MAIN = ["get", "is_main"];
/** The width of the centerlines: the main ones are twice as wide as the others. */
export const CENTERLINE_WIDTH = ["interpolate", ["linear"], ["zoom"], 8, ["case", MAIN, 1, 0.5], 12, ["case", MAIN, 2, 1]];

/* The glacier outlines, the divides and their casings over one base map. */
const outlines = (width, color, casingOpacity) => ({
  "glaciers-casing": { "line-gap-width": width, "line-opacity": casingOpacity },
  "intersects-casing": { "line-gap-width": width, "line-opacity": casingOpacity },
  "glaciers-outline": { "line-color": color, "line-width": width },
  "intersects": { "line-width": width },
});

/**
 * The paint that changes with the base map, by layer ID. Over the standard map
 * the glacier fill is opaque, so the water and woods that OSM maps on a glacier
 * do not tint it. Over imagery the glaciers are white outlines without a fill,
 * so the ice shows, and the region outlines turn light: the first-order outline
 * is the lightest, as it is the darkest over the standard map. The glacier
 * outlines and the divides get a near-black casing over imagery that keeps them
 * apart from snow. The casing is opaque, so where an outline and a divide
 * overlap it is no darker. The gold centerlines need no casing; over imagery
 * they are a lighter gold, which the standard map's light glaciers would fade.
 */
export const BASE_PAINT = {
  standard: {
    "glaciers-fill": { "fill-opacity": 1 },
    ...outlines(OUTLINE_WIDTH.standard, PALETTE.glacierOutline, 0),
    "centerlines": { "line-color": PALETTE.centerline },
    "regions-outline-1": { "line-color": PALETTE.region1 },
    "regions-outline-2": { "line-color": PALETTE.region2 },
  },
  imagery: {
    "glaciers-fill": { "fill-opacity": 0 },
    ...outlines(OUTLINE_WIDTH.imagery, "#ffffff", 1),
    "centerlines": { "line-color": PALETTE.centerlineOnImagery },
    "regions-outline-1": { "line-color": "#f1f3f4" },
    "regions-outline-2": { "line-color": "#bdc1c6" },
  },
};

const POINTS = ["in", ["geometry-type"], ["literal", ["Point", "MultiPoint"]]];

/*
 * A casing on each side of a line, drawn around a gap as wide as the line, so
 * it starts at the line's edge and leaves the line's width as it is. It is 1 px
 * wide close in and thins to 0.4 px at zoom 8, where a heavily glaciated range
 * is a mesh of outlines that full casings would blacken.
 */
const CASING = { "line-color": PALETTE.casing, "line-width": ["interpolate", ["linear"], ["zoom"], 8, 0.4, 11, 1] };

/** The sources and layers of the RGI style over the PMTiles file at `pmtilesUrl`. */
export function rgiStyle(pmtilesUrl) {
  const layer = (id, type, sourceLayer, rest) => ({ id, type, source: "data", "source-layer": sourceLayer, ...rest });
  const casing = (id, sourceLayer) => layer(id, "line", sourceLayer, { paint: { ...CASING, ...BASE_PAINT.standard[id] } });
  const label = (rest) => ({ "text-color": PALETTE.label, "text-halo-color": PALETTE.halo, "text-halo-width": 1.2, ...rest });
  return {
    sources: { data: { type: "vector", url: `pmtiles://${pmtilesUrl}` } },
    layers: [
      layer("regions-outline-2", "line", "region-boundaries", {
        minzoom: REGION2_MINZOOM,
        filter: ["==", ["get", "level"], 2],
        paint: { "line-color": PALETTE.region2, "line-width": 0.6, "line-dasharray": REGION_DASH[2] },
      }),
      layer("regions-outline-1", "line", "region-boundaries", {
        filter: ["==", ["get", "level"], 1],
        paint: { "line-color": PALETTE.region1, "line-width": 1, "line-dasharray": REGION_DASH[1] },
      }),
      layer("glaciers-fill", "fill", "glaciers", {
        paint: { "fill-color": PALETTE.glacier, ...BASE_PAINT.standard["glaciers-fill"] },
      }),
      /* The casings lie below all the lines, so that none covers another line. */
      casing("glaciers-casing", "glaciers"),
      casing("intersects-casing", "intersects"),
      layer("glaciers-outline", "line", "glaciers", {
        paint: { ...BASE_PAINT.standard["glaciers-outline"] },
      }),
      layer("glaciers-dots", "circle", "glaciers", {
        filter: POINTS,
        paint: {
          "circle-color": PALETTE.glacier,
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 0, 1.5, 6, 2.5],
          "circle-stroke-color": PALETTE.glacierOutline,
          "circle-stroke-width": 0.75,
        },
      }),
      layer("centerlines", "line", "centerlines", {
        paint: {
          "line-width": CENTERLINE_WIDTH,
          ...BASE_PAINT.standard.centerlines,
        },
      }),
      layer("intersects", "line", "intersects", {
        paint: { "line-color": PALETTE.divide, ...BASE_PAINT.standard.intersects },
      }),
      layer("region-labels-1", "symbol", "region-labels", {
        minzoom: 1,
        maxzoom: 6,
        filter: ["==", ["get", "level"], 1],
        layout: {
          "text-field": ["concat", ["get", "o1region"], "\n", ["get", "full_name"]],
          "text-font": ["Noto Sans Bold"],
          "text-size": 12,
          "text-transform": "uppercase",
          "text-letter-spacing": 0.08,
        },
        paint: label(),
      }),
      layer("region-labels-2", "symbol", "region-labels", {
        minzoom: 4,
        maxzoom: 9,
        filter: ["==", ["get", "level"], 2],
        layout: {
          "text-field": ["concat", ["get", "o2region"], "\n", ["get", "full_name"]],
          "text-font": ["Noto Sans Regular"],
          "text-size": 11,
        },
        paint: label(),
      }),
      layer("glacier-labels", "symbol", "glacier-labels", {
        layout: {
          "text-field": ["get", "display_name"],
          "text-font": ["Noto Sans Italic"],
          "text-size": 12,
          "symbol-sort-key": ["-", ["get", "area_km2"]],
        },
        paint: label({ "text-color": "#202124" }),
      }),
    ],
  };
}
