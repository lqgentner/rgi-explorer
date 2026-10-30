/*
 * The layer previews of the current view: a north-up square of Web Mercator
 * around the map's centre. The RGI previews read the tiles the map has already
 * loaded, so they cost no download. The imagery preview is one small Esri
 * export.
 */

import { ESRI_EXPORT } from "./config.js";

/** How many screen pixels around the map's centre a preview shows, across. */
export const PREVIEW_SPAN = 320;

/** The radius of a glacier dot, in screen pixels, as the map draws it at mid zoom. */
const DOT_PX = 2;
const TILE_SIZE = 512;
const EARTH_RADIUS = 6378137;
const MAX_LAT = 85.05;

const clampLat = (lat) => Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
const wrapLng = (lng) => ((((lng + 180) % 360) + 360) % 360) - 180;

/** World pixels of a `[lng, lat]` in a Web Mercator world `world` pixels wide. */
function worldXY([lng, lat], world) {
  const phi = (clampLat(lat) * Math.PI) / 180;
  return [((lng + 180) / 360) * world, (0.5 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / (2 * Math.PI)) * world];
}

/** The rings, lines or points of a GeoJSON geometry, and whether they close or are dots. */
function partsOf(geometry) {
  const { type, coordinates } = geometry ?? {};
  if (type === "Point") return { parts: [[coordinates]], dots: true };
  if (type === "MultiPoint") return { parts: coordinates.map((point) => [point]), dots: true };
  if (type === "LineString") return { parts: [coordinates], closed: false };
  if (type === "MultiLineString") return { parts: coordinates, closed: false };
  if (type === "Polygon") return { parts: coordinates, closed: true };
  if (type === "MultiPolygon") return { parts: coordinates.flat(), closed: true };
  return { parts: [], closed: false };
}

/** An SVG path of a circle of radius `r` around `[x, y]`: two half arcs. */
function circle([x, y], r) {
  const [left, top, radius, across] = [x - r, y, r, 2 * r].map((v) => v.toFixed(1));
  return `M${left} ${top}a${radius} ${radius} 0 1 0 ${across} 0a${radius} ${radius} 0 1 0 -${across} 0`;
}

/** Whether the segment from `a` to `b` crosses the rectangle `[x0, y0, x1, y1]`. */
function crosses([ax, ay], [bx, by], [x0, y0, x1, y1]) {
  let [t0, t1] = [0, 1];
  const [dx, dy] = [bx - ax, by - ay];
  for (const [p, q] of [
    [-dx, ax - x0],
    [dx, x1 - ax],
    [-dy, ay - y0],
    [dy, y1 - ay],
  ]) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return false;
  }
  return true;
}

/**
 * The shapes of `sourceLayers` around the view's centre, scaled to a square
 * `size` pixels wide: `{ clips, layers }`, or null when the map cannot be
 * read. `layers` maps each source layer to `{ clip, d, seen, properties }`
paths; `seen` says whether a line of the path shows, not only a fill.
 * `clips` holds the rectangle `{ key, x, y, width, height }` of each tile a
 * path came from. A tile cuts polygons a little outside its border, so a path
 * drawn inside its tile's rectangle hides the cut.
 */
export function viewShapes(map, sourceLayers, size) {
  const world = TILE_SIZE * 2 ** map.getZoom();
  const { lng, lat } = map.getCenter();
  const [cx, cy] = worldXY([wrapLng(lng), lat], world);
  const scale = size / PREVIEW_SPAN;
  const tiles = new Map();

  /* A tile's place in the preview, or null when it lies outside. */
  function place(feature) {
    const { x, y, z } = feature.tile ?? {};
    if (!Number.isInteger(z)) return { key: null, offset: 0, rect: null };
    const key = `${z}/${x}/${y}`;
    if (!tiles.has(key)) {
      const side = world / 2 ** z;
      /* The copy of the tile nearest the centre, across the antimeridian if need be. */
      const offset = Math.round(((x + 0.5) * side - cx) / world) * world;
      const rect = {
        key,
        x: (x * side - offset - cx) * scale + size / 2,
        y: (y * side - cy) * scale + size / 2,
        width: side * scale,
        height: side * scale,
      };
      const inside = rect.x < size && rect.y < size && rect.x + rect.width > 0 && rect.y + rect.height > 0;
      tiles.set(key, inside ? { key, offset, rect } : null);
    }
    return tiles.get(key);
  }

  /*
   * The SVG path of a feature in a tile, and whether one of its segments
   * shows; null when it lies outside the preview.
   */
  function pathOf(geometry, tile) {
    const { parts, closed, dots } = partsOf(geometry);
    const { rect } = tile;
    const view = rect
      ? [Math.max(0, rect.x), Math.max(0, rect.y), Math.min(size, rect.x + rect.width), Math.min(size, rect.y + rect.height)]
      : [0, 0, size, size];
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    let seen = false;
    const d = parts
      .map((part) => {
        const points = part.map((lngLat) => {
          const [wx, wy] = worldXY(lngLat, world);
          return [(wx - tile.offset - cx) * scale + size / 2, (wy - cy) * scale + size / 2];
        });
        points.forEach(([x, y], i) => {
          [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
          if (!seen && i > 0) seen = crosses(points[i - 1], [x, y], view);
        });
        if (dots) {
          if (!seen) seen = crosses(points[0], points[0], view);
          return circle(points[0], DOT_PX * scale);
        }
        if (points.length < 2) return "";
        return `M${points.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join("L")}${closed ? "Z" : ""}`;
      })
      .join("");
    return d && x0 < size && y0 < size && x1 > 0 && y1 > 0 ? { d, seen } : null;
  }

  const layers = {};
  for (const sourceLayer of sourceLayers) {
    let features;
    try {
      features = map.querySourceFeatures("data", { sourceLayer });
    } catch {
      return null;
    }
    layers[sourceLayer] = [];
    for (const feature of features) {
      const tile = place(feature);
      if (!tile) continue;
      const path = pathOf(feature.geometry, tile);
      if (path) layers[sourceLayer].push({ clip: tile.key, ...path, properties: feature.properties ?? {} });
    }
  }
  const used = new Set(Object.values(layers).flatMap((paths) => paths.map((path) => path.clip)));
  const clips = [...tiles.values()].filter((tile) => tile && used.has(tile.key)).map((tile) => tile.rect);
  return { clips, layers };
}

/** The Esri World Imagery export URL for the preview of the view, `px` pixels square. */
export function imageryUrl(map, px) {
  const { lng, lat } = map.getCenter();
  const metres = ((2 * Math.PI * EARTH_RADIUS) / (TILE_SIZE * 2 ** map.getZoom())) * PREVIEW_SPAN;
  const x = (EARTH_RADIUS * wrapLng(lng) * Math.PI) / 180;
  const y = EARTH_RADIUS * Math.log(Math.tan(Math.PI / 4 + (clampLat(lat) * Math.PI) / 360));
  const extent = [x - metres / 2, y - metres / 2, x + metres / 2, y + metres / 2].map((v) => Math.round(v));
  return `${ESRI_EXPORT}?bbox=${extent.join(",")}&bboxSR=3857&imageSR=3857&size=${px},${px}&format=jpg&f=image`;
}
