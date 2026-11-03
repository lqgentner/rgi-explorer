/* A known ?glacier= ID opens its card from the search index and fits its bbox. */

import assert from "node:assert/strict";
import { test } from "node:test";

import * as hyparquet from "hyparquet";

import { load, loadPage, waitFor } from "./helpers/browser.js";
import { parquetFiles, servedFetch } from "./helpers/served.js";

const ID = "RGI2000-v7.0-G-11-00001";

test("?glacier= with a known ID opens the card, selects it and fits it", async () => {
  const page = await loadPage({
    url: `https://lqgentner.github.io/rgi-explorer/?glacier=${ID}`,
    fetch: servedFetch(parquetFiles()),
  });
  globalThis.hyparquet = hyparquet;
  await load("js/app.js");
  const { document, window } = page;
  await waitFor(() => document.querySelector("#card .card-title")?.textContent === "Morteratsch");
  assert.equal(document.querySelector("#card").hidden, false);
  await waitFor(() => page.map.lastFit);
  /* The glacier's bbox with half its size free on every side. */
  const [dx, dy] = [(8.11 - 8.1) * 0.5, (46.11 - 46.1) * 0.5];
  assert.deepEqual(page.map.lastFit.bounds, [[8.1 - dx, 46.1 - dy], [8.11 + dx, 46.11 + dy]]);
  assert.equal(page.map.lastFit.options.maxZoom, 15);
  assert.deepEqual(page.map.getLayer("selection-outline").filter, ["==", ["get", "rgi_id"], ID]);
  assert.equal(new URL(window.location.href).searchParams.get("glacier"), ID);
  page.map.fire("idle");
});
