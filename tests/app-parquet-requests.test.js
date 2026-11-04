/* The page reads its GeoParquet files at the catalog's sizes, past the HTTP cache. */

import assert from "node:assert/strict";
import { test } from "node:test";

import * as hyparquet from "hyparquet";

import { load, loadPage, waitFor } from "./helpers/browser.js";
import { GLACIERS_URL, REGIONS_URL, parquetFiles, servedFetch } from "./helpers/served.js";

const log = [];
const page = await loadPage({ fetch: servedFetch(parquetFiles(), log) });
globalThis.hyparquet = hyparquet;

await load("js/app.js");
/* The regions load with the page; the search index follows once the first view has loaded. */
await waitFor(() => log.some((r) => r.url === GLACIERS_URL) && page.document.querySelector("#search input"));
const reads = (url) => log.filter((r) => r.url === url);

test("the regions and glaciers files open without a HEAD request", () => {
  for (const url of [REGIONS_URL, GLACIERS_URL]) {
    assert.ok(reads(url).length > 0, `no read of ${url}`);
    assert.deepEqual(reads(url).filter((r) => r.method === "HEAD"), [], url);
  }
});

test("every read of a GeoParquet file skips the HTTP cache", () => {
  const cached = log.filter((r) => r.url.endsWith(".parquet") && r.cache !== "no-store");
  assert.deepEqual(cached, []);
});
