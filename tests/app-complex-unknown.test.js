/* A ?complex= ID the complexes file does not hold opens no panel and leaves the URL. */

import assert from "node:assert/strict";
import { test } from "node:test";

import * as hyparquet from "hyparquet";

import { load, loadPage, settle, waitFor } from "./helpers/browser.js";
import { COMPLEXES_URL, parquetFiles, servedFetch } from "./helpers/served.js";

test("an unknown complex in the address is dropped", async () => {
  const log = [];
  const { window, document } = await loadPage({
    url: "https://lqgentner.github.io/rgi-explorer/?complex=RGI2000-v7.0-C-11-09999",
    fetch: servedFetch(parquetFiles(), log),
  });
  globalThis.hyparquet = hyparquet;
  await load("js/app.js");
  await waitFor(() => log.some(({ url }) => url === COMPLEXES_URL) && !window.location.search.includes("complex="));
  await settle(20);
  assert.equal(document.querySelector("#card").hidden, true);
  assert.equal(window.location.search, "");
});
