/*
 * The page's own style for the RGI layers. It reads the catalog's PMTiles file
 * but not the catalog's styles: glaciers are white with a grey outline, and
 * regions are outlines without a fill.
 */

/** Source layers that a toggle shows and hides, keyed by the toggle's name. */
export const TOGGLES = {
  regions: ["regions", "region-labels"],
  centerlines: ["centerlines"],
  intersects: ["intersects"],
};

/** The zoom from which each toggle's tiles hold data. */
export const TOGGLE_MINZOOM = { regions: 0, centerlines: 8, intersects: 10 };

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
};

/** The glacier fill's opacity over each base map; imagery shows through more. */
export const GLACIER_OPACITY = { standard: 0.85, imagery: 0.35 };

const POINTS = ["in", ["geometry-type"], ["literal", ["Point", "MultiPoint"]]];
const MAIN = ["get", "is_main"];

/** The sources and layers of the RGI style over the PMTiles file at `pmtilesUrl`. */
export function rgiStyle(pmtilesUrl) {
  const layer = (id, type, sourceLayer, rest) => ({ id, type, source: "data", "source-layer": sourceLayer, ...rest });
  const label = (rest) => ({ "text-color": PALETTE.label, "text-halo-color": PALETTE.halo, "text-halo-width": 1.2, ...rest });
  return {
    sources: { data: { type: "vector", url: `pmtiles://${pmtilesUrl}` } },
    layers: [
      layer("regions-outline-2", "line", "regions", {
        minzoom: 3,
        filter: ["==", ["get", "level"], 2],
        paint: { "line-color": PALETTE.region2, "line-width": 0.6 },
      }),
      layer("regions-outline-1", "line", "regions", {
        filter: ["==", ["get", "level"], 1],
        paint: { "line-color": PALETTE.region1, "line-width": 1 },
      }),
      layer("glaciers-fill", "fill", "glaciers", {
        paint: { "fill-color": PALETTE.glacier, "fill-opacity": GLACIER_OPACITY.standard },
      }),
      layer("glaciers-outline", "line", "glaciers", {
        paint: {
          "line-color": PALETTE.glacierOutline,
          "line-width": ["interpolate", ["linear"], ["zoom"], 0, 1, 8, 0.5, 12, 1],
        },
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
          "line-width": ["interpolate", ["linear"], ["zoom"], 8, ["case", MAIN, 1, 0.5], 12, ["case", MAIN, 2, 1]],
        },
      }),
      layer("intersects", "line", "intersects", {
        paint: { "line-color": PALETTE.divide, "line-width": 2 },
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
