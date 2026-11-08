/* The search index is read once the first view has loaded, before anyone focuses the search. */

import assert from "node:assert/strict";
import { test } from "node:test";

import * as hyparquet from "hyparquet";

import { FakeMap, load, loadPage, settle, waitFor } from "./helpers/browser.js";
import { parquetFiles, servedFetch } from "./helpers/served.js";

const page = await loadPage({ fetch: servedFetch(parquetFiles()) });
const { document, window } = page;
/* The first view's tiles are still loading when the page wires the search. */
globalThis.maplibregl.Map = class BusyMap extends FakeMap {
  constructor(options) {
    super(options);
    this.tilesLoaded = false;
  }
};
const reads = [];
globalThis.hyparquet = {
  ...hyparquet,
  parquetReadObjects(options) {
    reads.push(options.columns ?? []);
    return hyparquet.parquetReadObjects(options);
  },
};
const indexReads = () => reads.filter((columns) => columns.join() === "rgi_id,display_name").length;

await load("js/app.js");
await waitFor(() => document.querySelector("#search input") && document.querySelector("#status .credits"));

test("the index waits for the first view's tiles, then reads without a focus", async () => {
  await settle(20);
  assert.equal(indexReads(), 0, "no index read while the tiles load");
  page.map.tilesLoaded = true;
  page.map.fire("idle");
  await waitFor(() => indexReads() > 0);
});

test("the search uses the index already read", async () => {
  await settle(20);
  const before = indexReads();
  const input = document.querySelector("#search input");
  input.focus();
  input.value = "aletsch";
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
  await waitFor(() => [...document.querySelectorAll("#search li .title")]
    .some((title) => title.textContent === "Grosser Aletsch Gletscher"));
  assert.equal(indexReads(), before);
});
