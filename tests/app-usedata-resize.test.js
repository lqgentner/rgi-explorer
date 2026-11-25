/* Use this data, open on the desktop, stays usable when the window narrows to the phone's layout. */

import assert from "node:assert/strict";
import { test } from "node:test";

import * as hyparquet from "hyparquet";

import { load, loadPage, waitFor } from "./helpers/browser.js";
import { parquetFiles, servedFetch } from "./helpers/served.js";

const page = await loadPage({ fetch: servedFetch(parquetFiles()) });
const { document, window } = page;
globalThis.hyparquet = hyparquet;
await load("js/app.js");
await waitFor(() => document.querySelector("#search input"));
const $ = (sel) => document.querySelector(sel);
const click = (node) => node.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

test("an open Use this data raises the sheet all the way when the layout becomes the phone's", async () => {
  const input = $("#search input");
  input.focus();
  input.value = "aletsch";
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
  const row = await waitFor(() => [...document.querySelectorAll("#search li")]
    .find((li) => li.querySelector(".title").textContent === "Grosser Aletsch Gletscher"));
  click(row);
  const useData = await waitFor(() => [...document.querySelectorAll("#card button")].find((b) => b.textContent === "Use this data"));
  click(useData);
  assert.ok($("dialog.usedata").hasAttribute("open") || $("dialog.usedata").open);

  page.setPhone(true);
  assert.equal($(".usedata-pane").hidden, false, "it moves into the sheet, still open");
  assert.equal($("#sheet").dataset.level, "full", "the sheet does not stay at the phone's compact start");

  click($(".usedata-pane .usedata-close"));
  page.setPhone(false);
  page.setPhone(true);
  assert.equal($("#sheet").dataset.level, "compact", "closed, it leaves the sheet as the layout sets it");
});
