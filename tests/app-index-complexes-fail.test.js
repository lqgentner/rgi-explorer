/* A complexes file that cannot be read leaves complexes out of ID searches, and the glaciers searchable. */

import assert from "node:assert/strict";
import { test } from "node:test";

import * as hyparquet from "hyparquet";

import { load, loadPage, settle, waitFor } from "./helpers/browser.js";
import { COMPLEXES_URL, parquetFiles, servedFetch } from "./helpers/served.js";

const failing = (url) => (url === COMPLEXES_URL ? new Response("", { status: 503 }) : null);
const page = await loadPage({ fetch: servedFetch(parquetFiles(), [], failing) });
const { document, window } = page;
globalThis.hyparquet = hyparquet;
const warnings = [];
const warn = console.warn;
console.warn = (...args) => warnings.push(args.join(" "));
await load("js/app.js");
await waitFor(() => document.querySelector("#search input"));

const input = document.querySelector("#search input");
const titles = () => [...document.querySelectorAll("#search li .title")].map((title) => title.textContent);
function type(text) {
  input.value = text;
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
}

test("the search still finds glaciers by name and by ID", async () => {
  input.focus();
  type("aletsch");
  await waitFor(() => titles().includes("Grosser Aletsch Gletscher"));
  type("11-02596");
  await waitFor(() => titles().includes("Grosser Aletsch Gletscher"));
});

test("a complex ID finds no complex, and the failure is logged", async () => {
  await waitFor(() => warnings.some((w) => w.startsWith("complex IDs:")));
  type("C-11-01323");
  await settle(20);
  assert.ok(!titles().includes("RGI2000-v7.0-C-11-01323"));
  console.warn = warn;
});
