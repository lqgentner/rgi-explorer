/* The complex panel: header, rows, the member table, actions and late reads. */

import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

import { loadPage, load, settle } from "./helpers/browser.js";

const { document, window } = await loadPage();
const { loadCatalog } = await load("js/catalog.js");
const { mountComplexCard } = await load("js/complexcard.js");

const ROOT = "https://data.source.coop/lqgentner/rgi/catalog.json";
const DIR = new URL("./fixtures/catalog/", import.meta.url);
const catalog = await loadCatalog(ROOT, async (url) =>
  JSON.parse(fs.readFileSync(new URL(url.slice(ROOT.length - "catalog.json".length), DIR), "utf8")));
const regions = [
  { level: 1, o1region: "11", o2region: null, full_name: "Central Europe" },
  { level: 2, o1region: "11", o2region: "11-01", full_name: "Alps" },
];

const ID = "RGI2000-v7.0-C-11-01323";
const PROPS = {
  rgi_id: ID, o1region: "11", o2region: "11-01", cenlon: 7.97, cenlat: 46.48, utm_zone: 32, area_km2: 83.28,
  glacier_ids: ["RGI2000-v7.0-G-11-00003", "RGI2000-v7.0-G-11-02596"],
  bbox: { xmin: 7.931361, ymin: 46.397437, xmax: 8.31, ymax: 46.61 },
};
const MEMBERS = [
  { rgiId: "RGI2000-v7.0-G-11-02596", name: "Grosser Aletsch Gletscher", area: 81.78 },
  { rgiId: "RGI2000-v7.0-G-11-00003", name: null, area: 1.5 },
];

function setup(over = {}) {
  document.getElementById("card")?.remove();
  const root = document.createElement("div");
  root.id = "card";
  document.getElementById("sidebar").append(root);
  const calls = [];
  const card = mountComplexCard(root, {
    catalog,
    regions,
    read: async () => PROPS,
    members: async () => MEMBERS,
    onClose: () => calls.push("close"),
    onZoom: (bbox) => calls.push(["zoom", bbox]),
    onShare: () => calls.push("share"),
    onUseData: (target) => calls.push(["use", target]),
    onOpenGlacier: (id) => calls.push(["glacier", id]),
    ...over,
  });
  return { root, card, calls };
}
const text = (root, sel) => root.querySelector(sel)?.textContent;
const click = (node) => node.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
const button = (root, label) => [...root.querySelectorAll("button")].find((b) => b.textContent === label);
const cells = (root) =>
  [...root.querySelectorAll("table.members tbody tr")].map((tr) => [...tr.children].map((td) => td.textContent));

test("the panel shows the ID, the region, the area, the rows and the members", async () => {
  const { root, card } = setup();
  const opening = card.open(ID);
  assert.equal(text(root, ".card-title"), ID);
  assert.equal(text(root, ".card-subtitle"), "Complex · Central Europe", "the region comes from the ID before the read");
  assert.match(root.textContent, /Loading…/);
  await opening;
  await settle();
  assert.equal(root.querySelector("section.complex-card").getAttribute("aria-label"), "Glacier complex");
  assert.equal(text(root, ".card-area"), "83.3 km²");
  assert.deepEqual([...root.querySelectorAll(".row .row-label")].map((n) => n.firstChild.textContent),
    ["Region", "Subregion", "Central point", "UTM zone", "Glaciers"]);
  assert.ok(root.querySelector(".row .info"), "rows carry the catalog's descriptions");
  assert.deepEqual([...root.querySelectorAll("table.members th")].map((th) => th.textContent), ["Name", "RGI ID", "Area (km²)"]);
  assert.deepEqual(cells(root), [
    ["Grosser Aletsch Gletscher", "RGI2000-v7.0-G-11-02596", "81.8"],
    ["", "RGI2000-v7.0-G-11-00003", "1.50"],
  ]);
  assert.ok(root.querySelector(".members-scroll table.members"));
  assert.ok(root.querySelector("img.photo-crop"));
  assert.doesNotMatch(root.textContent, /Loading…|null|undefined/);
});

test("clicking a member opens that glacier", async () => {
  const { root, card, calls } = setup();
  await card.open(ID);
  await settle();
  click(button(root, "RGI2000-v7.0-G-11-00003"));
  assert.deepEqual(calls, [["glacier", "RGI2000-v7.0-G-11-00003"]]);
});

test("the actions report the complex", async () => {
  const { root, card, calls } = setup();
  await card.open(ID);
  click(button(root, "Use this data"));
  click(button(root, "Zoom to"));
  click(button(root, "Share"));
  click(root.querySelector(".card-close"));
  assert.deepEqual(calls, [
    ["use", { kind: "complex", rgiId: ID, o1region: "11" }],
    ["zoom", PROPS.bbox],
    "share",
    "close",
  ]);
  assert.equal(root.hidden, true);
});

test("a failed read says so", async () => {
  const { root, card } = setup({ read: async () => { throw new Error("offline"); } });
  await card.open(ID);
  await settle();
  assert.match(root.textContent, /The complex could not be read\./);
  assert.doesNotMatch(root.textContent, /Loading…/);
  assert.equal(text(root, ".card-title"), ID);
});

test("members without the index show their IDs", async () => {
  const bare = PROPS.glacier_ids.map((rgiId) => ({ rgiId, name: null, area: null }));
  const { root, card } = setup({ members: async () => bare });
  await card.open(ID);
  await settle();
  assert.deepEqual(cells(root), [
    ["", "RGI2000-v7.0-G-11-00003", ""],
    ["", "RGI2000-v7.0-G-11-02596", ""],
  ]);
});

test("a late read after close renders nothing", async () => {
  let finish;
  const { root, card } = setup({ read: () => new Promise((resolve) => (finish = resolve)) });
  const opening = card.open(ID);
  card.close();
  finish(PROPS);
  await opening;
  await settle();
  assert.equal(root.querySelector("section.complex-card").hidden, true);
  assert.equal(root.querySelectorAll(".row").length, 0);
});

test("on the phone the head goes to the band and hides when closed", async () => {
  const band = document.createElement("div");
  const { root, card } = setup({ band });
  await card.open(ID);
  assert.equal(text(band, ".card-title"), ID);
  assert.ok(button(band, "Use this data"));
  assert.equal(root.querySelector(".card-title"), null);
  card.close();
  for (const node of band.children) assert.equal(node.hidden, true);
});
