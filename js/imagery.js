/*
 * Esri World Imagery, read through the esri:// protocol. Its deepest level
 * differs from place to place: z13 over parts of Antarctica, z19 and deeper
 * over many towns. Past it the server still answers, with a grey "Map data not
 * yet available" tile. Esri's tilemap says which tiles a level has, in blocks.
 * Where a tile is missing, the protocol enlarges its part of the deepest
 * ancestor that exists, as Esri's own SDK does, so the imagery blurs instead
 * of turning grey.
 */

import { ESRI_TILEMAP, ESRI_TILES, TIMEOUT_MS } from "./config.js";

export const IMAGERY_PROTOCOL = "esri";
export const IMAGERY_TILES = `${IMAGERY_PROTOCOL}://{z}/{x}/{y}`;
const SIZE = 256;
/* The tilemap is read in squares of BLOCK by BLOCK tiles, aligned to BLOCK. */
const BLOCK = 32;

/**
 * A level's tilemap: a 0 or 1 per tile, row by row, over the block `location`.
 * Kept as bytes, a kilobyte a block, as a session may visit many.
 *
 * @typedef {{ data: Uint8Array, location: { left: number, top: number, width: number, height: number } }} Tilemap
 */

/** @type {Map<string, Promise<Tilemap | null>>} */
const tilemaps = new Map();

/**
 * The tilemap of the block that holds tile z/x/y, read once and shared. A
 * read that fails, takes longer than TIMEOUT_MS or that Esri marks invalid
 * resolves to null and is forgotten, so a later tile asks again.
 *
 * @returns {Promise<Tilemap | null>}
 */
function tilemap(z, x, y) {
  const left = x - (x % BLOCK);
  const top = y - (y % BLOCK);
  const key = `${z}/${top}/${left}`;
  let read = tilemaps.get(key);
  if (!read) {
    read = fetch(`${ESRI_TILEMAP}/${key}/${BLOCK}/${BLOCK}`, { signal: AbortSignal.timeout(TIMEOUT_MS) })
      .then((response) => (response.ok ? response.json() : null))
      .catch(() => null)
      .then((json) => {
        if (json?.valid === false || !Array.isArray(json?.data) || !json.location) {
          tilemaps.delete(key);
          return null;
        }
        return { data: Uint8Array.from(json.data), location: json.location };
      });
    tilemaps.set(key, read);
  }
  return read;
}

/** Whether Esri has tile z/x/y. A tilemap that could not be read counts as yes, so the tile is asked for as before. */
async function has(z, x, y) {
  const map = await tilemap(z, x, y);
  if (!map) return true;
  const { left, top, width, height } = map.location;
  const col = x - left;
  const row = y - top;
  if (col < 0 || row < 0 || col >= width || row >= height) return true;
  return map.data[row * width + col] !== 0;
}

const tileUrl = (z, x, y) => ESRI_TILES.replace("{z}", String(z)).replace("{y}", String(y)).replace("{x}", String(x));

/**
 * MapLibre's handler for esri://z/x/y. A tile that exists comes back as
 * Esri's bytes. A missing one comes back as an ImageBitmap: its square of the
 * deepest ancestor that exists, scaled up to the tile's size.
 *
 * @param {{ url: string }} params
 * @param {AbortController} controller
 * @returns {Promise<{ data: ArrayBuffer | ImageBitmap }>}
 */
export async function imageryTile({ url }, controller) {
  const [z, x, y] = url.slice(`${IMAGERY_PROTOCOL}://`.length).split("/").map(Number);
  let depth = z;
  /* MapLibre frees the request's slot only when this settles: an aborted tile stops looking at once. */
  while (depth > 0 && !(await has(depth, x >> (z - depth), y >> (z - depth)))) {
    controller.signal.throwIfAborted();
    depth -= 1;
  }
  const shift = z - depth;
  const response = await fetch(tileUrl(depth, x >> shift, y >> shift), { signal: controller.signal });
  if (!response.ok) throw new Error(`World Imagery tile ${depth}/${x >> shift}/${y >> shift}: HTTP ${response.status}`);
  if (shift === 0) return { data: await response.arrayBuffer() };
  /* Past 8 levels a tile's share of its ancestor is under a pixel: it takes one. */
  const span = SIZE / 2 ** shift;
  const mask = 2 ** shift - 1;
  const blob = await response.blob();
  controller.signal.throwIfAborted();
  const data = await createImageBitmap(
    blob,
    Math.floor((x & mask) * span),
    Math.floor((y & mask) * span),
    Math.max(1, span),
    Math.max(1, span),
    { resizeWidth: SIZE, resizeHeight: SIZE, resizeQuality: "high" },
  );
  return { data };
}
