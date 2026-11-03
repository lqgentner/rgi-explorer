/* The imagery preview of the view. */

import assert from "node:assert/strict";
import test from "node:test";

import { FakeMap, loadPage, load } from "./helpers/browser.js";

await loadPage();
const { imageryUrl, PREVIEW_SPAN } = await load("js/viewpreview.js");

const fakeMap = (center, zoom) => new FakeMap({ center, zoom });

test("the imagery export covers the preview's span around the centre", () => {
  const map = fakeMap([0, 0], 0);
  assert.equal(PREVIEW_SPAN, 320);
  const url = new URL(imageryUrl(map, 192));
  assert.equal(url.origin + url.pathname, "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export");
  assert.equal(url.searchParams.get("bbox"), "-12523443,-12523443,12523443,12523443");
  assert.equal(url.searchParams.get("size"), "192,192");
  assert.equal(url.searchParams.get("bboxSR"), "3857");
  map.center = { lng: 370, lat: 0 };
  const [xmin, , xmax] = new URL(imageryUrl(map, 192)).searchParams.get("bbox").split(",").map(Number);
  assert.ok(Math.abs((xmin + xmax) / 2 - 1113195) < 1, "a centre past the antimeridian wraps");
});

test("the export stays inside the world at the poles and the antimeridian", () => {
  const HALF = 20037508.34;
  for (const [center, zoom] of [[[0, 90], 1], [[179.9, -85], 2], [[-180, 0], 3], [[0, 0], -2]]) {
    const [xmin, ymin, xmax, ymax] = new URL(imageryUrl(fakeMap(center, zoom), 192)).searchParams.get("bbox").split(",").map(Number);
    assert.ok(xmin >= -HALF - 1 && xmax <= HALF + 1 && ymin >= -HALF - 1 && ymax <= HALF + 1, `${center} at zoom ${zoom}`);
    assert.ok(Math.abs(xmax - xmin - (ymax - ymin)) <= 1, "the box stays square");
  }
});
