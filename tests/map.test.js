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
  assert.equal(paint("selection-dim", "fill-opacity"), 0, "a clear fill cannot lift a selection out of the dimming");
  assert.equal(paint("glaciers-outline", "line-color"), "#ffffff");
  for (const id of ["glaciers-casing", "intersects-casing"]) assert.equal(paint(id, "line-opacity"), 1);
  assert.equal(paint("centerlines", "line-color"), "#ddaa33");
  assert.equal(paint("selection-centerlines", "line-color"), "#ddaa33");
  const imageryWidth = paint("glaciers-outline", "line-width");
  assert.deepEqual(paint("intersects", "line-width"), imageryWidth);
  assert.equal(paint("regions-outline-1", "line-color"), "#f1f3f4");
  assert.equal(paint("regions-outline-2", "line-color"), "#bdc1c6");
  assert.equal(map.getSky()["atmosphere-blend"], 0.8, "MapLibre draws the atmosphere");
  rgiMap.setBase("standard");
  assert.equal(paint("glaciers-fill", "fill-opacity"), 1);
  assert.equal(paint("selection-fill", "fill-opacity"), 1);
  assert.equal(paint("selection-dim", "fill-opacity"), 0.15);
  assert.equal(paint("glaciers-outline", "line-color"), "#80868b");
  for (const id of ["glaciers-casing", "intersects-casing"]) assert.equal(paint(id, "line-opacity"), 0);
  assert.equal(paint("centerlines", "line-color"), "#b8860b");
  assert.equal(paint("selection-centerlines", "line-color"), "#b8860b");
  assert.notDeepEqual(paint("glaciers-outline", "line-width"), imageryWidth, "wider on the standard map");
  assert.deepEqual(paint("intersects", "line-width"), paint("glaciers-outline", "line-width"));
  assert.deepEqual(paint("glaciers-casing", "line-gap-width"), paint("glaciers-outline", "line-width"));
  assert.equal(paint("regions-outline-1", "line-color"), "#5f6368");
  assert.equal(map.getSky()["atmosphere-blend"], 0.5, "fainter over the light map");
  rgiMap.setBase("imagery");
  assert.equal(paint("selection-fill", "fill-opacity"), 0);
  assert.equal(paint("selection-dim", "fill-opacity"), 0);
  assert.equal(paint("regions-outline-2", "line-color"), "#bdc1c6");
  assert.equal(map.getSky()["atmosphere-blend"], 0.8);
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

test("imagery switches off the Liberty layers it covers and the borders, which then fetch nothing", async () => {
  const { rgiMap, map } = await build();
  rgiMap.setBase("imagery");
  assert.equal(map.layout("water").visibility, "none");
  assert.equal(map.layout("road_major").visibility, "none");
  assert.equal(map.layout("road_one_way_arrow").visibility, "none");
  assert.equal(map.layout("background").visibility, undefined, "the background shows while the imagery loads");
  assert.equal(map.getLayer("background").paint["background-color"], "#3c4043", "dark grey until the imagery loads");
  assert.equal(map.layout("boundary").visibility, "none", "the borders belong to the standard map");
  assert.equal(map.layout("label_place").visibility, undefined, "the labels stay");
  rgiMap.setBase("standard");
  assert.equal(map.layout("water").visibility, "visible");
  assert.equal(map.layout("boundary").visibility, "visible");
  assert.equal(map.layout("road_major").visibility, "visible");
  assert.equal(map.layout("landcover_ice").visibility, "none", "Liberty's glaciers stay hidden");
  assert.equal(map.getLayer("background").paint["background-color"], "#f8f4f0");

  const { map: started } = await build("?base=imagery");
  assert.equal(started.layout("water").visibility, "none");
  assert.equal(started.layout("landcover_ice").visibility, "none");
  assert.equal(started.getLayer("background").paint["background-color"], "#3c4043");
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

/** createMap with a map that fires `events` instead of loading its style, then `style.load` if asked. */
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
        if (thenLoad) super.fire("style.load");
      });
    }

    fire(event, payload) {
      if (event !== "style.load" && event !== "load") super.fire(event, payload);
    }
  };
  return createMap(page.document.getElementById("map"), catalog, parseState(new URL(page.window.location.href)));
}

test("the map rejects when MapLibre reports an error before its style loads", async () => {
  await assert.rejects(startWith([{ error: new Error("style broke") }], { thenLoad: false }), /style broke/);
});

test("a source or tile error before the style loads does not stop the map", async () => {
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
    .filter((l) => l["source-layer"] === "centerlines" && !l.id.startsWith("selection-"))
    .map((l) => l.layout.visibility);
  assert.ok(visible.length > 0 && visible.every((v) => v === "visible"));
  assert.equal(map.layout("intersects").visibility, "none");
  rgiMap.setToggle("regions", false);
  for (const id of ["regions-outline-1", "regions-outline-2", "region-labels-1"]) {
    assert.equal(map.layout(id).visibility, "none", id);
  }
  assert.equal(map.layout("glaciers-fill").visibility, undefined);
});

test("each region label names its code above the region's name", async () => {
  const { map } = await build();
  assert.deepEqual(map.getLayer("region-labels-1").layout["text-field"], ["concat", ["get", "o1region"], "\n", ["get", "full_name"]]);
  assert.deepEqual(map.getLayer("region-labels-2").layout["text-field"], ["concat", ["get", "o2region"], "\n", ["get", "full_name"]]);
});

test("a selection draws its own centerlines again above its lift, with their toggle", async () => {
  const { rgiMap, map } = await build();
  assert.deepEqual(map.getLayer("selection-centerlines").paint, map.getLayer("centerlines").paint);
  assert.ok(map.indexOf("selection-centerlines") > map.indexOf("selection-fill"), "above the glacier's lift");
  assert.ok(map.indexOf("selection-centerlines") > map.indexOf("complex-fill"), "above the complex's lift");
  assert.ok(map.indexOf("selection-centerlines") < map.indexOf("selection-outline"), "below the red outline");
  assert.ok(map.indexOf("selection-centerlines") < map.indexOf("complex-outline"), "below the complex's red outline");
  assert.equal(map.getLayer("selection-intersects"), undefined, "the divides run along the outline, which shows");
  rgiMap.select(rgiId);
  assert.equal(map.layout("selection-centerlines").visibility, "none", "the toggle is off");
  rgiMap.setToggle("centerlines", true);
  assert.equal(map.layout("selection-centerlines").visibility, "visible");
  assert.deepEqual(map.getLayer("selection-centerlines").filter, ["in", ["get", "rgi_g_id"], ["literal", [rgiId]]]);
  rgiMap.setToggle("centerlines", false);
  assert.equal(map.layout("selection-centerlines").visibility, "none");

  const complexId = "RGI2000-v7.0-C-11-01323";
  const members = [rgiId, "RGI2000-v7.0-G-11-01451"];
  rgiMap.setToggle("centerlines", true);
  rgiMap.selectComplex(complexId);
  assert.deepEqual(map.getLayer("selection-centerlines").filter, ["in", ["get", "rgi_g_id"], ["literal", []]],
    "nothing until the complex's glaciers are known");
  rgiMap.selectComplex(complexId, members);
  assert.equal(map.layout("selection-centerlines").visibility, "visible");
  assert.deepEqual(map.getLayer("selection-centerlines").filter, ["in", ["get", "rgi_g_id"], ["literal", members]]);
  rgiMap.selectComplex(null);
  assert.equal(map.layout("selection-centerlines").visibility, "none");
});

/** The value of a linear zoom curve, or of a constant, at `zoom`. */
function atZoom(value, zoom) {
  if (!Array.isArray(value)) return value;
  const stops = value.slice(3);
  if (zoom <= stops[0]) return stops[1];
  for (let i = 2; i < stops.length; i += 2) {
    if (zoom <= stops[i]) {
      const [z0, v0, z1, v1] = stops.slice(i - 2, i + 2);
      return v0 + ((v1 - v0) * (zoom - z0)) / (z1 - z0);
    }
  }
  return stops.at(-1);
}

test("the selection is the same on both maps to zoom 10, wider than an outline with its casing, and from zoom 11 as wide as it over imagery", async () => {
  const { rgiMap, map } = await build("?base=imagery");
  const width = (id, key = "line-width") => map.getLayer(id).paint[key];
  const zooms = Array.from({ length: 65 }, (_, i) => i / 4);
  const imagery = width("selection-outline");
  for (const zoom of zooms) {
    const cased = atZoom(width("glaciers-outline"), zoom) + 2 * atZoom(width("glaciers-casing"), zoom);
    const selected = atZoom(imagery, zoom);
    if (zoom >= 11) assert.ok(Math.abs(selected - cased) < 1e-9, `zoom ${zoom}: ${selected} against ${cased}`);
    else assert.ok(selected >= cased, `no casing shows beside it at zoom ${zoom}: ${selected} against ${cased}`);
  }
  rgiMap.setBase("standard");
  const standard = width("selection-outline");
  for (const zoom of zooms) {
    if (zoom <= 10) assert.equal(atZoom(standard, zoom), atZoom(imagery, zoom), `the same at zoom ${zoom}`);
    else assert.ok(atZoom(standard, zoom) < atZoom(imagery, zoom), `narrower at zoom ${zoom}`);
    assert.ok(atZoom(standard, zoom) > atZoom(width("glaciers-outline"), zoom), `covers the outline at zoom ${zoom}`);
  }
  for (const id of ["selection-under", "complex-under", "complex-outline"]) assert.deepEqual(width(id), standard, id);
  rgiMap.setBase("imagery");
  for (const id of ["selection-under", "selection-outline", "complex-under", "complex-outline"]) assert.deepEqual(width(id), imagery, id);
});

test("selection draws a red dashed outline filtered to the ID", async () => {
  const { rgiMap, map } = await build();
  assert.equal(map.layout("selection-outline").visibility, "none");
  rgiMap.select(rgiId);
  const outline = map.getLayer("selection-outline");
  assert.deepEqual(outline.filter, ["==", ["get", "rgi_id"], rgiId]);
  assert.equal(outline["source-layer"], "glaciers");
  assert.equal(outline.paint["line-color"], "#cc3311");
  assert.deepEqual(outline.paint["line-dasharray"], [1, 0.8], "short dashes");
  const under = map.getLayer("selection-under");
  assert.deepEqual(under.filter, outline.filter, "a white line fills the gaps between the dashes");
  assert.equal(under.paint["line-color"], "#ffffff");
  assert.deepEqual(under.paint["line-width"], outline.paint["line-width"]);
  assert.equal(map.indexOf("selection-under"), map.indexOf("selection-outline") - 1);
  assert.deepEqual(map.getLayer("selection-fill").filter, ["==", ["get", "rgi_id"], rgiId]);
  assert.deepEqual(map.getLayer("selection-fill").paint, map.getLayer("glaciers-fill").paint);
  assert.equal(map.getLayer("selection-dim").paint["fill-opacity"], 0.15);
  for (const id of ["selection-dim", "selection-fill", "selection-under", "selection-outline", "selection-dot"]) {
    assert.equal(map.layout(id).visibility, "visible", id);
  }
  assert.ok(map.indexOf("selection-outline") > map.indexOf("glacier-labels"));
  rgiMap.select(null);
  assert.equal(map.layout("selection-under").visibility, "none");
});

test("the selected glacier's name is red and drawn above the selection", async () => {
  const { rgiMap, map } = await build();
  const label = map.getLayer("selection-label");
  assert.equal(label.type, "symbol");
  assert.equal(label["source-layer"], "glacier-labels");
  assert.equal(label.paint["text-color"], "#cc3311");
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
  assert.equal(dot.paint["circle-color"], "#cc3311");
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

test("select(null) hides the selection and clears the pin", async () => {
  const { rgiMap, map } = await build();
  rgiMap.select(rgiId);
  rgiMap.pin([10, 20]);
  assert.deepEqual(map.getSource("pin").data.geometry.coordinates, [10, 20]);
  assert.equal(map.getLayer("terminus-pin").paint["circle-color"], "#cc3311");

  rgiMap.select(null);
  for (const id of ["selection-dim", "selection-fill", "selection-outline", "selection-dot"]) {
    assert.equal(map.layout(id).visibility, "none", id);
  }
  assert.deepEqual(map.getSource("pin").data.features, []);
});

/*
 * The fake's canvas is 1024 x 768 px and puts [lng, lat] at x = lng, y = lat;
 * its unproject turns a screen point back into the same place.
 */
test("inView: a point on the canvas is in view, one off it or under the padding is not", async () => {
  const { rgiMap } = await build();
  assert.equal(rgiMap.inView([500, 300]), true);
  assert.equal(rgiMap.inView([0, 0]), true, "the canvas edge counts as in view");
  assert.equal(rgiMap.inView([1100, 300]), false);
  assert.equal(rgiMap.inView([500, -5]), false);
  assert.equal(rgiMap.inView([500, 800]), false);

  const card = { top: 24, right: 24, bottom: 24, left: 432 };
  assert.equal(rgiMap.inView([400, 300], card), false, "under the card");
  assert.equal(rgiMap.inView([500, 300], card), true);
  assert.equal(rgiMap.inView([1010, 300], card), false, "in the right margin");
  assert.equal(rgiMap.inView([500, 750], card), false, "in the bottom margin");
  assert.equal(rgiMap.inView([500, 10], 24), false, "a number pads every side");
  assert.equal(rgiMap.inView([500, 30], 24), true);
});

test("inView: a point on the far side of the globe is not in view", async () => {
  const { rgiMap, map } = await build();
  /* MapLibre projects a far-side point onto the near side's disc; unproject finds the near-side place there. */
  map.unproject = ([x, y]) => ({ lng: x - 180, lat: -y });
  assert.equal(rgiMap.inView([500, 30]), false);
  /* A place a pixel off, as the terrain's depth may give back, still counts. */
  const px = 360 / (512 * 2 ** map.getZoom());
  map.unproject = ([x, y]) => ({ lng: x + px, lat: y });
  assert.equal(rgiMap.inView([500, 30]), true);
  map.unproject = ([x, y]) => ({ lng: x + 360, lat: y });
  assert.equal(rgiMap.inView([500, 30]), true, "a whole turn of longitude is the same place");
});

/* The canvas less the desktop card, as the page pads it. */
const CARD = { top: 24, right: 24, bottom: 24, left: 432 };
/*
 * The bbox tests stage a screen of 8 px per degree, with latitude -50° at the
 * top, so their bboxes are given in screen pixels and stay off the poles.
 */
const SCREEN = { origin: [0, -50], scale: 8 };
const box = (x0, y0, x1, y1) => ({ xmin: x0 / 8, ymin: y0 / 8 - 50, xmax: x1 / 8, ymax: y1 / 8 - 50 });
const placeAt = ([x, y]) => ({ lng: x / 8, lat: y / 8 - 50 });
async function staged() {
  const built = await build();
  built.map.screen = SCREEN;
  built.map.jumpTo({ center: [64, 0], zoom: 2 });
  return built;
}

test("bboxVisibility: the share of a bbox in view, its size on screen and whether it fits", async () => {
  const { rgiMap } = await staged();
  assert.deepEqual(rgiMap.bboxVisibility(box(500, 300, 600, 350), CARD), { fraction: 1, sizePx: 100, fits: true });
  assert.deepEqual(rgiMap.bboxVisibility(box(382, 300, 482, 340), CARD), { fraction: 0.5, sizePx: 100, fits: true }, "half under the card");
  assert.deepEqual(rgiMap.bboxVisibility(box(1100, 300, 1200, 400)), { fraction: 0, sizePx: 100, fits: true }, "off the canvas");
  assert.deepEqual(rgiMap.bboxVisibility(box(400, 300, 1100, 310), CARD), { fraction: 568 / 700, sizePx: 700, fits: false }, "wider than the room");
  assert.deepEqual(rgiMap.bboxVisibility(box(500, 24, 510, 744), CARD), { fraction: 1, sizePx: 720, fits: true }, "as tall as the room");
  assert.deepEqual(rgiMap.bboxVisibility(box(500, 300, 500, 300)), { fraction: 1, sizePx: 0, fits: true }, "a point in view");
  assert.deepEqual(rgiMap.bboxVisibility(box(500, 0, 600, 50), 24), { fraction: 0.52, sizePx: 100, fits: true }, "a number pads every side");
});

test("bboxVisibility: a bbox across the antimeridian runs on past 180°, and one a turn away comes round", async () => {
  const { rgiMap, map } = await staged();
  map.screen = { origin: [100, -50], scale: 8 };
  map.jumpTo({ center: [180, 0], zoom: 2 });
  /* 170° E to 170° W: 560 to 720 px. */
  const across = { xmin: 170, ymin: -10, xmax: -170, ymax: -5 };
  assert.deepEqual(rgiMap.bboxVisibility(across), { fraction: 1, sizePx: 160, fits: true });
  map.jumpTo({ center: [-175, 0], zoom: 2 });
  map.screen = { origin: [-260, -50], scale: 8 };
  assert.deepEqual(rgiMap.bboxVisibility(across), { fraction: 1, sizePx: 160, fits: true }, "the copy next to the view's centre");
});

test("bboxVisibility: a bbox 360° wide or with a part on the far side of the globe shows nowhere", async () => {
  const { rgiMap, map } = await staged();
  assert.equal(rgiMap.bboxVisibility({ xmin: -180, ymin: 10, xmax: 180, ymax: 40 }), null);
  /* Only the bbox's west edge comes back as another place: it is over the horizon. */
  map.unproject = ([x, y]) => (x < 505 ? { lng: x / 8 - 180, lat: y / 8 - 50 } : placeAt([x, y]));
  assert.equal(rgiMap.bboxVisibility(box(500, 300, 600, 350)), null);
  map.unproject = placeAt;
  assert.deepEqual(rgiMap.bboxVisibility(box(500, 300, 600, 350)).fraction, 1);
  map.project = () => ({ x: Number.NaN, y: Number.NaN });
  assert.equal(rgiMap.bboxVisibility(box(500, 300, 600, 350)), null, "a place MapLibre cannot draw");
});

test("needsFit: a bbox needs a fit unless 80% of it shows, 24 px across or more, and it fits", async () => {
  const { rgiMap, map } = await staged();
  assert.equal(rgiMap.needsFit(box(500, 300, 600, 350), CARD), false, "well in view");
  assert.equal(rgiMap.needsFit(box(412, 300, 512, 350), CARD), false, "80% in view");
  assert.equal(rgiMap.needsFit(box(411, 300, 511, 350), CARD), true, "79% in view");
  assert.equal(rgiMap.needsFit(box(382, 300, 482, 340), CARD), true, "half under the card");
  assert.equal(rgiMap.needsFit(box(500, 300, 524, 310), CARD), false, "24 px across");
  assert.equal(rgiMap.needsFit(box(500, 300, 523, 310), CARD), true, "too small to make out");
  assert.equal(rgiMap.needsFit(box(440, 24, 1000, 744), CARD), false, "as large as the room");
  assert.equal(rgiMap.needsFit(box(440, 24, 1000, 745), CARD), true, "larger than the room");
  assert.equal(rgiMap.needsFit({ xmin: -180, ymin: 10, xmax: 180, ymax: 40 }, CARD), true, "the whole world");
  map.unproject = ([x, y]) => ({ lng: x / 8 - 180, lat: 50 - y / 8 });
  assert.equal(rgiMap.needsFit(box(500, 300, 600, 350), CARD), true, "on the far side");
});

test("centerOn eases the point to the middle of the canvas less the padding, and keeps the camera", async () => {
  const { rgiMap, map } = await build();
  const zoom = map.getZoom();
  map.calls.length = 0;
  rgiMap.centerOn([8.02, 46.4], { top: 24, right: 24, bottom: 24, left: 432 });
  assert.deepEqual(map.calls, ['easeTo {"center":[8.02,46.4],"offset":[204,0]}']);
  assert.equal(map.getZoom(), zoom);
  map.calls.length = 0;
  rgiMap.centerOn([8.02, 46.4], { top: 72, right: 24, bottom: 324, left: 24 });
  assert.deepEqual(map.calls, ['easeTo {"center":[8.02,46.4],"offset":[0,-126]}'], "above a phone's sheet");
  map.calls.length = 0;
  rgiMap.centerOn([8.02, 46.4]);
  assert.deepEqual(map.calls, ['easeTo {"center":[8.02,46.4],"offset":[0,0]}']);
});

test("a complex is selected like a glacier: dimmed map, lifted complex, red outline, member outlines kept", async () => {
  const { rgiMap, map } = await build();
  const id = "RGI2000-v7.0-C-11-01323";
  rgiMap.select(rgiId);
  rgiMap.selectComplex(id);
  for (const layer of ["selection-dim", "complex-fill", "complex-members", "complex-outline", "complex-dot"]) {
    assert.equal(map.layout(layer).visibility, "visible", layer);
  }
  for (const layer of ["selection-fill", "selection-outline", "selection-dot", "selection-label"]) {
    assert.equal(map.layout(layer).visibility, "none", layer);
  }
  assert.deepEqual(map.getLayer("complex-fill").filter, ["==", ["get", "rgi_id"], id]);
  assert.deepEqual(map.getLayer("complex-outline").filter, ["==", ["get", "rgi_id"], id]);
  assert.deepEqual(map.getLayer("complex-members").filter, ["==", ["get", "complex_id"], id]);
  assert.equal(map.getLayer("complex-outline")["source-layer"], "complexes");
  assert.equal(map.getLayer("complex-members")["source-layer"], "glaciers");
  assert.deepEqual(map.getLayer("complex-outline").paint, map.getLayer("selection-outline").paint);
  assert.deepEqual(map.getLayer("complex-under").paint, map.getLayer("selection-under").paint);
  assert.deepEqual(map.getLayer("complex-under").filter, ["==", ["get", "rgi_id"], id]);
  assert.equal(map.indexOf("complex-under"), map.indexOf("complex-outline") - 1);
  assert.equal(map.layout("complex-under").visibility, "visible");
  assert.equal(map.getLayer("complex-outline").paint["line-color"], "#cc3311");
  assert.equal(map.getLayer("complex-members").paint["line-color"], "#80868b");
  assert.ok(map.indexOf("complex-fill") > map.indexOf("selection-dim"));
  assert.ok(map.indexOf("complex-members") > map.indexOf("complex-fill"));
  assert.ok(map.indexOf("complex-outline") > map.indexOf("complex-members"));
  assert.equal(map.layout("complex-labels").visibility, "visible", "glacier names show above the lifted complex");
  assert.deepEqual(map.getLayer("complex-labels").layout["text-field"], map.getLayer("glacier-labels").layout["text-field"]);
  assert.ok(map.indexOf("complex-labels") > map.indexOf("complex-members"));
  assert.equal(map.getLayer("selection-complex"), undefined);

  rgiMap.setBase("imagery");
  assert.equal(map.getLayer("complex-fill").paint["fill-opacity"], 0);
  assert.equal(map.getLayer("complex-members").paint["line-color"], "#ffffff");
  assert.deepEqual(map.getLayer("complex-members").paint, map.getLayer("glaciers-outline").paint, "and as wide");

  rgiMap.select(rgiId);
  assert.equal(map.layout("complex-outline").visibility, "none", "a glacier replaces the complex");
  assert.equal(map.layout("selection-outline").visibility, "visible");
  rgiMap.selectComplex(id);
  rgiMap.selectComplex(null);
  for (const layer of ["selection-dim", "complex-fill", "complex-members", "complex-labels", "complex-outline", "complex-dot"]) {
    assert.equal(map.layout(layer).visibility, "none", layer);
  }
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

test("setTerrain without a move switches the terrain and leaves the camera", async () => {
  const { rgiMap, map } = await build();
  map.gesture({ pitch: 30, bearing: 40 });
  rgiMap.setTerrain(true, { move: false });
  assert.equal(map.getTerrain().source, "terrain");
  rgiMap.setTerrain(false, { move: false });
  assert.equal(map.getTerrain(), null);
  assert.equal(map.calls.filter((c) => c.startsWith("easeTo")).length, 0);
  assert.equal(map.getPitch(), 30);
  assert.equal(map.getBearing(), 40);
});

test("rotateBy turns from the current bearing, faceNorth resets, level flattens", async () => {
  const { rgiMap, map } = await build();
  rgiMap.rotateBy(22.5);
  rgiMap.rotateBy(22.5);
  assert.equal(map.calls.at(-1), 'easeTo {"bearing":45}');
  map.gesture({ pitch: 30 });
  rgiMap.level();
  assert.equal(map.calls.at(-1), 'easeTo {"pitch":0}');
  assert.equal(map.getBearing(), 45);
  rgiMap.faceNorth();
  assert.equal(map.calls.at(-1), 'easeTo {"bearing":0,"pitch":0}');
});

test("onCamera follows every move; onTilt hears only the reader's tilts", async () => {
  const { rgiMap, map } = await build();
  const camera = [];
  const tilts = [];
  rgiMap.onCamera((view) => camera.push(view));
  rgiMap.onTilt((pitch) => tilts.push(pitch));
  rgiMap.setTerrain(true);
  rgiMap.rotateBy(22.5);
  map.gesture({ pitch: 3 });
  assert.deepEqual(camera.at(-1), { bearing: 22.5, pitch: 3 });
  await settle();
  assert.deepEqual(tilts, [3], "the 60° ease of setTerrain is the page's own and does not count");
});

test("onTilt waits for the camera to come to rest and reports where it ends", async () => {
  const { rgiMap, map } = await build();
  const tilts = [];
  rgiMap.onTilt((pitch) => tilts.push(pitch));
  map.moving = true;
  map.gesture({ pitch: 30 });
  map.gesture({ pitch: 3 }, { snapNorth: false });
  await settle();
  assert.deepEqual(tilts, [], "still gliding");
  map.moving = false;
  map.fire("moveend");
  await settle();
  assert.deepEqual(tilts, [3], "a touch's second pitchend replaces the first");
});

test("arrow clicks during a turn add up to whole steps", async () => {
  const { rgiMap, map } = await build();
  map.moving = true;
  rgiMap.rotateBy(45);
  map.bearing = 10;
  rgiMap.rotateBy(45);
  assert.equal(map.calls.at(-1), 'easeTo {"bearing":90}', "from the first click's target, not from mid-turn");
  map.moving = false;
  map.fire("moveend");
  map.bearing = 100;
  rgiMap.rotateBy(45);
  assert.equal(map.calls.at(-1), 'easeTo {"bearing":145}', "a finished turn starts again from where the map faces");
});

test("MapLibre adds no attribution control of its own", async () => {
  const { map } = await build();
  assert.equal(map.options.attributionControl, false);
});

test("past the archive's deepest zoom the tiles are stretched, not cut", async () => {
  const { map } = await build();
  assert.ok("zoomLevelsToOverscale" in map.options, "MapLibre's default cuts the deepest tile");
  assert.equal(map.options.zoomLevelsToOverscale, undefined);
});

test("the centre stops at the Mercator edge, from a link and from the camera", async () => {
  const { map } = await build("#2/90/10");
  assert.deepEqual(map.options.center, [10, 85.05]);
  const update = map.options.transformCameraUpdate;
  const { center } = update({ center: { lng: 20, lat: -89.5 } });
  assert.deepEqual([center.lng, center.lat], [20, -85.05]);
  assert.deepEqual(update({ center: { lng: 20, lat: 60 } }), {}, "a centre inside the edge moves freely");
});

test("North Asia and Antarctic Mainland fit without throwing", async () => {
  const { rgiMap, map } = await build();
  rgiMap.fitBbox({ xmin: -180, ymin: -90, xmax: 180, ymax: -63.2 }, 0);
  assert.ok(map.lastFit.bounds[0][1] >= -85.05);
  rgiMap.fitBbox({ xmin: 10, ymin: 20, xmax: 30, ymax: 95 }, 8);
  assert.equal(map.lastFit.bounds[1][1], 85.05);
  assert.equal(map.lastFit.options.padding, 8);
});

test("fitting a glacier, complex or region keeps the reader's bearing", async () => {
  const { rgiMap, map } = await build();
  map.gesture({ bearing: 40 });
  rgiMap.fitBbox({ xmin: 7.9, ymin: 46.4, xmax: 8.1, ymax: 46.6 }, 8, { maxZoom: 15 });
  assert.equal(map.lastFit.options.bearing, 40, "MapLibre's fitBounds faces north unless told otherwise");
  assert.equal(map.lastFit.options.maxZoom, 15);
});

test("a fit that would fly longer than two seconds jumps instead", async () => {
  const { rgiMap, map } = await build();
  rgiMap.fitBbox({ xmin: 7.9, ymin: 46.4, xmax: 8.1, ymax: 46.6 }, 8);
  assert.equal(map.lastFit.options.maxDuration, 2000, "MapLibre's flight resets a longer duration to 0");
});

/** A promise and the function that resolves it. */
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

test("fitLater moves once its read returns, and a failed read moves nothing", async () => {
  const { rgiMap } = await build();
  const ran = [];
  await rgiMap.fitLater(Promise.resolve("bbox"), (value) => ran.push(value));
  assert.deepEqual(ran, ["bbox"]);
  await rgiMap.fitLater(Promise.reject(new Error("read failed")), (value) => ran.push(value));
  assert.deepEqual(ran, ["bbox"]);
});

test("every camera request of the map drops a pending fitLater", async () => {
  const { rgiMap, map } = await build();
  const bbox = { xmin: 7.9, ymin: 46.4, xmax: 8.1, ymax: 46.6 };
  const requests = {
    fitBbox: () => rgiMap.fitBbox(bbox, 8),
    centerOn: () => rgiMap.centerOn([8, 46.5], 8),
    jumpTo: () => rgiMap.jumpTo({ center: [8, 46.5], zoom: 12 }),
    zoomIn: () => rgiMap.zoomIn(),
    zoomOut: () => rgiMap.zoomOut(),
    rotateBy: () => rgiMap.rotateBy(45),
    faceNorth: () => rgiMap.faceNorth(),
    level: () => rgiMap.level(),
    setTerrain: () => rgiMap.setTerrain(true),
    fitLater: () => rgiMap.fitLater(new Promise(() => {}), () => {}),
    "a reader's move": () => map.fire("movestart", { originalEvent: { type: "mousedown" } }),
  };
  for (const [name, request] of Object.entries(requests)) {
    const read = deferred();
    let ran = false;
    const later = rgiMap.fitLater(read.promise, () => {
      ran = true;
    });
    request();
    read.resolve();
    await later;
    assert.equal(ran, false, `${name} wins over the late fit`);
  }
});

test("the page's own moves and a terrain switch without a move keep a pending fitLater", async () => {
  const { rgiMap, map } = await build();
  const read = deferred();
  let ran = false;
  const later = rgiMap.fitLater(read.promise, () => {
    ran = true;
  });
  map.fire("movestart", {});
  rgiMap.setTerrain(true, { move: false });
  read.resolve();
  await later;
  assert.equal(ran, true);
});

test("jumpTo, zoomIn and zoomOut move the map", async () => {
  const { rgiMap, map } = await build();
  rgiMap.jumpTo({ center: [8, 46.5], zoom: 12 });
  rgiMap.zoomIn();
  rgiMap.zoomOut();
  rgiMap.zoomOut();
  assert.deepEqual(map.calls.slice(-4), ["jumpTo 8,46.5 z12", "zoomIn", "zoomOut", "zoomOut"]);
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

test("the standard picture draws Liberty without its labels on one hidden map, at the main map's view", async () => {
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
  assert.deepEqual(
    mini.options.style.layers.map((layer) => layer.id),
    ["background", "landcover_ice", "water", "road_major", "boundary"],
    "no labels, icons or arrows",
  );
  assert.equal(mini.options.style.glyphs, undefined);

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

test("a glacier is RGI's point below the zoom at which its bbox spans 3 pixels of a 512-pixel tile, as in the catalog", async () => {
  await loadPage();
  const { shapeMinzoom } = await load("js/map.js");
  /* At zoom 9 a pixel is 40,075,017 m / (512 * 2^9), 152.9 m, at the equator. */
  const degrees = (metres) => (metres * 180) / (Math.PI * 6378137);
  const wide = (metres) => ({ xmin: 0, ymin: 0, xmax: degrees(metres), ymax: 0 });
  assert.equal(shapeMinzoom(wide(3 * 152.88)), 9);
  assert.equal(shapeMinzoom(wide(3 * 152.86)), 10, "a little short: an outline only once every glacier is");
  assert.equal(shapeMinzoom(wide(3 * 2 * 152.88)), 8);
  assert.equal(shapeMinzoom({ xmin: 7.7, ymin: 46.44, xmax: 7.7, ymax: 46.44 }), 10);
  assert.equal(shapeMinzoom({ xmin: -50, ymin: 60, xmax: -20, ymax: 83 }), 0, "Greenland's ice sheet from the start");
  /* Mercator stretches north-south: a bbox of the same degrees spans more metres further north. */
  const tall = (lat) => shapeMinzoom({ xmin: 0, ymin: lat, xmax: 0, ymax: lat + 0.01 });
  assert.ok(tall(70) < tall(0));
});

test("the selection draws its own dot at RGI's point below its outline's zoom, which another selection clears", async () => {
  const { rgiMap, map } = await build();
  const layer = map.getLayer("selection-point");
  assert.equal(layer.source, "selection-point");
  assert.deepEqual(layer.filter, ["<", ["zoom"], ["get", "outline_zoom"]]);
  assert.deepEqual(layer.paint, map.getLayer("selection-dot").paint);
  assert.ok(map.indexOf("selection-point") > map.indexOf("complex-dot"));
  const data = () => map.getSource("selection-point").data;
  const row = { cenlon: 7.7674, cenlat: 46.441, bbox: { xmin: 7.766, ymin: 46.4402, xmax: 7.769, ymax: 46.4418 } };

  rgiMap.select(rgiId);
  rgiMap.selectPoint(rgiId, row);
  assert.deepEqual(data().geometry.coordinates, [7.7674, 46.441]);
  assert.equal(data().properties.outline_zoom, 10, "a small glacier is a point until every glacier is an outline");
  rgiMap.select(rgiId);
  assert.ok(data().geometry, "selecting the same glacier keeps it");
  rgiMap.select("RGI2000-v7.0-G-11-00002");
  assert.deepEqual(data().features, [], "another glacier clears it");

  rgiMap.selectComplex("RGI2000-v7.0-C-11-00001");
  rgiMap.selectPoint("RGI2000-v7.0-C-11-00001", { ...row, bbox: { xmin: 5, ymin: 45, xmax: 10, ymax: 48 } });
  assert.equal(data().properties.outline_zoom, 0);
  rgiMap.selectComplex("RGI2000-v7.0-C-11-00001", ["RGI2000-v7.0-G-11-00001"]);
  assert.ok(data().geometry, "the complex's members arriving keep it");
  rgiMap.selectComplex(null);
  assert.deepEqual(data().features, []);

  rgiMap.selectPoint(rgiId, { cenlon: 7.7, cenlat: 46.4 });
  assert.deepEqual(data().features, [], "no bbox, no dot");
});
