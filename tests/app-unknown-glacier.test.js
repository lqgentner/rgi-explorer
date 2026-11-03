/* A ?glacier= ID the index does not know opens no card and leaves the URL (Review Focus 5). */

import assert from "node:assert/strict";
import { test } from "node:test";

import * as hyparquet from "hyparquet";

import { load, loadPage, settle, waitFor } from "./helpers/browser.js";
import { parquetFiles, servedFetch } from "./helpers/served.js";

const BASE = "https://lqgentner.github.io/rgi-explorer/";

test("?glacier= with an unknown ID opens no card and cleans the URL", async () => {
  const log = [];
  const { window, document } = await loadPage({
    url: `${BASE}?glacier=RGI2000-v7.0-G-11-99999#not/a/view`,
    fetch: servedFetch(parquetFiles(), log),
  });
  globalThis.hyparquet = hyparquet;
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args);
  try {
    await load("js/app.js");
    await waitFor(() => log.some(({ url }) => url.endsWith("rgi7.0-glaciers.parquet")) && window.location.search === "");
    await settle(20);
  } finally {
    console.error = original;
  }
  assert.equal(document.querySelector("#card").hidden, true);
  assert.equal(document.querySelector("#card .card-title"), null);
  assert.equal(window.location.search, "");
  assert.equal(window.location.hash, "");
  assert.deepEqual(errors, []);
});
