/* On the phone the credits show at load and fold when the reader opens a glacier, here from the search. */

import assert from "node:assert/strict";
import { test } from "node:test";

import * as hyparquet from "hyparquet";

import { load, loadPage, waitFor } from "./helpers/browser.js";
import { parquetFiles, servedFetch } from "./helpers/served.js";

const page = await loadPage({ phone: true, fetch: servedFetch(parquetFiles()) });
const { document, window } = page;
window.localStorage.clear();
globalThis.hyparquet = hyparquet;
await load("js/app.js");
await waitFor(() => document.querySelector("#search input"));

const $ = (sel) => document.querySelector(sel);
const click = (node) => node.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

test("a search pick folds the credits, as the first drag of the map does", async () => {
  const box = await waitFor(() => $("#status .credits-box"));
  assert.ok(box.classList.contains("open"), "shown at load");
  const input = $("#search input");
  input.focus();
  input.value = "aletsch";
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
  click(await waitFor(() => [...document.querySelectorAll("#search li")].find((li) => li.querySelector(".title").textContent === "Grosser Aletsch Gletscher")));
  await waitFor(() => document.body.classList.contains("card-open"));
  assert.ok(!box.classList.contains("open"));
});
