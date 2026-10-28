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
