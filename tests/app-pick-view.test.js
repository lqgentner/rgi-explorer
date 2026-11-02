/*
 * A picked glacier or complex moves the map only when it is not already well
 * in view: from the map, from a panel or from search. The tests run in order
 * on one page, the phone's last.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import * as hyparquet from "hyparquet";

import { load, loadPage, settle, waitFor } from "./helpers/browser.js";
import { makeParquet, servedFetch } from "./helpers/served.js";

const ALETSCH = "RGI2000-v7.0-G-11-02596";
const COMPLEX = "RGI2000-v7.0-C-11-01323";
/* Aletsch's bbox, and its complex's, from the fixture. */
const BBOX = { xmin: 7.931361, ymin: 46.397437, xmax: 8.087402, ymax: 46.563295 };
const COMPLEX_BBOX = { xmin: 7.931361, ymin: 46.397437, xmax: 8.31, ymax: 46.61 };
/* A fit leaves half the bbox's size free on every side. */
const around = ({ xmin, ymin, xmax, ymax }) => {
  const [dx, dy] = [(xmax - xmin) * 0.5, (ymax - ymin) * 0.5];
  return [[xmin - dx, ymin - dy], [xmax + dx, ymax + dy]];
};

const log = [];
const page = await loadPage({ fetch: servedFetch(makeParquet(), log) });
const { document, window } = page;
globalThis.hyparquet = hyparquet;
await load("js/app.js");
await waitFor(() => document.querySelector("#search input"));
const { map } = page;

const $ = (sel) => document.querySelector(sel);
const click = (node) => {
  node.focus?.();
  node.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
};
const fits = () => map.calls.filter((call) => call.startsWith("fitBounds")).length;
const sparql = () => log.filter(({ url }) => url.startsWith("https://query.wikidata.org/")).length;

/*
 * Draw the map so the bbox's west and north corner lands at screen [x, y], at
 * `scale` pixels per degree: at 1000, Aletsch is 156 x 166 px. The fake's
 * canvas is 1024 x 768 px, and the desktop card covers its left 432 px.
 */
function stage(x, y, scale = 1000, bbox = BBOX) {
  map.screen = { origin: [bbox.xmin - x / scale, bbox.ymin - y / scale], scale };
}

/* A glacier's photo lookup starts once its fit, if any, is done: its SPARQL request marks the decision. */
async function decided(pick) {
  const before = sparql();
  pick();
  await waitFor(() => sparql() > before);
  await settle();
}

const clickAletsch = () => {
  map.rendered = [{ layer: { id: "glaciers-fill" }, properties: { rgi_id: ALETSCH, display_name: "Grosser Aletsch Gletscher", o1region: "11" } }];
  map.fire("click", { point: { x: 700, y: 400 } });
};
const clickEmpty = () => {
  map.rendered = [];
  map.fire("click", { point: { x: 5, y: 5 } });
};
async function searchAndPick(text, title) {
  const input = $("#search input");
  input.focus();
  input.value = text;
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
  const row = await waitFor(() => [...document.querySelectorAll("#search li")]
    .find((li) => li.querySelector(".title").textContent === title));
  click(row);
}

test("a click on a glacier well in view leaves the map where it is", async () => {
  stage(600, 300);
  const before = fits();
  await decided(clickAletsch);
  assert.equal($("#card .card-title").textContent, "Grosser Aletsch Gletscher");
  assert.equal(fits(), before);
  clickEmpty();
});

test("a click on a glacier half under the card fits it clear of the card", async () => {
  stage(354, 300);
  const before = fits();
  await decided(clickAletsch);
  assert.equal(fits(), before + 1);
  assert.deepEqual(map.lastFit.bounds, around(BBOX));
  assert.equal(map.lastFit.options.padding.left, 408 + 24);
  clickEmpty();
});

test("a click on a glacier too small to make out zooms to it", async () => {
  /* 16 px across. */
  stage(600, 300, 100);
  const before = fits();
  await decided(clickAletsch);
  assert.equal(fits(), before + 1);
  assert.deepEqual(map.lastFit.bounds, around(BBOX));
  clickEmpty();
});

test("a click on a glacier larger than the open map zooms out to it", async () => {
  /* 1560 x 1659 px, over the whole canvas. */
  stage(-500, -500, 10000);
  const before = fits();
  await decided(clickAletsch);
  assert.equal(fits(), before + 1);
  assert.deepEqual(map.lastFit.bounds, around(BBOX));
  clickEmpty();
});

test("a search pick of a glacier in view leaves the map where it is, and one out of view fits it", async () => {
  stage(600, 300);
  const before = fits();
  await decided(() => searchAndPick("aletsch", "Grosser Aletsch Gletscher"));
  await waitFor(() => $("#card .card-title")?.textContent === "Grosser Aletsch Gletscher");
  assert.equal(fits(), before);
  clickEmpty();

  stage(1100, 300);
  await decided(() => searchAndPick("aletsch", "Grosser Aletsch Gletscher"));
  assert.equal(fits(), before + 1, "off the canvas");
  assert.deepEqual(map.lastFit.bounds, around(BBOX));
});

const glacierCard = () => $("#card section.card:not(.complex-card)");
const complexCard = () => $("#card section.complex-card");
const complexLink = () =>
  [...glacierCard().querySelectorAll(".row")]
    .find((r) => r.querySelector(".row-label").firstChild.textContent === "Glacier complex")
    ?.querySelector("button.link");
const membersShown = () => complexCard() && !complexCard().hidden && complexCard().querySelector("table.members button");

test("the complex of a glacier in view opens without a move, and so does a member glacier", async () => {
  /* The complex spans 379 x 213 px right of the card, Aletsch in its west. */
  stage(600, 300);
  const before = fits();
  click(await waitFor(complexLink));
  await waitFor(membersShown);
  await settle(10);
  assert.equal(new URL(window.location.href).searchParams.get("complex"), COMPLEX);
  assert.equal(fits(), before, "the complex is in view");

  const member = await waitFor(() =>
    [...complexCard().querySelectorAll("table.members button")].find((b) => b.textContent === ALETSCH));
  await decided(() => click(member));
  assert.equal(glacierCard().querySelector(".card-title").textContent, "Grosser Aletsch Gletscher");
  assert.equal(fits(), before, "the member is in view");
  clickEmpty();
});

test("a complex half under the card fits it", async () => {
  stage(200, 300, 1000, COMPLEX_BBOX);
  const before = fits();
  await searchAndPick("C-11-01323", COMPLEX);
  await waitFor(() => fits() > before);
  assert.deepEqual(map.lastFit.bounds, around(COMPLEX_BBOX));
  assert.equal(map.lastFit.options.padding.left, 408 + 24);
  clickEmpty();
});

test("on a phone the search bar and the sheet bound the open map, not the left", async () => {
  page.setPhone(true);
  /* Left of where the desktop card would be. */
  stage(40, 150);
  const before = fits();
  await decided(clickAletsch);
  assert.equal(fits(), before, "the phone's left is open");
  clickEmpty();

  /* Its top 72 px are under the search bar: 57% shows. */
  stage(300, 0);
  await decided(clickAletsch);
  assert.equal(fits(), before + 1);
  assert.equal(map.lastFit.options.padding.top, 72);
  assert.equal(map.lastFit.options.padding.left, 24);
  clickEmpty();
  map.fire("idle");
});
