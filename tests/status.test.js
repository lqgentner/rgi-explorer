import assert from "node:assert/strict";
import test from "node:test";

import { FakeMap, loadPage, load } from "./helpers/browser.js";

const { document } = await loadPage();
const { credits, metersPerPixel, mountStatus, scaleBar } = await load("js/status.js");

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

test("the RGI credit links to the DOI, and reads no year from a citation without one", () => {
  const [glaciers] = credits({ base: "standard", terrain: false, catalog });
  assert.deepEqual(glaciers.items[0], { text: "RGI Consortium 2023", href: "https://doi.org/10.5067/f6jmovy5navz" });
  const [plain] = credits({ base: "standard", terrain: false, catalog: { ...catalog, citation: "RGI", doi: "javascript:x" } });
  assert.deepEqual(plain.items[0], { text: "RGI Consortium", href: null });
});

test("a custom catalog is named first, as text", () => {
  const list = credits({ base: "standard", terrain: false, catalog, customCatalog: "localhost:8000" });
  assert.deepEqual(list[0], { label: "Custom catalog", items: [{ text: "localhost:8000" }] });
  assert.equal(credits({ base: "standard", terrain: false, catalog, customCatalog: null })[0].label, "Glaciers");
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

test("credits render as text, never markup", () => {
  const root = document.createElement("div");
  const rgiMap = { map: new FakeMap({ zoom: 3 }), onMove() {} };
  mountStatus(root, rgiMap, catalog, () => ({ base: "standard", terrain: false, customCatalog: "<img src=x>" }));
  assert.equal(root.querySelector("img"), null);
  assert.ok(root.textContent.includes("<img src=x>"));
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
