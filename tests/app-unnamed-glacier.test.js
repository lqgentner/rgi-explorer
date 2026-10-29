/* An unnamed glacier from a ?glacier= link: the ID is the title, the region the subtitle. */

import assert from "node:assert/strict";
import { test } from "node:test";

import * as hyparquet from "hyparquet";

import { load, loadPage, waitFor } from "./helpers/browser.js";
import { makeParquet, servedFetch } from "./helpers/served.js";

const ID = "RGI2000-v7.0-G-11-00004";

test("?glacier= with an unnamed glacier titles the card with its ID", async () => {
  const page = await loadPage({
    url: `https://lqgentner.github.io/rgi-explorer/?glacier=${ID}`,
    fetch: servedFetch(makeParquet()),
  });
  globalThis.hyparquet = hyparquet;
  await load("js/app.js");
  const { document } = page;
  await waitFor(() => document.querySelector("#card .panel-hypsometry svg"));
  assert.equal(document.querySelector("#card .card-title").textContent, ID);
  assert.equal(document.querySelector("#card .card-subtitle").textContent, "Central Europe");
  assert.doesNotMatch(document.querySelector("#card").textContent, /null|undefined/);
});
