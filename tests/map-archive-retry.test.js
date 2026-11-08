/*
 * A failed read of the RGI archive is retried with a fresh pmtiles reader:
 * pmtiles keeps a failed header read for the life of its reader. The tests run
 * in order on one map and one clock.
 */

import assert from "node:assert/strict";
import { mock, test } from "node:test";

import * as pmtiles from "pmtiles";

import { loadCatalog } from "../js/catalog.js";
import { parseState } from "../js/state.js";
import { load, loadPage } from "./helpers/browser.js";
import { servedFetch } from "./helpers/served.js";

const ARCHIVE = "https://data.source.coop/lqgentner/rgi/v7.0/rgi7.0.pmtiles";
const TILEJSON = { url: `pmtiles://${ARCHIVE}`, type: "json" };

const log = [];
let page;
let handler = null;
const reads = () => log.filter((r) => r.url === ARCHIVE).length;
const since = (mark) => page.map.calls.slice(mark);
/* Ask the protocol for the archive's TileJSON, as the source does, and wait for the read to fail. */
const askHeader = () => handler(TILEJSON, new AbortController()).catch(() => {});
/* The read of a missing archive fails, and MapLibre names the source on its error. */
const sourceError = () => page.map.fire("error", { error: new Error("404"), sourceId: "data" });
const tileError = (z, x, y) =>
  page.map.fire("error", { error: new Error("404"), sourceId: "data", tile: { tileID: { canonical: { z, x, y } } } });

test.before(async () => {
  mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const url = "https://lqgentner.github.io/rgi-explorer/";
  page = await loadPage({ url, fetch: servedFetch({}, log) });
  globalThis.pmtiles = pmtiles;
  globalThis.maplibregl.addProtocol = (name, fn) => {
    if (name === "pmtiles") handler = fn;
  };
  const { createMap } = await load("js/map.js");
  const catalog = await loadCatalog("https://data.source.coop/lqgentner/rgi/catalog.json");
  const ready = createMap(page.document.getElementById("map"), catalog, parseState(new URL(url)));
  mock.timers.runAll();
  await ready;
});

test.after(() => mock.timers.reset());

test("a failed header read stays failed in its pmtiles reader", async () => {
  await askHeader();
  const first = reads();
  assert.ok(first > 0, "the archive was not read");
  await askHeader();
  assert.equal(reads(), first, "the reader asked the archive again on its own");
});

test("a failed source is read again 2 s later, by a fresh reader", async () => {
  const mark = page.map.calls.length;
  sourceError();
  sourceError();
  mock.timers.tick(1999);
  assert.deepEqual(since(mark), []);
  mock.timers.tick(1);
  assert.deepEqual(since(mark), [`setUrl pmtiles://${ARCHIVE}`], "one retry for both errors");
  const before = reads();
  await askHeader();
  assert.ok(reads() > before, "the retry kept the failed reader");
});

test("the next failure waits twice as long", () => {
  const mark = page.map.calls.length;
  sourceError();
  mock.timers.tick(3999);
  assert.deepEqual(since(mark), []);
  mock.timers.tick(1);
  assert.deepEqual(since(mark), [`setUrl pmtiles://${ARCHIVE}`]);
});

test("failed tiles reload alone, each once", () => {
  const mark = page.map.calls.length;
  tileError(3, 4, 2);
  tileError(3, 4, 2);
  tileError(3, 5, 2);
  mock.timers.tick(8000);
  assert.deepEqual(since(mark), [
    `refreshTiles data ${JSON.stringify([{ x: 4, y: 2, z: 3 }, { x: 5, y: 2, z: 3 }])}`,
  ]);
});

test("aborted reads and other sources' errors are not retried", () => {
  const mark = page.map.calls.length;
  const abort = new Error("aborted");
  abort.name = "AbortError";
  page.map.fire("error", { error: abort, sourceId: "data" });
  page.map.fire("error", { error: new Error("404"), sourceId: "openmaptiles" });
  mock.timers.tick(120_000);
  assert.deepEqual(since(mark), []);
});

test("after six retries in a row the page waits, until the browser is online again", () => {
  /* Three retries so far; the fourth to sixth wait 16, 32 and 60 s. */
  for (const wait of [16_000, 32_000, 60_000]) {
    sourceError();
    mock.timers.tick(wait);
  }
  const mark = page.map.calls.length;
  sourceError();
  mock.timers.tick(10 * 60_000);
  assert.deepEqual(since(mark), [], "a seventh retry");
  page.window.dispatchEvent(new page.window.Event("online"));
  assert.deepEqual(since(mark), [`setUrl pmtiles://${ARCHIVE}`]);
});

test("a failure five minutes after the last one starts again at 2 s", () => {
  sourceError();
  mock.timers.tick(2000);
  sourceError();
  mock.timers.tick(4000);
  /* Without the pause the next retry would wait 8 s. */
  mock.timers.tick(5 * 60_000 + 1);
  const mark = page.map.calls.length;
  sourceError();
  mock.timers.tick(2000);
  assert.deepEqual(since(mark), [`setUrl pmtiles://${ARCHIVE}`]);
});
