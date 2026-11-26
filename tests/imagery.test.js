/* The esri:// protocol: World Imagery's tiles, and the deepest real ancestor enlarged where a level has none. */

import assert from "node:assert/strict";
import test from "node:test";

import { ESRI_TILEMAP } from "../js/config.js";
import { IMAGERY_TILES, imageryTile } from "../js/imagery.js";

const TILE = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/";
const TILEMAP = /\/tilemap\/(\d+)\/(\d+)\/(\d+)\/(\d+)\/(\d+)$/;
const BYTES = new Uint8Array([0xff, 0xd8, 0xff]);

/*
 * A fake Esri whose imagery reaches level `deepest(x, y)` at a z13 tile. The
 * module keeps the tilemaps it read, so each test uses its own z13 tile.
 */
function esri(deepest, { tilemapFails = 0, tilemap = (json) => json } = {}) {
  const log = [];
  /* Every level above 13 has every tile; below, `deepest` decides from the z13 tile above. */
  const has = (z, x, y) => z < 13 || z <= deepest(x >> (z - 13), y >> (z - 13));
  globalThis.fetch = async (url, options = {}) => {
    log.push({ url, signal: options.signal });
    const map = TILEMAP.exec(url);
    if (map) {
      if (tilemapFails > 0) {
        tilemapFails -= 1;
        return { ok: false, status: 503, json: async () => ({}) };
      }
      const [z, top, left, height, width] = map.slice(1).map(Number);
      const data = [];
      for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) data.push(has(z, left + col, top + row) ? 1 : 0);
      return { ok: true, status: 200, json: async () => tilemap({ data, location: { left, top, width, height }, valid: true }) };
    }
    /* Esri answers a missing tile too, with its grey placeholder: the tests check which tiles were asked for. */
    return { ok: true, status: 200, arrayBuffer: async () => BYTES.buffer, blob: async () => new Blob([BYTES]) };
  };
  const crops = [];
  globalThis.createImageBitmap = async (blob, ...args) => {
    crops.push(args);
    return { bitmap: true };
  };
  return { log, crops, tiles: () => log.filter((r) => r.url.startsWith(TILE)).map((r) => r.url.slice(TILE.length)) };
}

const tile = (z, x, y, controller = new AbortController()) =>
  imageryTile({ url: IMAGERY_TILES.replace("{z}", z).replace("{x}", x).replace("{y}", y) }, controller);

test("a tile Esri has comes back as its bytes, after one tilemap read for its block", async () => {
  const { log, tiles, crops } = esri(() => 19);
  const controller = new AbortController();
  const { data } = await tile(14, 100, 200, controller);
  assert.equal(data, BYTES.buffer);
  await tile(14, 101, 200);
  assert.deepEqual(tiles(), ["14/200/100", "14/200/101"], "Esri's URL is z/y/x");
  assert.deepEqual(
    log.filter((r) => r.url.startsWith(ESRI_TILEMAP)).map((r) => r.url),
    [`${ESRI_TILEMAP}/14/192/96/32/32`],
    "one read per 32 by 32 block",
  );
  assert.equal(log.find((r) => r.url.startsWith(TILE)).signal, controller.signal, "the tile read stops with MapLibre's");
  assert.equal(crops.length, 0);
});

test("past Esri's deepest level a tile is its square of the deepest tile there, scaled up", async () => {
  /* Abbot-like: imagery ends at z13 here. */
  const { tiles, crops } = esri(() => 13);
  const { data } = await tile(14, 14631, 12318);
  assert.deepEqual(data, { bitmap: true });
  assert.deepEqual(tiles(), ["13/6159/7315"]);
  assert.deepEqual(crops, [[128, 0, 128, 128, { resizeWidth: 256, resizeHeight: 256, resizeQuality: "high" }]]);
});

test("three levels past the deepest, a tile takes a 32 pixel square at its place in the ancestor", async () => {
  const { tiles, crops } = esri(() => 13);
  /* z16 x = 8 * 1000 + 5, y = 8 * 2000 + 2. */
  await tile(16, 8005, 16002);
  assert.deepEqual(tiles(), ["13/2000/1000"]);
  assert.deepEqual(crops[0].slice(0, 4), [160, 64, 32, 32]);
});

test("more than eight levels past the deepest, a tile takes a single pixel", async () => {
  const { tiles, crops } = esri(() => 13);
  /* z23 is ten levels below z13: 1024 tiles across one, a quarter pixel each. */
  await tile(23, 3000 * 1024 + 1023, 4000 * 1024 + 4);
  assert.deepEqual(tiles(), ["13/4000/3000"]);
  assert.deepEqual(crops[0].slice(0, 4), [255, 1, 1, 1]);
});

test("a tilemap that cannot be read lets the tile be asked for, and is read again next time", async () => {
  const { log, tiles, crops } = esri(() => 13, { tilemapFails: 1 });
  const first = await tile(14, 2 * 5000, 2 * 6000);
  assert.equal(first.data, BYTES.buffer);
  assert.deepEqual(tiles(), ["14/12000/10000"], "asked for as before the tilemap existed");
  const second = await tile(14, 2 * 5000, 2 * 6000);
  const reads = log.filter((r) => r.url.startsWith(ESRI_TILEMAP)).map((r) => r.url);
  assert.equal(reads[0], reads[1], "the failed block is read again");
  assert.deepEqual(second.data, { bitmap: true });
  assert.deepEqual(tiles(), ["14/12000/10000", "13/6000/5000"], "and now finds the tile missing");
  assert.deepEqual(crops[0].slice(0, 4), [0, 0, 128, 128]);
});

test("a tilemap Esri marks invalid counts as unknown: the tile is asked for", async () => {
  const { tiles } = esri(() => 13, { tilemap: (json) => ({ ...json, valid: false }) });
  await tile(14, 2 * 5100, 2 * 6100);
  assert.deepEqual(tiles(), ["14/12200/10200"]);
});

test("a tile outside the block Esri answered for counts as present", async () => {
  const { tiles } = esri(() => 13, { tilemap: (json) => ({ ...json, location: { ...json.location, width: 1, height: 1 } }) });
  /* The block starts at column 10208, row 12224: the tile is not its first. */
  await tile(14, 2 * 5105, 2 * 6115);
  assert.deepEqual(tiles(), ["14/12230/10210"]);
});

test("the read of an ancestor stops with MapLibre's request too", async () => {
  const { log } = esri(() => 13);
  const controller = new AbortController();
  await tile(15, 4 * 5200, 4 * 6200, controller);
  const read = log.find((r) => !r.url.startsWith(ESRI_TILEMAP));
  assert.equal(read.url, `${TILE}13/6200/5200`);
  assert.equal(read.signal, controller.signal);
});

test("an abort while looking for the deepest tile stops the search and reads no tile", async () => {
  const { log, tiles } = esri(() => 13);
  const controller = new AbortController();
  const read = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const response = await read(url, options);
    if (url.startsWith(ESRI_TILEMAP)) controller.abort();
    return response;
  };
  await assert.rejects(tile(16, 8 * 5300, 8 * 6300, controller), { name: "AbortError" });
  assert.equal(log.filter((r) => r.url.startsWith(ESRI_TILEMAP)).length, 1, "no level past the first");
  assert.deepEqual(tiles(), []);
});

test("tiles of one block that arrive together share one tilemap read", async () => {
  const { log, tiles } = esri(() => 13);
  await Promise.all([tile(14, 2 * 5400, 2 * 6400), tile(14, 2 * 5400 + 1, 2 * 6400), tile(14, 2 * 5400, 2 * 6400 + 1)]);
  const reads = log.filter((r) => r.url.startsWith(ESRI_TILEMAP)).map((r) => r.url);
  assert.deepEqual(reads, [`${ESRI_TILEMAP}/14/12800/10784/32/32`, `${ESRI_TILEMAP}/13/6400/5376/32/32`]);
  assert.deepEqual(tiles(), ["13/6400/5400", "13/6400/5400", "13/6400/5400"]);
});

test("z0 is the whole world, asked for as it is", async () => {
  const { tiles, crops } = esri(() => 13);
  const { data } = await tile(0, 0, 0);
  assert.equal(data, BYTES.buffer);
  assert.deepEqual(tiles(), ["0/0/0"]);
  assert.equal(crops.length, 0);
});

test("a tile read that fails rejects, for MapLibre to report", async () => {
  esri(() => 19);
  const ok = globalThis.fetch;
  globalThis.fetch = async (url, options) => (url.startsWith(TILE) ? { ok: false, status: 500 } : ok(url, options));
  await assert.rejects(tile(14, 7000, 7000), /HTTP 500/);
});
