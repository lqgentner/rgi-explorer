/*
 * The page's CSP has no 'wasm-unsafe-eval', so a browser refuses to compile
 * WebAssembly. With every WebAssembly entry point throwing, the whole module
 * graph still loads, the map starts and the ZSTD search index reads.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import * as hyparquet from "hyparquet";

import { load, loadPage, waitFor } from "./helpers/browser.js";
import { parquetFiles, servedFetch } from "./helpers/served.js";

const refused = () => {
  throw new Error("Refused to compile WebAssembly under the page's CSP");
};
const wasm = globalThis.WebAssembly;
globalThis.WebAssembly = {
  ...wasm,
  Module: function Module() {
    refused();
  },
  Instance: function Instance() {
    refused();
  },
  compile: async () => refused(),
  compileStreaming: async () => refused(),
  instantiate: async () => refused(),
  instantiateStreaming: async () => refused(),
};

test("without WebAssembly the page starts the map and searches the ZSTD index", async () => {
  const page = await loadPage({ fetch: servedFetch(parquetFiles()) });
  const { document, window } = page;
  globalThis.hyparquet = hyparquet;
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args);
  try {
    await load("js/app.js");
    await waitFor(() => document.querySelector("#search input") && document.querySelector("#status .credits"));
  } finally {
    console.error = original;
  }
  assert.deepEqual(errors, []);
  assert.ok(page.map, "the map is built");

  const input = document.querySelector("#search input");
  input.focus();
  input.value = "aletsch";
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
  await waitFor(() => [...document.querySelectorAll("#search li .title")]
    .some((title) => title.textContent === "Grosser Aletsch Gletscher"));
});
