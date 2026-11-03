/* The card's terminus point pins the map and brings the pin into view when it is out of sight. */

import assert from "node:assert/strict";
import { test } from "node:test";

import * as hyparquet from "hyparquet";

import { load, loadPage, settle, waitFor } from "./helpers/browser.js";
import { parquetFiles, servedFetch } from "./helpers/served.js";

const ALETSCH = "RGI2000-v7.0-G-11-02596";
const TERMINUS = [8.024125568430303, 46.39832730515637];

const terminusButton = (document) =>
  [...document.querySelectorAll("#card .row")]
    .find((row) => row.querySelector(".row-label")?.firstChild?.textContent === "Terminus point")
    ?.querySelector("button.link");

test("the terminus point moves the map only when the pin is off screen or under the card", async () => {
  const page = await loadPage({
    url: `https://lqgentner.github.io/rgi-explorer/?glacier=${ALETSCH}#9/46.4/8.0`,
    fetch: servedFetch(parquetFiles()),
  });
  globalThis.hyparquet = hyparquet;
  await load("js/app.js");
  const { document } = page;
  const button = await waitFor(() => terminusButton(document));
  await settle(20);
  const { map } = page;
  const eases = () => map.calls.filter((call) => call.startsWith("easeTo"));
  /* Draw the terminus at a screen point, on the near side of the globe. */
  const drawAt = (x, y) => {
    map.project = () => ({ x, y });
    map.unproject = () => ({ lng: TERMINUS[0], lat: TERMINUS[1] });
  };

  /* The fake's canvas is 1024 x 768 px; the card covers its left 408 px and more. */
  drawAt(700, 400);
  map.calls.length = 0;
  button.click();
  assert.deepEqual(map.getSource("pin").data.geometry.coordinates, TERMINUS);
  assert.deepEqual(eases(), [], "a pin in view leaves the map where it is");

  drawAt(200, 400);
  map.calls.length = 0;
  button.click();
  assert.deepEqual(map.getSource("pin").data.geometry.coordinates, TERMINUS);
  const [ease] = eases();
  assert.ok(ease, "a pin under the card moves the map");
  const options = JSON.parse(ease.slice("easeTo ".length));
  assert.deepEqual(options.center, TERMINUS);
  assert.deepEqual(Object.keys(options).sort(), ["center", "offset"], "zoom, bearing and pitch stay");
  assert.ok(options.offset[0] >= 204, "the pin lands in the middle of the map right of the card");
  assert.equal(options.offset[1], 0);

  drawAt(700, 900);
  map.calls.length = 0;
  button.click();
  assert.equal(eases().length, 1, "a pin below the canvas moves the map");

  /* On a phone the sheet covers the bottom and the search bar the top, not the left. */
  page.setPhone(true);
  drawAt(200, 400);
  map.calls.length = 0;
  button.click();
  assert.deepEqual(eases(), [], "the left of a phone's map is open");
  drawAt(500, 30);
  map.calls.length = 0;
  button.click();
  const [phoneEase] = eases();
  assert.ok(phoneEase, "a pin under the search bar moves the map");
  const { offset } = JSON.parse(phoneEase.slice("easeTo ".length));
  assert.equal(offset[0], 0);
  assert.ok(offset[1] <= 24, "the pin lands between the search bar and the sheet");
  page.map.fire("idle");
});
