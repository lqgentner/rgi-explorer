/* The previews of the view: shapes from the loaded tiles and the imagery export. */

import assert from "node:assert/strict";
import test from "node:test";

import { FakeMap, loadPage, load } from "./helpers/browser.js";

await loadPage();
const { imageryUrl, PREVIEW_SPAN, viewShapes } = await load("js/viewpreview.js");

/* A map with the RGI source, which the previews query. */
const fakeMap = (center, zoom) => new FakeMap({ center, zoom, style: { sources: { data: { type: "vector" } }, layers: [] } });

const line = (sourceLayer, coordinates, extra = {}) => ({
  sourceLayer,
  geometry: { type: "LineString", coordinates },
  properties: {},
  ...extra,
});

test("a preview spans PREVIEW_SPAN screen pixels around the centre, north up", () => {
  /* At zoom 2 the world is 2048 px wide, so 10 degrees east is 56.9 px, or 8.5 preview pixels. */
  const map = fakeMap([0, 0], 2);
  map.sourceFeatures = [line("regions", [[-10, 0], [10, 0]])];
  const { layers, clips } = viewShapes(map, ["regions"], 48);
  assert.equal(PREVIEW_SPAN, 320);
  assert.deepEqual(layers.regions, [{ clip: null, d: "M15.5 24.0L32.5 24.0", seen: true, properties: {} }]);
  assert.deepEqual(clips, []);
});

test("closed rings close, points draw as dots and shapes outside the square are dropped", () => {
  const map = fakeMap([0, 0], 2);
  map.sourceFeatures = [
    { sourceLayer: "glaciers", geometry: { type: "Polygon", coordinates: [[[0, 0], [5, 0], [5, 5], [0, 0]]] }, properties: { rgi_id: "a" } },
    { sourceLayer: "glaciers", geometry: { type: "Point", coordinates: [0, 0] }, properties: { rgi_id: "b" } },
    line("glaciers", [[80, 0], [90, 0]]),
  ];
  const { layers } = viewShapes(map, ["glaciers"], 48);
  assert.equal(layers.glaciers.length, 2);
  assert.match(layers.glaciers[0].d, /^M24\.0 24\.0L.*Z$/);
  assert.deepEqual(layers.glaciers[0].properties, { rgi_id: "a" });
  /* A 2 px dot at a preview scale of 48 / 320 has a radius of 0.3. */
  assert.equal(layers.glaciers[1].d, "M23.7 24.0a0.3 0.3 0 1 0 0.6 0a0.3 0.3 0 1 0 -0.6 0");
  assert.equal(layers.glaciers[1].seen, true);
});

test("each path keeps to its tile's rectangle, and tiles outside the square are skipped", () => {
  const map = fakeMap([0, 0], 2);
  map.sourceFeatures = [
    line("regions", [[-10, 0], [-1, 0]], { tile: { z: 2, x: 1, y: 1 } }),
    line("regions", [[100, -60], [120, -60]], { tile: { z: 2, x: 3, y: 3 } }),
  ];
  const { layers, clips } = viewShapes(map, ["regions"], 48);
  assert.deepEqual(layers.regions.map((shape) => shape.clip), ["2/1/1"]);
  assert.deepEqual(clips, [{ key: "2/1/1", x: -52.8, y: -52.8, width: 76.8, height: 76.8 }]);
});

test("a polygon whose only lines in view are its tile's cuts is drawn but not seen", () => {
  /* A region that covers the whole tile 2/1/1, lng -90 to 0: its ring runs around the tile, a little outside. */
  const map = fakeMap([-45, 40], 2);
  const ring = [[-92, 68], [2, 68], [2, -2], [-92, -2], [-92, 68]];
  map.sourceFeatures = [
    { sourceLayer: "regions", geometry: { type: "Polygon", coordinates: [ring] }, properties: {}, tile: { z: 2, x: 1, y: 1 } },
  ];
  const [shape] = viewShapes(map, ["regions"], 48).layers.regions;
  assert.equal(shape.seen, false);
  map.sourceFeatures[0].geometry.coordinates[0][1] = [-45, 40];
  assert.equal(viewShapes(map, ["regions"], 48).layers.regions[0].seen, true, "a vertex in view puts lines in view");
});

test("a tile across the antimeridian draws beside the centre", () => {
  const map = fakeMap([179, 0], 2);
  map.sourceFeatures = [line("regions", [[-179, 0], [-178, 0]], { tile: { z: 2, x: 0, y: 1 } })];
  const { layers } = viewShapes(map, ["regions"], 48);
  const [x] = layers.regions[0].d.slice(1).split(" ").map(Number);
  assert.ok(x > 24 && x < 48, `x ${x} lies east of the centre`);
});

test("a map that cannot be read gives no shapes", () => {
  const map = fakeMap([0, 0], 2);
  map.querySourceFeatures = () => {
    throw new Error("style not loaded");
  };
  assert.equal(viewShapes(map, ["regions"], 48), null);
});

test("the imagery export covers the preview's span around the centre", () => {
  const map = fakeMap([0, 0], 0);
  const url = new URL(imageryUrl(map, 192));
  assert.equal(url.origin + url.pathname, "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export");
  assert.equal(url.searchParams.get("bbox"), "-12523443,-12523443,12523443,12523443");
  assert.equal(url.searchParams.get("size"), "192,192");
  assert.equal(url.searchParams.get("bboxSR"), "3857");
  map.center = { lng: 370, lat: 0 };
  const [xmin, , xmax] = new URL(imageryUrl(map, 192)).searchParams.get("bbox").split(",").map(Number);
  assert.ok(Math.abs((xmin + xmax) / 2 - 1113195) < 1, "a centre past the antimeridian wraps");
});
