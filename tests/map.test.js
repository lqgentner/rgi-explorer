/* The map's style, base maps, toggles, selection and view helpers, on the strict fake. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { LIBERTY_STYLE } from "../js/config.js";
import { loadCatalog } from "../js/catalog.js";
import { parseState } from "../js/state.js";
import { load, loadPage, settle } from "./helpers/browser.js";

const ROOT = "https://data.source.coop/lqgentner/rgi/catalog.json";
const FIXTURES = new URL("./fixtures/", import.meta.url);
const read = (path) => readFileSync(new URL(path, FIXTURES), "utf8");

const respond = (body) => ({ ok: true, status: 200, json: async () => JSON.parse(body) });
const BASE = "https://data.source.coop/lqgentner/rgi/";

async function fetchFixture(url) {
  if (url === LIBERTY_STYLE) return respond(read("liberty.json"));
  if (url.startsWith(BASE)) return respond(read(`catalog/${url.slice(BASE.length)}`));
  return { ok: false, status: 404, json: async () => ({}) };
}

/** A fake map built from the fixtures for a page URL's state. */
async function build(search = "") {
  const url = `https://lqgentner.github.io/rgi-explorer/${search}`;
  const page = await loadPage({ url, fetch: fetchFixture });
  const { createMap } = await load("js/map.js");
  const catalog = await loadCatalog(ROOT);
  const rgiMap = await createMap(page.document.getElementById("map"), catalog, parseState(new URL(url)));
  return { rgiMap, map: page.map, page };
}

const rgiId = "RGI2000-v7.0-G-01-00001";

test("the page starts the map from the catalog", async () => {
  const page = await loadPage({ fetch: fetchFixture });
  await load("js/app.js");
  await settle();
  assert.equal(page.map.layout("landcover_ice").visibility, "none");
});

test("the base map glacier fill is hidden", async () => {
  const { map } = await build();
  assert.equal(map.layout("landcover_ice").visibility, "none");
  assert.equal(map.layout("water").visibility, undefined);
});

test("the map reads glyphs from the glyph server and one PMTiles source", async () => {
  const { map } = await build();
  assert.match(map.options.style.glyphs, /^https:\/\/tiles\.openfreemap\.org\/fonts\//);
  assert.equal(map.getSource("data").url, "pmtiles://https://data.source.coop/lqgentner/rgi/v7.0/rgi7.0.pmtiles");
});

test("the map is a globe and reads no catalog style", async () => {
  const fetched = [];
  const page = await loadPage({
    url: "https://lqgentner.github.io/rgi-explorer/",
    fetch: (url) => {
      fetched.push(url);
      return fetchFixture(url);
    },
  });
  const { createMap } = await load("js/map.js");
  const catalog = await loadCatalog(ROOT);
  fetched.length = 0;
  await createMap(page.document.getElementById("map"), catalog, parseState(new URL(page.window.location.href)));
  assert.deepEqual(page.map.options.style.projection, { type: "globe" });
  assert.deepEqual(fetched, [LIBERTY_STYLE]);
});

test("glaciers are white with a grey outline and regions have no fill", async () => {
  const { map } = await build();
  assert.equal(map.getLayer("glaciers-fill").paint["fill-color"], "#ffffff");
  assert.equal(map.getLayer("glaciers-outline").paint["line-color"], "#80868b");
  const regionFills = [...map.layers.values()].filter((l) => /^region/.test(l["source-layer"] ?? "") && l.type === "fill");
  assert.deepEqual(regionFills, []);
});

test("over imagery glaciers are white outlines without a fill, and region outlines turn light", async () => {
  const { rgiMap, map } = await build("?base=imagery");
  const paint = (id, key) => map.getLayer(id).paint[key];
  assert.equal(paint("glaciers-fill", "fill-opacity"), 0);
  assert.equal(paint("selection-fill", "fill-opacity"), 0);
  assert.equal(paint("glaciers-outline", "line-color"), "#ffffff");
  assert.equal(paint("regions-outline-1", "line-color"), "#f1f3f4");
  assert.equal(paint("regions-outline-2", "line-color"), "#bdc1c6");
  rgiMap.setBase("standard");
  assert.equal(paint("glaciers-fill", "fill-opacity"), 0.85);
  assert.equal(paint("selection-fill", "fill-opacity"), 0.85);
  assert.equal(paint("glaciers-outline", "line-color"), "#80868b");
  assert.equal(paint("regions-outline-1", "line-color"), "#5f6368");
  rgiMap.setBase("imagery");
  assert.equal(paint("selection-fill", "fill-opacity"), 0);
  assert.equal(paint("regions-outline-2", "line-color"), "#bdc1c6");
});

test("the RGI layers draw above Liberty's lines and below its borders and labels", async () => {
  const { map } = await build();
  assert.ok(map.indexOf("glaciers-fill") > map.indexOf("road_major"));
  assert.ok(map.indexOf("glaciers-outline") < map.indexOf("boundary"));
  assert.ok(map.indexOf("intersects") < map.indexOf("boundary"));
  assert.ok(map.indexOf("glaciers-fill") < map.indexOf("label_place"));
  assert.ok(map.indexOf("regions-outline-1") < map.indexOf("glaciers-fill"));
  assert.ok(map.indexOf("glacier-labels") > map.indexOf("label_country"));
});

test("imagery shows esri above Liberty's fills and lines and below its borders and labels", async () => {
  const { rgiMap, map } = await build();
  assert.equal(map.layout("esri").visibility, "none");
  rgiMap.setBase("imagery");
  assert.equal(map.layout("esri").visibility, "visible");
  assert.equal(map.indexOf("esri"), map.indexOf("road_one_way_arrow") + 1);
  assert.ok(map.indexOf("esri") < map.indexOf("boundary"));
  assert.ok(map.indexOf("esri") < map.indexOf("label_place"));
  assert.ok(map.indexOf("esri") < map.indexOf("glaciers-fill"));
  assert.equal(map.layout("label_place").visibility, undefined);
  rgiMap.setBase("standard");
  assert.equal(map.layout("esri").visibility, "none");
});

test("a symbol between Liberty's lines stays below imagery and the RGI layers", async () => {
  const { map } = await build();
  const arrow = map.indexOf("road_one_way_arrow");
  assert.ok(arrow > -1 && arrow < map.indexOf("boundary"));
  assert.ok(map.indexOf("esri") > arrow);
  assert.ok(map.indexOf("glaciers-fill") > map.indexOf("esri"));
  assert.ok(map.indexOf("regions-outline-1") < map.indexOf("boundary"));
  assert.ok(arrow < map.indexOf("esri"));
  assert.ok(map.indexOf("label_place") > map.indexOf("glaciers-outline"));
});

/** createMap with a map that fires `events` instead of loading, then `load` if asked. */
async function startWith(events, { thenLoad }) {
  const page = await loadPage({ url: "https://lqgentner.github.io/rgi-explorer/", fetch: fetchFixture });
  const { createMap } = await load("js/map.js");
  const catalog = await loadCatalog(ROOT);
  const Base = globalThis.maplibregl.Map;
  globalThis.maplibregl.Map = class extends Base {
    constructor(options) {
      super(options);
      queueMicrotask(() => {
        for (const event of events) this.fire("error", event);
        if (thenLoad) super.fire("load");
      });
    }

    fire(event, payload) {
      if (event !== "load") super.fire(event, payload);
    }
  };
  return createMap(page.document.getElementById("map"), catalog, parseState(new URL(page.window.location.href)));
}

test("the map rejects when MapLibre reports an error before load", async () => {
  await assert.rejects(startWith([{ error: new Error("style broke") }], { thenLoad: false }), /style broke/);
});

test("a source or tile error before load does not stop the map", async () => {
  const rgiMap = await startWith(
    [{ error: new Error("404"), sourceId: "openmaptiles" }, { error: new Error("404"), tile: {} }],
    { thenLoad: true },
  );
  assert.ok(rgiMap.map);
});

test("the state starts the base map and the toggles", async () => {
  const { map } = await build("?base=imagery&layers=centerlines");
  assert.equal(map.layout("esri").visibility, "visible");
  assert.equal(map.layout("centerlines").visibility, "visible");
  assert.equal(map.layout("regions-outline-1").visibility, "none");
  assert.equal(map.layout("intersects").visibility, "none");
  assert.equal(map.layout("glaciers-fill").visibility, undefined);
});

test("a toggle shows exactly the layers with its source layer", async () => {
  const { rgiMap, map } = await build();
  assert.equal(map.layout("centerlines").visibility, "none");
  rgiMap.setToggle("centerlines", true);
  const visible = [...map.layers.values()]
    .filter((l) => l["source-layer"] === "centerlines")
    .map((l) => l.layout.visibility);
  assert.ok(visible.length > 0 && visible.every((v) => v === "visible"));
  assert.equal(map.layout("intersects").visibility, "none");
  rgiMap.setToggle("regions", false);
  for (const id of ["regions-outline-1", "regions-outline-2", "region-labels-1"]) {
    assert.equal(map.layout(id).visibility, "none", id);
  }
  assert.equal(map.layout("glaciers-fill").visibility, undefined);
});

test("selection draws a red dashed outline filtered to the ID", async () => {
  const { rgiMap, map } = await build();
  assert.equal(map.layout("selection-outline").visibility, "none");
  rgiMap.select(rgiId);
  const outline = map.getLayer("selection-outline");
  assert.deepEqual(outline.filter, ["==", ["get", "rgi_id"], rgiId]);
  assert.equal(outline["source-layer"], "glaciers");
  assert.equal(outline.paint["line-color"], "#d93025");
  assert.equal(outline.paint["line-width"], 2);
  assert.deepEqual(outline.paint["line-dasharray"], [2, 1.2]);
  assert.deepEqual(map.getLayer("selection-fill").filter, ["==", ["get", "rgi_id"], rgiId]);
  assert.deepEqual(map.getLayer("selection-fill").paint, map.getLayer("glaciers-fill").paint);
  assert.equal(map.getLayer("selection-dim").paint["fill-opacity"], 0.15);
  for (const id of ["selection-dim", "selection-fill", "selection-outline", "selection-dot"]) {
    assert.equal(map.layout(id).visibility, "visible", id);
  }
  assert.ok(map.indexOf("selection-outline") > map.indexOf("glacier-labels"));
});

test("the selected glacier's name is red and drawn above the selection", async () => {
  const { rgiMap, map } = await build();
  const label = map.getLayer("selection-label");
  assert.equal(label.type, "symbol");
  assert.equal(label["source-layer"], "glacier-labels");
  assert.equal(label.paint["text-color"], "#d93025");
  assert.deepEqual(label.layout["text-field"], map.getLayer("glacier-labels").layout["text-field"]);
  assert.equal(map.layout("selection-label").visibility, "none");
  for (const id of ["selection-dim", "selection-fill", "selection-outline"]) {
    assert.ok(map.indexOf("selection-label") > map.indexOf(id), `above ${id}`);
  }
  rgiMap.select(rgiId);
  assert.deepEqual(map.getLayer("selection-label").filter, ["==", ["get", "rgi_id"], rgiId]);
  assert.equal(map.layout("selection-label").visibility, "visible");
  rgiMap.select(null);
  assert.equal(map.layout("selection-label").visibility, "none");
});

test("a selected glacier drawn as a dot shows a red dot with a white ring", async () => {
  const { rgiMap, map } = await build();
  const dot = map.getLayer("selection-dot");
  assert.equal(dot.type, "circle");
  assert.equal(dot["source-layer"], "glaciers");
  assert.equal(map.layout("selection-dot").visibility, "none");
  assert.equal(dot.paint["circle-color"], "#d93025");
  assert.equal(dot.paint["circle-stroke-color"], "#ffffff");
  const radius = (paint, zoom) => paint["circle-radius"][paint["circle-radius"].indexOf(zoom, 3) + 1];
  const dots = map.getLayer("glaciers-dots").paint;
  for (const zoom of [0, 6]) assert.ok(radius(dot.paint, zoom) > radius(dots, zoom), `larger than the dots at zoom ${zoom}`);
  assert.ok(map.indexOf("selection-dot") > map.indexOf("glaciers-dots"));

  rgiMap.select(rgiId);
  assert.deepEqual(map.getLayer("selection-dot").filter, [
    "all",
    ["in", ["geometry-type"], ["literal", ["Point", "MultiPoint"]]],
    ["==", ["get", "rgi_id"], rgiId],
  ]);
  assert.equal(map.layout("selection-dot").visibility, "visible");
  rgiMap.select(null);
  assert.equal(map.layout("selection-dot").visibility, "none");
});

test("a second selection replaces the first", async () => {
  const { rgiMap, map } = await build();
  const other = "RGI2000-v7.0-G-01-00002";
  rgiMap.select(rgiId);
  rgiMap.select(other);
  assert.deepEqual(map.getLayer("selection-outline").filter, ["==", ["get", "rgi_id"], other]);
  assert.deepEqual(map.getLayer("selection-fill").filter, ["==", ["get", "rgi_id"], other]);
  assert.equal(map.layout("selection-outline").visibility, "visible");
});

test("setBase keeps the selection and the toggles", async () => {
  const { rgiMap, map } = await build();
  rgiMap.setToggle("centerlines", true);
  rgiMap.select(rgiId);
  rgiMap.setBase("imagery");
  rgiMap.setBase("standard");
  assert.equal(map.layout("centerlines").visibility, "visible");
  assert.equal(map.layout("selection-outline").visibility, "visible");
  assert.deepEqual(map.getLayer("selection-outline").filter, ["==", ["get", "rgi_id"], rgiId]);
});

test("select(null) hides the selection and clears the complex and the pin", async () => {
  const { rgiMap, map } = await build();
  rgiMap.select(rgiId);
  rgiMap.showComplex("RGI2000-v7.0-C-01-00001");
  rgiMap.pin([10, 20]);
  assert.equal(map.layout("selection-complex").visibility, "visible");
  assert.deepEqual(map.getLayer("selection-complex").filter, ["==", ["get", "rgi_id"], "RGI2000-v7.0-C-01-00001"]);
  assert.equal(map.getLayer("selection-complex")["source-layer"], "complexes");
  assert.equal(map.getLayer("selection-complex").paint["line-color"], "#5f6368");
  assert.deepEqual(map.getSource("pin").data.geometry.coordinates, [10, 20]);
  assert.equal(map.getLayer("terminus-pin").paint["circle-color"], "#d93025");

  rgiMap.select(null);
  for (const id of ["selection-dim", "selection-fill", "selection-outline", "selection-dot", "selection-complex"]) {
    assert.equal(map.layout(id).visibility, "none", id);
  }
  assert.deepEqual(map.getSource("pin").data.features, []);
});

test("terrain adds its source once and switches on and off", async () => {
  const { rgiMap, map } = await build();
  rgiMap.setTerrain(true);
  rgiMap.setTerrain(false);
  rgiMap.setTerrain(true);
  assert.equal(map.calls.filter((c) => c === "+source terrain").length, 1);
  assert.equal(map.getTerrain().source, "terrain");
  rgiMap.setTerrain(false);
  assert.equal(map.getTerrain(), null);
});

test("3D tilts the camera after the terrain is set, and 2D levels it and faces north", async () => {
  const { rgiMap, map } = await build();
  rgiMap.setTerrain(true);
  const on = map.calls.lastIndexOf("+terrain");
  assert.equal(map.calls[on + 1], 'easeTo {"pitch":60}');
  assert.equal(map.getPitch(), 60);
  map.bearing = 30;
  rgiMap.setTerrain(false);
  assert.equal(map.calls.at(-1), 'easeTo {"pitch":0,"bearing":0}');
  assert.equal(map.getPitch(), 0);
  assert.equal(map.getBearing(), 0);
});

test("MapLibre adds no attribution control of its own", async () => {
  const { map } = await build();
  assert.equal(map.options.attributionControl, false);
});

test("North Asia and Antarctic Mainland fit without throwing", async () => {
  const { rgiMap, map } = await build();
  rgiMap.fitBbox({ xmin: -180, ymin: -90, xmax: 180, ymax: -63.2 }, 0);
  assert.ok(map.lastFit.bounds[0][1] >= -85.05);
  rgiMap.fitBbox({ xmin: 10, ymin: 20, xmax: 30, ymax: 95 }, 8);
  assert.equal(map.lastFit.bounds[1][1], 85.05);
  assert.equal(map.lastFit.options.padding, 8);
});

test("a bbox 360 degrees wide jumps to its center at zoom 3", async () => {
  const { rgiMap, map } = await build();
  rgiMap.fitBbox({ xmin: -180, ymin: 50, xmax: 180, ymax: 80 }, 0, [90, 65]);
  assert.equal(map.getZoom(), 3);
  assert.deepEqual(map.getCenter(), { lng: 90, lat: 65 });
});

test("glacierAt returns the properties of the first glacier under the point", async () => {
  const { rgiMap, map } = await build();
  assert.equal(rgiMap.glacierAt([5, 5]), null);
  map.rendered = [
    { layer: { id: "regions-outline-1" }, properties: { name: "region" } },
    { layer: { id: "glaciers-fill" }, properties: { rgi_id: rgiId } },
  ];
  assert.deepEqual(rgiMap.glacierAt([5, 5]), { rgi_id: rgiId });
});

test("glacierAt ignores the low-zoom dots", async () => {
  const { rgiMap, map } = await build();
  map.rendered = [
    { layer: { id: "glaciers-dots" }, geometry: { type: "Point", coordinates: [100, 100] }, properties: { rgi_id: "dot" } },
  ];
  assert.equal(rgiMap.glacierAt({ x: 100, y: 100 }), null);
});

test("the standard picture draws Liberty as it comes on one hidden map, at the main map's view", async () => {
  const { rgiMap, map, page } = await build();
  map.jumpTo({ center: [8, 46.5], zoom: 9 });
  assert.equal(await rgiMap.standardPicture(192), "data:image/jpeg;view=9/8/46.5");
  const mini = page.map;
  assert.notEqual(mini, map);
  assert.equal(mini.options.container.className, "picture-map");
  assert.equal(mini.options.container.style.width, "320px");
  assert.equal(mini.options.interactive, false);
  assert.equal(mini.options.pixelRatio, 0.6, "a 320 px view drawn into 192 pixels");
  assert.deepEqual(mini.options.canvasContextAttributes, { preserveDrawingBuffer: true });
  assert.equal(mini.getSource("data"), undefined, "no RGI layers");
  assert.equal(mini.layout("landcover_ice").visibility, undefined, "Liberty's own glaciers show");

  map.jumpTo({ center: [10, 47], zoom: 11 });
  assert.equal(await rgiMap.standardPicture(192), "data:image/jpeg;view=11/10/47");
  assert.equal(page.map, mini, "the hidden map is made once");
  assert.equal(document.querySelectorAll(".picture-map").length, 1);
});

test("onMove reports the view after the map moves", async () => {
  const { rgiMap, map } = await build();
  const seen = [];
  rgiMap.onMove((view) => seen.push(view));
  map.jumpTo({ center: [7, 46], zoom: 9 });
  assert.deepEqual(seen, [{ zoom: 9, lat: 46, lon: 7 }]);
});
