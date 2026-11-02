/* "Take me to a glacier" opens the sample glacier from its row group alone, without waiting for the search index. */

import assert from "node:assert/strict";
import { test } from "node:test";

import * as hyparquet from "hyparquet";

import { load, loadPage, waitFor } from "./helpers/browser.js";
import { makeParquet, servedFetch } from "./helpers/served.js";

const UPSALA = "RGI2000-v7.0-G-17-04760";
const page = await loadPage({ fetch: servedFetch(makeParquet()) });
const { document, window } = page;
window.localStorage.clear();
const reads = [];
globalThis.hyparquet = {
  ...hyparquet,
  parquetReadObjects(options) {
    reads.push(options.columns ?? []);
    return hyparquet.parquetReadObjects(options);
  },
};
await load("js/app.js");
const button = (root, label) => [...root.querySelectorAll("button")].find((b) => b.textContent === label && !b.hidden);

test("Take me to a glacier finds Upsala by its row group and never reads the search index", async () => {
  const welcome = await waitFor(() => document.querySelector(".welcome:not([hidden])"));
  button(welcome, "Take the tour").click();
  button(document.querySelector(".tour"), "Take me to a glacier").click();
  await waitFor(() => location.search.includes(`glacier=${UPSALA}`));
  await waitFor(() => document.querySelector("#card .card-title")?.textContent === "Upsala Glacier");
  /* The index is the one read of exactly the search columns; the card's own row read is a single row. */
  const index = reads.filter((columns) => columns.join() === "rgi_id,display_name,complex_id");
  assert.deepEqual(index, [], "the search index was not read");
});
