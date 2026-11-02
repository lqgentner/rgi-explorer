/* The compass and the tilt that switches 3D, on one desktop page. The tests run in order. */

import assert from "node:assert/strict";
import { test } from "node:test";

import * as hyparquet from "hyparquet";

import { load, loadPage, settle, waitFor } from "./helpers/browser.js";
import { makeParquet, servedFetch } from "./helpers/served.js";

const page = await loadPage({ fetch: servedFetch(makeParquet()) });
const { document, window } = page;
globalThis.hyparquet = hyparquet;
window.sessionStorage.clear();
await load("js/app.js");
await waitFor(() => document.querySelector("#controls .compass"));
const $ = (sel) => document.querySelector(sel);
const click = (node) => node.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
const params = () => new URL(window.location.href).searchParams;
const map = () => page.map;
/* In 3D the 3D button reads "2D", the mode it switches to. */
const switchesTo = () => $("#controls .terrain-btn").textContent;
/* The map calls made since `mark`, so other listeners' calls don't matter. */
const since = (mark) => map().calls.slice(mark);

test("the compass leads the column, idle, and the arrows turn the map 45°", () => {
  assert.deepEqual([...$("#controls").children].slice(0, 2).map((n) => n.className), ["compass", "terrain-btn"]);
  assert.equal($(".compass").hasAttribute("data-idle"), true);
  click($('.compass button[aria-label="Rotate left"]'));
  assert.equal(map().getBearing(), 45);
  assert.equal($(".compass-needle").style.transform, "rotateX(0deg) rotateZ(-45deg)");
  assert.equal($(".compass").hasAttribute("data-idle"), false);
  click($('.compass button[aria-label="Face north"]'));
  assert.equal(map().getBearing(), 0);
  assert.equal(params().get("3d"), null, "facing north in 2D stays in 2D");
});

test("a tilt by hand past 5° turns 3D on where the reader left the camera, with the notice", async () => {
  const mark = map().calls.length;
  map().gesture({ bearing: 40, pitch: 30 });
  await settle();
  assert.equal(params().get("3d"), "1");
  assert.equal(map().getTerrain().source, "terrain");
  assert.equal(switchesTo(), "2D");
  assert.ok($(".terrain-notice"), "the notice shows the first time");
  assert.equal(map().getPitch(), 30, "no ease to 60°");
  assert.ok(!since(mark).some((c) => c.startsWith("easeTo")));
});

test("tilting back flat by hand leaves 3D and keeps the bearing", async () => {
  const mark = map().calls.length;
  map().gesture({ pitch: 3 });
  await settle();
  assert.equal(params().get("3d"), null);
  assert.equal(map().getTerrain(), null);
  assert.equal(switchesTo(), "3D");
  assert.equal($(".terrain-notice"), null);
  assert.ok(since(mark).includes('easeTo {"pitch":0}'));
  assert.equal(map().getPitch(), 0);
  assert.equal(map().getBearing(), 40);
  assert.equal($(".compass").hasAttribute("data-idle"), false, "still turned, so the phone compass stays");
});

test("a small tilt by hand in 2D eases back flat without 3D", async () => {
  const mark = map().calls.length;
  map().gesture({ pitch: 4 });
  await settle();
  assert.equal(params().get("3d"), null);
  assert.ok(since(mark).includes('easeTo {"pitch":0}'));
  assert.ok(!since(mark).includes("+terrain"));
});

test("a small tilt that MapLibre snaps north still ends flat", async () => {
  map().gesture({ bearing: -2.4, pitch: 4 }, { snapNorth: true });
  await settle();
  assert.equal(map().getPitch(), 0);
  assert.equal(map().getBearing(), 0);
  assert.equal(params().get("3d"), null);
});

test("the compass leaves 3D the way the 3D button does", async () => {
  map().gesture({ pitch: 45 });
  await settle();
  assert.equal(params().get("3d"), "1");
  click($('.compass button[aria-label="Face north"]'));
  assert.equal(params().get("3d"), null);
  assert.equal(map().getTerrain(), null);
  assert.equal(switchesTo(), "3D");
  assert.equal($(".terrain-notice"), null);
  assert.equal(map().getBearing(), 0);
  assert.equal(map().getPitch(), 0);
  assert.equal($(".compass").hasAttribute("data-idle"), true);
});

/* Last, because mountTerrain shows the notice once per page and the tilt test above expects it. */
test("the page's own camera moves never switch 3D", () => {
  click($("#controls .terrain-btn"));
  assert.equal(map().getPitch(), 60);
  assert.equal(params().get("3d"), "1");
  assert.equal(switchesTo(), "2D");
  click($("#controls .terrain-btn"));
  assert.equal(map().getPitch(), 0);
  assert.equal(params().get("3d"), null);
  assert.equal(map().getTerrain(), null);
});
