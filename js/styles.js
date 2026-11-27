/*
 * The page's own style for the RGI layers, over the catalog's PMTiles file.
 * Region outlines use `region-boundaries`: two dash patterns over a border
 * that two `regions` polygons share look solid.
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

/* Steps of one OKLCH ramp at the hue of the blues in style.css. 700 is --accent. */
export const ICE = {
  50: "#f0f8fe",
  500: "#03a9f4",
  700: "#00668a",
};

/** The colors the map and the layer previews share. */
export const PALETTE = {
  glacier: ICE[50],
  glacierOutline: ICE[500],
  /* --muted, --image-placeholder, --surface-2 and --line in style.css. */
  region1: "#4f6570",
  region2: "#93a5ae",
  region1OnImagery: "#edf3f6",
  region2OnImagery: "#d3dee4",
  centerline: "#b8860b",
  centerlineOnImagery: "#ddaa33",
  /* Darker than the outline, so readers who see purple as blue still tell them apart. */
  divide: "#801fa2",
  divideOnImagery: "#983dbc",
  label: "#3c4043",
  glacierLabel: ICE[700],
  halo: "#ffffff",
  /* Liberty's halo on lake and river names. */
  waterHalo: "rgba(255,255,255,0.7)",
};

/** A width that follows the zoom: `low` at zoom 8, `high` from zoom 12 and at zoom 0. */
const byZoom = (high, low) => ["interpolate", ["linear"], ["zoom"], 0, high, 8, low, 12, high];

/* Wider over imagery, where the outline reads alone on snow and rock. */
export const OUTLINE_WIDTH = { standard: byZoom(1, 0.5), imagery: byZoom(1.5, 0.75) };
/* A divide lies on the outline and is wider, so no blue fringes it. */
export const DIVIDE_WIDTH = { standard: byZoom(1.5, 0.75), imagery: byZoom(2, 1) };

const MAIN = ["get", "is_main"];
/** A centerline width: `main` px for a main centerline from zoom 12, half that at zoom 8, and half for the others. */
const centerlineWidth = (main) => ["interpolate", ["linear"], ["zoom"], 8, ["case", MAIN, main / 2, main / 4], 12, ["case", MAIN, main, main / 2]];
export const CENTERLINE_WIDTH = { standard: centerlineWidth(1.5), imagery: centerlineWidth(2) };

/**
 * The paint that changes with the base map, by layer ID. The standard map's
 * fill is opaque, so OSM water and woods on a glacier do not tint it.
 */
export const BASE_PAINT = {
  standard: {
    "glaciers-fill": { "fill-opacity": 1 },
    "glaciers-outline": { "line-color": PALETTE.glacierOutline, "line-width": OUTLINE_WIDTH.standard },
    "intersects": { "line-color": PALETTE.divide, "line-width": DIVIDE_WIDTH.standard },
    "centerlines": { "line-color": PALETTE.centerline, "line-width": CENTERLINE_WIDTH.standard },
    "regions-outline-1": { "line-color": PALETTE.region1 },
    "regions-outline-2": { "line-color": PALETTE.region2 },
  },
  imagery: {
    "glaciers-fill": { "fill-opacity": 0 },
    "glaciers-outline": { "line-color": PALETTE.glacierOutline, "line-width": OUTLINE_WIDTH.imagery },
    "intersects": { "line-color": PALETTE.divideOnImagery, "line-width": DIVIDE_WIDTH.imagery },
    "centerlines": { "line-color": PALETTE.centerlineOnImagery, "line-width": CENTERLINE_WIDTH.imagery },
    "regions-outline-1": { "line-color": PALETTE.region1OnImagery },
    "regions-outline-2": { "line-color": PALETTE.region2OnImagery },
  },
};

const POINTS = ["in", ["geometry-type"], ["literal", ["Point", "MultiPoint"]]];

/* The label lines of the map's zoom, the same rule as the catalog's styles. */
const NAME_ZOOMS = [
  "all",
  [">=", ["zoom"], ["get", "label_zoom"]],
  ["any", ["<", ["zoom"], ["+", ["get", "label_zoom"], 1]], [">=", ["get", "label_zoom"], 14]],
];

/** The sources and layers of the RGI style over the PMTiles file at `pmtilesUrl`. */
export function rgiStyle(pmtilesUrl) {
  const layer = (id, type, sourceLayer, rest) => ({ id, type, source: "data", "source-layer": sourceLayer, ...rest });
  /* Liberty's place-label halo. */
  const label = (rest) => ({
    "text-color": PALETTE.label,
    "text-halo-color": PALETTE.halo,
    "text-halo-width": 1,
    "text-halo-blur": 1,
    ...rest,
  });
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
          ...BASE_PAINT.standard.centerlines,
        },
      }),
      layer("intersects", "line", "intersects", {
        paint: { ...BASE_PAINT.standard.intersects },
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
        filter: ["all", ["==", ["geometry-type"], "LineString"], NAME_ZOOMS],
        layout: {
          "text-field": ["get", "display_name"],
          /* Liberty's lake and river names. */
          "text-font": ["Noto Sans Italic"],
          "text-size": 14,
          "text-letter-spacing": 0.2,
          "symbol-placement": "line-center",
          "symbol-sort-key": ["-", ["get", "area_km2"]],
        },
        paint: label({ "text-color": PALETTE.glacierLabel, "text-halo-color": PALETTE.waterHalo, "text-halo-width": 1.5, "text-halo-blur": 0 }),
      }),
    ],
  };
}
