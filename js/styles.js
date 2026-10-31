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

/** The zoom from which each toggle's tiles hold data. */
export const TOGGLE_MINZOOM = { regions: 0, centerlines: 8, intersects: 10 };

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
  centerline: "#d55e00",
  divide: "#00897b",
  label: "#3c4043",
  halo: "#ffffff",
  casing: "#3c4043",
};

/**
 * The paint that changes with the base map, by layer ID. Over the standard map
 * the glacier fill is opaque, so the water and woods that OSM maps on a glacier
 * do not tint it. Over imagery the glaciers are white outlines without a fill,
 * so the ice shows, and the region outlines turn light: the first-order outline
 * is the lightest, as it is the darkest over the standard map. The glacier
 * outlines and the divides get a dark grey casing over imagery that keeps them
 * apart from snow; the orange centerlines stand out without one. The casing is
 * opaque, so where an outline and a divide overlap it is no darker.
 */
export const BASE_PAINT = {
  standard: {
    "glaciers-fill": { "fill-opacity": 1 },
    "glaciers-casing": { "line-opacity": 0 },
    "intersects-casing": { "line-opacity": 0 },
    "glaciers-outline": { "line-color": PALETTE.glacierOutline },
    "regions-outline-1": { "line-color": PALETTE.region1 },
    "regions-outline-2": { "line-color": PALETTE.region2 },
  },
  imagery: {
    "glaciers-fill": { "fill-opacity": 0 },
    "glaciers-casing": { "line-opacity": 1 },
    "intersects-casing": { "line-opacity": 1 },
    "glaciers-outline": { "line-color": "#ffffff" },
    "regions-outline-1": { "line-color": "#f1f3f4" },
    "regions-outline-2": { "line-color": "#bdc1c6" },
  },
};

const POINTS = ["in", ["geometry-type"], ["literal", ["Point", "MultiPoint"]]];
const MAIN = ["get", "is_main"];

/** The width of each line that a casing follows, by layer ID. */
export const LINE_WIDTH = {
  "glaciers-outline": ["interpolate", ["linear"], ["zoom"], 0, 1, 8, 0.5, 12, 1],
  "centerlines": ["interpolate", ["linear"], ["zoom"], 8, ["case", MAIN, 1, 0.5], 12, ["case", MAIN, 2, 1]],
  "intersects": 2,
};

/*
 * A casing on each side of a line, 1 px wide. It is drawn around a gap as wide
 * as the line, so it starts at the line's edge and leaves the line's width as
 * it is.
 */
const CASING = { "line-color": PALETTE.casing, "line-width": 1 };

/** The sources and layers of the RGI style over the PMTiles file at `pmtilesUrl`. */
export function rgiStyle(pmtilesUrl) {
  const layer = (id, type, sourceLayer, rest) => ({ id, type, source: "data", "source-layer": sourceLayer, ...rest });
  const casing = (id, sourceLayer, line) =>
    layer(id, "line", sourceLayer, {
      paint: { ...CASING, "line-gap-width": LINE_WIDTH[line], ...BASE_PAINT.standard[id] },
    });
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
      casing("glaciers-casing", "glaciers", "glaciers-outline"),
      casing("intersects-casing", "intersects", "intersects"),
      layer("glaciers-outline", "line", "glaciers", {
        paint: { "line-color": PALETTE.glacierOutline, "line-width": LINE_WIDTH["glaciers-outline"] },
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
          "line-color": PALETTE.centerline,
          "line-width": LINE_WIDTH.centerlines,
        },
      }),
      layer("intersects", "line", "intersects", {
        paint: { "line-color": PALETTE.divide, "line-width": LINE_WIDTH.intersects },
      }),
      layer("region-labels-1", "symbol", "region-labels", {
        minzoom: 1,
        maxzoom: 6,
        filter: ["==", ["get", "level"], 1],
        layout: {
          "text-field": ["get", "full_name"],
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
