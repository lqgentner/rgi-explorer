/* A ?catalog= override loads that catalog and adds no credit of its own. */

import assert from "node:assert/strict";
import { test } from "node:test";

import * as hyparquet from "hyparquet";

import { load, loadPage, waitFor } from "./helpers/browser.js";
import { makeParquet, servedFetch } from "./helpers/served.js";

const CATALOG = "https://data.source.coop/lqgentner/rgi/v7.0/catalog.json";

test("?catalog= loads that catalog, and the credits stay the same", async () => {
  const { document } = await loadPage({
    url: `https://lqgentner.github.io/rgi-explorer/?catalog=${encodeURIComponent(CATALOG)}`,
    fetch: servedFetch(makeParquet()),
  });
  globalThis.hyparquet = hyparquet;
  await load("js/app.js");
  const group = await waitFor(() => document.querySelector("#status .credit-group"));
  assert.equal(group.querySelector(".credit-label").textContent, "Glaciers");
  assert.doesNotMatch(document.getElementById("status").textContent, /Custom catalog|data\.source\.coop/);
});
