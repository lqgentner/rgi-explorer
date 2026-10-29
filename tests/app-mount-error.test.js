/* A failure while the page mounts its parts says so in the status line. */

import assert from "node:assert/strict";
import { test } from "node:test";

import * as hyparquet from "hyparquet";

import { FakeMap, load, loadPage, waitFor } from "./helpers/browser.js";
import { makeParquet, servedFetch } from "./helpers/served.js";

test("a mount that throws leaves the load message and one logged error", async () => {
  const { document } = await loadPage({ fetch: servedFetch(makeParquet()) });
  globalThis.hyparquet = hyparquet;
  globalThis.maplibregl.Map = class extends FakeMap {
    on(event, fn) {
      if (event === "click") throw new Error("no click handlers");
      super.on(event, fn);
    }
  };
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args);
  try {
    await load("js/app.js");
    await waitFor(() => errors.length);
  } finally {
    console.error = original;
  }
  assert.equal(document.querySelector("#status").textContent, "The catalog could not be loaded.");
  assert.equal(errors.length, 1);
});
