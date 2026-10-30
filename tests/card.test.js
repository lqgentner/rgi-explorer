/* The glacier card: header, Overview, tabs, reads and late results. */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

import * as hyparquet from "hyparquet";

import { loadPage, load, settle } from "./helpers/browser.js";

const { document, window } = await loadPage();
globalThis.hyparquet = hyparquet;
const { loadCatalog } = await load("js/catalog.js");
const { openParquet } = await load("js/parquet.js");
const { mountCard } = await load("js/card.js");

const ROOT = "https://data.source.coop/lqgentner/rgi/catalog.json";
const DIR = new URL("./fixtures/catalog/", import.meta.url);
const SCRIPT = fileURLToPath(new URL("../scripts/make_fixture_parquet.py", import.meta.url));
const catalog = await loadCatalog(ROOT, async (url) =>
  JSON.parse(fs.readFileSync(new URL(url.slice(ROOT.length - "catalog.json".length), DIR), "utf8")));

const IDS = ["RGI2000-v7.0-G-11-02596", "RGI2000-v7.0-G-11-00001", "RGI2000-v7.0-G-03-00002",
  "RGI2000-v7.0-G-11-00003", "RGI2000-v7.0-G-11-00004"];
const regions = [
  { level: 1, o1region: "11", o2region: null, full_name: "Central Europe" },
  { level: 1, o1region: "03", o2region: null, full_name: "Arctic Canada North" },
  { level: 2, o1region: "11", o2region: "11-01", full_name: "Alps" },
];
const OVERVIEW_PROPS = { rgi_id: IDS[0], display_name: "Grosser Aletsch Gletscher", area_km2: 81.78, zmed_m: 3152, surge_type: 0, term_type: 9, is_rgi6: false };

let dir;
let handle;
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "rgi-card-"));
  execFileSync("python", [SCRIPT, dir]);
  handle = await openParquet(await hyparquet.asyncBufferFromFile(path.join(dir, "glaciers.parquet")));
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

function setup(over = {}) {
  document.getElementById("card")?.remove();
  const root = document.createElement("div");
  root.id = "card";
  document.getElementById("sidebar").append(root);
  const calls = [];
  const rowOf = async (id) => (IDS.includes(id) ? IDS.indexOf(id) : null);
  const ctx = {
    catalog, regions,
    parquet: { handle, rowOf },
    photos: async () => [],
    onClose: () => calls.push("close"),
    onZoom: (x) => calls.push(["zoom", x]),
    onShare: () => calls.push("share"),
    onUseData: (g) => calls.push(["use", g.rgiId]),
    onAction: (a) => calls.push(["action", a]),
    ...over,
  };
  const card = mountCard(root, ctx);
  return { root, card, calls, ctx };
}
const text = (root, sel) => root.querySelector(sel)?.textContent;
const click = (node) => node.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
const rowOfLabel = (root, label) =>
  [...root.querySelectorAll(".row")].find((r) => r.querySelector(".row-label").firstChild.textContent === label);

test("a low-zoom click renders at once, then the attribute read fills the rows", async () => {
  const { root, card } = setup();
  const done = card.open({ rgiId: IDS[0], props: OVERVIEW_PROPS });
  assert.equal(text(root, ".card-title"), "Grosser Aletsch Gletscher");
  assert.equal(text(root, ".panel-hypsometry"), "Loading…");
  assert.equal(rowOfLabel(root, "Terminus type").querySelector(".row-value").textContent, "Not assigned");
  assert.equal(rowOfLabel(root, "UTM zone"), undefined);
  await done;
  assert.equal(rowOfLabel(root, "UTM zone").querySelector(".row-value").textContent, "32");
  assert.equal(rowOfLabel(root, "Region").querySelector(".row-value").textContent, "11 · Central Europe");
  assert.ok(root.querySelector(".panel-hypsometry svg"));
});

test("a title, subtitle and unnamed glacier", async () => {
  const named = setup();
  await named.card.open({ rgiId: IDS[0], props: { display_name: "Grosser Aletsch Gletscher", o1region: "11" } });
  assert.equal(text(named.root, ".card-subtitle"), `${IDS[0]} · Central Europe`);

  const bare = setup();
  await bare.card.open({ rgiId: IDS[4], props: {} });
  assert.equal(text(bare.root, ".card-title"), IDS[4]);
  assert.equal(text(bare.root, ".card-subtitle"), "Central Europe");
  assert.doesNotMatch(bare.root.textContent, /null|undefined/);
});

test("an unnamed glacier's title is its ID before any read", () => {
  const { root, card } = setup({ parquet: { handle, rowOf: () => new Promise(() => {}) } });
  card.open({ rgiId: IDS[4], props: { rgi_id: IDS[4], display_name: null, glac_name: "" } });
  assert.equal(text(root, ".card-title"), IDS[4]);
  assert.equal(text(root, ".card-subtitle"), "Central Europe");
});

test("a search pick reads the row and the attributes", async () => {
  const { root, card } = setup();
  await card.open({ rgiId: IDS[1], row: 1 });
  assert.equal(text(root, ".card-title"), "Morteratsch");
  assert.ok(rowOfLabel(root, "GLIMS ID"));
  assert.equal(rowOfLabel(root, "Region").querySelector(".row-value").textContent, "11 · Central Europe");
});

test("full tile properties skip the attribute read", async () => {
  const { ATTRIBUTE_COLUMNS } = await load("js/columns.js");
  const props = Object.fromEntries(ATTRIBUTE_COLUMNS.map((c) => [c, null]));
  Object.assign(props, { rgi_id: IDS[0], display_name: "From the tile" });
  const { root, card } = setup();
  await card.open({ rgiId: IDS[0], row: 0, props });
  assert.equal(text(root, ".card-title"), "From the tile", "tile values stay when nothing needs reading");
  assert.equal(rowOfLabel(root, "UTM zone"), undefined, "the attribute columns were not read");
  assert.ok(root.querySelector(".panel-hypsometry svg"), "the card columns still arrive");
});

test("a pick the index cannot place renders the props without an error", async () => {
  const { root, card } = setup({ parquet: { handle, rowOf: async () => null } });
  await card.open({ rgiId: "RGI2000-v7.0-G-99-99999", props: OVERVIEW_PROPS });
  assert.equal(text(root, ".card-title"), "Grosser Aletsch Gletscher");
  assert.doesNotMatch(root.textContent, /error|failed|Loading/i);
});

test("a late read for A is ignored after B opens", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const { root, card } = setup({
    parquet: { handle, rowOf: async (id) => { if (id === IDS[0]) await gate; return IDS.indexOf(id); } },
  });
  const a = card.open({ rgiId: IDS[0], props: { display_name: "A glacier" } });
  const b = card.open({ rgiId: IDS[1], props: { display_name: "B glacier" } });
  await b;
  release();
  await a;
  await settle();
  assert.equal(text(root, ".card-title"), "Morteratsch");
  assert.doesNotMatch(root.textContent, /A glacier|Aletsch/);
  assert.equal(rowOfLabel(root, "GLIMS ID").querySelector(".row-value").textContent, "G001000E46000N");
});

test("a photos call gets a signal that aborts on the next open and on close", async () => {
  const signals = [];
  const { card } = setup({ photos: async (g, signal) => { signals.push(signal); return []; } });
  await card.open({ rgiId: IDS[0], props: {} });
  await card.open({ rgiId: IDS[1], props: {} });
  assert.equal(signals[0].aborted, true);
  assert.equal(signals[1].aborted, false);
  card.close();
  assert.equal(signals[1].aborted, true);
});

test("a rejecting or throwing photos call leaves the card intact", async () => {
  for (const photos of [() => Promise.reject(new Error("down")), () => { throw new Error("sync"); }, () => new Promise(() => {})]) {
    const { root, card } = setup({ photos });
    await card.open({ rgiId: IDS[0], props: {} });
    await settle();
    assert.equal(text(root, ".card-title"), "Grosser Aletsch Gletscher");
    assert.ok(root.querySelector(".panel-hypsometry svg"));
  }
});

test("the buttons call the context", async () => {
  const { root, card, calls } = setup();
  await card.open({ rgiId: IDS[0], row: 0, props: OVERVIEW_PROPS });
  const button = (label) => [...root.querySelectorAll(".card-actions button")].find((b) => b.textContent === label);
  assert.ok(button("Use this data").classList.contains("primary"));
  click(button("Use this data"));
  click(button("Zoom to"));
  click(button("Share"));
  assert.deepEqual(calls[0], ["use", IDS[0]]);
  assert.equal(calls[1][1].xmin, 7.931361);
  assert.equal(calls[2], "share");
  click(root.querySelector('[aria-label="Close"]'));
  assert.equal(calls[3], "close");
  assert.equal(root.querySelector(".card").hidden, true);
});

test("Zoom to passes the props before the bbox arrives", () => {
  const { root, card, calls } = setup({ parquet: { handle, rowOf: () => new Promise(() => {}) } });
  card.open({ rgiId: IDS[0], props: { cenlon: 8, cenlat: 46 } });
  click([...root.querySelectorAll(".card-actions button")].find((b) => b.textContent === "Zoom to"));
  assert.deepEqual(calls[0][1], { cenlon: 8, cenlat: 46 });
});

test("tabs switch by click and arrow key and mark the selection", async () => {
  const { root, card } = setup();
  await card.open({ rgiId: IDS[0], row: 0, props: OVERVIEW_PROPS });
  const [overview, hypso] = root.querySelectorAll('[role="tab"]');
  assert.equal(root.querySelector('[role="tablist"]') !== null, true);
  assert.equal(overview.getAttribute("aria-selected"), "true");
  assert.equal(root.querySelector(".panel-hypsometry").hidden, true);
  overview.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  assert.equal(hypso.getAttribute("aria-selected"), "true");
  assert.equal(root.querySelector(".panel-overview").hidden, true);
  assert.equal(root.querySelector(".panel-hypsometry").hidden, false);
  hypso.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  assert.equal(overview.getAttribute("aria-selected"), "true");
  click(hypso);
  assert.equal(hypso.getAttribute("aria-selected"), "true");
  assert.equal(root.querySelectorAll('[role="tabpanel"]').length, 2);
});

test("the ⓘ shows the column description verbatim", async () => {
  const { root, card } = setup();
  await card.open({ rgiId: IDS[0], row: 0, props: OVERVIEW_PROPS });
  const row = rowOfLabel(root, "Primary class");
  const info = row.querySelector("button.info");
  assert.equal(info.getAttribute("aria-label"), "About Primary class");
  const popover = row.querySelector(".popover");
  assert.equal(popover.hidden, true);
  click(info);
  assert.equal(popover.hidden, false);
  assert.equal(popover.textContent, catalog.columns.get("primeclass").description);
  click(info);
  assert.equal(popover.hidden, true);
});

test("the GLIMS ID links to the GLIMS page", async () => {
  const { root, card } = setup();
  await card.open({ rgiId: IDS[0], row: 0 });
  const link = rowOfLabel(root, "GLIMS ID").querySelector("a");
  assert.equal(link.href, "https://www.glims.org/maps/info.html?anlys_id=753957");
  assert.equal(link.textContent, "G008032E46504N");
});

test("+ N more expands the RGI 6.0 overlaps in place", async () => {
  const { root, card } = setup();
  const links = ["A", "B", "C", "D", "E"].map((id) => ({ rgi6_id: id }));
  await card.open({ rgiId: IDS[3], row: 3 });
  assert.equal(rowOfLabel(root, "RGI 6.0 overlaps").querySelectorAll(".link-id").length, 2);
  const big = setup({ parquet: { handle, rowOf: async () => null } });
  await big.card.open({ rgiId: IDS[0], props: { rgi6_links: links } });
  const rowBig = () => rowOfLabel(big.root, "RGI 6.0 overlaps");
  assert.equal(rowBig().querySelectorAll(".link-id").length, 3);
  const more = rowBig().querySelector("button.more-links");
  assert.equal(more.textContent, "+ 2 more");
  click(more);
  assert.deepEqual([...rowBig().querySelectorAll(".link-id")].map((n) => n.textContent), links.map((l) => l.rgi6_id));
  assert.equal(rowBig().querySelector("button.more-links"), null);
});

test("the Greenland connection shows only in region 05", async () => {
  const label = "Greenland ice sheet connection";
  const a = setup({ parquet: { handle, rowOf: async () => null } });
  await a.card.open({ rgiId: IDS[0], props: { o1region: "11", conn_lvl: 0 } });
  assert.equal(rowOfLabel(a.root, label), undefined);
  const b = setup({ parquet: { handle, rowOf: async () => null } });
  await b.card.open({ rgiId: IDS[0], props: { o1region: "05", conn_lvl: 1 } });
  assert.equal(rowOfLabel(b.root, label).querySelector(".row-value").textContent, "Weak connection");
});

test("Submission starts collapsed and the IDs stay hidden until show more", async () => {
  const { root, card } = setup();
  await card.open({ rgiId: IDS[0], row: 0 });
  const details = root.querySelector("details.group-submission");
  assert.equal(details.open, false);
  const ids = ["Analysis ID", "Submission ID", "Regional center ID"].map((l) => rowOfLabel(root, l));
  assert.ok(ids.every((r) => r.hidden));
  assert.equal(rowOfLabel(root, "Analysts").hidden, false);
  click(root.querySelector("button.show-more"));
  assert.ok(["Analysis ID", "Submission ID", "Regional center ID"].every((l) => !rowOfLabel(root, l).hidden));
});

test("the terminus and complex rows call onAction", async () => {
  const { root, card, calls } = setup();
  await card.open({ rgiId: IDS[0], row: 0 });
  click(rowOfLabel(root, "Terminus point").querySelector("button.link"));
  click(rowOfLabel(root, "Glacier complex").querySelector("button.link"));
  assert.equal(calls[0][1].type, "pin");
  assert.deepEqual(calls[1][1], { type: "complex", id: "RGI2000-v7.0-C-11-01323" });
});

test("the card column rises above the status line and the search above the card", () => {
  const css = fs.readFileSync(new URL("../style.css", import.meta.url), "utf8");
  const z = (sel) => Number(new RegExp(`${sel}\\s*{[^}]*z-index:\\s*(\\d+)`).exec(css)[1]);
  assert.ok(z("#card") > z("#status"));
  assert.ok(z("#search") > z("#card"));
  assert.match(css, /--card-w:\s*408px/);
  assert.match(css, /#card\s*{[^}]*width:\s*var\(--card-w\)/);
});

test("the search and the layer control sit outside the card container", () => {
  const page = new window.DOMParser().parseFromString(
    fs.readFileSync(new URL("../index.html", import.meta.url), "utf8"), "text/html");
  const card = page.getElementById("card");
  assert.ok(card && page.getElementById("sidebar").contains(card));
  assert.equal(card.contains(page.getElementById("search")), false);
  assert.equal(card.contains(page.getElementById("layers")), false);
  assert.equal(page.getElementById("sidebar").contains(page.getElementById("layers")), false);
});

test("the sidebar is hidden until a glacier opens and again after close", async () => {
  const { root, card } = setup();
  assert.equal(root.hidden, true);
  await card.open({ rgiId: IDS[0], props: {} });
  assert.equal(root.hidden, false);
  card.close();
  assert.equal(root.hidden, true);
  await card.open({ rgiId: IDS[0], props: {} });
  click(root.querySelector('[aria-label="Close"]'));
  assert.equal(root.hidden, true);
});

/** A handle of one-row groups whose reads `rows(rowStart)` answers, possibly late. */
async function fakeHandle(count, rows) {
  const real = globalThis.hyparquet;
  globalThis.hyparquet = {
    ...real,
    parquetMetadataAsync: async () => ({ row_groups: Array.from({ length: count }, () => ({ num_rows: 1n })) }),
    parquetReadObjects: async ({ rowStart }) => [await rows(rowStart)],
  };
  try {
    return await openParquet({});
  } finally {
    globalThis.hyparquet = real;
  }
}

test("null or empty hypsometry settles on a message, not Loading", async () => {
  for (const hypso of [{ hypso_permille: null, hypso_z0_m: null }, { hypso_permille: [], hypso_z0_m: 1000 }]) {
    const real = globalThis.hyparquet;
    const h = await fakeHandle(1, async () => ({}));
    globalThis.hyparquet = { ...real, parquetReadObjects: async () => [{ ...hypso, bbox: null, rgi6_links: null }] };
    try {
      const { root, card } = setup({ parquet: { handle: h, rowOf: async () => 0 } });
      await card.open({ rgiId: IDS[0], row: 0, props: { display_name: "X" } });
      assert.equal(text(root, ".panel-hypsometry"), "No hypsometry data.");
      assert.equal(root.querySelector(".panel-hypsometry svg"), null);
    } finally {
      globalThis.hyparquet = real;
    }
  }
  const { root, card } = setup({ parquet: { handle, rowOf: async () => null } });
  await card.open({ rgiId: IDS[0], props: { hypso_permille: [], hypso_z0_m: 1000 } });
  assert.equal(text(root, ".panel-hypsometry"), "No hypsometry data.");
});

test("a late readRow for A is ignored after B opens", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const names = ["Late A", "Prompt B"];
  const read = async ({ rowStart }) => {
    if (rowStart === 0) await gate;
    return [{ display_name: names[rowStart], hypso_permille: [1, 2], hypso_z0_m: 1000 }];
  };
  const real = globalThis.hyparquet;
  globalThis.hyparquet = { ...real, parquetReadObjects: read };
  try {
    const h = await fakeHandle(2, async () => ({}));
    const { root, card } = setup({ parquet: { handle: h, rowOf: async () => null } });
    const a = card.open({ rgiId: IDS[0], row: 0, props: {} });
    await card.open({ rgiId: IDS[1], row: 1, props: {} });
    assert.equal(text(root, ".card-title"), "Prompt B");
    release();
    await a;
    await settle();
    assert.equal(text(root, ".card-title"), "Prompt B");
    assert.doesNotMatch(root.textContent, /Late A/);
  } finally {
    globalThis.hyparquet = real;
  }
});

test("with a band, the header and actions sit in the band and the photo and tabs in the root", async () => {
  const band = document.createElement("div");
  const { root, card } = setup({ band });
  await card.open({ rgiId: IDS[0], props: OVERVIEW_PROPS });
  assert.equal(text(band, ".card-title"), "Grosser Aletsch Gletscher");
  assert.equal(text(band, ".card-area"), "81.8 km²");
  assert.ok([...band.querySelectorAll("button")].some((b) => b.textContent === "Use this data"));
  assert.ok(band.querySelector(".card-close"));
  assert.equal(root.querySelector(".card-title"), null);
  assert.ok(root.querySelector(".photo"));
  assert.ok(root.querySelector("[role=tablist]"));
  card.close();
  assert.equal(root.hidden, true);
});

test("the header names the area when it is known, and nothing when it is not", async () => {
  const { root, card } = setup();
  await card.open({ rgiId: IDS[0], props: OVERVIEW_PROPS });
  assert.equal(text(root, ".card-area"), "81.8 km²");
  const bare = setup({ parquet: { handle, rowOf: async () => null } });
  await bare.card.open({ rgiId: IDS[4], props: {} });
  assert.equal(bare.root.querySelector(".card-area"), null);
});
