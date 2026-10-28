/*
 * The status line: a compact scale bar and the credits. The phone folds the
 * credits behind an info button and draws no scale bar.
 */

import { PHONE, h, icon } from "./ui.js";

const EARTH_CIRCUMFERENCE = 40075016.686;
const TILE_SIZE = 512;
const OSM = "© OpenStreetMap contributors";
const OSM_COPYRIGHT = "https://www.openstreetmap.org/copyright";
const ESRI = "Esri, Maxar, Earthstar Geographics, and the GIS User Community";
const UNOFFICIAL = "RGI Explorer and the RGI mirror are unofficial and not endorsed by the RGI Consortium.";

/** Ground meters per screen pixel at a latitude in degrees and a zoom level. */
export function metersPerPixel(lat, zoom) {
  return (EARTH_CIRCUMFERENCE * Math.cos((lat * Math.PI) / 180)) / (TILE_SIZE * 2 ** zoom);
}

/** The longest 1, 2 or 5 times a power of ten that fits in maxPx pixels. */
export function scaleBar(mpp, maxPx = 80) {
  const maxMeters = mpp * maxPx;
  const power = 10 ** Math.floor(Math.log10(maxMeters));
  const meters = [5, 2, 1].map((step) => step * power).find((length) => length <= maxMeters);
  const label = meters >= 1000 ? `${meters / 1000} km` : `${meters} m`;
  return { px: Math.round(meters / mpp), label };
}

/** The credit lines for what the map shows, in reading order. */
export function credits({ base, terrain, catalog }) {
  return [
    OSM,
    "OpenFreeMap",
    base === "imagery" ? ESRI : null,
    terrain ? "Mapterhorn" : null,
    catalog.citation,
    `License: ${catalog.license.id}`,
    UNOFFICIAL,
  ].filter(Boolean);
}

/**
 * Draw the scale bar and the credits.
 *
 * @param getState  returns the current `{ base, terrain }`
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
      ...lines.map((line) => {
        let href = null;
        if (line === OSM) href = OSM_COPYRIGHT;
        else if (line.startsWith("License: ")) href = catalog.license.href;
        if (!href) return h("span", { class: "credit" }, line);
        return h("a", { class: "credit", href, target: "_blank", rel: "noopener" }, line);
      }),
    );
  };

  const drawScale = (lat, zoom) => {
    const { px, label } = scaleBar(metersPerPixel(lat, zoom));
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
    root.append(info, panel);
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
