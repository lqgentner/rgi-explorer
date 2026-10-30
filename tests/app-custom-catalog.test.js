/* A ?catalog= override names the catalog's host in the status line. */

import assert from "node:assert/strict";
import { test } from "node:test";

import * as hyparquet from "hyparquet";

import { load, loadPage, waitFor } from "./helpers/browser.js";
import { makeParquet, servedFetch } from "./helpers/served.js";

const CATALOG = "https://data.source.coop/lqgentner/rgi/v7.0/catalog.json";

test("?catalog= shows Custom catalog and the host as text", async () => {
  const { document } = await loadPage({
    url: `https://lqgentner.github.io/rgi-explorer/?catalog=${encodeURIComponent(CATALOG)}`,
    fetch: servedFetch(makeParquet()),
  });
  globalThis.hyparquet = hyparquet;
  await load("js/app.js");
  const group = await waitFor(() => document.querySelector("#status .credit-group"));
  assert.equal(group.querySelector(".credit-label").textContent, "Custom catalog");
  const credit = group.querySelector(".credit");
  assert.equal(credit.textContent, "data.source.coop");
  assert.equal(credit.tagName, "SPAN", "the host is text, not a link");
});
