/* The page's own RGI style: its source, its layers and the toggles over them. */

import assert from "node:assert/strict";
import test from "node:test";

import { PREVIEWS, GLACIERS } from "../js/previews.js";
import { rgiStyle, TOGGLES } from "../js/styles.js";

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

test("rgiStyle draws regions as outlines without a fill", () => {
  const regions = rgiStyle(PMTILES).layers.filter((l) => l["source-layer"] === "regions");
  assert.ok(regions.length > 0);
  assert.ok(regions.every((l) => l.type === "line"));
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
