/*
 * The status line: a compact scale bar and the credits. The phone folds the
 * credits behind an info button and draws no scale bar.
 */

import { PHONE, h, icon } from "./ui.js";

const EARTH_CIRCUMFERENCE = 40075016.686;
const TILE_SIZE = 512;
const OSM = "© OpenStreetMap contributors";
const OSM_COPYRIGHT = "https://www.openstreetmap.org/copyright";
const OPENMAPTILES = "https://www.openmaptiles.org/";
const ESRI = "Esri, Maxar, Earthstar Geographics, and the GIS User Community";
const UNOFFICIAL = "RGI Explorer and the RGI mirror are unofficial and not endorsed by the RGI Consortium.";

const MAX_LAT = 85.05;

/** The address when it is http or https, otherwise null. */
function webUrl(href) {
  try {
    return ["http:", "https:"].includes(new URL(href).protocol) ? href : null;
  } catch {
    return null;
  }
}

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
 * The credits for what the map shows, in reading order, as `{ text, href? }`.
 * With `customCatalog`, the host of a catalog that ?catalog= chose, a note
 * names it first.
 */
export function credits({ base, terrain, catalog, customCatalog }) {
  return [
    customCatalog ? { text: `Custom catalog: ${customCatalog}` } : null,
    { text: OSM, href: OSM_COPYRIGHT },
    { text: "OpenFreeMap" },
    { text: "© OpenMapTiles", href: OPENMAPTILES },
    base === "imagery" ? { text: ESRI } : null,
    terrain ? { text: "Mapterhorn" } : null,
    { text: catalog.citation },
    { text: `License: ${catalog.license.id}`, href: webUrl(catalog.license.href) },
    { text: UNOFFICIAL },
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

  const drawCredits = () => {
    const lines = credits({ ...getState(), catalog });
    list.replaceChildren(
      ...lines.map(({ text, href }) =>
        href
          ? h("a", { class: "credit", href, target: "_blank", rel: "noopener" }, text)
          : h("span", { class: "credit" }, text),
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
  const drawScaleNow = () => drawScale(rgiMap.map.getCenter().lat, rgiMap.map.getZoom());

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
    drawScaleNow();
  }
  drawCredits();

  return {
    refresh() {
      if (!phone) drawScaleNow();
      drawCredits();
    },
  };
}
