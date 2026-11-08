/* The page reads its GeoParquet files at the catalog's sizes, past the HTTP cache. */

import assert from "node:assert/strict";
import { test } from "node:test";

import * as hyparquet from "hyparquet";

import { load, loadPage, settle, waitFor } from "./helpers/browser.js";
import { COMPLEXES_URL, GLACIERS_URL, NAMES_URL, REGIONS_URL, parquetFiles, servedFetch } from "./helpers/served.js";

const log = [];
const page = await loadPage({ fetch: servedFetch(parquetFiles(), log) });
globalThis.hyparquet = hyparquet;

await load("js/app.js");
/*
 * The regions load with the page; the search index follows once the first view
 * has loaded, from the names table and the complexes file's IDs.
 */
const reads = (url) => log.filter((r) => r.url === url);
await waitFor(() => page.document.querySelector("#search input") && reads(NAMES_URL).length && reads(COMPLEXES_URL).length);
await settle(20);

test("the regions file, the names table and the complexes file open without a HEAD request", () => {
  for (const url of [REGIONS_URL, NAMES_URL, COMPLEXES_URL]) {
    assert.ok(reads(url).length > 0, `no read of ${url}`);
    assert.deepEqual(reads(url).filter((r) => r.method === "HEAD"), [], url);
  }
});

test("the search index leaves the glaciers file unread", () => {
  assert.deepEqual(reads(GLACIERS_URL), []);
});

test("a glacier picked from the search opens the glaciers file without a HEAD request", async () => {
  const { document, window } = page;
  const input = document.querySelector("#search input");
  input.focus();
  input.value = "aletsch";
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
  const row = await waitFor(() => [...document.querySelectorAll("#search li")]
    .find((li) => li.querySelector(".title").textContent === "Grosser Aletsch Gletscher"));
  row.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await waitFor(() => document.querySelector("#card .card-title")?.textContent === "Grosser Aletsch Gletscher");
  assert.ok(reads(GLACIERS_URL).length > 0, "the card reads the glaciers file");
  assert.deepEqual(reads(GLACIERS_URL).filter((r) => r.method === "HEAD"), []);
});

test("every read of a GeoParquet file skips the HTTP cache", () => {
  const cached = log.filter((r) => r.url.endsWith(".parquet") && r.cache !== "no-store");
  assert.deepEqual(cached, []);
});
