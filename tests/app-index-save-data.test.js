/* A browser that asks to save data reads the search index on the search's first use only. */

import assert from "node:assert/strict";
import { test } from "node:test";

import * as hyparquet from "hyparquet";

import { load, loadPage, settle, waitFor } from "./helpers/browser.js";
import { parquetFiles, servedFetch } from "./helpers/served.js";

const page = await loadPage({ fetch: servedFetch(parquetFiles()) });
const { document } = page;
Object.defineProperty(globalThis.navigator, "connection", { configurable: true, value: { saveData: true } });
const reads = [];
globalThis.hyparquet = {
  ...hyparquet,
  parquetReadObjects(options) {
    reads.push(options.columns ?? []);
    return hyparquet.parquetReadObjects(options);
  },
};
const indexReads = () => reads.filter((columns) => columns.join() === "rgi_id,display_name,complex_id").length;
await load("js/app.js");
await waitFor(() => document.querySelector("#search input") && document.querySelector("#status .credits"));

test("with Save-Data the index is read on focus, not once the view loads", async () => {
  page.map.fire("idle");
  await settle(20);
  assert.equal(indexReads(), 0);
  document.querySelector("#search input").focus();
  await waitFor(() => indexReads() > 0);
});
