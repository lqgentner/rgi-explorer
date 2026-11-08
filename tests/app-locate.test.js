/* The locate button, on a desktop page that then crosses to the phone. The tests run in order. */

import assert from "node:assert/strict";
import { test } from "node:test";

import * as hyparquet from "hyparquet";

import { load, loadPage, waitFor } from "./helpers/browser.js";
import { parquetFiles, servedFetch } from "./helpers/served.js";

const page = await loadPage({ fetch: servedFetch(parquetFiles()) });
const { document, window } = page;
globalThis.hyparquet = hyparquet;
window.sessionStorage.clear();
Object.defineProperty(globalThis.navigator, "geolocation", { configurable: true, value: {} });
await load("js/app.js");
/* The button draws with the page; the search shows that the map is wired. */
await waitFor(() => document.querySelector("#search input"));
const $ = (sel) => document.querySelector(sel);
const click = (node) => node.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
const button = () => $("#controls .locate-btn");
const geolocate = () => page.map.controls[0];

test("the button follows the zoom buttons, with Lucide's locate-fixed", () => {
  const names = [...$("#controls").children].map((n) => n.className);
  assert.equal(names.indexOf("locate-btn"), names.indexOf("zoom-control") + 1);
  assert.equal(button().getAttribute("aria-label"), "Show my location");
  assert.match(button().querySelector("use").getAttribute("href"), /#locate-fixed$/);
});

test("MapLibre's geolocate control finds the reader once, with the GPS, and draws the dot", () => {
  assert.equal(page.map.controls.length, 1);
  const { options } = geolocate();
  assert.equal(options.positionOptions.enableHighAccuracy, true);
  assert.ok(options.positionOptions.timeout > 0);
  assert.notEqual(options.trackUserLocation, true);
  assert.equal(options.fitBoundsOptions.maxZoom, 15, "replacing the fit options keeps MapLibre's zoom limit");
  assert.ok(options.fitBoundsOptions.maxDuration > 0, "a long flight jumps, as the page's own fits do");
  assert.equal(geolocate().triggers, 0, "nothing asks before a press");
  click(button());
  assert.equal(geolocate().triggers, 1);
  const { padding } = geolocate().options.fitBoundsOptions;
  assert.deepEqual(padding, { top: 24, right: 24, bottom: 24, left: 24 }, "the fit leaves room, as the page's own fits do");
  assert.equal(geolocate().options.fitBoundsOptions.maxZoom, 15);
});

test("a refusal and a position not found each show a notice at the button", () => {
  geolocate().fail(1);
  assert.equal($("#notice").textContent, "Location access is off for this site.");
  geolocate().fail(3);
  assert.equal($("#notice").textContent, "Your location couldn't be found.");
});

test("a browser without geolocation shows a notice and asks nothing", () => {
  const before = geolocate().triggers;
  delete globalThis.navigator.geolocation;
  click(button());
  assert.equal(geolocate().triggers, before);
  assert.equal($("#notice").textContent, "Your browser can't share your location.");
  Object.defineProperty(globalThis.navigator, "geolocation", { configurable: true, value: {} });
});

test("on the phone the same button stays in the column and still locates, clear of the search bar", () => {
  const node = button();
  page.setPhone(true);
  assert.equal(button(), node);
  const before = geolocate().triggers;
  click(button());
  assert.equal(geolocate().triggers, before + 1);
  assert.ok(geolocate().options.fitBoundsOptions.padding.top > 24, "the phone's fit keeps below the search bar");
});

test("a press before MapLibre has set the control up does nothing and says nothing", () => {
  $("#notice").textContent = "";
  geolocate().trigger = () => false;
  click(button());
  assert.equal($("#notice").textContent, "");
});
