/* A shared link opens its glacier without the reader's doing, so on the phone the credits still show. */

import assert from "node:assert/strict";
import { test } from "node:test";

import * as hyparquet from "hyparquet";

import { load, loadPage, waitFor } from "./helpers/browser.js";
import { parquetFiles, servedFetch } from "./helpers/served.js";

test("a ?glacier= link leaves the credits unfolded", async () => {
  const page = await loadPage({
    phone: true,
    url: "https://lqgentner.github.io/rgi-explorer/?glacier=RGI2000-v7.0-G-11-02596",
    fetch: servedFetch(parquetFiles()),
  });
  const { document, window } = page;
  window.localStorage.clear();
  globalThis.hyparquet = hyparquet;
  await load("js/app.js");
  await waitFor(() => document.body.classList.contains("card-open"));
  assert.ok(document.querySelector("#status .credits-box").classList.contains("open"));
});
