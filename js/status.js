/*
 * The status line: a compact scale bar and the credits. The phone folds the
 * credits behind an info button and draws no scale bar.
 */

import { PHONE, h, icon } from "./ui.js";

const EARTH_CIRCUMFERENCE = 40075016.686;
const TILE_SIZE = 512;
const OSM = { text: "© OpenStreetMap contributors", href: "https://www.openstreetmap.org/copyright" };
const OPENFREEMAP = { text: "OpenFreeMap", href: "https://openfreemap.org/" };
const OPENMAPTILES = { text: "© OpenMapTiles", href: "https://www.openmaptiles.org/" };
const ESRI = { text: "Esri, Maxar, Earthstar Geographics, and the GIS User Community" };
const MAPTERHORN = { text: "© Mapterhorn", href: "https://mapterhorn.com/attribution" };
const DOI = /^10\.\d{4,}\/\S+$/;

const MAX_LAT = 85.05;

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

/** "RGI Consortium" and the year of the catalog's citation, when it holds one. */
function rgiCredit(citation) {
  const year = /\((\d{4})\)/.exec(citation ?? "")?.[1];
  return year ? `RGI Consortium ${year}` : "RGI Consortium";
}

/**
 * The credits for what the map shows, in reading order, as groups of
 * `{ label, items }`, each item `{ text, href? }`. With `customCatalog`, the
 * host of a catalog that ?catalog= chose, a note names it first.
 */
export function credits({ base, terrain, catalog, customCatalog }) {
  const doi = DOI.test(catalog.doi ?? "") ? `https://doi.org/${catalog.doi}` : null;
  return [
    customCatalog ? { label: "Custom catalog", items: [{ text: customCatalog }] } : null,
    /* The DOI's landing page names the license. */
    { label: "Glaciers", items: [{ text: rgiCredit(catalog.citation), href: doi }] },
    { label: "Basemap", items: [OSM, OPENFREEMAP, OPENMAPTILES] },
    base === "imagery" ? { label: "Imagery", items: [ESRI] } : null,
    terrain ? { label: "Terrain", items: [MAPTERHORN] } : null,
  ].filter(Boolean);
}

/**
 * Draw the scale bar and the credits.
 *
 * @param getState  returns the current `{ base, terrain, customCatalog? }`
 * @returns {{refresh(): void}}  redraws both, after a base map or terrain change
 */
export function mountStatus(root, rgiMap, catalog, getState) {
  const phone = PHONE.matches;
  const list = h("span", { class: "credits" });
  const scaleLabel = h("span", { class: "scale-label" });
  const scaleLine = h("span", { class: "scale-bar" });
  const scale = h("span", { class: "scale", "aria-hidden": "true" }, scaleLabel, scaleLine);

  const item = ({ text, href }) =>
    href ? h("a", { class: "credit", href, target: "_blank", rel: "noopener" }, text) : h("span", { class: "credit" }, text);
  const drawCredits = () => {
    const groups = credits({ ...getState(), catalog });
    list.replaceChildren(
      ...groups.map(({ label, items }) =>
        h(
          "span",
          { class: "credit-group" },
          h("span", { class: "credit-label" }, label),
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
  drawCredits();

  /* Desktop: redraw the scale and publish the status line's height, which the controls sit above. */
  let relayout = () => {};
  if (phone) {
    const panel = h("div", { class: "credits-panel", hidden: true }, list);
    const info = h("button", { type: "button", class: "round-button", "aria-label": "Credits", "aria-expanded": "false" }, icon("info"));
    info.addEventListener("click", () => {
      panel.hidden = !panel.hidden;
      info.setAttribute("aria-expanded", String(!panel.hidden));
    });
    const onKey = (event) => {
      if (event.key !== "Escape" || panel.hidden) return;
      panel.hidden = true;
      info.setAttribute("aria-expanded", "false");
      info.focus();
    };
    root.addEventListener("keydown", onKey);
    panel.addEventListener("keydown", onKey);
    /*
     * The panel goes in the body. Inside root it would share root's stacking
     * context, which sits below the bottom sheet.
     */
    root.append(info);
    document.body.append(panel);
  } else {
    root.append(scale, list);
    rgiMap.onMove(({ zoom, lat }) => drawScale(lat, zoom));
    const publishHeight = () => {
      const height = root.getBoundingClientRect().height;
      document.documentElement.style.setProperty("--status-h", `${height}px`);
    };
    relayout = () => {
      drawScale(rgiMap.map.getCenter().lat, rgiMap.map.getZoom());
      publishHeight();
    };
    relayout();
    if (typeof ResizeObserver === "function") new ResizeObserver(publishHeight).observe(root);
  }

  return {
    refresh() {
      drawCredits();
      relayout();
    },
  };
}
