/* The page's own RGI style: its source, its layers and the toggles over them. */

import assert from "node:assert/strict";
import test from "node:test";

import { PREVIEWS, GLACIERS } from "../js/previews.js";
import { BASE_PAINT, CENTERLINE_WIDTH, DIVIDE_WIDTH, ICE, OUTLINE_WIDTH, PALETTE, rgiStyle, TOGGLES } from "../js/styles.js";

const PMTILES = "https://data.source.coop/lqgentner/rgi/v7.0/rgi7.0.pmtiles";

test("rgiStyle reads one PMTiles source", () => {
  const style = rgiStyle(PMTILES);
  assert.deepEqual(style.sources, { data: { type: "vector", url: `pmtiles://${PMTILES}` } });
  assert.ok(style.layers.every((layer) => layer.source === "data"));
});

test("rgiStyle gives each layer a unique id and a toggle's source layers exist", () => {
  const { layers } = rgiStyle(PMTILES);
  const ids = layers.map((l) => l.id);
  assert.equal(new Set(ids).size, ids.length);
  const sourceLayers = new Set(layers.map((l) => l["source-layer"]));
  for (const names of Object.values(TOGGLES)) for (const name of names) assert.ok(sourceLayers.has(name), name);
});

test("rgiStyle draws regions as dashed outlines from the boundary lines, without a fill", () => {
  const layers = rgiStyle(PMTILES).layers;
  assert.equal(layers.filter((l) => l["source-layer"] === "regions").length, 0, "the polygons hold each border twice");
  const outlines = layers.filter((l) => l["source-layer"] === "region-boundaries");
  assert.deepEqual(outlines.map((l) => l.id).sort(), ["regions-outline-1", "regions-outline-2"]);
  for (const outline of outlines) {
    assert.equal(outline.type, "line");
    assert.ok(Array.isArray(outline.paint["line-dasharray"]), outline.id);
  }
});

test("no line has a casing, and the centerlines are drawn alone", () => {
  const { layers } = rgiStyle(PMTILES);
  assert.deepEqual(layers.filter((l) => /casing/.test(l.id)).map((l) => l.id), []);
  assert.ok(!layers.some((l) => l["source-layer"] === "centerlines" && l.id !== "centerlines"));
});

test("the lines are finer on the standard map, and the divides lie on the outlines half a pixel wider close in", () => {
  const { layers } = rgiStyle(PMTILES);
  const paint = (id) => layers.find((l) => l.id === id).paint;
  assert.deepEqual(paint("glaciers-outline")["line-width"], OUTLINE_WIDTH.standard, "the style starts on the standard map");
  assert.deepEqual(paint("intersects")["line-width"], DIVIDE_WIDTH.standard);
  assert.deepEqual(paint("centerlines")["line-width"], CENTERLINE_WIDTH.standard);
  const stops = (width) => width.slice(3).filter((_, i) => i % 2 === 1);
  for (const base of ["standard", "imagery"]) {
    assert.deepEqual(BASE_PAINT[base]["glaciers-outline"]["line-width"], OUTLINE_WIDTH[base], base);
    assert.deepEqual(BASE_PAINT[base].intersects["line-width"], DIVIDE_WIDTH[base], base);
    assert.deepEqual(BASE_PAINT[base].centerlines["line-width"], CENTERLINE_WIDTH[base], base);
    stops(DIVIDE_WIDTH[base]).forEach((w, i) => assert.equal(w, stops(OUTLINE_WIDTH[base])[i] + (i === 1 ? 0.25 : 0.5), base));
  }
  stops(OUTLINE_WIDTH.standard).forEach((w, i) => assert.ok(w < stops(OUTLINE_WIDTH.imagery)[i]));
  /* A main centerline is as wide as a divide from zoom 12, on each map. */
  for (const base of ["standard", "imagery"]) assert.equal(CENTERLINE_WIDTH[base][6][2], stops(DIVIDE_WIDTH[base])[2], base);
});

test("the glaciers take the ramp's blues, one outline blue on both maps, and the other lines turn lighter over imagery", () => {
  const { layers } = rgiStyle(PMTILES);
  const paint = (id) => layers.find((l) => l.id === id).paint;
  assert.equal(paint("glaciers-fill")["fill-color"], ICE[50]);
  assert.equal(paint("glaciers-outline")["line-color"], ICE[500]);
  assert.equal(BASE_PAINT.imagery["glaciers-outline"]["line-color"], ICE[500]);
  assert.equal(paint("intersects")["line-color"], PALETTE.divide);
  assert.equal(BASE_PAINT.imagery.intersects["line-color"], PALETTE.divideOnImagery);
  assert.equal(paint("centerlines")["line-color"], PALETTE.centerline);
  assert.equal(BASE_PAINT.imagery.centerlines["line-color"], PALETTE.centerlineOnImagery);
  for (const id of ["glaciers-outline", "intersects", "centerlines", "regions-outline-1", "regions-outline-2"]) {
    assert.equal(paint(id)["line-color"], BASE_PAINT.standard[id]["line-color"], `${id} starts on the standard map`);
  }
  for (const id of ["intersects", "centerlines", "regions-outline-1", "regions-outline-2"]) {
    assert.notEqual(BASE_PAINT.standard[id]["line-color"], BASE_PAINT.imagery[id]["line-color"], id);
  }
});

test("rgiStyle uses only fonts the glyph server holds", () => {
  const fonts = rgiStyle(PMTILES).layers.flatMap((l) => l.layout?.["text-font"] ?? []);
  assert.ok(fonts.length > 0);
  assert.ok(fonts.every((font) => /^Noto Sans (Regular|Bold|Italic)$/.test(font)), fonts.join());
});

test("the layer previews hold a path for every part they draw", () => {
  const path = /^(M[-\d. L]+Z?)+$/;
  assert.match(GLACIERS, path);
  for (const [name, parts] of Object.entries(PREVIEWS)) {
    assert.ok(name in TOGGLES, name);
    for (const [part, d] of Object.entries(parts)) assert.match(d, path, `${name} ${part}`);
  }
});

test("the region labels take the soft halo of Liberty's place labels, the glacier names that of its lakes", () => {
  const labels = rgiStyle("https://example.org/rgi.pmtiles").layers.filter((layer) => layer.type === "symbol");
  assert.ok(labels.length >= 3);
  for (const layer of labels) {
    const glacier = layer.id === "glacier-labels";
    assert.equal(layer.paint["text-halo-width"], glacier ? 1.5 : 1, layer.id);
    assert.equal(layer.paint["text-halo-blur"], glacier ? 0 : 1, layer.id);
    assert.equal(layer.paint["text-halo-color"], glacier ? "rgba(255,255,255,0.7)" : PALETTE.halo, layer.id);
  }
});

test("a glacier's name shows only along its centerline, never at its point", () => {
  const { layers } = rgiStyle(PMTILES);
  const names = layers.filter((l) => l["source-layer"] === "glacier-labels");
  assert.deepEqual(names.map((l) => l.id), ["glacier-labels"]);
  const [name] = names;
  assert.deepEqual(name.filter, ["all", ["==", ["geometry-type"], "LineString"], ["==", ["get", "label_zoom"], ["min", ["zoom"], 14]]]);
  assert.equal(name.layout["symbol-placement"], "line-center");
  assert.deepEqual(name.layout["text-font"], ["Noto Sans Italic"]);
  assert.equal(name.layout["text-size"], 14, "as Liberty's lake and river names");
  assert.equal(name.layout["text-letter-spacing"], 0.2);
});
