/*
 * The controls do not wait for the tiles: the page wires the search, the
 * controls and the status line once the map's style has loaded, while the
 * first view's tiles are still arriving.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import * as hyparquet from "hyparquet";

import { FakeMap, load, loadPage, waitFor } from "./helpers/browser.js";
import { parquetFiles, servedFetch } from "./helpers/served.js";

const { document } = await loadPage({ fetch: servedFetch(parquetFiles()) });
globalThis.hyparquet = hyparquet;
/* A map whose style loads but whose tiles never finish: MapLibre's `load` never fires. */
globalThis.maplibregl.Map = class SlowTiles extends FakeMap {
  fire(event, payload) {
    if (event !== "load") super.fire(event, payload);
  }
};
await load("js/app.js");

test("the search, the controls and the credits show before the tiles have loaded", async () => {
  await waitFor(() => document.querySelector("#search input") && document.querySelector("#status .credits"));
  assert.ok(document.querySelector('#controls button[aria-label="Zoom in"]'));
  assert.equal(document.querySelector("#notice").textContent, "");
});
