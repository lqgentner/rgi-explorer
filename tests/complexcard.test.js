/* The complex panel: header, rows, the member table, actions and late reads. */

import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

import { loadPage, load, settle } from "./helpers/browser.js";

const { document, window, setPhone } = await loadPage();
const { loadCatalog } = await load("js/catalog.js");
const { mountComplexCard } = await load("js/complexcard.js");

const ROOT = "https://data.source.coop/lqgentner/rgi/catalog.json";
const DIR = new URL("./fixtures/catalog/", import.meta.url);
const catalog = await loadCatalog(ROOT, async (url) =>
  JSON.parse(fs.readFileSync(new URL(url.slice(ROOT.length - "catalog.json".length), DIR), "utf8")));
/** Run `fn` with the page on a phone, then back on desktop. */
async function onPhone(fn) {
  setPhone(true);
  try {
    await fn();
  } finally {
    setPhone(false);
  }
}

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
  assert.equal(root.querySelector(".card-head").textContent.includes("km²"), false, "the area is a fact, not a header line");
  assert.deepEqual([...root.querySelectorAll(".key-tile")].map((n) => [n.querySelector(".row-label").firstChild.textContent, n.querySelector(".key-value").textContent]),
    [["Area", "83.3 km²"], ["Glaciers", "2"]], "the key numbers sit in tiles, as on the glacier card");
  assert.equal(text(root, ".group-location h3"), "Location");
  assert.deepEqual([...root.querySelectorAll(".group-location .row .row-label")].map((n) => n.firstChild.textContent),
    ["Region", "Subregion", "Central point", "UTM zone"]);
  assert.ok(root.querySelector(".row .info"), "rows carry the catalog's descriptions");
  const lines = (node) => [...node.childNodes].map((n) => (n.nodeName === "BR" ? "\n" : n.textContent)).join("");
  assert.deepEqual([...root.querySelectorAll("table.members th")].map(lines), ["Name", "RGI ID", "Area\nkm²"],
    "the unit sits on a second header line, so the area column stays narrow");
  const name = root.querySelector("table.members tbody td.name");
  assert.equal(name.title, "Grosser Aletsch Gletscher", "a name cut short with … keeps its full text on hover");
  assert.equal(root.querySelectorAll("table.members colgroup col").length, 3);
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
  assert.deepEqual(calls, [
    ["use", { kind: "complex", rgiId: ID, o1region: "11" }],
    ["zoom", PROPS.bbox],
    "share",
  ]);
  assert.equal(root.querySelector(".card-close"), null, "without a band, the search bar's Close closes the panel");
});

test("on the phone, with a band, the panel's Close reports the close", () => onPhone(async () => {
  const band = document.createElement("div");
  const { card, calls } = setup({ band });
  await card.open(ID);
  click(band.querySelector(".card-close"));
  assert.deepEqual(calls, ["close"]);
}));

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

test("on the phone the head goes to the band and hides when closed", () => onPhone(async () => {
  const band = document.createElement("div");
  const { root, card } = setup({ band });
  await card.open(ID);
  assert.equal(text(band, ".card-title"), ID);
  assert.ok(button(band, "Use this data"));
  assert.equal(root.querySelector(".card-title"), null);
  card.close();
  for (const node of band.children) assert.equal(node.hidden, true);
}));

test("the panel last opened in the sidebar is the one that stays drawn while it slides out", async () => {
  const { mountCard } = await load("js/card.js");
  const { root, card } = setup();
  const glacier = mountCard(root, { catalog, regions, parquet: { rowOf: async () => null }, photos: async () => [] });
  await glacier.open({ rgiId: "RGI2000-v7.0-G-11-02596", props: {} });
  const [glacierSection, complexSection] = [root.querySelector("section.card:not(.complex-card)"), root.querySelector("section.complex-card")];
  assert.ok(glacierSection.classList.contains("current"));
  glacier.close();
  await card.open(ID);
  assert.deepEqual([glacierSection.classList.contains("current"), complexSection.classList.contains("current")], [false, true]);
  card.close();
  assert.ok(complexSection.classList.contains("current"), "the closed panel keeps the slide-out");

  const css = fs.readFileSync(new URL("../style.css", import.meta.url), "utf8");
  assert.match(css, /#card\[hidden\] > \.card\.current\[hidden\]\s*\{\s*display: block !important;/);
  assert.doesNotMatch(css, /#card > \.card\[hidden\]/, "a replaced panel is not drawn under the open one");
});

test("the member table fits its box: fixed columns and names cut with an ellipsis", () => {
  const css = fs.readFileSync(new URL("../style.css", import.meta.url), "utf8");
  const rule = (selector) => new RegExp(`(^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(css)?.[2] ?? "";
  assert.match(rule("table.members"), /table-layout:\s*fixed/);
  const cell = rule("table.members td.name");
  for (const declaration of [/overflow:\s*hidden/, /text-overflow:\s*ellipsis/, /white-space:\s*nowrap/]) assert.match(cell, declaration);
});

test("the complex shows its crop as one image with no counter or arrows", async () => {
  const { root, card } = setup();
  await card.open(ID);
  await settle();
  assert.equal(root.querySelectorAll(".strip-tile").length, 1);
  assert.ok(root.querySelector(".strip-tile img.photo-crop"));
  assert.equal(root.querySelector(".photo-count"), null);
  assert.equal(root.querySelector(".photo-prev").hidden, true);
  assert.equal(root.querySelector(".photo-next").hidden, true);
});
