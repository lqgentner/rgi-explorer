/*
 * Glacier complexes on the whole page, in order as one visitor would use them:
 * from a glacier's card to its complex, into a member glacier, from search, and
 * away again with a map click.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import * as hyparquet from "hyparquet";

import { load, loadPage, waitFor } from "./helpers/browser.js";
import { makeParquet, servedFetch } from "./helpers/served.js";

const ALETSCH = "RGI2000-v7.0-G-11-02596";
const COMPLEX = "RGI2000-v7.0-C-11-01323";
/* The whole complex, with half its size free on every side. */
const around = ([[x0, y0], [x1, y1]]) => {
  const [dx, dy] = [(x1 - x0) * 0.5, (y1 - y0) * 0.5];
  return [[x0 - dx, y0 - dy], [x1 + dx, y1 + dy]];
};
const COMPLEX_BBOX = around([[7.931361, 46.397437], [8.31, 46.61]]);

const page = await loadPage({
  url: `https://lqgentner.github.io/rgi-explorer/?glacier=${ALETSCH}`,
  fetch: servedFetch(makeParquet()),
});
const { document, window } = page;
globalThis.hyparquet = hyparquet;
await load("js/app.js");
const map = await waitFor(() => page.map);

const $ = (sel) => document.querySelector(sel);
/* A press moves the focus to what it presses, as in a browser. */
const click = (node) => {
  node.focus?.();
  node.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
};
const params = () => new URL(window.location.href).searchParams;
const glacierCard = () => $("#card section.card:not(.complex-card)");
const complexCard = () => $("#card section.complex-card");
const rowOfLabel = (label) =>
  [...glacierCard().querySelectorAll(".row")].find((r) => r.querySelector(".row-label").firstChild.textContent === label);
const cells = () =>
  [...complexCard().querySelectorAll("table.members tbody tr")].map((tr) => [...tr.children].map((td) => td.textContent));

async function searchAndPick(text, title) {
  const input = $("#search input");
  input.focus();
  input.value = text;
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
  const row = await waitFor(() => [...document.querySelectorAll("#search li")]
    .find((li) => li.querySelector(".title").textContent === title));
  click(row);
}

test("the Glacier complex row opens the complex panel and fits the whole complex", async () => {
  await waitFor(() => rowOfLabel("Glacier complex"));
  assert.equal($("#search input").value, "Grosser Aletsch Gletscher", "a glacier opened from the address is named too");
  click(rowOfLabel("Glacier complex").querySelector("button.link"));
  await waitFor(() => complexCard() && !complexCard().hidden);
  assert.equal(glacierCard().hidden, true);
  assert.equal(complexCard().querySelector(".card-title").textContent, COMPLEX);
  assert.equal(complexCard().querySelector(".card-subtitle").textContent, "Complex · Central Europe");
  assert.equal(params().get("complex"), COMPLEX);
  assert.equal(params().get("glacier"), null);
  assert.equal(map.layout("complex-outline").visibility, "visible");
  assert.equal(map.layout("selection-outline").visibility, "none");
  await waitFor(() => JSON.stringify(map.lastFit?.bounds) === JSON.stringify(COMPLEX_BBOX));
  assert.equal(map.lastFit.options.padding.left, 408 + 24, "the fit keeps clear of the panel");
});

test("the member table lists both glaciers, largest first", async () => {
  await waitFor(() => cells().length === 2);
  assert.deepEqual(cells(), [
    ["Grosser Aletsch Gletscher", ALETSCH, "81.8"],
    ["", "RGI2000-v7.0-G-11-00003", "1.50"],
  ]);
  assert.equal(complexCard().querySelector(".row:last-child .row-value").textContent, "2");
});

test("opening a member glacier closes the complex", async () => {
  const member = [...complexCard().querySelectorAll("table.members button")].find((b) => b.textContent === "RGI2000-v7.0-G-11-00003");
  click(member);
  await waitFor(() => glacierCard().querySelector(".card-title")?.textContent === "RGI2000-v7.0-G-11-00003");
  assert.equal(glacierCard().hidden, false);
  assert.equal(complexCard().hidden, true);
  assert.equal(params().get("glacier"), "RGI2000-v7.0-G-11-00003");
  assert.equal(params().get("complex"), null);
  assert.equal(map.layout("complex-outline").visibility, "none");
  assert.equal(map.layout("selection-outline").visibility, "visible");
});

test("search opens a complex by its ID", async () => {
  await searchAndPick("C-11-00001", "RGI2000-v7.0-C-11-00001");
  await waitFor(() => !complexCard().hidden && complexCard().querySelector(".card-title").textContent === "RGI2000-v7.0-C-11-00001");
  assert.equal(glacierCard().hidden, true);
  assert.equal(params().get("complex"), "RGI2000-v7.0-C-11-00001");
  assert.deepEqual(map.getLayer("complex-outline").filter, ["==", ["get", "rgi_id"], "RGI2000-v7.0-C-11-00001"]);
});

test("the search box names the open panel however it was opened", async () => {
  const input = $("#search input");
  assert.equal(input.value, "RGI2000-v7.0-C-11-00001", "a pick keeps its title");
  await waitFor(() => complexCard().querySelectorAll("table.members button").length === 1);
  click(complexCard().querySelector("table.members button"));
  await waitFor(() => input.value === "Morteratsch");
  assert.equal(glacierCard().querySelector(".card-title").textContent, "Morteratsch");

  await waitFor(() => rowOfLabel("Glacier complex"));
  click(rowOfLabel("Glacier complex").querySelector("button.link"));
  await waitFor(() => !complexCard().hidden);
  assert.equal(input.value, "RGI2000-v7.0-C-11-00001", "the complex opened from the card");

  map.rendered = [{ layer: { id: "glaciers-fill" }, properties: { rgi_id: ALETSCH, display_name: "Grosser Aletsch Gletscher", o1region: "11" } }];
  map.getCanvas().focus?.();
  input.blur();
  map.fire("click", { point: { x: 200, y: 200 } });
  assert.equal(input.value, "Grosser Aletsch Gletscher", "a glacier opened on the map");
});

test("a map click leaves the complex", async () => {
  map.rendered = [];
  map.fire("click", { point: { x: 10, y: 10 } });
  assert.equal($("#card").hidden, true);
  assert.equal(params().get("complex"), null);
  assert.equal(map.layout("selection-dim").visibility, "none");
  assert.equal(map.layout("complex-outline").visibility, "none");

  await searchAndPick("C-11-01323", COMPLEX);
  await waitFor(() => !complexCard().hidden);
  map.rendered = [{
    layer: { id: "glaciers-fill" },
    properties: { rgi_id: "RGI2000-v7.0-G-11-00001", display_name: "Morteratsch", o1region: "11" },
  }];
  map.fire("click", { point: { x: 200, y: 200 } });
  assert.equal(glacierCard().querySelector(".card-title").textContent, "Morteratsch");
  assert.equal(complexCard().hidden, true);
  assert.equal(params().get("complex"), null);
  assert.equal(map.layout("complex-outline").visibility, "none");
});
