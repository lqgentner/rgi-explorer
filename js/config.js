/* Service addresses and tuning constants. Every data address comes from the catalog. */

export const CATALOG_URL = "https://data.source.coop/lqgentner/rgi/catalog.json";
export const LIBERTY_STYLE = "https://tiles.openfreemap.org/styles/liberty";
export const GLYPHS = "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf";
export const ESRI_TILES =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
export const ESRI_EXPORT =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export";
/* The imagery's source and date at a point, for the card's crop. */
export const ESRI_IDENTIFY =
  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/identify";
/* Who contributed World Imagery where, for the credits; Esri's own SDKs read it. */
export const ESRI_ATTRIBUTION = "https://static.arcgis.com/attribution/World_Imagery";
export const TERRAIN_TILEJSON = "https://tiles.mapterhorn.com/tilejson.json";
/* Which elevation sources Mapterhorn used in each tile, for the credits. */
export const TERRAIN_COVERAGE = "https://download.mapterhorn.com/coverage-index.pmtiles";
export const PHOTON = "https://photon.komoot.io/api/";
export const SPARQL = "https://query.wikidata.org/sparql";
export const COMMONS_API = "https://commons.wikimedia.org/w/api.php";

/** Height of one hypsometry band in metres. */
export const HYPSO_BAND_M = 50;
/** How long a third-party request may take before the page falls back. */
export const TIMEOUT_MS = 4000;
export const DEFAULT_VIEW = { zoom: 2, lat: 30, lon: 10 };
/*
 * A picked glacier or complex moves the map only when less than this share of
 * its bbox shows in the open map, when the bbox is under MIN_PICK_PX across on
 * screen, or when it is larger than the open map.
 */
export const MIN_VISIBLE_FRACTION = 0.8;
export const MIN_PICK_PX = 24;

/* The tour's sample glacier: Upsala Glacier, Southern Patagonian Icefield. Perito Moreno is unnamed in RGI 7.0. */
export const SAMPLE_GLACIER = "RGI2000-v7.0-G-17-04760";

/* A rough latitude for each time zone area; South American zones share "America/". */
const AREA_LAT = {
  Africa: 5, America: 35, Antarctica: -75, Arctic: 75, Asia: 30, Atlantic: 45,
  Australia: -25, Europe: 48, Indian: -15, Pacific: -15,
};
const SOUTH_AMERICA = /^America\/(Argentina|Sao_Paulo|Santiago|Punta_Arenas|Lima|Bogota|Caracas|La_Paz|Montevideo|Asuncion|Guayaquil|Manaus|Belem|Fortaleza|Recife|Bahia|Cuiaba|Campo_Grande|Porto_Velho|Rio_Branco|Paramaribo|Cayenne|Guyana)/;

/**
 * The opening view turned toward a time zone: its area's latitude and the
 * longitude of its standard UTC offset (`offsetHours` east of UTC). A zone
 * without an area, such as "UTC", keeps DEFAULT_VIEW.
 */
export function viewForZone(zone, offsetHours) {
  const area = String(zone ?? "").split("/")[0];
  if (!(area in AREA_LAT) || !Number.isFinite(offsetHours)) return DEFAULT_VIEW;
  const lat = SOUTH_AMERICA.test(zone) ? -15 : AREA_LAT[area];
  const lon = Math.max(-180, Math.min(180, offsetHours * 15));
  return { ...DEFAULT_VIEW, lat, lon };
}

/*
 * The opening view, from the browser's own time zone. Nothing leaves the
 * browser: no address lookup and no geolocation prompt.
 */
export function startView() {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const year = new Date().getFullYear();
    /* The larger offset west is standard time in either hemisphere. */
    const west = Math.max(new Date(year, 0, 1).getTimezoneOffset(), new Date(year, 6, 1).getTimezoneOffset());
    return viewForZone(zone, -west / 60);
  } catch {
    return DEFAULT_VIEW;
  }
}

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
