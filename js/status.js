/*
 * The status line: a compact scale bar and the credits. The phone folds the
 * credits into an info button and draws no scale bar.
 */

import { ESRI_ATTRIBUTION, TERRAIN_COVERAGE } from "./config.js";
import { PHONE, h, icon } from "./ui.js";

const EARTH_CIRCUMFERENCE = 40075016.686;
const TILE_SIZE = 512;
const OSM = { text: "© OpenStreetMap contributors", href: "https://www.openstreetmap.org/copyright" };
const OPENFREEMAP = { text: "OpenFreeMap", href: "https://openfreemap.org/" };
const OPENMAPTILES = { text: "© OpenMapTiles", href: "https://www.openmaptiles.org/" };
/* Esri asks for "Powered by Esri" on interactive maps, then the data's sources: its copyrightText without "Esri". */
const ESRI = { text: "Powered by Esri", href: "https://www.esri.com" };
const ESRI_SOURCES = { text: "Vantor, Earthstar Geographics, and the GIS User Community" };
const MAPTERHORN = { text: "© Mapterhorn", href: "https://mapterhorn.com/attribution" };
/* MapLibre's own control credits it last, with this link; the license asks for no credit, so it is a courtesy. */
const MAPLIBRE = { text: "MapLibre", href: "https://maplibre.org/" };
const DOI = /^10\.\d{4,}\/\S+$/;
const WEB = /^https?:\/\//;

const MAX_LAT = 85.05;
/* Mapterhorn's coverage index holds zooms 4 to 12. */
const COVERAGE_ZOOMS = { min: 4, max: 12 };
/* A view needing more index tiles is looked up at a coarser zoom. */
const MAX_COVERAGE_TILES = 16;
/* Past this many sources in view, "© Mapterhorn" alone links to the full list, as Mapterhorn's own example does. */
const MAX_TERRAIN_SOURCES = 15;
/* Past this many contributors in view, Esri's fixed sources stand in. */
const MAX_IMAGERY_CONTRIBUTORS = 15;

/** Ground meters per screen pixel at a latitude in degrees (clamped to the map's) and a zoom level. */
export function metersPerPixel(lat, zoom) {
  const clamped = Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
  return (EARTH_CIRCUMFERENCE * Math.cos((clamped * Math.PI) / 180)) / (TILE_SIZE * 2 ** zoom);
}

/** The longest 1, 2 or 5 times a power of ten that fits in maxPx pixels, or null without a usable scale. */
export function scaleBar(mpp, maxPx = 80) {
  if (!Number.isFinite(mpp) || mpp <= 0) return null;
  const maxMeters = mpp * maxPx;
  const power = 10 ** Math.floor(Math.log10(maxMeters));
  const meters = [5, 2, 1].map((step) => step * power).find((length) => length <= maxMeters);
  const label = meters >= 1000 ? `${meters / 1000} km` : `${meters} m`;
  return { px: Math.round(meters / mpp), label };
}

/**
 * The coverage-index tiles over a view's bounds, at the deepest zoom up to the
 * map's that needs at most MAX_COVERAGE_TILES, or none below the index's zooms.
 */
export function coverageTiles({ west, south, east, north }, zoom) {
  const latY = (lat, n) => {
    const r = (Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)) * Math.PI) / 180;
    return Math.min(n - 1, Math.max(0, Math.floor(((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2) * n)));
  };
  for (let z = Math.min(Math.floor(zoom), COVERAGE_ZOOMS.max); z >= COVERAGE_ZOOMS.min; z--) {
    const n = 2 ** z;
    const [x0, x1] = [west, east].map((lon) => Math.floor(((lon + 180) / 360) * n));
    const [y0, y1] = [latY(north, n), latY(south, n)];
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > MAX_COVERAGE_TILES) continue;
    const tiles = [];
    /* A view across the antimeridian runs past ±180°; its tiles wrap around. */
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) tiles.push({ z, x: ((x % n) + n) % n, y });
    return tiles;
  }
  return [];
}

/**
 * The producers of the elevation sources in a set of coverage-index entries,
 * finest data first and each producer once, as credits. Null when there are
 * none or too many to list.
 */
export function terrainProducers(sources) {
  const entries = Object.values(sources).sort((a, b) => a.resolution - b.resolution);
  if (!entries.length || entries.length > MAX_TERRAIN_SOURCES) return null;
  const seen = new Set();
  return entries
    .filter(({ producer_short: name }) => name && !seen.has(name) && seen.add(name))
    .map(({ producer_short: name, website }) => ({ text: `© ${name}`, href: WEB.test(website ?? "") ? website : null }));
}

/**
 * The contributors in Esri's World Imagery list whose coverage meets a view's
 * bounds at Esri's tile `level`, best score first, as credits. Null when there
 * are none or too many to list. Each coverage bbox is
 * [minLat, minLon, maxLat, maxLon].
 */
export function imageryContributors(contributors, { west, south, east, north }, level) {
  const meets = ({ bbox: [minLat, minLon, maxLat, maxLon], zoomMin, zoomMax }) =>
    level >= zoomMin &&
    level <= zoomMax &&
    minLat <= north &&
    maxLat >= south &&
    /* A view across the antimeridian runs past ±180°; its far side wraps around. */
    [-360, 0, 360].some((shift) => minLon + shift <= east && maxLon + shift >= west);
  const found = (contributors ?? []).flatMap(({ attribution, coverageAreas }) => {
    const scores = (coverageAreas ?? []).filter(meets).map(({ score }) => score);
    return attribution && scores.length ? [{ text: attribution, score: Math.max(...scores) }] : [];
  });
  if (!found.length || found.length > MAX_IMAGERY_CONTRIBUTORS) return null;
  return found.sort((a, b) => b.score - a.score).map(({ text }) => ({ text }));
}

let coverage = null;

/** The producers behind the terrain in view, or null when the index has no answer. */
async function lookUpProducers(bounds, zoom) {
  const tiles = coverageTiles(bounds, zoom);
  if (!tiles.length) return null;
  coverage ??= new globalThis.pmtiles.PMTiles(TERRAIN_COVERAGE);
  const decoder = new TextDecoder();
  const found = await Promise.all(
    tiles.map(async ({ z, x, y }) => {
      const tile = await coverage.getZxy(z, x, y);
      return tile ? JSON.parse(decoder.decode(tile.data)) : {};
    }),
  );
  return terrainProducers(Object.assign({}, ...found));
}

/** "RGI Consortium" and the year of the catalog's citation, when it holds one. */
function rgiCredit(citation) {
  const year = /\((\d{4})\)/.exec(citation ?? "")?.[1];
  return year ? `RGI Consortium ${year}` : "RGI Consortium";
}

/**
 * The credits for what the map shows, in reading order, as groups of
 * `{ label, items }`, each item `{ text, href? }`. The map library comes
 * last, with no label. `imagery` credits Esri's
 * contributors in view after Esri, in place of its fixed sources; `producers`
 * credits the elevation sources of the terrain in view after Mapterhorn.
 */
export function credits({ base, terrain, catalog, imagery = null, producers = null }) {
  const doi = DOI.test(catalog.doi ?? "") ? `https://doi.org/${catalog.doi}` : null;
  return [
    /* The DOI's landing page names the license. */
    { label: "Glaciers", items: [{ text: rgiCredit(catalog.citation), href: doi }] },
    { label: "Basemap", items: [OSM, OPENFREEMAP, OPENMAPTILES] },
    base === "imagery" ? { label: "Imagery", items: [ESRI, ...(imagery ?? [ESRI_SOURCES])] } : null,
    terrain ? { label: "Terrain", items: [MAPTERHORN, ...(producers ?? [])] } : null,
    { label: null, items: [MAPLIBRE] },
  ].filter(Boolean);
}

/**
 * Draw the scale bar and the credits.
 *
 * @param getState  returns the current `{ base, terrain }`
 * @returns {{refresh(): void}}  redraws both, after a base map or terrain change
 *
 * With terrain on, each move looks up the elevation sources in view. Until an
 * answer arrives, the credits keep the last one; a failed lookup leaves
 * "© Mapterhorn" alone. On imagery, the credits name Esri's contributors in
 * view, from Esri's list, read once; until it arrives, or when it fails, Esri's
 * fixed sources stand, and the next move reads it again.
 */
export function mountStatus(root, rgiMap, catalog, getState) {
  const list = h("span", { class: "credits" });
  const scaleLabel = h("span", { class: "scale-label" });
  const scaleLine = h("span", { class: "scale-bar" });
  const scale = h("span", { class: "scale", "aria-hidden": "true" }, scaleLabel, scaleLine);

  /* A no-break space keeps "©" on the line of the name it belongs to. */
  const item = ({ text: raw, href }) => {
    const text = raw.replaceAll("© ", "© ");
    return href ? h("a", { class: "credit", href, target: "_blank", rel: "noopener" }, text) : h("span", { class: "credit" }, text);
  };
  const view = () => {
    const bounds = rgiMap.map.getBounds();
    return { west: bounds.getWest(), south: bounds.getSouth(), east: bounds.getEast(), north: bounds.getNorth() };
  };
  let producers = null;
  let asked = 0;
  let contributors = null;
  let reading = false;
  /* MapLibre draws Esri's 256 px tiles one level deeper than its own zoom. */
  const imageryInView = () =>
    contributors && getState().base === "imagery"
      ? imageryContributors(contributors, view(), Math.round(rgiMap.map.getZoom()) + 1)
      : null;
  const drawCredits = () => {
    const groups = credits({ ...getState(), catalog, imagery: imageryInView(), producers });
    list.replaceChildren(
      ...groups.map(({ label, items }) =>
        h(
          "span",
          { class: "credit-group" },
          label ? h("span", { class: "credit-label" }, label) : null,
          ...items.flatMap((entry, i) => (i ? [", ", item(entry)] : [item(entry)])),
        ),
      ),
    );
  };

  const drawScale = (lat, zoom) => {
    const bar = scaleBar(metersPerPixel(lat, zoom));
    scale.hidden = !bar;
    if (!bar) return;
    const { px, label } = bar;
    scaleLine.style.width = `${px}px`;
    scaleLabel.textContent = label;
  };
  /* Only the latest lookup draws, so a slow answer for an old view never replaces a newer one. */
  const lookUpTerrain = () => {
    const ask = ++asked;
    if (!getState().terrain) {
      producers = null;
      return;
    }
    lookUpProducers(view(), rgiMap.map.getZoom())
      .catch(() => null)
      .then((found) => {
        if (ask !== asked) return;
        producers = found;
        drawCredits();
      });
  };
  /* On imagery, credit the contributors in view, reading Esri's list first if it has not arrived. */
  const showImagery = () => {
    if (getState().base !== "imagery") return;
    if (contributors) {
      drawCredits();
      return;
    }
    if (reading) return;
    reading = true;
    fetch(ESRI_ATTRIBUTION)
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        contributors = Array.isArray(data?.contributors) ? data.contributors : null;
      })
      .catch(() => {})
      .finally(() => {
        reading = false;
        drawCredits();
      });
  };
  lookUpTerrain();
  drawCredits();
  showImagery();

  /*
   * One set of nodes for both layouts; style.css decides how they show. The
   * phone hides the scale bar and folds the credits into the info button: they
   * show at load and fold on the first drag of the map, as MapLibre's compact
   * attribution does, and the button unfolds them again in place.
   */
  const info = h(
    "button",
    { type: "button", class: "credits-button", "aria-label": "Credits", "aria-expanded": "true" },
    icon("info"),
  );
  const box = h("div", { class: "credits-box open" }, info, list);
  const setOpen = (open) => {
    box.classList.toggle("open", open);
    info.setAttribute("aria-expanded", String(open));
  };
  info.addEventListener("click", () => setOpen(!box.classList.contains("open")));
  box.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !PHONE.matches || !box.classList.contains("open")) return;
    setOpen(false);
    info.focus();
  });
  rgiMap.map.once("dragstart", () => setOpen(false));
  root.append(scale, box);

  /* Redraw the scale and publish the status line's height, which the desktop controls sit above. */
  rgiMap.onMove(({ zoom, lat }) => {
    drawScale(lat, zoom);
    lookUpTerrain();
    showImagery();
  });
  const publishHeight = () => {
    const height = root.getBoundingClientRect().height;
    document.documentElement.style.setProperty("--status-h", `${height}px`);
  };
  const relayout = () => {
    drawScale(rgiMap.map.getCenter().lat, rgiMap.map.getZoom());
    publishHeight();
  };
  relayout();
  if (typeof ResizeObserver === "function") new ResizeObserver(publishHeight).observe(root);

  return {
    refresh() {
      lookUpTerrain();
      drawCredits();
      showImagery();
      relayout();
    },
  };
}
