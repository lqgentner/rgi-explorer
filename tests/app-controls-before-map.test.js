/*
 * The map's controls draw with the page, before the catalog and the map load.
 * A click on one before the map exists does nothing, or changes the state,
 * which the map takes on once it is wired. The tests run in order.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import * as hyparquet from "hyparquet";

import { FakeMap, load, loadPage, waitFor } from "./helpers/browser.js";
import { parquetFiles, servedFetch } from "./helpers/served.js";

const page = await loadPage({ fetch: servedFetch(parquetFiles()) });
const { document, window } = page;
globalThis.hyparquet = hyparquet;
window.localStorage.clear();

/* A map whose style loads only when the test says so. */
const held = [];
let holding = true;
globalThis.maplibregl.Map = class HeldStyle extends FakeMap {
  fire(event, payload) {
    if (holding && (event === "style.load" || event === "load")) held.push(() => super.fire(event, payload));
    else super.fire(event, payload);
  }
};
await load("js/app.js");

const $ = (sel) => document.querySelector(sel);
const click = (node) => node.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
const params = () => new URL(window.location.href).searchParams;
const visibility = (id) => page.map.layout(id).visibility;

test("the controls and the Layers tile show before the catalog and the map load", () => {
  assert.equal(page.map, undefined, "no map yet");
  assert.equal($("#search input"), null, "the page is not wired yet");
  assert.deepEqual(
    [...$("#controls").children].map((node) => node.className),
    ["compass", "terrain-btn", "zoom-control", "locate-btn", "help-btn"],
  );
  assert.ok($('#controls button[aria-label="Zoom in"]'));
  assert.ok($("#layers .layers-thumb"));
  assert.ok($("#layers .layers-open"));
  assert.equal($(".compass").hasAttribute("data-idle"), true, "the phone hides the compass of a map facing north");
  for (const button of $("#controls").querySelectorAll("button")) {
    assert.ok(button.title, `${button.className} shows its label as a tooltip`);
    assert.equal(button.title, button.getAttribute("aria-label"));
  }
});

test("before the map, the compass, zoom, locate and Help do nothing; a layer and 3D change the state", () => {
  click($('.compass button[aria-label="Rotate left"]'));
  click($('.compass button[aria-label="Face north"]'));
  click($('#controls button[aria-label="Zoom in"]'));
  click($(".locate-btn"));
  click($(".help-btn"));
  assert.equal($("#notice").textContent, "");

  click($('.layer-toggle[data-name="centerlines"]'));
  assert.equal($('.layer-toggle[data-name="centerlines"]').getAttribute("aria-pressed"), "true");
  assert.equal(params().get("layers"), "regions,centerlines");

  click($(".terrain-btn"));
  assert.equal($(".terrain-btn").getAttribute("aria-pressed"), "true");
  assert.equal(params().get("3d"), "1");
  assert.equal($(".compass").hasAttribute("data-idle"), false, "the phone shows the compass in 3D");
});

test("the controls follow the breakpoint before the map", () => {
  page.setPhone(true);
  assert.equal($(".help-btn").parentElement, $("#status"));
  assert.ok($(".layers-pane").contains($('.layer-toggle[data-name="centerlines"]')));
  page.setPhone(false);
  assert.equal($(".help-btn").parentElement, $("#controls"));
  assert.ok($(".layers-drawer").contains($('.layer-toggle[data-name="centerlines"]')));
});

test("a choice made after the map's style was built reaches the map once it is wired", async () => {
  await waitFor(() => page.map);
  /* The style holds the choices so far; these come after it. */
  assert.equal(visibility("centerlines"), "visible");
  assert.equal(visibility("intersects"), "none");
  click($('.layer-toggle[data-name="intersects"]'));
  click($(".layers-thumb"));
  click($(".layers-thumb"));
  assert.equal(params().get("base"), "imagery");
  assert.equal(visibility("intersects"), "none", "no map calls before the map is wired");

  holding = false;
  for (const fire of held.splice(0)) fire();
  await waitFor(() => $("#search input"));
  assert.equal($("#notice").textContent, "");
  assert.equal(visibility("intersects"), "visible");
  assert.equal(visibility("esri"), "visible");
  assert.equal(page.map.getTerrain()?.source, "terrain");
  /* The Standard picture, shown on imagery, takes the map's background until the view's picture comes. */
  assert.match(decodeURIComponent($(".layers-thumb img").src), /fill="#[0-9a-f]+"/i);
});

test("once wired, the controls move the map", () => {
  click($('#controls button[aria-label="Zoom in"]'));
  assert.ok(page.map.calls.includes("zoomIn"));
  click($('.layer-toggle[data-name="intersects"]'));
  assert.equal(visibility("intersects"), "none");
  click($(".help-btn"));
  assert.ok($(".welcome") && !$(".welcome").closest("[hidden]"), "Help shows the welcome");
});
