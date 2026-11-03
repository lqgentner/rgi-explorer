/* A base style that cannot be read says the map could not load, not the catalog. */

import assert from "node:assert/strict";
import { test } from "node:test";

import * as hyparquet from "hyparquet";

import { load, loadPage, waitFor } from "./helpers/browser.js";
import { parquetFiles, servedFetch } from "./helpers/served.js";

const LIBERTY = "https://tiles.openfreemap.org/styles/liberty";

test("a missing base style says the map could not be loaded and logs one error", async () => {
  const fetch = servedFetch(parquetFiles(), [], (url) => (url === LIBERTY ? new Response("{}", { status: 404 }) : null));
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
  assert.equal(document.querySelector("#notice").textContent, "The map could not be loaded.");
  assert.equal(errors.length, 1);
});
