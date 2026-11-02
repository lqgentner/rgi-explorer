/* A ?glacier= link with a view hash opens the card and keeps the view. */

import assert from "node:assert/strict";
import { test } from "node:test";

import * as hyparquet from "hyparquet";

import { load, loadPage, settle, waitFor } from "./helpers/browser.js";
import { makeParquet, servedFetch } from "./helpers/served.js";

const ID = "RGI2000-v7.0-G-11-00001";

test("?glacier= with a view hash opens the card without moving the map", async () => {
  const page = await loadPage({
    url: `https://lqgentner.github.io/rgi-explorer/?glacier=${ID}&3d=1#9/46.2/8.3`,
    fetch: servedFetch(makeParquet()),
  });
  globalThis.hyparquet = hyparquet;
  await load("js/app.js");
  const { document, window } = page;
  await waitFor(() => document.querySelector("#card .card-title")?.textContent === "Morteratsch");
  await settle(20);
  assert.equal(page.map.lastFit, undefined);
  assert.equal(page.map.getZoom(), 9);
  assert.equal(page.map.getTerrain().source, "terrain", "3D applies once the map has loaded");
  assert.equal(page.map.getPitch(), 60, "a ?3d=1 link opens tilted");
  assert.equal(document.querySelector("#controls .terrain-btn").textContent, "2D", "the 3D button offers 2D");
  assert.equal(window.location.hash, "#9/46.2/8.3");
  assert.equal(new URL(window.location.href).searchParams.get("3d"), "1");
  page.map.fire("idle");
});
