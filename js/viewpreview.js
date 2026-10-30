/*
 * The imagery preview of the current view: one small Esri export of a
 * north-up square of Web Mercator around the map's centre.
 */

import { ESRI_EXPORT } from "./config.js";

/** How many screen pixels around the map's centre a preview shows, across. */
export const PREVIEW_SPAN = 320;

const TILE_SIZE = 512;
const EARTH_RADIUS = 6378137;
const MAX_LAT = 85.05;

const clampLat = (lat) => Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
const wrapLng = (lng) => ((((lng + 180) % 360) + 360) % 360) - 180;

/** The Esri World Imagery export URL for the preview of the view, `px` pixels square. */
export function imageryUrl(map, px) {
  const { lng, lat } = map.getCenter();
  const metres = ((2 * Math.PI * EARTH_RADIUS) / (TILE_SIZE * 2 ** map.getZoom())) * PREVIEW_SPAN;
  const x = (EARTH_RADIUS * wrapLng(lng) * Math.PI) / 180;
  const y = EARTH_RADIUS * Math.log(Math.tan(Math.PI / 4 + (clampLat(lat) * Math.PI) / 360));
  const extent = [x - metres / 2, y - metres / 2, x + metres / 2, y + metres / 2].map((v) => Math.round(v));
  return `${ESRI_EXPORT}?bbox=${extent.join(",")}&bboxSR=3857&imageSR=3857&size=${px},${px}&format=jpg&f=image`;
}
