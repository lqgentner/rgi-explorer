/*
 * The page's pmtiles readers forget a failed read, through the real pmtiles
 * library and a tiny archive: a header, a root directory that points to one
 * leaf directory, and one tile at 0/0/0.
 */

import assert from "node:assert/strict";
import test from "node:test";

import * as pmtiles from "pmtiles";

globalThis.pmtiles = pmtiles;
const { forgetfulCache } = await import("../js/archive.js");

const URL_ = "https://example.org/tiny.pmtiles";
const TILE = new Uint8Array([1, 2, 3, 4]);

/* A directory of one entry, uncompressed: count, tile ID delta, run length, length, offset + 1. */
const directory = (runLength, length) => new Uint8Array([1, 0, runLength, length, 1]);

function archive() {
  const root = directory(0, 5);
  const metadata = new TextEncoder().encode("{}");
  const leaf = directory(1, TILE.length);
  const header = new Uint8Array(127);
  const view = new DataView(header.buffer);
  header.set(new TextEncoder().encode("PMTiles"), 0);
  header[7] = 3;
  const sections = [
    [8, root],
    [24, metadata],
    [40, leaf],
    [56, TILE],
  ];
  let offset = 127;
  for (const [at, bytes] of sections) {
    view.setBigUint64(at, BigInt(offset), true);
    view.setBigUint64(at + 8, BigInt(bytes.length), true);
    offset += bytes.length;
  }
  for (const at of [72, 80, 88]) view.setBigUint64(at, 1n, true);
  header[97] = 1; /* no internal compression */
  header[98] = 1; /* no tile compression */
  header[99] = 1; /* vector tiles */
  view.setInt32(102, -1800000000, true);
  view.setInt32(106, -850000000, true);
  view.setInt32(110, 1800000000, true);
  view.setInt32(114, 850000000, true);
  const bytes = new Uint8Array(offset);
  bytes.set(header, 0);
  offset = 127;
  for (const [, section] of sections) {
    bytes.set(section, offset);
    offset += section.length;
  }
  return bytes;
}

const LEAF_AT = 127 + 5 + 2;

/** Serves the archive's byte ranges; a read that starts at a byte in `failing` fails once with a 503. */
function serve(failing) {
  const bytes = archive();
  const reads = [];
  globalThis.fetch = async (url, { headers }) => {
    const [, start, end] = /bytes=(\d+)-(\d+)/.exec(new Headers(headers).get("range")).map(Number);
    reads.push(start);
    if (failing.delete(start)) return new Response(null, { status: 503 });
    const body = bytes.slice(start, Math.min(end + 1, bytes.length));
    return new Response(body, { status: 206, headers: { "Content-Length": String(body.length) } });
  };
  return reads;
}

const tile = async (reader) => new Uint8Array((await reader.getZxy(0, 0, 0)).data);

test("pmtiles' own cache keeps a failed header read, which is why the page brings its own", async () => {
  serve(new Set([0]));
  const reader = new pmtiles.PMTiles(URL_);
  await assert.rejects(reader.getZxy(0, 0, 0), /503/);
  await assert.rejects(reader.getZxy(0, 0, 0), /503/, "if this passes, pmtiles forgets on its own: drop js/archive.js");
});

test("a failed header read is forgotten, and the next read gets the tile", async () => {
  const reads = serve(new Set([0]));
  const reader = new pmtiles.PMTiles(URL_, forgetfulCache());
  await assert.rejects(reader.getZxy(0, 0, 0), /503/);
  assert.deepEqual(await tile(reader), TILE);
  assert.deepEqual(reads, [0, 0, LEAF_AT, LEAF_AT + 5]);
});

test("a failed leaf directory read is forgotten too", async () => {
  const reads = serve(new Set([LEAF_AT]));
  const reader = new pmtiles.PMTiles(URL_, forgetfulCache());
  await assert.rejects(reader.getZxy(0, 0, 0), /503/);
  assert.deepEqual(await tile(reader), TILE);
  assert.deepEqual(reads, [0, LEAF_AT, LEAF_AT, LEAF_AT + 5], "the header stays cached");
});

test("a read that succeeds stays cached", async () => {
  const reads = serve(new Set());
  const reader = new pmtiles.PMTiles(URL_, forgetfulCache());
  assert.deepEqual(await tile(reader), TILE);
  assert.deepEqual(await tile(reader), TILE);
  assert.deepEqual(reads, [0, LEAF_AT, LEAF_AT + 5, LEAF_AT + 5], "only the tile is read again");
});
