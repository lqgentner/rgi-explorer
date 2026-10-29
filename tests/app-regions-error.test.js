/* A regions table that cannot be read says the catalog could not load, not the map. */

import assert from "node:assert/strict";
import { test } from "node:test";

import * as hyparquet from "hyparquet";

import { load, loadPage, waitFor } from "./helpers/browser.js";
import { makeParquet, REGIONS_URL, servedFetch } from "./helpers/served.js";

test("a missing regions table says the catalog could not be loaded and logs one error", async () => {
  const fetch = servedFetch(makeParquet(), [], (url) => (url === REGIONS_URL ? new Response("{}", { status: 404 }) : null));
  const { document } = await loadPage({ fetch });
  globalThis.hyparquet = hyparquet;
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args);
  try {
    await load("js/app.js");
    await waitFor(() => document.querySelector("#notice").textContent);
  } finally {
    console.error = original;
  }
  assert.equal(document.querySelector("#notice").textContent, "The catalog could not be loaded.");
  assert.equal(errors.length, 1);
});
