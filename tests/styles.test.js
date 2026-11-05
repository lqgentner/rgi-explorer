/* The page's own RGI style: its source, its layers and the toggles over them. */

import assert from "node:assert/strict";
import test from "node:test";

import { PREVIEWS, GLACIERS } from "../js/previews.js";
import { BASE_PAINT, OUTLINE_WIDTH, PALETTE, rgiStyle, TOGGLES } from "../js/styles.js";

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

test("rgiStyle draws each casing outside its line, below every line", () => {
  const { layers } = rgiStyle(PMTILES);
  const index = (id) => layers.findIndex((l) => l.id === id);
  for (const [casing, line] of [
    ["glaciers-casing", "glaciers-outline"],
    ["intersects-casing", "intersects"],
  ]) {
    for (const paint of Object.values(BASE_PAINT)) {
      assert.deepEqual(paint[casing]["line-gap-width"], paint[line]["line-width"], "the gap is as wide as the line");
    }
    const paint = layers[index(casing)].paint;
    assert.deepEqual(paint["line-gap-width"], layers[index(line)].paint["line-width"]);
    assert.equal(paint["line-color"], layers[index("glaciers-casing")].paint["line-color"], "the casings match");
    assert.deepEqual(paint["line-width"], layers[index("glaciers-casing")].paint["line-width"]);
    assert.equal(layers[index(casing)]["source-layer"], layers[index(line)]["source-layer"]);
    assert.ok(index(casing) < index("glaciers-outline"), casing);
  }
  assert.ok(!layers.some((l) => l["source-layer"] === "centerlines" && l.id !== "centerlines"), "centerlines need no casing");
});

test("the divides are as wide as the glacier outlines, which are wider on the standard map", () => {
  const { layers } = rgiStyle(PMTILES);
  const paint = (id) => layers.find((l) => l.id === id).paint;
  assert.deepEqual(paint("glaciers-outline")["line-width"], OUTLINE_WIDTH.standard, "the style starts on the standard map");
  assert.deepEqual(paint("intersects")["line-width"], OUTLINE_WIDTH.standard);
  for (const [base, width] of Object.entries(OUTLINE_WIDTH)) {
    assert.deepEqual(BASE_PAINT[base]["glaciers-outline"]["line-width"], width, base);
    assert.deepEqual(BASE_PAINT[base].intersects["line-width"], width, base);
  }
  const stops = (width) => width.slice(3).filter((_, i) => i % 2 === 1);
  stops(OUTLINE_WIDTH.standard).forEach((w, i) => assert.ok(w > stops(OUTLINE_WIDTH.imagery)[i]));
});

test("the casing thins at low zoom, and the centerlines are a lighter gold over imagery", () => {
  const { layers } = rgiStyle(PMTILES);
  const paint = (id) => layers.find((l) => l.id === id).paint;
  assert.deepEqual(paint("glaciers-casing")["line-width"], ["interpolate", ["linear"], ["zoom"], 8, 0.4, 11, 1]);
  assert.equal(paint("glaciers-casing")["line-color"], PALETTE.casing);
  assert.equal(paint("centerlines")["line-color"], PALETTE.centerline);
  assert.equal(BASE_PAINT.imagery.centerlines["line-color"], PALETTE.centerlineOnImagery);
  assert.notEqual(PALETTE.centerline, PALETTE.centerlineOnImagery);
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

test("the RGI labels take the halo of Liberty's place labels: 1 px, blurred 1 px", () => {
  const labels = rgiStyle("https://example.org/rgi.pmtiles").layers.filter((layer) => layer.type === "symbol");
  assert.ok(labels.length >= 3);
  for (const layer of labels) {
    assert.equal(layer.paint["text-halo-width"], 1, layer.id);
    assert.equal(layer.paint["text-halo-blur"], 1, layer.id);
  }
});
