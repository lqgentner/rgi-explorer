/*
 * The page's own style for the RGI layers. It reads the catalog's PMTiles file
 * but not the catalog's styles: glaciers are a faint blue with a blue outline, and
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

/*
 * The glaciers' blues: one ramp at the hue of the page's own blues in
 * style.css (about 235° in OKLCH), by lightness from 50, near white, to 900,
 * near black. Three steps are the page's: 100 is --accent-tint, 700 --accent
 * and 900 --text. The outline is 500 on both base maps; the names take a
 * dark step on the standard map and a light one over imagery.
 */
export const ICE = {
  50: "#f0f8fe",
  100: "#e3f0f6",
  200: "#b9e1fb",
  500: "#03a9f4",
  700: "#00668a",
  900: "#14232b",
};

/** The colors the map and the layer previews share. */
export const PALETTE = {
  /* A glacier is the faintest blue, lighter and greener than Liberty's lakes. */
  glacier: ICE[50],
  /* One blue on both maps: a fine line on the standard map's fill, a wider one over imagery. */
  glacierOutline: ICE[500],
  /* The page's blue-greys: --muted and --image-placeholder, and over imagery --surface-2 and --line. */
  region1: "#4f6570",
  region2: "#93a5ae",
  region1OnImagery: "#edf3f6",
  region2OnImagery: "#d3dee4",
  centerline: "#b8860b",
  centerlineOnImagery: "#ddaa33",
  /*
   * A purple, darker than the outline beside it on each base map, so that it
   * stands apart from the blue by its lightness too, as it must for readers
   * who see purple as a blue.
   */
  divide: "#801fa2",
  divideOnImagery: "#983dbc",
  label: "#3c4043",
  /* The glacier names: --accent on the fill, 6:1, and over imagery a light blue on a soft --text shadow. */
  glacierLabel: ICE[700],
  glacierLabelOnImagery: ICE[200],
  glacierShadow: ICE[900],
  halo: "#ffffff",
  /* Liberty's halo on the names of lakes and rivers, which the glacier names share. */
  waterHalo: "rgba(255,255,255,0.7)",
};

/** A width that follows the zoom: `low` at zoom 8, `high` from zoom 12 and at zoom 0. */
const byZoom = (high, low) => ["interpolate", ["linear"], ["zoom"], 0, high, 8, low, 12, high];

/*
 * The width of the glacier outlines, per base map. No line has a casing. On
 * the standard map the outline is a fine edge to the fill, as quiet as
 * Liberty's lakes, which have none; over imagery it must read alone on snow
 * and rock, so it is half again as wide.
 */
export const OUTLINE_WIDTH = { standard: byZoom(1, 0.5), imagery: byZoom(1.5, 0.75) };
/*
 * The width of the divides. A divide is a stretch of outline that two
 * glaciers share and lies on it, half a pixel wider close in, so that the
 * blue below does not fringe the purple.
 */
export const DIVIDE_WIDTH = { standard: byZoom(1.5, 0.75), imagery: byZoom(2, 1) };

const MAIN = ["get", "is_main"];
/** A centerline width: `main` px for a main centerline from zoom 12, half that at zoom 8, and half for the others. */
const centerlineWidth = (main) => ["interpolate", ["linear"], ["zoom"], 8, ["case", MAIN, main / 2, main / 4], 12, ["case", MAIN, main, main / 2]];
/* The width of the centerlines, per base map: a main one as wide as a divide close in. */
export const CENTERLINE_WIDTH = { standard: centerlineWidth(1.5), imagery: centerlineWidth(2) };

/**
 * The paint that changes with the base map, by layer ID. Over the standard map
 * the glacier fill is opaque, so the water and woods that OSM maps on a glacier
 * do not tint it. Over imagery the glaciers are outlines without a fill, so the
 * ice shows; the outlines, divides and centerlines are wider, and the divides,
 * centerlines and region outlines take lighter colors: a lighter purple, a
 * lighter gold, which the standard map's light glaciers would fade, and light
 * blue-greys, the first-order outline the lightest, as it is the darkest over
 * the standard map.
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

/** The sources and layers of the RGI style over the PMTiles file at `pmtilesUrl`. */
export function rgiStyle(pmtilesUrl) {
  const layer = (id, type, sourceLayer, rest) => ({ id, type, source: "data", "source-layer": sourceLayer, ...rest });
  /* The labels' halo is Liberty's place labels': 1 px, softened by 1 px of blur. */
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
      /*
       * A glacier's name shows only where it fits along the glacier's main
       * centerline: from the zoom, `line_zoom`, at which the tiles add a
       * stretch of that line, smoothed, as a line of its own. Each zoom has its
       * own stretch, the one nearest the tongue that fits, so the name moves
       * down the glacier as the map zooms in. The name's points in the same
       * layer serve the selection's label.
       */
      layer("glacier-labels", "symbol", "glacier-labels", {
        /* One line per zoom, its stretch nearest the tongue that fits there; z12's serves the deeper zooms. */
        filter: ["all", ["==", ["geometry-type"], "LineString"], ["==", ["get", "label_zoom"], ["min", ["zoom"], 12]]],
        layout: {
          "text-field": ["get", "display_name"],
          /* Liberty's lake and river names: the same italic, 14 px, spaced 0.2 em. */
          "text-font": ["Noto Sans Italic"],
          "text-size": 14,
          "text-letter-spacing": 0.2,
          "symbol-placement": "line-center",
          "symbol-sort-key": ["-", ["get", "area_km2"]],
        },
        /* Liberty's lake and river halo: white at 70 %, 1.5 px, hard. */
        paint: label({ "text-color": PALETTE.glacierLabel, "text-halo-color": PALETTE.waterHalo, "text-halo-width": 1.5, "text-halo-blur": 0 }),
      }),
    ],
  };
}
