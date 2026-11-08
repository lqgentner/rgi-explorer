/* In a catalog without a names table, the search index reads the glaciers file's own columns. */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import * as hyparquet from "hyparquet";

import { REPO, load, loadPage, waitFor } from "./helpers/browser.js";
import { DATA, GLACIERS_URL, NAMES_URL, parquetFiles, servedFetch } from "./helpers/served.js";

const COLLECTION = `${DATA}v7.0/glaciers/collection.json`;
const files = parquetFiles();
/* The glaciers collection as a catalog before the names table had it. */
function withoutNames(url) {
  if (url !== COLLECTION) return null;
  const file = path.join(REPO, "tests", "fixtures", "catalog", "v7.0", "glaciers", "collection.json");
  const json = JSON.parse(fs.readFileSync(file, "utf8"));
  delete json.assets.names;
  json.assets.data["file:size"] = files[GLACIERS_URL].length;
  return new Response(JSON.stringify(json), { status: 200, headers: { "Content-Type": "application/json" } });
}

const log = [];
const page = await loadPage({ fetch: servedFetch(files, log, withoutNames) });
const { document, window } = page;
globalThis.hyparquet = hyparquet;
await load("js/app.js");
await waitFor(() => document.querySelector("#search input"));

test("the search finds glaciers and complexes from the glaciers file and the complexes file", async () => {
  const input = document.querySelector("#search input");
  const titles = () => [...document.querySelectorAll("#search li .title")].map((title) => title.textContent);
  input.focus();
  input.value = "aletsch";
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
  await waitFor(() => titles().includes("Grosser Aletsch Gletscher"));
  input.value = "C-11-01323";
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
  await waitFor(() => titles().includes("RGI2000-v7.0-C-11-01323"));
  assert.ok(log.some((r) => r.url === GLACIERS_URL));
  assert.deepEqual(log.filter((r) => r.url === NAMES_URL), []);
});
