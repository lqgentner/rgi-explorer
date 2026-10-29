import assert from "node:assert/strict";
import fs from "node:fs";
import test, { mock } from "node:test";

import { loadPage } from "./helpers/browser.js";

const { document } = await loadPage();
const { buildGlacierIndex } = await import("../js/search.js");
const { mountSearch } = await import("../js/searchbox.js");

const ID = (n) => `RGI2000-v7.0-G-11-${String(n).padStart(5, "0")}`;
const index = buildGlacierIndex(
  { rgi_id: [ID(1), ID(2)], display_name: ["Aletsch", null], glac_name: [null, null] },
  new Map([["11", "Central Europe"]]),
);
const regions = [
  { level: 1, o1region: "11", o2region: "11-00", full_name: "Central Europe", bbox: { xmin: 1, ymin: 2, xmax: 3, ymax: 4 } },
];

const flush = async () => {
  for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setImmediate(resolve));
};
const feature = (name) => ({
  properties: { name, osm_value: "peak", country: "Switzerland" },
  geometry: { coordinates: [7, 46] },
});
const photonOk = (...names) => async () => ({
  ok: true,
  json: async () => ({ features: names.map(feature) }),
});

function setup({ fetch = photonOk(), loadGlacierIndex = async () => index } = {}) {
  mock.timers.enable({ apis: ["setTimeout"] });
  globalThis.fetch = fetch;
  document.body.replaceChildren();
  const root = document.createElement("div");
  document.body.append(root);
  const picks = [];
  const loads = [];
  mountSearch(root, {
    onPick: (hit) => picks.push(hit),
    loadGlacierIndex: () => {
      loads.push(1);
      return loadGlacierIndex();
    },
    regions,
    view: () => ({ lat: 46, lon: 7, zoom: 5 }),
  });
  const input = root.querySelector("input");
  const type = (value) => {
    input.value = value;
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
  };
  const key = (name) =>
    input.dispatchEvent(new window.KeyboardEvent("keydown", { key: name, bubbles: true }));
  const rows = () => [...root.querySelectorAll('[role="option"]')];
  return { root, input, picks, loads, type, key, rows };
}
const window = document.defaultView;

test.afterEach(() => mock.timers.reset());

test("the input is labelled and the list is a listbox", () => {
  const { root, input } = setup();
  assert.equal(input.type, "search");
  assert.ok(input.getAttribute("aria-label"));
  assert.ok(root.querySelector('[role="listbox"]'));
});

test("the search bar is a pill with a hidden search icon and no native clear control", () => {
  const { root, input } = setup();
  const glyph = root.querySelector("svg.search-icon");
  assert.ok(glyph.querySelector("use").getAttribute("href").endsWith("#search"));
  assert.equal(glyph.getAttribute("aria-hidden"), "true");
  assert.ok(glyph.compareDocumentPosition(input) & window.Node.DOCUMENT_POSITION_FOLLOWING, "the icon sits before the input");

  const css = fs.readFileSync(new URL("../style.css", import.meta.url), "utf8");
  const rule = (selector) => new RegExp(`(^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`).exec(css)?.[2] ?? "";
  const pill = rule("#search input");
  for (const declaration of [/width:\s*100%/, /height:\s*48px/, /border-radius:\s*24px/, /box-shadow:\s*var\(--shadow\)/, /border:\s*0/, /padding:\s*0 48px/]) {
    assert.match(pill, declaration);
  }
  assert.match(css, /#search input::-webkit-search-cancel-button[^{]*\{[^}]*appearance:\s*none/);
  const results = rule("#search ul");
  for (const declaration of [/background:\s*var\(--surface\)/, /box-shadow:\s*var\(--shadow\)/, /border-radius:\s*16px/]) {
    assert.match(results, declaration);
  }
});

test("the glacier index loads once, on first focus or input, not at mount", async () => {
  const { input, loads, type } = setup();
  assert.equal(loads.length, 0);
  input.dispatchEvent(new window.Event("focus"));
  type("al");
  type("ale");
  await flush();
  assert.equal(loads.length, 1);
});

test("local hits show at once and Photon adds places after 250 ms", async () => {
  const { type, rows } = setup({ fetch: photonOk("Aletsch Arena") });
  type("aletsch");
  await flush();
  assert.deepEqual(rows().map((r) => r.querySelector(".title").textContent), ["Aletsch"]);
  mock.timers.tick(249);
  await flush();
  assert.equal(rows().length, 1);
  mock.timers.tick(1);
  await flush();
  assert.deepEqual(
    rows().map((r) => r.querySelector(".title").textContent),
    ["Aletsch", "Aletsch Arena"],
  );
  const icons = rows().map((r) => r.querySelector("use").getAttribute("href").split("#")[1]);
  assert.deepEqual(icons, ["mountain-snow", "map-pin"]);
  assert.match(rows()[0].textContent, /Glacier · RGI2000-v7\.0-G-11-00001 · Central Europe/);
});

test("a query under 2 characters shows nothing and calls no Photon", async () => {
  let calls = 0;
  const { type, rows } = setup({ fetch: async () => { calls += 1; return { ok: true, json: async () => ({ features: [] }) }; } });
  type(" a ");
  mock.timers.tick(500);
  await flush();
  assert.equal(rows().length, 0);
  assert.equal(calls, 0);
});

test("the index arriving after typing re-runs the current query", async () => {
  let resolve;
  const { type, rows } = setup({ loadGlacierIndex: () => new Promise((r) => (resolve = r)) });
  type("aletsch");
  await flush();
  assert.equal(rows().filter((r) => r.querySelector(".title").textContent === "Aletsch").length, 0);
  resolve(index);
  await flush();
  assert.equal(rows()[0].querySelector(".title").textContent, "Aletsch");
});

test("Photon failing still shows glacier hits, with no error text", async () => {
  const fetch = async (url) => {
    if (String(url).startsWith("https://photon.komoot.io/")) throw new TypeError("network down");
    throw new Error("unexpected");
  };
  const { root, type, rows } = setup({ fetch });
  type("aletsch");
  mock.timers.tick(250);
  await flush();
  assert.deepEqual(rows().map((r) => r.querySelector(".title").textContent), ["Aletsch"]);
  assert.doesNotMatch(root.textContent, /error|fail|network/i);
});

test("a slow older Photon response never replaces newer results", async () => {
  const pending = [];
  const fetch = (url, { signal }) =>
    new Promise((resolve) => pending.push({ resolve, signal, url }));
  const { type, rows } = setup({ fetch });
  type("zerm");
  mock.timers.tick(250);
  await flush();
  type("zermatt");
  mock.timers.tick(250);
  await flush();
  assert.equal(pending.length, 2);
  assert.equal(pending[0].signal.aborted, true);
  const answer = (entry, name) =>
    entry.resolve({ ok: true, json: async () => ({ features: [feature(name)] }) });
  answer(pending[1], "Zermatt");
  await flush();
  answer(pending[0], "Zermatt Old");
  await flush();
  assert.deepEqual(rows().map((r) => r.querySelector(".title").textContent), ["Zermatt"]);
});

test("arrow keys move the active row and Enter picks it", async () => {
  const { input, type, key, rows, picks } = setup();
  type("11");
  await flush();
  assert.equal(rows().length, 1);
  key("ArrowDown");
  key("ArrowDown");
  const active = rows().find((r) => r.getAttribute("aria-selected") === "true");
  assert.equal(input.getAttribute("aria-activedescendant"), active.id);
  key("Enter");
  assert.equal(picks.length, 1);
  assert.equal(picks[0].kind, "region");
});

test("Enter with no active row picks the first row", async () => {
  const { type, key, picks } = setup();
  type("aletsch");
  await flush();
  key("Enter");
  assert.equal(picks.length, 1);
  assert.equal(picks[0].rgiId, ID(1));
});

test("clicking a row picks it once", async () => {
  const { type, rows, picks } = setup();
  type("aletsch");
  await flush();
  rows()[0].dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  assert.equal(picks.length, 1);
  assert.equal(rows().length, 0);
});

test("Escape clears the input and closes the list", async () => {
  const { input, type, key, rows } = setup();
  type("aletsch");
  await flush();
  key("Escape");
  assert.equal(input.value, "");
  assert.equal(rows().length, 0);
  assert.equal(input.getAttribute("aria-expanded"), "false");
});

test("the list closes when focus leaves the search and reopens on focus", async () => {
  const { root, input, type, rows } = setup();
  type("aletsch");
  await flush();
  const list = root.querySelector('[role="listbox"]');
  input.dispatchEvent(new window.FocusEvent("focusout", { bubbles: true, relatedTarget: null }));
  assert.equal(list.hidden, true);
  assert.equal(input.getAttribute("aria-expanded"), "false");
  input.dispatchEvent(new window.Event("focus"));
  assert.equal(list.hidden, false);
  assert.equal(rows().length, 1);
});

test("focus moving to a row keeps the list open", async () => {
  const { root, input, type, rows } = setup();
  type("aletsch");
  await flush();
  input.dispatchEvent(
    new window.FocusEvent("focusout", { bubbles: true, relatedTarget: rows()[0] }),
  );
  assert.equal(root.querySelector('[role="listbox"]').hidden, false);
});

test("a late Photon response keeps the arrow-key selection on the same hit", async () => {
  const fuzzyIndex = buildGlacierIndex(
    { rgi_id: [ID(1)], display_name: ["Grosser Aletsch"], glac_name: [null] },
    new Map(),
  );
  const { input, type, key, rows } = setup({
    fetch: photonOk("Rossi"),
    loadGlacierIndex: async () => fuzzyIndex,
  });
  type("rosser");
  await flush();
  key("ArrowDown");
  assert.equal(rows()[0].getAttribute("aria-selected"), "true");
  mock.timers.tick(250);
  await flush();
  const titles = rows().map((r) => r.querySelector(".title").textContent);
  assert.deepEqual(titles, ["Rossi", "Grosser Aletsch"]);
  assert.equal(rows()[1].getAttribute("aria-selected"), "true");
  assert.equal(input.getAttribute("aria-activedescendant"), rows()[1].id);
});

test("setClosable shows a Close button that calls its function, and null hides it", () => {
  document.body.replaceChildren();
  const root = document.createElement("div");
  document.body.append(root);
  const search = mountSearch(root, { onPick() {}, loadGlacierIndex: async () => index, regions, view: () => ({ lat: 0, lon: 0, zoom: 1 }) });
  const close = root.querySelector('button[aria-label="Close"]');
  assert.ok(close, "the button is in the search bar");
  assert.equal(close.hidden, true, "hidden while nothing can close");
  assert.ok(close.querySelector("svg use").getAttribute("href").endsWith("#x"));

  const calls = [];
  search.setClosable(() => calls.push("close"));
  assert.equal(close.hidden, false);
  close.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  assert.deepEqual(calls, ["close"]);

  search.setClosable(null);
  assert.equal(close.hidden, true);
  close.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  assert.deepEqual(calls, ["close"], "a hidden button calls nothing");
});
