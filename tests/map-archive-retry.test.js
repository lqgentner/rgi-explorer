/*
 * A failed read of the RGI source is tried again: MapLibre asks for neither
 * the source's TileJSON nor a failed tile again by itself. The tests run in
 * order on one map and one clock.
 */

import assert from "node:assert/strict";
import { mock, test } from "node:test";

import { loadCatalog } from "../js/catalog.js";
import { parseState } from "../js/state.js";
import { load, loadPage } from "./helpers/browser.js";
import { servedFetch } from "./helpers/served.js";

const ARCHIVE = "https://data.source.coop/lqgentner/rgi/v7.0/rgi7.0.pmtiles";
const SET_URL = `setUrl pmtiles://${ARCHIVE}`;

let page;
const protocols = [];
const since = (mark) => page.map.calls.slice(mark);
const tile = (z, x, y) => ({ tileID: { canonical: { z, x, y } } });
const sourceError = () => page.map.fire("error", { error: new Error("503"), sourceId: "data" });
const tileError = (z, x, y) => page.map.fire("error", { error: new Error("503"), sourceId: "data", tile: tile(z, x, y) });
const tileLoaded = (z, x, y) => page.map.fire("sourcedata", { sourceId: "data", tile: tile(z, x, y) });
const metadataLoaded = () => page.map.fire("sourcedata", { sourceId: "data", sourceDataType: "metadata" });
/* The calls the clock makes over `ms`. */
const after = (ms) => {
  const mark = page.map.calls.length;
  mock.timers.tick(ms);
  return since(mark);
};

test.before(async () => {
  mock.timers.enable({ apis: ["setTimeout", "Date"] });
  const url = "https://lqgentner.github.io/rgi-explorer/";
  page = await loadPage({ url, fetch: servedFetch({}, []) });
  const { Protocol } = globalThis.pmtiles;
  globalThis.pmtiles.Protocol = class extends Protocol {
    constructor() {
      super();
      protocols.push(this);
    }
  };
  const { createMap } = await load("js/map.js");
  const catalog = await loadCatalog("https://data.source.coop/lqgentner/rgi/catalog.json");
  const ready = createMap(page.document.getElementById("map"), catalog, parseState(new URL(url)));
  mock.timers.runAll();
  await ready;
});

test.after(() => mock.timers.reset());

test("the archive's reader forgets a failed read, so a retry needs no new reader", () => {
  const archive = protocols[0].get(ARCHIVE);
  assert.ok(archive.cache instanceof globalThis.pmtiles.SharedPromiseCache);
  assert.equal(typeof archive.cache.forget, "function", "js/archive.js's cache");
});

test("a failed TileJSON is read again 2 s later, once for both errors", () => {
  sourceError();
  sourceError();
  assert.deepEqual(after(1999), []);
  assert.deepEqual(after(1), [SET_URL]);
});

test("while retries fail, each waits twice as long", () => {
  sourceError();
  assert.deepEqual(after(3999), []);
  assert.deepEqual(after(1), [SET_URL]);
  sourceError();
  assert.deepEqual(after(8000), [SET_URL]);
});

test("once the TileJSON loads, the next failure waits 2 s again", () => {
  metadataLoaded();
  sourceError();
  assert.deepEqual(after(2000), [SET_URL]);
  metadataLoaded();
});

test("failed tiles reload alone, each once", () => {
  tileError(3, 4, 2);
  tileError(3, 4, 2);
  tileError(3, 5, 2);
  assert.deepEqual(after(2000), [`refreshTiles data ${JSON.stringify([{ x: 4, y: 2, z: 3 }, { x: 5, y: 2, z: 3 }])}`]);
});

test("a retried tile that loads starts the wait again at 2 s; another tile does not", () => {
  tileError(3, 4, 2);
  after(4000);
  tileLoaded(9, 9, 9);
  tileError(3, 4, 2);
  assert.deepEqual(after(7999), [], "an unrelated tile keeps the wait growing");
  assert.deepEqual(after(1), [`refreshTiles data ${JSON.stringify([{ x: 4, y: 2, z: 3 }])}`]);
  tileLoaded(3, 4, 2);
  tileError(3, 6, 2);
  assert.deepEqual(after(2000), [`refreshTiles data ${JSON.stringify([{ x: 6, y: 2, z: 3 }])}`]);
  tileLoaded(3, 6, 2);
});

test("a source that keeps failing is retried every minute at most, without end", () => {
  const waits = [2000, 4000, 8000, 16_000, 32_000, 60_000, 60_000, 60_000];
  for (const wait of waits) {
    sourceError();
    assert.deepEqual(after(wait - 1), [], `before ${wait} ms`);
    assert.deepEqual(after(1), [SET_URL], `at ${wait} ms`);
  }
});

test("coming back online retries at once, and only with something to retry", () => {
  sourceError();
  const mark = page.map.calls.length;
  page.window.dispatchEvent(new page.window.Event("online"));
  assert.deepEqual(since(mark), [SET_URL]);
  assert.deepEqual(after(120_000), [], "the pending retry went with it");
  page.window.dispatchEvent(new page.window.Event("online"));
  assert.deepEqual(since(mark), [SET_URL]);
  metadataLoaded();
});

test("aborted reads and other sources' errors are not retried", () => {
  const abort = new Error("aborted");
  abort.name = "AbortError";
  page.map.fire("error", { error: abort, sourceId: "data" });
  page.map.fire("error", { error: new Error("503"), sourceId: "openmaptiles" });
  assert.deepEqual(after(120_000), []);
});
