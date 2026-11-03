/* A ?glacier= link without a view hash fits the glacier, even one the opening view already shows well. */

import assert from "node:assert/strict";
import { test } from "node:test";

import * as hyparquet from "hyparquet";

import { load, loadPage, waitFor } from "./helpers/browser.js";
import { GLACIERS_URL, parquetFiles, servedFetch } from "./helpers/served.js";

const ALETSCH = "RGI2000-v7.0-G-11-02596";
const BBOX = { xmin: 7.931361, ymin: 46.397437, xmax: 8.087402, ymax: 46.563295 };

test("?glacier= without a view fits the glacier although it is in view", async () => {
  /* The glaciers file waits until the map is staged, so the link opens the glacier on the staged map. */
  let release;
  const held = new Promise((resolve) => (release = resolve));
  const fetch = servedFetch(parquetFiles(), [], async (url) => {
    if (url === GLACIERS_URL) await held;
    return null;
  });
  const page = await loadPage({ url: `https://lqgentner.github.io/rgi-explorer/?glacier=${ALETSCH}`, fetch });
  globalThis.hyparquet = hyparquet;
  await load("js/app.js");
  const map = await waitFor(() => page.map);
  /* Aletsch at 156 x 166 px, right of the card. */
  map.screen = { origin: [BBOX.xmin - 0.6, BBOX.ymin - 0.3], scale: 1000 };
  release();
  await waitFor(() => map.lastFit);
  const [[x0], [x1]] = map.lastFit.bounds;
  assert.ok(x0 < BBOX.xmin && x1 > BBOX.xmax, "the fit is around the glacier");
  assert.equal(new URL(page.window.location.href).searchParams.get("glacier"), ALETSCH);
  map.fire("idle");
});
