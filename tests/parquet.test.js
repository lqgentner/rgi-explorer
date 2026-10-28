/* GeoParquet access reads columns by row group over an AsyncBuffer and caches them. */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

import * as hyparquet from "hyparquet";

globalThis.hyparquet = hyparquet;

const { CARD_COLUMNS, SEARCH_COLUMNS, openParquet, readColumns, readRow, rowGroupOf } =
  await import("../js/parquet.js");

const SCRIPT = fileURLToPath(new URL("../scripts/make_fixture_parquet.py", import.meta.url));
let dir;
let file;

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "rgi-parquet-"));
  execFileSync("python", [SCRIPT, dir]);
  file = path.join(dir, "glaciers.parquet");
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

/** Wraps an AsyncBuffer and counts its slice calls. */
function counting(buffer) {
  const wrapped = {
    byteLength: buffer.byteLength,
    calls: 0,
    slice(start, end) {
      wrapped.calls++;
      return buffer.slice(start, end);
    },
  };
  return wrapped;
}

const open = async () => openParquet(await hyparquet.asyncBufferFromFile(file));

test("reads the search columns across groups", async () => {
  const h = await open();
  const cols = await readColumns(h, SEARCH_COLUMNS);
  assert.equal(cols.rgi_id.length, 5);
  assert.equal(h.groups.length, 3);
  assert.deepEqual(h.groups, [
    { start: 0, count: 2 },
    { start: 2, count: 2 },
    { start: 4, count: 1 },
  ]);
  assert.equal(cols.rgi_id[0], "RGI2000-v7.0-G-11-02596");
  assert.equal(cols.display_name[4], null);
  assert.equal(cols.glac_name[4], null);
});

test("finds the group of a row", async () => {
  const h = await open();
  assert.equal(rowGroupOf(h, 0), 0);
  assert.equal(rowGroupOf(h, 3), 1);
  assert.equal(rowGroupOf(h, 4), 2);
});

test("reads one row's card columns", async () => {
  const h = await open();
  const r = await readRow(h, 0, CARD_COLUMNS);
  assert.equal(r.hypso_z0_m, 1625);
  assert.equal(r.hypso_permille.length, 50);
  assert.deepEqual(r.bbox, { xmin: 7.931361, ymin: 46.397437, xmax: 8.087402, ymax: 46.563295 });
  assert.equal(r.rgi6_links.length, 1);
  assert.equal(r.rgi6_links[0].cluster_id, 81075);
  const r3 = await readRow(h, 3, CARD_COLUMNS);
  assert.equal(r3.rgi6_links.length, 2);
});

test("converts BigInt values to Number inside lists and structs", async () => {
  const h = await open();
  const bigint = (value) =>
    typeof value === "bigint" ||
    (Array.isArray(value) && value.some(bigint)) ||
    (value && typeof value === "object" && !(value instanceof Date) && Object.values(value).some(bigint));
  const cols = await readColumns(h, ["anlys_id", "hypso_permille", "rgi6_links", "src_date"]);
  assert.ok(!Object.values(cols).some((column) => column.some(bigint)));
  assert.ok(cols.src_date[0] instanceof Date);
});

test("a second read of the same group hits the cache", async () => {
  const buffer = counting(await hyparquet.asyncBufferFromFile(file));
  const h = await openParquet(buffer);
  await readColumns(h, CARD_COLUMNS, 0);
  const first = buffer.calls;
  assert.ok(first > 0);
  await readColumns(h, CARD_COLUMNS, 0);
  await readRow(h, 1, CARD_COLUMNS);
  assert.equal(buffer.calls, first);
});

test("concurrent identical reads share one fetch", async () => {
  const solo = counting(await hyparquet.asyncBufferFromFile(file));
  const soloHandle = await openParquet(solo);
  const base = solo.calls;
  await readColumns(soloHandle, CARD_COLUMNS, 0);
  const single = solo.calls - base;

  const buffer = counting(await hyparquet.asyncBufferFromFile(file));
  const h = await openParquet(buffer);
  const start = buffer.calls;
  await Promise.all([readColumns(h, CARD_COLUMNS, 0), readColumns(h, CARD_COLUMNS, 0)]);
  assert.equal(buffer.calls - start, single);
});

test("a failed read is not cached", async () => {
  const buffer = counting(await hyparquet.asyncBufferFromFile(file));
  const h = await openParquet(buffer);
  const slice = buffer.slice;
  buffer.slice = () => Promise.reject(new Error("network down"));
  await assert.rejects(readColumns(h, CARD_COLUMNS, 1), /network down/);
  buffer.slice = slice;
  const cols = await readColumns(h, CARD_COLUMNS, 1);
  assert.equal(cols.hypso_z0_m.length, 2);
});

test("a row outside the file rejects with a RangeError", async () => {
  const h = await open();
  assert.throws(() => rowGroupOf(h, 5), RangeError);
  await assert.rejects(readRow(h, 5, CARD_COLUMNS), RangeError);
  await assert.rejects(readRow(h, -1, CARD_COLUMNS), RangeError);
  await assert.rejects(readRow(h, 1.5, CARD_COLUMNS), RangeError);
});

test("a string source opens through asyncBufferFromUrl", async () => {
  const seen = [];
  const real = hyparquet.asyncBufferFromFile;
  const buffer = await real(file);
  globalThis.hyparquet = { ...hyparquet, asyncBufferFromUrl: async (opts) => (seen.push(opts), buffer) };
  try {
    const h = await openParquet("https://example.test/glaciers.parquet");
    assert.deepEqual(seen, [{ url: "https://example.test/glaciers.parquet" }]);
    assert.equal(h.groups.length, 3);
  } finally {
    globalThis.hyparquet = hyparquet;
  }
});

test("reads the regions fixture", async () => {
  const h = await openParquet(await hyparquet.asyncBufferFromFile(path.join(dir, "regions.parquet")));
  const cols = await readColumns(h, ["full_name", "bbox"]);
  assert.equal(cols.full_name[0], "North Asia");
  assert.deepEqual(cols.bbox[0], { xmin: -180, ymin: 31, xmax: 180, ymax: 78 });
});
