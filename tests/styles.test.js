/* adaptStyle and mergeStyles change only plumbing of the catalog's styles. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { adaptStyle, mergeStyles } from "../js/styles.js";

const BASE = "https://data.source.coop/lqgentner/rgi/v7.0/";
const styleUrl = (name) => `${BASE}${name}/styles/${name}.json`;
const fixtureStyle = (name) =>
  JSON.parse(readFileSync(new URL(`./fixtures/catalog/v7.0/${name}/styles/${name}.json`, import.meta.url), "utf8"));

function stripFonts(layers) {
  return layers.map((layer) => {
    const copy = structuredClone(layer);
    if (copy.layout?.["text-font"]) delete copy.layout["text-font"];
    return copy;
  });
}

test("adaptStyle rewrites only the source URL and the fonts", () => {
  const out = adaptStyle(fixtureStyle("glaciers"), styleUrl("glaciers"));
  assert.equal(out.sources.data.url, "pmtiles://https://data.source.coop/lqgentner/rgi/v7.0/rgi7.0.pmtiles");
  assert.ok(out.layers.every((l) => !JSON.stringify(l.layout ?? {}).includes("Open Sans")));
  assert.ok(out.layers.some((l) => l.layout?.["text-font"]?.includes("Noto Sans Bold")));
  assert.deepEqual(stripFonts(out.layers), stripFonts(fixtureStyle("glaciers").layers));
});

test("adaptStyle resolves the relative PMTiles URL against the style URL", () => {
  const style = fixtureStyle("regions");
  assert.equal(style.sources.data.url, "pmtiles://../../rgi7.0.pmtiles");
  const local = adaptStyle(style, "http://localhost:8000/catalog/v7.0/regions/styles/regions.json");
  assert.equal(local.sources.data.url, "pmtiles://http://localhost:8000/catalog/v7.0/rgi7.0.pmtiles");
});

test("adaptStyle leaves its input untouched", () => {
  const style = fixtureStyle("glaciers");
  const before = JSON.stringify(style);
  adaptStyle(style, styleUrl("glaciers"));
  assert.equal(JSON.stringify(style), before);
});

test("mergeStyles drops repeated layer ids and sources", () => {
  const regions = adaptStyle(fixtureStyle("regions"), styleUrl("regions"));
  const glaciers = adaptStyle(fixtureStyle("glaciers"), styleUrl("glaciers"));
  const merged = mergeStyles([regions, glaciers]);
  const ids = merged.layers.map((l) => l.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.indexOf("regions-fill") < ids.indexOf("glaciers-fill"));
  assert.equal(ids.filter((id) => id === "regions-outline-1").length, 1);
  assert.deepEqual(Object.keys(merged.sources), ["data"]);
});
