/*
 * The fake must be as strict as MapLibre is lenient: later suites rely on it
 * to throw where the renderer would only warn.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { FakeMap, loadPage } from "./helpers/browser.js";

const source = { type: "geojson", data: { type: "FeatureCollection", features: [] } };
const layer = { id: "outline", type: "line", source: "glaciers" };

test("the harness exposes the map the page modules construct", async () => {
  const page = await loadPage();
  assert.equal(page.map, undefined);
  const built = new globalThis.maplibregl.Map({ container: "map", center: [0, 0], zoom: 1 });
  assert.equal(page.map, built);
  assert.ok(page.document.getElementById("map"));
});

test("an unknown map option throws", () => {
  assert.throws(() => new FakeMap({ attribution: false }), /unknown map option 'attribution'/);
  assert.doesNotThrow(() => new FakeMap({ attributionControl: false }));
});

test("a duplicate source or layer id throws", () => {
  const map = new FakeMap();
  map.addSource("glaciers", source);
  assert.throws(() => map.addSource("glaciers", source), /added twice/);
  map.addLayer(layer);
  assert.throws(() => map.addLayer(layer), /added twice/);
});

test("a layer on a missing source throws", () => {
  assert.throws(() => new FakeMap().addLayer(layer), /missing source/);
});

test("writes to a missing layer throw", () => {
  const map = new FakeMap();
  assert.throws(() => map.setLayoutProperty("nope", "visibility", "none"), /missing layer/);
  assert.throws(() => map.setPaintProperty("nope", "line-color", "red"), /missing layer/);
  assert.throws(() => map.setFilter("nope", ["==", "a", 1]), /missing layer/);
});

test("terrain must name an added source", () => {
  const map = new FakeMap();
  assert.throws(() => map.setTerrain({ source: "dem" }), /missing source/);
  map.addSource("dem", { type: "raster-dem" });
  map.setTerrain({ source: "dem" });
  assert.deepEqual(map.getTerrain(), { source: "dem" });
});

test("fitBounds and jumpTo are recorded and fire moveend", () => {
  const map = new FakeMap();
  let moves = 0;
  map.on("moveend", () => moves++);
  map.fitBounds([[0, 0], [1, 1]], { padding: 10 });
  map.jumpTo({ center: [5, 6], zoom: 3 });
  assert.equal(moves, 2);
  assert.deepEqual(map.getCenter(), { lng: 5, lat: 6 });
  assert.equal(map.getZoom(), 3);
  assert.equal(map.lastFit.options.padding, 10);
});

test("a style with a duplicate layer or a missing source throws at construction", () => {
  const sources = { a: source };
  assert.throws(
    () => new FakeMap({ style: { sources, layers: [{ id: "x", type: "line", source: "a" }, { id: "x", type: "line", source: "a" }] } }),
    /added twice/,
  );
  assert.throws(
    () => new FakeMap({ style: { sources, layers: [{ id: "x", type: "line", source: "nope" }] } }),
    /missing source/,
  );
});

test("querySourceFeatures throws on a missing source and matches by source layer and rgi_id", () => {
  const map = new FakeMap();
  map.addSource("data", { type: "vector" });
  assert.throws(() => map.querySourceFeatures("nope", { sourceLayer: "glaciers" }), /missing source/);
  map.sourceFeatures = [
    { sourceLayer: "glaciers", properties: { rgi_id: "a" } },
    { sourceLayer: "glaciers", properties: { rgi_id: "b" } },
    { sourceLayer: "complexes", properties: { rgi_id: "a" } },
  ];
  const found = map.querySourceFeatures("data", {
    sourceLayer: "glaciers",
    filter: ["==", ["get", "rgi_id"], "a"],
  });
  assert.deepEqual(found, [map.sourceFeatures[0]]);
  assert.throws(
    () => map.querySourceFeatures("data", { sourceLayer: "glaciers", filter: ["in", "a"] }),
    /unsupported filter/,
  );
});

test("loaded and isMoving answer what the test stages", () => {
  const map = new FakeMap();
  assert.equal(map.loaded(), true);
  assert.equal(map.isMoving(), false);
  map.tilesLoaded = false;
  map.moving = true;
  assert.equal(map.loaded(), false);
  assert.equal(map.isMoving(), true);
});

test("easeTo fires page events without an originalEvent, and gesture fires them with one", () => {
  const map = new FakeMap();
  const seen = [];
  for (const name of ["move", "pitchend", "rotateend", "moveend"]) {
    map.on(name, (e) => seen.push([name, Boolean(e.originalEvent)]));
  }
  map.easeTo({ pitch: 60 });
  assert.deepEqual(seen, [["move", false], ["pitchend", false], ["moveend", false]]);
  seen.length = 0;
  map.gesture({ bearing: 40, pitch: 30 });
  assert.deepEqual(seen, [["move", true], ["pitchend", true], ["rotateend", true], ["moveend", false]]);
  assert.equal(map.getBearing(), 40);
  assert.equal(map.getPitch(), 30);
  assert.equal(map.calls.at(-1), 'gesture {"bearing":40,"pitch":30}');
});
