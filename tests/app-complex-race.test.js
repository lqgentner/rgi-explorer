/* A glacier opened while a shared ?complex= link is still being read wins, and the complex never pops open. */

import assert from "node:assert/strict";
import { test } from "node:test";

import * as hyparquet from "hyparquet";

import { load, loadPage, settle, waitFor } from "./helpers/browser.js";
import { COMPLEXES_URL, parquetFiles, servedFetch } from "./helpers/served.js";

test("a glacier opened during the ?complex= read clears the complex for good", async () => {
  let release;
  const held = new Promise((resolve) => (release = resolve));
  const fetch = servedFetch(parquetFiles(), [], async (url) => {
    if (url === COMPLEXES_URL) await held;
    return null;
  });
  const page = await loadPage({ url: "https://lqgentner.github.io/rgi-explorer/?complex=RGI2000-v7.0-C-11-01323", fetch });
  globalThis.hyparquet = hyparquet;
  await load("js/app.js");
  const map = await waitFor(() => page.map);
  await waitFor(() => page.document.querySelector("#search input"));
  const params = () => new URL(page.window.location.href).searchParams;

  map.rendered = [{
    layer: { id: "glaciers-fill" },
    properties: { rgi_id: "RGI2000-v7.0-G-11-00001", display_name: "Morteratsch", o1region: "11" },
  }];
  map.fire("click", { point: { x: 200, y: 200 } });
  assert.equal(params().get("glacier"), "RGI2000-v7.0-G-11-00001");
  assert.equal(params().get("complex"), null, "a page holds one of the two");

  map.rendered = [];
  map.fire("click", { point: { x: 10, y: 10 } });
  release();
  await settle(30);
  assert.equal(page.document.querySelector("#card").hidden, true, "the complex does not open on its own");
  assert.equal(params().get("complex"), null);
});
