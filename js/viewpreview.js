/*
 * The imagery preview of the current view: one small Esri export of a
 * north-up square of Web Mercator around the map's centre, moved inside the
 * world where it would cross an edge. Esri draws past an edge in black.
 */

import { EARTH_RADIUS, ESRI_EXPORT, mercatorX, mercatorY, TILE_SIZE } from "./config.js";

/** How many screen pixels around the map's centre a preview shows, across. */
export const PREVIEW_SPAN = 320;

/* Half the Web Mercator world's width and height, in metres. */
const HALF_WORLD = Math.PI * EARTH_RADIUS;

const wrapLng = (lng) => ((((lng + 180) % 360) + 360) % 360) - 180;
/* A centre that keeps a box `metres` across inside the world. */
const inside = (v, metres) => Math.max(-HALF_WORLD + metres / 2, Math.min(HALF_WORLD - metres / 2, v));

/** The Esri World Imagery export URL for the preview of the view, `px` pixels square. */
export function imageryUrl(map, px) {
  const { lng, lat } = map.getCenter();
  const metres = Math.min(2 * HALF_WORLD, ((2 * HALF_WORLD) / (TILE_SIZE * 2 ** map.getZoom())) * PREVIEW_SPAN);
  const x = inside(mercatorX(wrapLng(lng)), metres);
  const y = inside(mercatorY(lat), metres);
  const extent = [x - metres / 2, y - metres / 2, x + metres / 2, y + metres / 2].map((v) => Math.round(v));
  return `${ESRI_EXPORT}?bbox=${extent.join(",")}&bboxSR=3857&imageSR=3857&size=${px},${px}&format=jpg&f=image`;
}
