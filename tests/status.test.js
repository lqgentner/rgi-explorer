import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { FakeMap, loadPage, load } from "./helpers/browser.js";

const { document } = await loadPage();
const { coverageTiles, credits, metersPerPixel, mountStatus, scaleBar, terrainProducers } = await load("js/status.js");

/* Mapterhorn's coverage index: each tile asked for is recorded, and `answer` gives its sources. */
const asked = [];
let answer = () => ({});
globalThis.pmtiles.PMTiles = class {
  constructor(url) {
    this.url = url;
  }
  async getZxy(z, x, y) {
    asked.push({ url: this.url, z, x, y });
    const sources = await answer({ z, x, y });
    return sources && { data: new TextEncoder().encode(JSON.stringify(sources)) };
  }
};
const source = (producer, resolution, website = `https://${producer.toLowerCase()}.example/`) => ({
  producer_short: producer,
  resolution,
  website,
});
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const catalog = {
  citation: "RGI 7.0 Consortium (2023). Randolph Glacier Inventory.",
  doi: "10.5067/f6jmovy5navz",
  license: { id: "CC-BY-4.0", href: "https://creativecommons.org/licenses/by/4.0/" },
};

/** Each group as "Label: text, text". */
const texts = (groups) => groups.map(({ label, items }) => `${label}: ${items.map((c) => c.text).join(", ")}`);
const BASEMAP = "Basemap: © OpenStreetMap contributors, OpenFreeMap, © OpenMapTiles";

test("scale bar picks a round length", () => {
  assert.deepEqual(scaleBar(metersPerPixel(46.48, 11)), { px: 76, label: "2 km" });
  assert.deepEqual(scaleBar(0.5), { px: 40, label: "20 m" });
  assert.equal(scaleBar(10).label, "500 m");
  assert.equal(scaleBar(100).label, "5 km");
});

test("meters per pixel follow the 512 px tile formula", () => {
  assert.ok(Math.abs(metersPerPixel(0, 0) - 78271.517) < 0.01);
});

test("credits name what each source draws, Esri only on imagery and Mapterhorn only in 3D", () => {
  const plain = credits({ base: "standard", terrain: false, catalog });
  assert.deepEqual(texts(plain), ["Glaciers: RGI Consortium 2023", BASEMAP]);
  const both = credits({ base: "imagery", terrain: true, catalog });
  assert.deepEqual(texts(both), [
    "Glaciers: RGI Consortium 2023",
    BASEMAP,
    "Imagery: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    "Terrain: © Mapterhorn",
  ]);
});

test("the terrain credits list the producers in view after Mapterhorn", () => {
  const producers = [{ text: "© swisstopo", href: "https://swisstopo.example/" }];
  const [, , terrain] = credits({ base: "standard", terrain: true, catalog, producers });
  assert.deepEqual(terrain.items.map((c) => c.text), ["© Mapterhorn", "© swisstopo"]);
  assert.equal(credits({ base: "standard", terrain: false, catalog, producers }).length, 2);
});

test("the coverage tiles are the index's tiles over the view, at most 16, at zooms 4 to 12", () => {
  const aletsch = { west: 7.9, south: 46.4, east: 8.1, north: 46.6 };
  assert.deepEqual(coverageTiles(aletsch, 9.7), [
    { z: 9, x: 267, y: 180 },
    { z: 9, x: 267, y: 181 },
  ]);
  /* Past the index's deepest zoom, its tiles at 12 hold the answer. */
  assert.ok(coverageTiles(aletsch, 15).every(({ z }) => z === 12));
  /* A wide view steps out until 16 tiles cover it. */
  const alps = coverageTiles({ west: 5, south: 43, east: 16, north: 48 }, 11);
  assert.ok(alps.length <= 16 && alps[0].z < 11);
  assert.deepEqual(coverageTiles(aletsch, 3.9), []);
  assert.deepEqual(coverageTiles({ west: -180, south: -85, east: 180, north: 85 }, 6), []);
  /* Across the antimeridian the columns wrap around. */
  const xs = coverageTiles({ west: 179, south: 60, east: 181, north: 61 }, 6).map(({ x }) => x);
  assert.deepEqual([...new Set(xs)], [63, 0]);
});

test("the producers are listed finest first and once each, linked only to web pages", () => {
  const producers = terrainProducers({
    glo30: source("Copernicus", 30),
    swissalti3d: source("swisstopo", 0.5),
    swisssurface: source("swisstopo", 0.5),
    odd: source("Odd", 2, "javascript:alert(1)"),
  });
  assert.deepEqual(producers, [
    { text: "© swisstopo", href: "https://swisstopo.example/" },
    { text: "© Odd", href: null },
    { text: "© Copernicus", href: "https://copernicus.example/" },
  ]);
  assert.equal(terrainProducers({}), null);
  const many = Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`s${i}`, source(`P${i}`, i)]));
  assert.equal(terrainProducers(many), null, "past 15 sources, Mapterhorn's own page lists them");
});

test("with terrain on, each move credits the elevation sources in view, and only the latest answer counts", async () => {
  const root = document.createElement("div");
  const map = new FakeMap({ center: [8.03, 46.5], zoom: 11 });
  const onMove = [];
  const rgiMap = { map, onMove: (cb) => onMove.push(cb) };
  const state = { base: "standard", terrain: false };
  const terrainText = () =>
    [...root.querySelectorAll(".credit-group")].find((g) => g.textContent.startsWith("Terrain"))?.textContent;
  asked.length = 0;
  const status = mountStatus(root, rgiMap, catalog, () => state);
  await settle();
  assert.equal(asked.length, 0, "no lookup without terrain");

  answer = () => ({ swissalti3d: source("swisstopo", 0.5), glo30: source("Copernicus", 30) });
  state.terrain = true;
  status.refresh();
  assert.equal(terrainText(), "Terrain© Mapterhorn");
  await settle();
  assert.equal(terrainText(), "Terrain© Mapterhorn, © swisstopo, © Copernicus");
  assert.ok(asked.length > 0 && asked.every(({ url, z }) => url === "https://download.mapterhorn.com/coverage-index.pmtiles" && z === 11));
  assert.equal(root.querySelector('a[href="https://swisstopo.example/"]').textContent, "© swisstopo");

  /* A slow answer for the first view arrives after the one for the second. */
  let release;
  const slow = new Promise((resolve) => (release = resolve));
  answer = () => slow.then(() => ({ old: source("Old", 1) }));
  onMove[0]({ zoom: 11, lat: 46.5, lon: 8.03 });
  answer = () => ({ usgs: source("USGS", 10) });
  onMove[0]({ zoom: 11, lat: 46.5, lon: 8.03 });
  await settle();
  release();
  await settle();
  assert.equal(terrainText(), "Terrain© Mapterhorn, © USGS");

  answer = () => Promise.reject(new Error("offline"));
  onMove[0]({ zoom: 11, lat: 46.5, lon: 8.03 });
  await settle();
  assert.equal(terrainText(), "Terrain© Mapterhorn");

  state.terrain = false;
  status.refresh();
  assert.equal(terrainText(), undefined);
});

test("the RGI credit links to the DOI, and reads no year from a citation without one", () => {
  const [glaciers] = credits({ base: "standard", terrain: false, catalog });
  assert.deepEqual(glaciers.items[0], { text: "RGI Consortium 2023", href: "https://doi.org/10.5067/f6jmovy5navz" });
  const [plain] = credits({ base: "standard", terrain: false, catalog: { ...catalog, citation: "RGI", doi: "javascript:x" } });
  assert.deepEqual(plain.items[0], { text: "RGI Consortium", href: null });
});

test("the status line draws the scale and links, and refresh updates the credits", () => {
  const root = document.createElement("div");
  const map = new FakeMap({ center: [8, 46.48], zoom: 11 });
  const onMove = [];
  const rgiMap = { map, onMove: (cb) => onMove.push(cb) };
  let state = { base: "standard", terrain: false };
  const status = mountStatus(root, rgiMap, catalog, () => state);

  assert.equal(root.querySelector(".scale-label").textContent, "2 km");
  assert.equal(root.querySelector(".scale-bar").style.width, "76px");
  assert.ok(!root.textContent.includes("Esri"));
  assert.deepEqual([...root.querySelectorAll(".credit-label")].map((l) => l.textContent), ["Glaciers", "Basemap"]);
  const osm = [...root.querySelectorAll("a")].find((a) => a.textContent.startsWith("© OpenStreetMap"));
  assert.equal(osm.href, "https://www.openstreetmap.org/copyright");
  const rgi = [...root.querySelectorAll("a")].find((a) => a.textContent === "RGI Consortium 2023");
  assert.equal(rgi.href, "https://doi.org/10.5067/f6jmovy5navz");
  assert.equal(rgi.getAttribute("rel"), "noopener");
  assert.equal(rgi.target, "_blank");

  state = { base: "imagery", terrain: true };
  status.refresh();
  assert.ok(root.textContent.includes("Esri, Maxar"));
  assert.ok(root.textContent.includes("Mapterhorn"));

  onMove[0]({ zoom: 6, lat: 46.48, lon: 8 });
  map.zoom = 6;
  onMove[0]({ zoom: 6, lat: 46.48, lon: 8 });
  assert.equal(root.querySelector(".scale-label").textContent, "50 km");
});

test("scale bar edge cases", () => {
  assert.ok(Number.isFinite(metersPerPixel(90, 5)) && metersPerPixel(90, 5) > 0);
  assert.equal(metersPerPixel(90, 5), metersPerPixel(85.05, 5));
  assert.equal(scaleBar(metersPerPixel(0, 0)).label, "5000 km");
  for (const bad of [NaN, 0, -1, Infinity]) assert.equal(scaleBar(bad), null);
});

test("the status line hides the scale bar when there is no scale", () => {
  const root = document.createElement("div");
  mountStatus(root, { map: new FakeMap({ zoom: NaN }), onMove() {} }, catalog, () => ({ base: "standard", terrain: false }));
  assert.equal(root.querySelector(".scale").hidden, true);
});

test("the status line height is published as --status-h on mount and refresh", () => {
  const root = document.createElement("div");
  let height = 54;
  root.getBoundingClientRect = () => ({ height });
  const rgiMap = { map: new FakeMap({ center: [8, 46.48], zoom: 11 }), onMove: () => {} };
  const status = mountStatus(root, rgiMap, catalog, () => ({ base: "standard", terrain: false }));
  const read = () => document.documentElement.style.getPropertyValue("--status-h");
  assert.equal(read(), "54px");
  height = 70;
  status.refresh();
  assert.equal(read(), "70px");
});

test("the credits run as one text, so a long line wraps inside a group, not between groups", () => {
  const css = fs.readFileSync(new URL("../style.css", import.meta.url), "utf8");
  const desktop = css.slice(0, css.indexOf("@media (max-width: 640px)"));
  assert.doesNotMatch(desktop, /(^|\n)\.credits\s*\{[^}]*display:\s*flex/);
  assert.match(desktop, /(^|\n)\.credits-button\s*\{\s*display:\s*none;/, "the info button is the phone's");
});
