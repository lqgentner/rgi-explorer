/* The whole page on a phone: the card lives in the bottom sheet. */

import assert from "node:assert/strict";
import { test } from "node:test";

import * as hyparquet from "hyparquet";

import { load, loadPage, waitFor } from "./helpers/browser.js";
import { GLACIERS_URL, makeParquet, servedFetch } from "./helpers/served.js";

const ALETSCH = "RGI2000-v7.0-G-11-02596";
const page = await loadPage({ phone: true, fetch: servedFetch(makeParquet()) });
const { document, window } = page;
globalThis.hyparquet = hyparquet;
await load("js/app.js");
await waitFor(() => document.querySelector("#search input"));
const $ = (sel) => document.querySelector(sel);
const click = (node) => node.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
const button = (root, label) => [...root.querySelectorAll("button")].find((b) => b.textContent === label);

test("a pick mounts the card in the sheet: the header in the band, the photo and tabs in the body", async () => {
  assert.equal($("#sheet").hidden, true);
  const input = $("#search input");
  input.focus();
  input.value = "aletsch";
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
  const row = await waitFor(() => [...document.querySelectorAll("#search li")]
    .find((li) => li.querySelector(".title").textContent === "Grosser Aletsch Gletscher"));
  click(row);
  assert.notEqual(document.activeElement, input, "the pick puts the keyboard away");

  await waitFor(() => $("#sheet-band .card-title")?.textContent === "Grosser Aletsch Gletscher");
  assert.equal($("#sheet").hidden, false);
  assert.equal($("#card").hidden, true);
  assert.equal($("#card").children.length, 0, "the desktop sidebar stays empty");
  assert.equal($("#sheet-band .card-title").textContent, "Grosser Aletsch Gletscher");
  assert.equal($('#search button[aria-label="Close"]').hidden, false, "the search bar's Close shows as on desktop");
  assert.equal($("#sheet-band .card-subtitle").textContent, `Glacier · ${ALETSCH} · Central Europe`);
  assert.equal($("#sheet-band").textContent.includes("km²"), false, "the area is in the overview, not the band");
  assert.ok(button($("#sheet-band"), "Use this data"));
  assert.ok($("#sheet-body .photo"));
  assert.ok($("#sheet-body [role=tablist]"));
  assert.equal($("#sheet").dataset.level, "compact", "the sheet opens compact");
  assert.ok($("#sheet-body").hasAttribute("inert"));
  assert.equal(new URL(window.location.href).searchParams.get("glacier"), ALETSCH);

  click($("#sheet-handle"));
  assert.equal($("#sheet").dataset.level, "middle");
  await waitFor(() => $("#sheet-body .panel-hypsometry svg"));
});

test("Use this data opens a pane in the sheet with the exact snippet", () => {
  click(button($("#sheet-band"), "Use this data"));
  const pane = $("#sheet .usedata-pane");
  assert.equal(pane.hidden, false);
  assert.ok(!$("dialog.usedata").hasAttribute("open"));
  assert.equal(pane.querySelector(".usedata-code code").textContent,
    `import geopandas as gpd\n\nurl = "${GLACIERS_URL}"\ngdf = gpd.read_parquet(url, filters=[("rgi_id", "==", "${ALETSCH}")])\n`);
  click(pane.querySelector(".usedata-close"));
  assert.equal(pane.hidden, true);
});

test("clicking empty map closes the sheet", () => {
  page.map.rendered = [];
  page.map.fire("click", { point: { x: 5, y: 5 } });
  assert.equal($("#sheet").hidden, true);
  assert.equal(new URL(window.location.href).searchParams.get("glacier"), null);
  page.map.fire("idle");
});
