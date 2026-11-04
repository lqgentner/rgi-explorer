/* GeoParquet access reads columns by row group over an AsyncBuffer and caches them. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import * as hyparquet from "hyparquet";

globalThis.hyparquet = hyparquet;

const { CARD_COLUMNS, SEARCH_COLUMNS, findRow, groupsOfKey, openParquet, readColumns, readRow, rowGroupOf } =
  await import("../js/parquet.js");
const { ROW_GROUP_CACHE } = await import("../js/config.js");

/* The fixtures that scripts/make_fixture_parquet.py writes. */
const dir = fileURLToPath(new URL("./fixtures/parquet/", import.meta.url));
const file = path.join(dir, "glaciers.parquet");
const complexes = path.join(dir, "complexes.parquet");

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
  assert.equal(cols.rgi_id.length, 6);
  assert.equal(h.groups.length, 3);
  assert.deepEqual(h.groups, [
    { start: 0, count: 2 },
    { start: 2, count: 2 },
    { start: 4, count: 2 },
  ]);
  assert.equal(cols.rgi_id[0], "RGI2000-v7.0-G-11-02596");
  assert.equal(cols.display_name[4], null);
  assert.equal("glac_name" in cols, false, "search names come from display_name only");
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
  assert.throws(() => rowGroupOf(h, 6), RangeError);
  await assert.rejects(readRow(h, 6, CARD_COLUMNS), RangeError);
  await assert.rejects(readRow(h, -1, CARD_COLUMNS), RangeError);
  await assert.rejects(readRow(h, 1.5, CARD_COLUMNS), RangeError);
});

test("a string source opens through asyncBufferFromUrl, past the HTTP cache", async () => {
  const seen = [];
  const real = hyparquet.asyncBufferFromFile;
  const buffer = await real(file);
  globalThis.hyparquet = { ...hyparquet, asyncBufferFromUrl: async (opts) => (seen.push(opts), buffer) };
  try {
    const h = await openParquet("https://example.test/glaciers.parquet");
    assert.deepEqual(seen, [{ url: "https://example.test/glaciers.parquet", requestInit: { cache: "no-store" } }]);
    assert.equal(h.groups.length, 3);
  } finally {
    globalThis.hyparquet = hyparquet;
  }
});

/** Serves the glaciers fixture at FILE_URL over HTTP ranges, as the data host does, logging each request. */
async function served() {
  const { servedFetch } = await import("./helpers/served.js");
  const log = [];
  const bytes = readFileSync(file);
  const fetch = servedFetch({ [FILE_URL]: bytes }, log);
  return { fetch, log, size: bytes.length };
}
const FILE_URL = "https://example.test/glaciers.parquet";

test("a known size reads the file without a HEAD request, every read past the HTTP cache", async (t) => {
  const { fetch, log, size } = await served();
  t.mock.property(globalThis, "fetch", fetch);
  const h = await openParquet(FILE_URL, { byteLength: size });
  await readColumns(h, SEARCH_COLUMNS);
  assert.ok(log.length > 1);
  assert.deepEqual(log.filter((r) => r.method === "HEAD"), []);
  assert.deepEqual(log.filter((r) => r.cache !== "no-store"), []);
});

for (const [name, delta] of [
  ["past the end of the file", 1 << 20],
  ["short of the file, as when it grew", -1],
]) {
  test(`a size ${name} falls back to the size a HEAD request gives`, async (t) => {
    const { fetch, log, size } = await served();
    t.mock.property(globalThis, "fetch", fetch);
    const h = await openParquet(FILE_URL, { byteLength: size + delta });
    assert.equal(h.groups.length, 3);
    assert.equal(log.filter((r) => r.method === "HEAD").length, 1);
    assert.deepEqual((await readColumns(h, ["rgi_id"], 0)).rgi_id[0], "RGI2000-v7.0-G-11-02596");
  });
}

test("reads the regions fixture", async () => {
  const h = await openParquet(await hyparquet.asyncBufferFromFile(path.join(dir, "regions.parquet")));
  const cols = await readColumns(h, ["full_name", "bbox"]);
  assert.equal(cols.full_name[0], "North Asia");
  assert.deepEqual(cols.bbox[0], { xmin: -180, ymin: 31, xmax: 180, ymax: 78 });
});

test("cache keys keep a group and its columns apart", async () => {
  const reads = [];
  const groups = Array.from({ length: 11 }, () => ({ num_rows: 1n }));
  globalThis.hyparquet = {
    ...hyparquet,
    parquetMetadataAsync: async () => ({ row_groups: groups }),
    parquetReadObjects: async ({ columns, rowStart }) => {
      reads.push(`${rowStart}:${columns}`);
      return [Object.fromEntries(columns.map((c) => [c, `${c}@${rowStart}`]))];
    },
  };
  try {
    const h = await openParquet({});
    const one = await readColumns(h, ["0a"], 1);
    const ten = await readColumns(h, ["a"], 10);
    assert.deepEqual(one["0a"], ["0a@1"]);
    assert.deepEqual(ten.a, ["a@10"]);
    const all = await readColumns(h, ["a"]);
    assert.equal(all.a.length, 11);
    assert.deepEqual(all.a.slice(9), ["a@9", "a@10"]);
    assert.equal(reads.filter((r) => r === "10:a").length, 1);
  } finally {
    globalThis.hyparquet = hyparquet;
  }
});

test("finds the row group of a key from the column statistics", async () => {
  const h = await openParquet(await hyparquet.asyncBufferFromFile(complexes));
  assert.deepEqual(groupsOfKey(h, "rgi_id", "RGI2000-v7.0-C-03-00002"), [0]);
  assert.deepEqual(groupsOfKey(h, "rgi_id", "RGI2000-v7.0-C-11-01323"), [1]);
  assert.deepEqual(groupsOfKey(h, "rgi_id", "RGI2000-v7.0-C-01-00001"), []);
  assert.deepEqual(groupsOfKey(h, "rgi_id", "RGI2000-v7.0-C-19-00001"), []);
  assert.deepEqual(groupsOfKey(h, "no_such_column", "x"), h.groups.map((_, i) => i), "no statistics: any group may hold it");
});

test("findRow reads only the groups whose statistics span the key", async () => {
  const handle = await open();
  /* The fixture is not sorted: G-11-00004 lies in the third group, inside the first group's range too. */
  const ids = (await readColumns(handle, ["rgi_id"])).rgi_id;
  assert.equal(await findRow(handle, "rgi_id", "RGI2000-v7.0-G-11-00004"), ids.indexOf("RGI2000-v7.0-G-11-00004"));
  assert.equal(await findRow(handle, "rgi_id", "RGI2000-v7.0-G-11-00001"), ids.indexOf("RGI2000-v7.0-G-11-00001"));
  assert.equal(await findRow(handle, "rgi_id", "RGI2000-v7.0-G-11-00009"), null, "spanned but absent");
  assert.equal(await findRow(handle, "rgi_id", "RGI2000-v7.0-G-19-00001"), null, "outside every group");
});

test("findRow reads every group of a file without statistics", async () => {
  const handle = await open();
  for (const group of handle.metadata.row_groups) for (const column of group.columns) delete column.meta_data.statistics;
  const ids = (await readColumns(handle, ["rgi_id"])).rgi_id;
  assert.equal(await findRow(handle, "rgi_id", "RGI2000-v7.0-G-17-04760"), ids.indexOf("RGI2000-v7.0-G-17-04760"));
  assert.equal(await findRow(handle, "rgi_id", "RGI2000-v7.0-G-19-00001"), null);
});

test("findRow reads the columns asked with the key, so readRow needs no other read", async () => {
  const buffer = counting(await hyparquet.asyncBufferFromFile(complexes));
  const handle = await openParquet(buffer);
  const columns = ["rgi_id", "area_km2"];
  const row = await findRow(handle, "rgi_id", "RGI2000-v7.0-C-11-01323", columns);
  const calls = buffer.calls;
  assert.equal((await readRow(handle, row, columns)).rgi_id, "RGI2000-v7.0-C-11-01323");
  assert.equal(buffer.calls, calls);
});

test("the glaciers fixture names each glacier's complex", async () => {
  const cols = await readColumns(await open(), ["rgi_id", "complex_id"]);
  assert.equal(cols.complex_id[cols.rgi_id.indexOf("RGI2000-v7.0-G-11-00003")], "RGI2000-v7.0-C-11-01323");
  assert.equal(cols.complex_id[cols.rgi_id.indexOf("RGI2000-v7.0-G-11-00001")], "RGI2000-v7.0-C-11-00001");
});

/**
 * Runs `body` with a fake hyparquet over `count` one-row groups. Each read is
 * logged as "rowStart:columns"; a read that `fail(read)` names rejects.
 */
async function withFakeFile(count, body, fail = () => false) {
  const reads = [];
  globalThis.hyparquet = {
    ...hyparquet,
    parquetMetadataAsync: async () => ({ row_groups: Array.from({ length: count }, () => ({ num_rows: 1n })) }),
    parquetReadObjects: async ({ columns, rowStart }) => {
      const read = `${rowStart}:${columns}`;
      reads.push(read);
      await new Promise((resolve) => setTimeout(resolve));
      if (fail(read)) throw new Error("network down");
      return [Object.fromEntries(columns.map((c) => [c, `${c}@${rowStart}`]))];
    },
  };
  try {
    await body(await openParquet({}), reads);
  } finally {
    globalThis.hyparquet = hyparquet;
  }
}

test("a read fetches only the columns its row group lacks", async () => {
  await withFakeFile(2, async (h, reads) => {
    await readColumns(h, ["a", "b"], 0);
    assert.deepEqual(await readColumns(h, ["a", "c"], 0), { a: ["a@0"], c: ["c@0"] });
    assert.deepEqual(reads, ["0:a,b", "0:c"]);
  });
});

test("concurrent overlapping reads share the columns in flight", async () => {
  await withFakeFile(2, async (h, reads) => {
    const [ab, ac] = await Promise.all([readColumns(h, ["a", "b"], 0), readColumns(h, ["a", "c"], 0)]);
    assert.deepEqual(ab, { a: ["a@0"], b: ["b@0"] });
    assert.deepEqual(ac, { a: ["a@0"], c: ["c@0"] });
    assert.deepEqual(reads, ["0:a,b", "0:c"]);
  });
});

test("row groups past the cache size are evicted, the least recently read first", async () => {
  assert.ok(ROW_GROUP_CACHE >= 2);
  await withFakeFile(ROW_GROUP_CACHE + 1, async (h, reads) => {
    for (let group = 0; group < ROW_GROUP_CACHE; group++) await readColumns(h, ["a"], group);
    await readColumns(h, ["a"], 0); /* group 1 is now the least recent */
    await readColumns(h, ["a"], ROW_GROUP_CACHE);
    await readColumns(h, ["a"], 0);
    assert.equal(reads.length, ROW_GROUP_CACHE + 1, "group 0 stayed");
    assert.deepEqual(await readColumns(h, ["a"], 1), { a: ["a@1"] });
    assert.deepEqual(reads.slice(-1), ["1:a"], "group 1 was evicted and is read again");
  });
});

test("a group evicted while its read is in flight still resolves and is read again later", async () => {
  await withFakeFile(ROW_GROUP_CACHE + 1, async (h, reads) => {
    const pending = readColumns(h, ["a"], 0);
    await Promise.all(Array.from({ length: ROW_GROUP_CACHE }, (_, i) => readColumns(h, ["a"], i + 1)));
    assert.deepEqual(await pending, { a: ["a@0"] });
    assert.deepEqual(await readColumns(h, ["a", "b"], 0), { a: ["a@0"], b: ["b@0"] });
    assert.deepEqual(reads.slice(-1), ["0:a,b"]);
  });
});

test("a failed read is dropped and tried again, and its group keeps the columns it had", async () => {
  let down = true;
  await withFakeFile(
    2,
    async (h, reads) => {
      await readColumns(h, ["a"], 0);
      await assert.rejects(readColumns(h, ["a", "b"], 0), /network down/);
      down = false;
      assert.deepEqual(await readColumns(h, ["a", "b"], 0), { a: ["a@0"], b: ["b@0"] });
      assert.deepEqual(reads, ["0:a", "0:b", "0:b"]);
    },
    (read) => down && read.endsWith(":b"),
  );
});

test("a group read takes a column the whole file has already read", async () => {
  await withFakeFile(3, async (h, reads) => {
    await readColumns(h, ["a"]);
    const count = reads.length;
    assert.deepEqual(await readColumns(h, ["a", "b"], 2), { a: ["a@2"], b: ["b@2"] });
    await readColumns(h, ["a"]);
    assert.deepEqual(reads.slice(count), ["2:b"], "neither the group nor the whole column reads `a` again");
  });
});
