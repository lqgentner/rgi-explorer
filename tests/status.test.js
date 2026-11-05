import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { FakeMap, loadPage, load } from "./helpers/browser.js";

const { document } = await loadPage();
const { coverageTiles, credits, imageryContributors, metersPerPixel, mountStatus, scaleBar, terrainProducers } =
  await load("js/status.js");
const { ESRI_ATTRIBUTION } = await load("js/config.js");

/* Esri's contributor list: each bbox is [minLat, minLon, maxLat, maxLon]. */
const area = (bbox, zoomMin = 12, zoomMax = 23, score = 100) => ({ bbox, zoomMin, zoomMax, score });
const CONTRIBUTORS = [
  { attribution: "Earthstar Geographics", coverageAreas: [area([-84.94, -179.66, 84.94, 179.66], 0, 13, 50)] },
  { attribution: "©swisstopo, ©Planet", coverageAreas: [area([46.39, 7.36, 46.41, 7.4]), area([46.3, 7.8, 46.6, 8.2])] },
  { attribution: "Vantor", coverageAreas: [area([40, 0, 50, 20], 14, 23, 80)] },
  { attribution: "Land Tirol", coverageAreas: [area([46.75, 10.09, 47.6, 11.14])] },
  { attribution: "Chukotka", coverageAreas: [area([64, -179.9, 70, -170])] },
];

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
const texts = (groups) => groups.map(({ label, items }) => `${label ? `${label}: ` : ""}${items.map((c) => c.text).join(", ")}`);
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
  assert.deepEqual(texts(plain), ["Glaciers: RGI Consortium 2023", BASEMAP, "MapLibre"]);
  const both = credits({ base: "imagery", terrain: true, catalog });
  assert.deepEqual(texts(both), [
    "Glaciers: RGI Consortium 2023",
    BASEMAP,
    "Imagery: Powered by Esri, Vantor, Earthstar Geographics, and the GIS User Community",
    "Terrain: © Mapterhorn",
    "MapLibre",
  ]);
  assert.deepEqual(plain.at(-1), { label: null, items: [{ text: "MapLibre", href: "https://maplibre.org/" }] });
});

test("the imagery credits list Esri's contributors in view after Esri", () => {
  const imagery = [{ text: "©swisstopo, ©Planet" }];
  const [, , group] = credits({ base: "imagery", terrain: false, catalog, imagery });
  assert.deepEqual(group.items.map((c) => c.text), ["Powered by Esri", "©swisstopo, ©Planet"]);
  /* Esri asks for "Powered by Esri" on interactive maps, with Esri linked to its site. */
  assert.equal(group.items[0].href, "https://www.esri.com");
  assert.equal(credits({ base: "standard", terrain: false, catalog, imagery }).length, 3, "glaciers, basemap and MapLibre");
});

test("the contributors in view are those whose areas meet the view at its zoom, best score first", () => {
  const aletsch = { west: 7.9, south: 46.4, east: 8.1, north: 46.6 };
  const names = (view, level) => imageryContributors(CONTRIBUTORS, view, level)?.map((c) => c.text) ?? null;
  assert.deepEqual(names(aletsch, 12), ["©swisstopo, ©Planet", "Earthstar Geographics"]);
  assert.deepEqual(names(aletsch, 15), ["©swisstopo, ©Planet", "Vantor"]);
  assert.deepEqual(names({ west: -180, south: -85, east: 180, north: 85 }, 3), ["Earthstar Geographics"]);
  /* A view across the antimeridian runs past 180°; its far side wraps around. */
  assert.deepEqual(names({ west: 179, south: 65, east: 181, north: 66 }, 16), ["Chukotka"]);
  assert.equal(names({ west: 0, south: -60, east: 1, north: -59 }, 16), null, "no contributor: the fixed sources stand");
  const many = Array.from({ length: 16 }, (_, i) => ({ attribution: `C${i}`, coverageAreas: [area([46, 7, 47, 9])] }));
  assert.equal(imageryContributors(many, aletsch, 15), null, "past 15 contributors, the fixed sources stand");
  assert.equal(imageryContributors(undefined, aletsch, 15), null);
});

test("on imagery, each move credits Esri's contributors in view, read from Esri once", async () => {
  const root = document.createElement("div");
  const map = new FakeMap({ center: [8.03, 46.5], zoom: 11 });
  const onMove = [];
  const rgiMap = { map, onMove: (cb) => onMove.push(cb) };
  const state = { base: "standard", terrain: false };
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(url);
    return { ok: true, status: 200, json: async () => ({ contributors: CONTRIBUTORS }) };
  };
  const imageryText = () =>
    [...root.querySelectorAll(".credit-group")].find((g) => g.textContent.startsWith("Imagery"))?.textContent;
  const status = mountStatus(root, rgiMap, catalog, () => state);
  await settle();
  assert.deepEqual(urls, [], "no request without imagery");

  state.base = "imagery";
  status.refresh();
  assert.equal(imageryText(), "ImageryPowered by Esri, Vantor, Earthstar Geographics, and the GIS User Community");
  await settle();
  /* MapLibre's zoom 11 draws Esri's 256 px tiles of level 12. */
  assert.equal(imageryText(), "ImageryPowered by Esri, ©swisstopo, ©Planet, Earthstar Geographics");

  map.zoom = 14;
  onMove[0]({ zoom: 14, lat: 46.5, lon: 8.03 });
  await settle();
  assert.equal(imageryText(), "ImageryPowered by Esri, ©swisstopo, ©Planet, Vantor");
  assert.deepEqual(urls, [ESRI_ATTRIBUTION]);
});

test("a failed read of Esri's contributors keeps the fixed sources and is tried again on the next move", async () => {
  const root = document.createElement("div");
  const map = new FakeMap({ center: [8.03, 46.5], zoom: 11 });
  const onMove = [];
  const rgiMap = { map, onMove: (cb) => onMove.push(cb) };
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) throw new Error("offline");
    return { ok: true, status: 200, json: async () => ({ contributors: CONTRIBUTORS }) };
  };
  mountStatus(root, rgiMap, catalog, () => ({ base: "imagery", terrain: false }));
  await settle();
  assert.match(root.textContent, /ImageryPowered by Esri, Vantor, Earthstar Geographics, and the GIS User Community/);
  onMove[0]({ zoom: 11, lat: 46.5, lon: 8.03 });
  await settle();
  assert.equal(calls, 2);
  assert.match(root.textContent, /ImageryPowered by Esri, ©swisstopo, ©Planet, Earthstar Geographics/);
});

test("the terrain credits list the producers in view after Mapterhorn", () => {
  const producers = [{ text: "© swisstopo", href: "https://swisstopo.example/" }];
  const [, , terrain] = credits({ base: "standard", terrain: true, catalog, producers });
  assert.deepEqual(terrain.items.map((c) => c.text), ["© Mapterhorn", "© swisstopo"]);
  assert.equal(credits({ base: "standard", terrain: false, catalog, producers }).length, 3, "glaciers, basemap and MapLibre");
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
    [...root.querySelectorAll(".credit-group")].find((g) => g.textContent.startsWith("Terrain"))?.textContent.replaceAll("\u00a0", " ");
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
  assert.equal(root.querySelector('a[href="https://swisstopo.example/"]').textContent, "©\u00a0swisstopo");

  /* A slow answer for the first view arrives after the one for the second. */
  let release;
  const slow = new Promise((resolve) => (release = resolve));
  /* Each move goes to a view of its own: a coverage tile, once read, is not asked again. */
  answer = () => slow.then(() => ({ old: source("Old", 1) }));
  map.jumpTo({ center: [9.5, 46.5] });
  onMove[0]({ zoom: 11, lat: 46.5, lon: 9.5 });
  answer = () => ({ usgs: source("USGS", 10) });
  map.jumpTo({ center: [11, 46.5] });
  onMove[0]({ zoom: 11, lat: 46.5, lon: 11 });
  await settle();
  release();
  await settle();
  assert.equal(terrainText(), "Terrain© Mapterhorn, © USGS");
  const before = asked.length;
  onMove[0]({ zoom: 11, lat: 46.5, lon: 11 });
  await settle();
  assert.equal(asked.length, before, "a coverage tile read once is not fetched again");
  assert.equal(terrainText(), "Terrain© Mapterhorn, © USGS");

  answer = () => Promise.reject(new Error("offline"));
  map.jumpTo({ center: [12.5, 46.5] });
  onMove[0]({ zoom: 11, lat: 46.5, lon: 12.5 });
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
  const last = root.querySelector(".credit-group:last-child");
  assert.equal(last.querySelector(".credit-label"), null, "the map library's credit has no label");
  assert.equal(last.textContent, "MapLibre");
  assert.equal(last.querySelector("a").href, "https://maplibre.org/");
  const osm = [...root.querySelectorAll("a")].find((a) => a.textContent.startsWith("©\u00a0OpenStreetMap"));
  assert.equal(osm.href, "https://www.openstreetmap.org/copyright");
  const rgi = [...root.querySelectorAll("a")].find((a) => a.textContent === "RGI Consortium 2023");
  assert.equal(rgi.href, "https://doi.org/10.5067/f6jmovy5navz");
  assert.equal(rgi.getAttribute("rel"), "noopener");
  assert.equal(rgi.target, "_blank");

  state = { base: "imagery", terrain: true };
  status.refresh();
  assert.ok(root.textContent.includes("Powered by Esri, Vantor"));
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

test("on desktop the scale and the credits sit in two columns, top-aligned, and the phone keeps its layout", () => {
  const css = fs.readFileSync(new URL("../style.css", import.meta.url), "utf8");
  const phoneAt = css.indexOf("@media (max-width: 640px)");
  const desktop = css.slice(0, phoneAt);
  const columns = /\n@media \(min-width: 641px\) \{\n  #status \{\s*display:\s*flex;\s*align-items:\s*flex-start;\s*\}[^@]*?\n\}\n/.exec(desktop);
  assert.ok(columns, "a desktop-only rule lays out #status as a row, top-aligned");
  assert.match(columns[0], /\.scale\s*\{\s*flex:\s*none;\s*\}/, "the scale keeps its width");
  assert.match(columns[0], /\.credits-box\s*\{\s*min-width:\s*0;\s*\}/, "the credits column narrows and wraps");
  /* Outside that block and the phone's own row, nothing turns #status into a flex row. */
  const rest = desktop.slice(0, columns.index) + desktop.slice(columns.index + columns[0].length);
  assert.doesNotMatch(rest, /#status\s*\{[^}]*display:\s*(inline-)?flex/);
  assert.doesNotMatch(desktop, /(^|\n)\.credits\s*\{[^}]*display:\s*flex/, "the credits stay one text");
  assert.match(desktop, /(^|\n)\.credits-button\s*\{\s*display:\s*none;/, "the info button is the phone's");
});

test("a line breaks between credits: each is a box with its comma, and a label shares its first credit's", () => {
  const root = document.createElement("div");
  const rgiMap = { map: new FakeMap({ center: [8, 46.48], zoom: 11 }), onMove: () => {} };
  mountStatus(root, rgiMap, catalog, () => ({ base: "imagery", terrain: false }));
  const list = root.querySelector(".credits");
  assert.ok(list.children.length > 1);
  assert.equal(list.childNodes.length, list.children.length, "no text nodes between the groups");
  for (const group of list.children) {
    const boxes = [...group.children];
    assert.ok(boxes.every((b) => b.className === "credit-box" && b.querySelectorAll(".credit").length === 1), group.textContent);
    /* Between the boxes only spaces, where a line may break. */
    assert.ok([...group.childNodes].every((n) => n.nodeType !== 3 || n.textContent === " "), group.textContent);
    boxes.slice(0, -1).forEach((b) => assert.ok(b.textContent.endsWith(","), b.textContent));
  }
  assert.equal(list.querySelector(".credit-box").textContent, "GlaciersRGI Consortium 2023");
  assert.equal(list.children[1].firstElementChild.textContent, "Basemap\u00a9\u00a0OpenStreetMap contributors,");
  const css = fs.readFileSync(new URL("../style.css", import.meta.url), "utf8");
  assert.match(css, /\.credit-box \{\s*display: inline-block;/);
  /* The separator hangs into the previous group's margin, which a line break drops. */
  assert.match(css, /\.credit-group:not\(:last-child\) \{\s*margin-right: 17px;/);
  assert.match(css, /\.credit-box:first-child::before \{[^}]*width: 17px;\s*margin-left: -17px;/);
  const box = root.querySelector(".credits-box");
  assert.deepEqual([...root.children], [root.querySelector(".scale"), box], "the scale, then the credits column");
});

test("a copyright sign stays on the line of the name it belongs to", () => {
  const root = document.createElement("div");
  const map = new FakeMap({ center: [8, 46.48], zoom: 11 });
  mountStatus(root, { map, onMove() {} }, catalog, () => ({ base: "standard", terrain: false }));
  const signs = [...root.querySelectorAll(".credit")].map((c) => c.textContent).filter((t) => t.includes("©"));
  assert.ok(signs.length >= 2);
  for (const text of signs) assert.match(text, /©\u00a0/);
});

test("a Privacy link ends the credits and opens the privacy note", () => {
  const root = document.createElement("div");
  const rgiMap = { map: new FakeMap({ center: [8, 46.48], zoom: 11 }), onMove: () => {} };
  let opened = 0;
  const status = mountStatus(root, rgiMap, catalog, () => ({ base: "standard", terrain: false }), { onPrivacy: () => opened++ });
  const last = () => root.querySelector(".credit-group:last-child");
  assert.equal(last().textContent, "Privacy");
  last().querySelector("button").click();
  assert.equal(opened, 1);
  status.refresh();
  assert.equal(last().textContent, "Privacy", "a redraw keeps it last");
});
