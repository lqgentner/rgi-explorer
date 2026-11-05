/* The glacier card: header, Overview, tabs, reads and late results. */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { before, test } from "node:test";

import * as hyparquet from "hyparquet";

import { loadPage, load, settle } from "./helpers/browser.js";
import { fixtureCatalog, PARQUET_DIR } from "./helpers/served.js";

const { document, window, setPhone } = await loadPage();
globalThis.hyparquet = hyparquet;
const { loadCatalog } = await load("js/catalog.js");
const { openParquet } = await load("js/parquet.js");
const { mountCard } = await load("js/card.js");

const catalog = await fixtureCatalog(loadCatalog);

const IDS = ["RGI2000-v7.0-G-11-02596", "RGI2000-v7.0-G-11-00001", "RGI2000-v7.0-G-03-00002",
  "RGI2000-v7.0-G-11-00003", "RGI2000-v7.0-G-11-00004"];
const regions = [
  { level: 1, o1region: "11", o2region: null, full_name: "Central Europe" },
  { level: 1, o1region: "03", o2region: null, full_name: "Arctic Canada North" },
  { level: 2, o1region: "11", o2region: "11-01", full_name: "Alps" },
];
const OVERVIEW_PROPS = { rgi_id: IDS[0], display_name: "Grosser Aletsch Gletscher", area_km2: 81.78, zmed_m: 3152, surge_type: 0, term_type: 9, is_rgi6: false };

let handle;
before(async () => {
  handle = await openParquet(await hyparquet.asyncBufferFromFile(path.join(PARQUET_DIR, "glaciers.parquet")));
});

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
/* The subtitle's rows: the kind and the region, then the ID of a named glacier. */
const rows = (root) => [...root.querySelectorAll(".card-subtitle > span")].map((n) => n.textContent);

/** Run `fn` with the page on a phone, then back on desktop. */
async function onPhone(fn) {
  setPhone(true);
  try {
    await fn();
  } finally {
    setPhone(false);
  }
}
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

test("a caption sits above the chart, without an info button", async () => {
  const { root, card } = setup();
  await card.open({ rgiId: IDS[0], row: 0 });
  const panel = root.querySelector(".panel-hypsometry");
  const caption = panel.querySelector(".hypso-caption");
  assert.equal(caption.textContent, "Share of the glacier's area in each 50 m elevation band.");
  assert.ok(caption.compareDocumentPosition(panel.querySelector("svg")) & window.Node.DOCUMENT_POSITION_FOLLOWING);
  assert.equal(panel.querySelector("button.info, .popover"), null);
});

test("no caption while the hypsometry loads or when there is none", async () => {
  const { root, card } = setup();
  const done = card.open({ rgiId: IDS[0], props: OVERVIEW_PROPS });
  assert.equal(root.querySelector(".hypso-caption"), null);
  await done;
  assert.ok(root.querySelector(".hypso-caption"));
});

test("a title, subtitle and unnamed glacier", async () => {
  const named = setup();
  await named.card.open({ rgiId: IDS[0], props: { display_name: "Grosser Aletsch Gletscher", o1region: "11" } });
  assert.deepEqual(rows(named.root), ["Glacier · Central Europe", IDS[0]], "two rows, whatever the region's length");

  const bare = setup();
  await bare.card.open({ rgiId: IDS[4], props: {} });
  assert.equal(text(bare.root, ".card-title"), IDS[4]);
  assert.deepEqual(rows(bare.root), ["Glacier · Central Europe"], "the title is the ID, so one row");
  assert.doesNotMatch(bare.root.textContent, /null|undefined/);
});

test("a glac_name is no title: a glacier without a display_name shows its ID", async () => {
  const { root, card } = setup({ parquet: { handle, rowOf: () => new Promise(() => {}) } });
  card.open({ rgiId: IDS[4], props: { rgi_id: IDS[4], display_name: null, glac_name: "Unnamed_23", o1region: "11" } });
  assert.equal(text(root, ".card-title"), IDS[4]);
  assert.equal(text(root, ".card-subtitle"), "Glacier · Central Europe");
});

test("an unnamed glacier's title is its ID before any read", () => {
  const { root, card } = setup({ parquet: { handle, rowOf: () => new Promise(() => {}) } });
  card.open({ rgiId: IDS[4], props: { rgi_id: IDS[4], display_name: null, glac_name: "" } });
  assert.equal(text(root, ".card-title"), IDS[4]);
  assert.equal(text(root, ".card-subtitle"), "Glacier · Central Europe");
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
  const glyph = (label) => button(label).querySelector("use").getAttribute("href").split("#")[1];
  assert.deepEqual(["Use this data", "Zoom to", "Share"].map(glyph), ["database", "scan-search", "share-2"]);
  for (const label of ["Use this data", "Zoom to", "Share"]) assert.equal(button(label).firstChild.tagName, "svg", "the icon leads");
  click(button("Use this data"));
  click(button("Zoom to"));
  click(button("Share"));
  assert.deepEqual(calls[0], ["use", IDS[0]]);
  assert.equal(calls[1][1].xmin, 7.931361);
  assert.equal(calls[2], "share");
  assert.equal(root.querySelector('[aria-label="Close"]'), null, "without a band, the search bar's Close closes the card");
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

test("the info button shows the column description verbatim", async () => {
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
  assert.equal(link.target, "_blank");
  assert.ok(link.querySelector("svg.icon use").getAttribute("href").endsWith("#external-link"), "an icon marks the new tab");
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
  assert.equal(document.activeElement.textContent, "D", "the first revealed ID takes the focus");
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

test("Submission starts collapsed and, open, shows every row with no show more", async () => {
  const { root, card } = setup();
  await card.open({ rgiId: IDS[0], row: 0 });
  const details = root.querySelector("details.group-submission");
  assert.equal(details.open, false);
  const labels = ["Analysts", "Analysis ID", "Submission ID", "Regional center ID"];
  assert.ok(labels.every((l) => !rowOfLabel(root, l).hidden), "the collapsed group hides nothing more");
  assert.equal(root.querySelector(".group-submission .show-more"), null);
  details.open = true;
  details.dispatchEvent(new window.Event("toggle"));
  assert.ok(labels.every((l) => !rowOfLabel(root, l).hidden));
  assert.equal(root.querySelector(".show-more"), null, "no group has a show more of its own");
});

test("show more in another group reveals that group's rows only", async () => {
  const { DISPLAY } = await load("js/columns.js");
  const entries = ["utm_zone", "dem_source"].map((column) => DISPLAY.find((d) => d.column === column));
  for (const entry of entries) entry.more = true;
  try {
    const { root, card } = setup();
    await card.open({ rgiId: IDS[0], row: 0 });
    const toggle = (group) => root.querySelector(`.group-${group} button.show-more`);
    assert.ok(rowOfLabel(root, "UTM zone").hidden && rowOfLabel(root, "Topography DEM").hidden);
    assert.equal(toggle("location").textContent, "show more");
    click(toggle("location"));
    assert.equal(rowOfLabel(root, "UTM zone").hidden, false);
    assert.equal(rowOfLabel(root, "Topography DEM").hidden, true, "the outline group stays as it was");
    assert.equal(document.activeElement, toggle("location"), "the focus stays on the toggle");
    assert.equal(toggle("location").textContent, "show less");
    assert.equal(toggle("outline").textContent, "show more");
    assert.equal(root.querySelector(".group-submission .show-more"), null);
    click(toggle("location"));
    assert.equal(rowOfLabel(root, "UTM zone").hidden, true);
  } finally {
    for (const entry of entries) delete entry.more;
  }
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
  assert.match(css, /#card\s*{[^}]*width:\s*var\(--sidebar-w\)/);
  assert.match(css, /#card\s*{[^}]*scrollbar-gutter:\s*stable/);
});

test("the sidebar's scrollbar gutter is clear, so the map shows there and only the thumb floats over it", () => {
  const css = fs.readFileSync(new URL("../style.css", import.meta.url), "utf8");
  const sidebar = /\n#card \{([^}]*)\}/.exec(css)[1];
  assert.doesNotMatch(sidebar, /background|box-shadow/, "a white scroller paints its gutter white");
  assert.match(sidebar, /scrollbar-color: var\(--image-placeholder\) transparent;/);
  const panel = /\n#card > \.card \{([^}]*)\}/.exec(css)[1];
  assert.match(panel, /background: var\(--surface\);/);
  assert.match(panel, /box-shadow: var\(--shadow\);/);
  assert.match(panel, /min-height: 100%;/, "white to the foot of the sidebar, however short the panel");
  assert.match(panel, /box-sizing: border-box;/, "its bottom padding inside that height, so a short panel does not scroll");
});

test("the buttons take the outer radius, the tiles and table the tile radius, and the ⓘ sits concentric", () => {
  const css = fs.readFileSync(new URL("../style.css", import.meta.url), "utf8");
  const rule = (sel) => new RegExp(`(^|\\n)${sel}\\s*{([^}]*)}`).exec(css)?.[2] ?? "";
  assert.match(css, /--radius:\s*16px/);
  assert.match(css, /--tile-radius:\s*12px/);
  assert.match(rule("\\.btn"), /border-radius:\s*var\(--radius\)/);
  for (const sel of ["\\.key-tile", "\\.members-scroll"]) assert.match(rule(sel), /border-radius:\s*var\(--tile-radius\)/, sel);
  const info = rule("\\.key-tile \\.info");
  for (const side of ["right", "bottom"]) assert.match(info, new RegExp(`${side}:\\s*calc\\(var\\(--tile-radius\\) - 1px - 7px\\)`), side);
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

test("on the phone, with a band, the header and actions sit in the band and the photo and tabs in the sheet", () => onPhone(async () => {
  const band = document.createElement("div");
  const sheet = document.createElement("div");
  const { root, card, calls } = setup({ band, sheet });
  await card.open({ rgiId: IDS[0], props: OVERVIEW_PROPS });
  assert.equal(text(band, ".card-title"), "Grosser Aletsch Gletscher");
  assert.ok([...band.querySelectorAll("button")].some((b) => b.textContent === "Use this data"));
  assert.ok(band.querySelector(".card-close"));
  assert.equal(sheet.querySelector(".card-title"), null);
  assert.ok(sheet.querySelector(".photo"));
  assert.ok(sheet.querySelector("[role=tablist]"));
  assert.equal(root.children.length, 0, "the sidebar stays empty");
  card.close();
  assert.equal(sheet.hidden, true);
  for (const node of band.children) assert.equal(node.hidden, true, "a closed card leaves the band to the other panel");
  await card.open({ rgiId: IDS[0], props: OVERVIEW_PROPS });
  for (const node of band.children) assert.equal(node.hidden, false);
  click(band.querySelector(".card-close"));
  assert.equal(calls.at(-1), "close");
}));

test("a change of layout moves an open card between the sidebar and the sheet", async () => {
  const band = document.createElement("div");
  const sheet = document.createElement("div");
  const { root, card } = setup({ band, sheet });
  await card.open({ rgiId: IDS[0], props: OVERVIEW_PROPS });
  const section = root.querySelector("section");
  assert.equal(text(root, ".card-title"), "Grosser Aletsch Gletscher");
  assert.equal(band.children.length, 0);

  await onPhone(() => {
    assert.equal(section.parentElement, sheet);
    assert.equal(sheet.hidden, false);
    assert.equal(root.hidden, true);
    assert.equal(text(band, ".card-title"), "Grosser Aletsch Gletscher");
    assert.ok(band.querySelector(".card-close"));
    assert.ok(!band.querySelector(".card-close").hidden);
    assert.equal(section.querySelector(".card-head"), null);
  });

  assert.equal(section.parentElement, root);
  assert.equal(root.hidden, false);
  assert.equal(sheet.hidden, true);
  assert.equal(section.querySelector(".photo").nextElementSibling.className, "card-head", "the header sits under the photo again");
  assert.equal(band.querySelector(".card-close"), null, "the search bar's Close closes the card on desktop");
});

test("the header leaves the area to the overview", async () => {
  const { root, card } = setup();
  await card.open({ rgiId: IDS[0], props: OVERVIEW_PROPS });
  assert.equal(root.querySelector(".card-head").textContent.includes("km²"), false);
  assert.ok([...root.querySelectorAll(".key-tile")].some((tile) => tile.textContent.includes("81.8 km²")));
});

/* The image strip: the imagery first, then the photos. */

const BBOX = { xmin: 7.93, ymin: 46.39, xmax: 8.08, ymax: 46.56 };
const PHOTO = (n, extra = {}) => ({
  src: `https://thumb.wikimedia.org/${n}.jpg`, file: `${n}.jpg`, page: `https://commons.wikimedia.org/wiki/File:${n}.jpg`,
  author: `Author ${n}`, license: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
  source: `Wikidata Q${n} · P18`, ...extra,
});
const PHOTOS = [PHOTO(1), PHOTO(2)];
const WITH_BBOX = { ...OVERVIEW_PROPS, bbox: BBOX };
const tilesOf = (root) => [...root.querySelectorAll(".strip-tile")];
const counts = (root) => [...root.querySelectorAll(".photo-count")].map((n) => n.textContent);

test("the imagery is the first image and keeps its element when photos arrive", async () => {
  let resolve;
  const { root, card } = setup({ photos: () => new Promise((r) => { resolve = r; }) });
  card.open({ rgiId: IDS[0], props: WITH_BBOX });
  const crop = root.querySelector(".strip-tile img.photo-crop");
  assert.ok(crop);
  resolve(PHOTOS);
  await settle();
  assert.equal(tilesOf(root)[0].querySelector("img"), crop);
  assert.equal(tilesOf(root).length, 3);
  assert.deepEqual(counts(root), ["1 / 3", "2 / 3", "3 / 3"]);
});

test("a photo credits its author linked to Commons and its license linked to its deed", async () => {
  const { root, card } = setup({ photos: async () => PHOTOS });
  await card.open({ rgiId: IDS[0], props: WITH_BBOX });
  await settle();
  const credit = tilesOf(root)[1].querySelector(".photo-credit");
  const author = credit.querySelector(".credit-author a");
  assert.equal(author.getAttribute("href"), PHOTOS[0].page);
  assert.equal(author.textContent, PHOTOS[0].author);
  const license = [...credit.querySelectorAll("a")].find((a) => a !== author);
  assert.equal(license.getAttribute("href"), PHOTOS[0].licenseUrl);
  assert.equal(license.textContent, PHOTOS[0].license);
  assert.equal(credit.textContent, `${PHOTOS[0].author} · ${PHOTOS[0].license}`);
});

test("a photo without an author credits its license alone", async () => {
  const { root, card } = setup({ photos: async () => [PHOTO(1, { author: "" })] });
  await card.open({ rgiId: IDS[0], props: WITH_BBOX });
  await settle();
  assert.equal(tilesOf(root)[1].querySelector(".photo-credit").textContent, "CC BY-SA 4.0");
});

test("a failed crop with photos leaves the photos; without photos the placeholder shows", async () => {
  const withPhotos = setup({ photos: async () => PHOTOS });
  await withPhotos.card.open({ rgiId: IDS[0], props: WITH_BBOX });
  await settle();
  withPhotos.root.querySelector("img.photo-crop").dispatchEvent(new window.Event("error"));
  assert.equal(withPhotos.root.querySelector(".photo-crop"), null);
  assert.equal(tilesOf(withPhotos.root).length, 2);
  assert.equal(withPhotos.root.querySelector(".photo-placeholder"), null);

  const without = setup();
  await without.card.open({ rgiId: IDS[0], props: WITH_BBOX });
  await settle();
  without.root.querySelector("img.photo-crop").dispatchEvent(new window.Event("error"));
  assert.equal(tilesOf(without.root).length, 0);
  assert.ok(without.root.querySelector(".photo-placeholder"));
});

test("a photo whose thumbnail fails drops out and the rest recount", async () => {
  const { root, card } = setup({ photos: async () => PHOTOS });
  await card.open({ rgiId: IDS[0], props: WITH_BBOX });
  await settle();
  tilesOf(root)[1].querySelector("img").dispatchEvent(new window.Event("error"));
  assert.equal(tilesOf(root).length, 2);
  assert.deepEqual(counts(root), ["1 / 2", "2 / 2"]);
});

test("a new glacier starts at its first image", async () => {
  const { root, card } = setup({ photos: async () => PHOTOS });
  await card.open({ rgiId: IDS[0], props: WITH_BBOX });
  await settle();
  click(root.querySelector(".photo-next"));
  click(root.querySelector(".photo-next"));
  assert.equal(root.querySelector(".photo-prev").hidden, false);
  await card.open({ rgiId: IDS[1], props: { ...WITH_BBOX, rgi_id: IDS[1] } });
  await settle();
  assert.equal(root.querySelector(".photo-prev").hidden, true);
});

test("a change of layout re-frames the crop in the same image", async () => {
  let phone = false;
  const { root, card, ctx } = setup();
  Object.defineProperty(ctx, "crop", { get: () => (phone ? { size: [720, 360], top: 0 } : { size: [816, 560], top: 144 }) });
  await card.open({ rgiId: IDS[0], props: WITH_BBOX });
  const crop = root.querySelector("img.photo-crop");
  assert.match(crop.getAttribute("src"), /size=816,560/);
  phone = true;
  await onPhone(() => {
    assert.equal(root.querySelector("img.photo-crop"), crop);
    assert.match(crop.getAttribute("src"), /size=720,360/);
  });
  phone = false;
  card.close();
});

test("the desktop arrows are centred between the search bar and the credit row", () => {
  const css = fs.readFileSync(new URL("../style.css", import.meta.url), "utf8");
  /* Every top-level rule for `sel`, joined: #search has two. */
  const rule = (sel) => [...css.matchAll(new RegExp(`(^|\\n)${sel}\\s*{([^}]*)}`, "g"))].map((m) => m[2]).join("\n");
  assert.match(rule("#search"), /top:\s*var\(--search-top\)/);
  assert.match(rule("#search input"), /height:\s*var\(--search-h\)/);
  const top = /top:\s*(calc\([^;]*\));/.exec(rule("\\.photo-prev,\\n\\.photo-next"))?.[1] ?? "";
  for (const name of ["--search-top", "--search-h", "--photo-h", "--credit-inset", "--credit-row"]) {
    assert.ok(top.includes(`var(${name})`), `${name} in ${top}`);
  }
});

test("a click on an image opens the viewer there, and closing shows that image in the strip", async () => {
  const { root, card } = setup({ photos: async () => PHOTOS });
  await card.open({ rgiId: IDS[0], props: WITH_BBOX });
  await settle();
  const opener = tilesOf(root)[1].querySelector(".strip-open");
  opener.focus();
  click(opener);
  const viewer = document.querySelector("dialog.viewer");
  assert.ok(viewer.open || viewer.hasAttribute("open"));
  assert.equal(viewer.querySelector(".viewer-dock .viewer-count").textContent, "2 / 3");
  assert.equal(viewer.querySelector(".viewer-slide.current .viewer-image").getAttribute("src"), PHOTOS[0].src, "the strip's thumbnail stands in");
  const credit = viewer.querySelector(".viewer-dock .viewer-credit");
  assert.match(credit.textContent, /Author 1/);
  assert.match(credit.textContent, /Wikidata Q1 · P18/);
  assert.equal(credit.querySelector(`a[href="${PHOTOS[0].page}"]`)?.textContent, "View on Commons");
  viewer.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  viewer.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(root.querySelector(".photo-next").hidden, true, "the strip shows the third image");
  assert.equal(document.activeElement, tilesOf(root)[2].querySelector(".strip-open"), "focus lands on the image closed on");
  card.close();
});

test("a new glacier's crop is a new image, so the last glacier's imagery never shows under its title", async () => {
  const { root, card } = setup();
  await card.open({ rgiId: IDS[0], props: WITH_BBOX });
  const first = root.querySelector("img.photo-crop");
  await card.open({ rgiId: IDS[1], props: { ...WITH_BBOX, rgi_id: IDS[1], bbox: { xmin: 1, ymin: 2, xmax: 3, ymax: 4 } } });
  const second = root.querySelector("img.photo-crop");
  assert.notEqual(second, first);
  first.dispatchEvent(new window.Event("error"));
  assert.ok(root.querySelector("img.photo-crop"), "a late error from the old crop changes nothing");
  card.close();
});

test("a tile's keyboard ring is drawn inside it, and the desktop arrows hide only where there is hover", () => {
  const css = fs.readFileSync(new URL("../style.css", import.meta.url), "utf8");
  assert.match(css, /\.strip-open:focus-visible\s*{[^}]*outline-offset:\s*-\d+px/);
  const hover = [...css.matchAll(/@media \(hover: hover\)\s*{([\s\S]*?)\n}/g)].map((m) => m[1]).join("\n");
  assert.match(hover, /\.photo-prev,\s*\.photo-next\s*{[^}]*opacity:\s*0/, "the fade is for pointers that hover");
  const base = /(^|\n)\.photo-prev,\n\.photo-next\s*{([^}]*)}/.exec(css)?.[2] ?? "";
  assert.doesNotMatch(base, /opacity:\s*0/, "without hover the arrows stay visible");
});

test("the imagery's viewer item is the glacier at 3:2, the same on every screen", async () => {
  const { imageryViewerItem } = await load("js/card.js");
  const { esriCrop } = await load("js/photo.js");
  const item = imageryViewerItem(BBOX, "Satellite imagery of the glacier");
  assert.equal(item.large(), esriCrop(BBOX, 1200, 800, 0));
  assert.equal(item.ratio, 1.5, "known before it loads, for the viewer's placeholder");
  await onPhone(() => assert.equal(item.large(), esriCrop(BBOX, 1200, 800, 0)));
});

test("the subtitle's rows are blocks, so the ID always starts the second row", () => {
  const css = fs.readFileSync(new URL("../style.css", import.meta.url), "utf8");
  assert.match(css, /\.card-subtitle > span\s*\{\s*display:\s*block;/);
});
