/* A catalog that cannot be read leaves a message in the status line and throws nothing. */

import assert from "node:assert/strict";
import { test } from "node:test";

import { load, loadPage, waitFor } from "./helpers/browser.js";

test("a missing catalog says so in the status line and logs one error", async () => {
  const { document } = await loadPage();
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args);
  try {
    await load("js/app.js");
    await waitFor(() => document.querySelector("#status").textContent);
  } finally {
    console.error = original;
  }
  assert.equal(document.querySelector("#status").textContent, "The catalog could not be loaded.");
  assert.equal(errors.length, 1);
  assert.equal(document.querySelector("#search input"), null);
});
