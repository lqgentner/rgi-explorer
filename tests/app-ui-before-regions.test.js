/*
 * The regions table takes several reads, so the page does not wait for it:
 * the search and the credits show while it is read. A shared link's glacier
 * waits for it, so its card names the region.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import * as hyparquet from "hyparquet";

import { load, loadPage, settle, waitFor } from "./helpers/browser.js";
import { parquetFiles, REGIONS_URL, servedFetch } from "./helpers/served.js";

const ALETSCH = "RGI2000-v7.0-G-11-02596";

test("the search and the credits show while the regions are read; a linked glacier waits for them", async () => {
  let release;
  const held = new Promise((resolve) => (release = resolve));
  const fetch = servedFetch(parquetFiles(), [], async (url) => {
    if (url === REGIONS_URL) await held;
    return null;
  });
  const page = await loadPage({ url: `https://lqgentner.github.io/rgi-explorer/?glacier=${ALETSCH}`, fetch });
  const { document } = page;
  globalThis.hyparquet = hyparquet;
  await load("js/app.js");

  await waitFor(() => document.querySelector("#search input") && document.querySelector("#status .credits"));
  await settle(20);
  assert.equal(document.querySelector("#card").hidden, true, "the linked glacier waits for the regions");

  release();
  await waitFor(() => !document.querySelector("#card").hidden && document.querySelector("#card").textContent.includes("Central Europe"));
  assert.equal(document.querySelector("#notice").textContent, "");
});
