/*
 * The whole page on a desktop, end to end: the real modules over the catalog
 * fixture and the GeoParquet fixtures, on the strict fake map. The tests run in
 * order on one page, as one visitor would use it.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

import * as hyparquet from "hyparquet";

import { load, loadPage, settle, waitFor } from "./helpers/browser.js";
import { GLACIERS_URL, makeParquet, servedFetch } from "./helpers/served.js";

const fixture = (p) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${p}`, import.meta.url), "utf8"));
const RINGS = fixture("aletsch-rings.json");
const ALETSCH = "RGI2000-v7.0-G-11-02596";
const MORTERATSCH = "RGI2000-v7.0-G-11-00001";
/* A glacier fit leaves half the glacier's size free on every side, so the map around it shows. */
const around = ([[x0, y0], [x1, y1]]) => {
  const [dx, dy] = [(x1 - x0) * 0.5, (y1 - y0) * 0.5];
  return [[x0 - dx, y0 - dy], [x1 + dx, y1 + dy]];
};
const ALETSCH_BBOX = around([[7.931361, 46.397437], [8.087402, 46.563295]]);
const PYTHON = `import geopandas as gpd\n\nurl = "${GLACIERS_URL}"\ngdf = gpd.read_parquet(url, filters=[("rgi_id", "==", "${ALETSCH}")])\n`;

const ZERMATT = {
  features: [{
    properties: { name: "Zermatt", osm_value: "village", country: "Switzerland" },
    geometry: { type: "Point", coordinates: [7.7491, 46.0207] },
  }],
};
const jsonResponse = (data) => new Response(JSON.stringify(data), { status: 200 });

/* While set, reads of the glaciers file wait for this promise. */
let hold = null;

async function extra(url, init) {
  if (hold && url === GLACIERS_URL && (init.method ?? "GET") === "GET") await hold;
  const u = new URL(url);
  if (u.host === "photon.komoot.io") return jsonResponse(u.searchParams.get("q") === "zermatt" ? ZERMATT : { features: [] });
  if (u.host === "query.wikidata.org") return jsonResponse(fixture("wikidata/aletsch.json"));
  if (u.host === "commons.wikimedia.org") {
    return jsonResponse(u.searchParams.get("generator") ? { query: { pages: {} } } : fixture("commons/aletsch.json"));
  }
  return null;
}

const log = [];
const page = await loadPage({ fetch: servedFetch(makeParquet(), log, extra) });
const { document, window } = page;
globalThis.hyparquet = hyparquet;
const copied = [];
Object.defineProperty(globalThis.navigator, "clipboard", {
  configurable: true,
  value: { writeText: async (text) => void copied.push(text) },
});
await load("js/app.js");
await waitFor(() => document.querySelector("#search input") && document.querySelector("#status .credits"));
const map = page.map;

const $ = (sel) => document.querySelector(sel);
const click = (node) => node.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
const params = () => new URL(window.location.href).searchParams;
const button = (root, label) => [...root.querySelectorAll("button")].find((b) => b.textContent === label);
const fits = () => map.calls.filter((call) => call.startsWith("fitBounds")).length;

async function search(text) {
  const input = $("#search input");
  input.focus();
  input.value = text;
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
}
async function pick(title, subtitle = "") {
  const row = await waitFor(() => [...document.querySelectorAll("#search li")]
    .find((li) => li.querySelector(".title").textContent === title && li.querySelector(".subtitle").textContent.includes(subtitle)));
  click(row);
}

test("the page mounts the search, the controls and the status line, with no card", () => {
  assert.ok($("#layers .layers-thumb"));
  assert.ok($("#controls .terrain-btn"));
  assert.ok($("#controls .zoom-control"));
  assert.match($("#status").textContent, /GlaciersRGI Consortium 2023/);
  assert.equal($("#status").getAttribute("aria-live"), null, "a base or 3D switch does not re-announce the credits");
  assert.equal($("#status").getAttribute("role"), null);
  assert.equal($("#card").hidden, true);
  assert.equal($("#sheet").hidden, true);
  assert.equal(window.location.search, "");
});

test("searching aletsch and picking it opens the card, selects it and fits its bbox", async () => {
  map.sourceFeatures = [
    { sourceLayer: "glaciers", properties: { rgi_id: ALETSCH }, geometry: { type: "Polygon", coordinates: RINGS.slice(0, 25) } },
    { sourceLayer: "glaciers", properties: { rgi_id: ALETSCH }, geometry: { type: "MultiPolygon", coordinates: [RINGS.slice(25)] } },
  ];
  map.tilesLoaded = false;
  await search("aletsch");
  await pick("Grosser Aletsch Gletscher");

  await waitFor(() => $("#card .card-title")?.textContent === "Grosser Aletsch Gletscher");
  assert.equal($("#card").hidden, false);
  assert.ok(document.body.classList.contains("card-open"));
  assert.equal(params().get("glacier"), ALETSCH);
  assert.deepEqual(map.getLayer("selection-outline").filter, ["==", ["get", "rgi_id"], ALETSCH]);
  assert.equal(map.layout("selection-outline").visibility, "visible");

  await waitFor(() => map.lastFit);
  assert.deepEqual(map.lastFit.bounds, ALETSCH_BBOX);
  assert.equal(map.lastFit.options.maxZoom, 15, "a small glacier keeps its surroundings in view");
  assert.equal(map.lastFit.options.padding.left, 408 + 24, "the fit keeps clear of the card");
  assert.equal(window.location.hash, "#2/30/10", "the view the fit ends at is written");
  assert.equal(params().get("glacier"), ALETSCH);
});

test("both tabs render from the glacier's row", async () => {
  await waitFor(() => $("#card .panel-hypsometry svg"));
  const region = [...document.querySelectorAll("#card .row")].find((r) => r.querySelector(".row-label").firstChild.textContent === "Region");
  assert.equal(region.querySelector(".row-value").textContent, "11 · Central Europe");
  assert.ok(document.querySelectorAll("#card .key-tile").length >= 6);
  click($("#card-tab-hypsometry"));
  assert.equal($("#card-panel-hypsometry").hidden, false);
  assert.equal($("#card-panel-overview").hidden, true);
  click($("#card-tab-overview"));
  assert.equal($("#card-panel-overview").hidden, false);
});

test("the photo lookup waits for the map, reads the outline pieces and fills the photo area", async () => {
  await waitFor(() => map.handlers.idle?.length);
  assert.ok($("#card .photo img.photo-crop"), "the imagery crop shows while the lookup waits");
  assert.equal(log.filter(({ url }) => url.startsWith("https://query.wikidata.org/")).length, 0, "no lookup before the tiles load");
  map.tilesLoaded = true;
  map.fire("idle");
  await waitFor(() => $("#card .photo img:not(.photo-crop)"));
  assert.ok(map.calls.includes("querySourceFeatures data"));
  const sparql = log.find(({ url }) => url.startsWith("https://query.wikidata.org/"));
  assert.match(new URL(sparql.url).searchParams.get("query"), /P6799 "G008032E46504N"/, "the GLIMS ID comes from the row");
  assert.match($("#card .photo img:not(.photo-crop)").getAttribute("src"), /^https:\/\/thumb\.wikimedia\.org\//);
});

test("the imagery's viewer frames its own crop and asks identify for it", async () => {
  const { viewerCropSize } = await load("js/viewer.js");
  const { ESRI_EXPORT, ESRI_IDENTIFY } = await load("js/config.js");
  const [w, hgt] = viewerCropSize(window.innerWidth, window.innerHeight, { scale: 1 });
  click($("#card .strip-tile .strip-open"));
  const viewer = $("dialog.viewer");
  const img = await waitFor(() => viewer.querySelector(".viewer-slide.current .viewer-image[src]"));
  const src = new URL(img.getAttribute("src"));
  assert.equal(src.origin + src.pathname, ESRI_EXPORT);
  assert.equal(src.searchParams.get("size"), `${w},${hgt}`);
  const identify = await waitFor(() => log.find(({ url }) => url.startsWith(ESRI_IDENTIFY) && new URL(url).searchParams.get("imageDisplay") === `${w},${hgt},96`));
  assert.ok(identify, "the viewer's credit asks about its own extent and size");
  viewer.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(viewer.open || viewer.hasAttribute("open"), false);
});

test("Use this data shows the exact Python snippet", () => {
  click(button($("#card"), "Use this data"));
  const dialog = $("dialog.usedata");
  assert.ok(dialog.open);
  assert.equal(dialog.querySelector(".usedata-code code").textContent, PYTHON);
  click(dialog.querySelector(".usedata-close"));
  assert.equal(dialog.open, false);
});

test("Share copies the page address and says so", async () => {
  click(button($("#card"), "Share"));
  await waitFor(() => copied.length);
  assert.equal(copied.at(-1), window.location.href);
  assert.match(copied.at(-1), /glacier=RGI2000-v7\.0-G-11-02596/);
  await waitFor(() => [...document.querySelectorAll('[aria-live="polite"]')].some((n) => n.textContent === "Link copied"));
});

test("Zoom to fits the glacier again", async () => {
  const before = fits();
  click(button($("#card"), "Zoom to"));
  await waitFor(() => fits() > before);
  assert.deepEqual(map.lastFit.bounds, ALETSCH_BBOX);
});

test("clicking a glacier opens the card and writes ?glacier=", async () => {
  const before = fits();
  map.rendered = [{
    layer: { id: "glaciers-fill" },
    properties: { rgi_id: MORTERATSCH, display_name: "Morteratsch", o1region: "11", area_km2: 0.5 },
  }];
  map.fire("click", { point: { x: 200, y: 200 } });
  assert.equal($("#card .card-title").textContent, "Morteratsch");
  assert.equal(params().get("glacier"), MORTERATSCH);
  assert.deepEqual(map.getLayer("selection-outline").filter, ["==", ["get", "rgi_id"], MORTERATSCH]);
  await settle();
  assert.equal(fits(), before, "a click does not move the map");
});

test("a click on a settled map looks up photos at once, not after the idle cap", async () => {
  const sparql = await waitFor(
    () => log.find(({ url }) => url.startsWith("https://query.wikidata.org/") && url.includes("G001000E46000N")),
    1000,
  );
  assert.ok(sparql);
  await waitFor(() => $("#card .photo img.photo-crop"), 1000);
});

test("a failing outline query still leaves the imagery crop", async () => {
  map.querySourceFeatures = () => {
    throw new Error("the source is gone");
  };
  try {
    map.rendered = [{ layer: { id: "glaciers-fill" }, properties: { rgi_id: "RGI2000-v7.0-G-11-00003", o1region: "11" } }];
    map.fire("click", { point: { x: 220, y: 220 } });
    await waitFor(() => log.some(({ url }) => url.startsWith("https://query.wikidata.org/") && url.includes("G003000E46000N")), 1000);
    await waitFor(() => $("#card .photo img.photo-crop"), 1000);
  } finally {
    delete map.querySourceFeatures;
  }
});

test("clicking empty map closes the card", () => {
  map.rendered = [];
  map.fire("click", { point: { x: 10, y: 10 } });
  assert.equal($("#card").hidden, true);
  assert.equal(document.body.classList.contains("card-open"), false);
  assert.equal(params().get("glacier"), null);
  assert.equal(map.layout("selection-outline").visibility, "none");
  assert.equal($("#search input").value, "", "closing the card clears the search");
});

test("the search bar's Close button closes the card on desktop", async () => {
  const close = $('#search button[aria-label="Close"]');
  assert.equal(close.hidden, true, "no glacier, no Close");
  map.rendered = [{ layer: { id: "glaciers-fill" }, properties: { rgi_id: MORTERATSCH, display_name: "Morteratsch", o1region: "11" } }];
  map.fire("click", { point: { x: 200, y: 200 } });
  assert.equal(close.hidden, false);
  click(close);
  assert.equal($("#card").hidden, true);
  assert.equal(params().get("glacier"), null);
  assert.equal(map.layout("selection-outline").visibility, "none");
  assert.equal(close.hidden, true);
  assert.equal($("#card .card-close"), null, "the desktop card has no Close of its own");
  await settle();
});

test("a region pick made while a glacier's bbox is read keeps the region fit", async () => {
  await search("athabasca");
  const row = await waitFor(() => [...document.querySelectorAll("#search li")]
    .find((li) => li.querySelector(".title").textContent === "Athabasca Glacier"));
  let release;
  hold = new Promise((resolve) => {
    release = resolve;
  });
  click(row);
  assert.equal(params().get("glacier"), "RGI2000-v7.0-G-03-00002");
  await search("central europe");
  await pick("Central Europe", "Glacier region · 11");
  assert.deepEqual(map.lastFit.bounds, [[-1.5, 41], [20, 48.5]]);
  release();
  hold = null;
  await waitFor(() => $("#card .card-title")?.textContent === "Athabasca Glacier");
  await settle(20);
  assert.deepEqual(map.lastFit.bounds, [[-1.5, 41], [20, 48.5]], "the late glacier fit is dropped");
  map.rendered = [];
  map.fire("click", { point: { x: 1, y: 1 } });
  assert.equal($("#card").hidden, true);
});

test("a drag while a glacier's bbox is read drops the late fit", async () => {
  await search("athabasca");
  const row = await waitFor(() => [...document.querySelectorAll("#search li")]
    .find((li) => li.querySelector(".title").textContent === "Athabasca Glacier"));
  let release;
  hold = new Promise((resolve) => {
    release = resolve;
  });
  const before = fits();
  click(row);
  map.fire("movestart", { originalEvent: new window.MouseEvent("mousedown") });
  release();
  hold = null;
  await waitFor(() => $("#card .card-title")?.textContent === "Athabasca Glacier");
  await settle(20);
  assert.equal(fits(), before, "the user's drag wins over the late glacier fit");
  map.rendered = [];
  map.fire("click", { point: { x: 1, y: 1 } });
  assert.equal($("#card").hidden, true);
});

test("a camera move without a user event keeps the glacier fit", async () => {
  await search("athabasca");
  const row = await waitFor(() => [...document.querySelectorAll("#search li")]
    .find((li) => li.querySelector(".title").textContent === "Athabasca Glacier"));
  const before = fits();
  click(row);
  map.fire("movestart", {});
  await waitFor(() => fits() > before);
  map.rendered = [];
  map.fire("click", { point: { x: 1, y: 1 } });
});

test("a region pick fits the region's bbox and a place pick jumps to zoom 12", async () => {
  await search("central europe");
  await pick("Central Europe", "Glacier region · 11");
  await waitFor(() => map.lastFit.bounds[0][0] === -1.5);
  assert.deepEqual(map.lastFit.bounds, [[-1.5, 41], [20, 48.5]]);
  assert.equal(map.lastFit.options.padding.left, 24, "no card, no card padding");

  await search("north asia");
  await pick("North Asia", "Glacier region · 10");
  await waitFor(() => map.lastFit.bounds[0][0] === -180);
  assert.deepEqual(map.lastFit.bounds, [[-180, 31], [180, 78]], "a 360° region fits the world's width");

  await search("zermatt");
  await pick("Zermatt");
  assert.equal(map.getZoom(), 12);
  assert.deepEqual(map.getCenter(), { lng: 7.7491, lat: 46.0207 });
  assert.match(window.location.hash, /^#12\/46\.0207\/7\.7491$/);
  assert.equal($("#card").hidden, true);
});

test("base map, toggles and 3D write the URL and refresh the credits", () => {
  $("#layers .layers").dispatchEvent(new window.Event("pointerenter"));
  click($("#layers .layers-thumb"));
  assert.equal(params().get("base"), "imagery");
  assert.equal(map.layout("esri").visibility, "visible");
  assert.match($("#status").textContent, /Esri/);

  click($('#layers .layer-toggle[data-name="centerlines"]'));
  assert.equal(params().get("layers"), "regions,centerlines");

  click($("#controls .terrain-btn"));
  assert.equal(params().get("3d"), "1");
  assert.equal(map.getTerrain().source, "terrain");
  assert.match($("#status").textContent, /Mapterhorn/);

  click($("#controls .terrain-btn"));
  assert.equal(params().get("3d"), null);
});
