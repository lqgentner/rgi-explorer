/* Service addresses and tuning constants. Every data address comes from the catalog. */

export const CATALOG_URL = "https://data.source.coop/lqgentner/rgi/catalog.json";
export const LIBERTY_STYLE = "https://tiles.openfreemap.org/styles/liberty";
export const GLYPHS = "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";
export const ESRI_TILES =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
export const ESRI_EXPORT =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export";
export const TERRAIN_TILEJSON = "https://tiles.mapterhorn.com/tilejson.json";
export const PHOTON = "https://photon.komoot.io/api/";
export const SPARQL = "https://query.wikidata.org/sparql";
export const COMMONS_API = "https://commons.wikimedia.org/w/api.php";

/** Height of one hypsometry band in metres. */
export const HYPSO_BAND_M = 50;
/** How long a third-party request may take before the page falls back. */
export const TIMEOUT_MS = 4000;
export const DEFAULT_VIEW = { zoom: 2, lat: 30, lon: 10 };

/**
 * The catalog to read: the `catalog` query parameter, resolved against `base`,
 * or the published catalog when the parameter is missing, empty or not a URL.
 */
export function resolveCatalogUrl(search, base = globalThis.location?.href) {
  const value = search.get("catalog");
  if (!value) return CATALOG_URL;
  try {
    return new URL(value, base).href;
  } catch {
    return CATALOG_URL;
  }
}
