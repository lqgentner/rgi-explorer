/* A shared link opens straight into its glacier: no welcome, and the welcome is not marked seen. */

import assert from "node:assert/strict";
import { test } from "node:test";

import * as hyparquet from "hyparquet";

import { load, loadPage, waitFor } from "./helpers/browser.js";
import { makeParquet, servedFetch } from "./helpers/served.js";

test("a ?glacier= link shows no welcome and leaves it for the next visit", async () => {
  const page = await loadPage({
    url: "https://lqgentner.github.io/rgi-explorer/?glacier=RGI2000-v7.0-G-11-02596",
    fetch: servedFetch(makeParquet()),
  });
  const { document, window } = page;
  window.localStorage.clear();
  globalThis.hyparquet = hyparquet;
  await load("js/app.js");
  await waitFor(() => document.body.classList.contains("card-open"));
  const welcome = document.querySelector(".welcome");
  assert.ok(welcome, "the welcome is mounted for the help button");
  assert.equal(welcome.hidden, true);
  assert.equal(window.localStorage.getItem("rgi-explorer:welcome"), null);
});
