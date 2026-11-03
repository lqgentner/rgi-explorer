/* A ?complex= link without a view hash fits the complex, even one the opening view already shows well. */

import assert from "node:assert/strict";
import { test } from "node:test";

import * as hyparquet from "hyparquet";

import { load, loadPage, waitFor } from "./helpers/browser.js";
import { COMPLEXES_URL, parquetFiles, servedFetch } from "./helpers/served.js";

const COMPLEX = "RGI2000-v7.0-C-11-01323";
const BBOX = { xmin: 7.931361, ymin: 46.397437, xmax: 8.31, ymax: 46.61 };

test("?complex= without a view fits the complex although it is in view", async () => {
  /* The complexes file waits until the map is staged, so the link opens the complex on the staged map. */
  let release;
  const held = new Promise((resolve) => (release = resolve));
  const fetch = servedFetch(parquetFiles(), [], async (url) => {
    if (url === COMPLEXES_URL) await held;
    return null;
  });
  const page = await loadPage({ url: `https://lqgentner.github.io/rgi-explorer/?complex=${COMPLEX}`, fetch });
  globalThis.hyparquet = hyparquet;
  await load("js/app.js");
  const map = await waitFor(() => page.map);
  /* The complex at 379 x 213 px, right of the panel. */
  map.screen = { origin: [BBOX.xmin - 0.6, BBOX.ymin - 0.3], scale: 1000 };
  release();
  await waitFor(() => map.lastFit);
  const [[x0], [x1]] = map.lastFit.bounds;
  assert.ok(x0 < BBOX.xmin && x1 > BBOX.xmax, "the fit is around the complex");
  assert.equal(new URL(page.window.location.href).searchParams.get("complex"), COMPLEX);
  map.fire("idle");
});
