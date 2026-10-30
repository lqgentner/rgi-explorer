/* "Use this data": the snippets and the desktop dialog. */

import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

import { load, loadPage, settle, waitFor } from "./helpers/browser.js";

const ROOT = "https://data.source.coop/lqgentner/rgi/catalog.json";
const DIR = new URL("./fixtures/catalog/", import.meta.url);
const SIZE = 258_123_456;

const heads = [];
const { document, window } = await loadPage({
  fetch: async (url, init = {}) => {
    if (init.method === "HEAD") heads.push(String(url));
    if (init.method === "HEAD" && String(url).endsWith("rgi7.0-glaciers.parquet")) {
      return new Response(null, { status: 200, headers: { "Content-Length": String(SIZE) } });
    }
    return new Response("{}", { status: 404 });
  },
});
const copied = [];
Object.defineProperty(globalThis.navigator, "clipboard", {
  configurable: true,
  value: { writeText: async (text) => void copied.push(text) },
});

const { loadCatalog } = await load("js/catalog.js");
const { snippet, mountUseData } = await load("js/usedata.js");
const catalog = await loadCatalog(ROOT, async (url) =>
  JSON.parse(fs.readFileSync(new URL(url.slice(ROOT.length - "catalog.json".length), DIR), "utf8")));

const URL_ = "https://data.source.coop/lqgentner/rgi/v7.0/glaciers/rgi7.0-glaciers.parquet";
const ALETSCH = { rgiId: "RGI2000-v7.0-G-11-02596", o1region: "11" };
const STEPS = [
  "Layer › Add Layer › Add Vector Layer…",
  "Source Type: Protocol: HTTP(S), cloud, etc.",
  "Protocol Type: HTTP/HTTPS/FTP.",
  `URI: ${URL_}`,
  'Leave Authentication at "No Authentication" and click Add.',
];

test("python glacier snippet is exact", () => {
  assert.equal(snippet({ tool: "python", scope: "glacier" }, ALETSCH, catalog).code,
    'import geopandas as gpd\n\nurl = "https://data.source.coop/lqgentner/rgi/v7.0/glaciers/rgi7.0-glaciers.parquet"\ngdf = gpd.read_parquet(url, filters=[("rgi_id", "==", "RGI2000-v7.0-G-11-02596")])\n');
});

test("python region snippet filters on o1region", () => {
  const { code, note } = snippet({ tool: "python", scope: "region" }, ALETSCH, catalog);
  assert.equal(code, `import geopandas as gpd\n\nurl = "${URL_}"\ngdf = gpd.read_parquet(url, filters=[("o1region", "==", "11")])\n`);
  assert.equal(note, undefined);
});

test("python all reads the whole file and states its size only when known", () => {
  const all = snippet({ tool: "python", scope: "all" }, ALETSCH, catalog, SIZE);
  assert.equal(all.code, `import geopandas as gpd\n\nurl = "${URL_}"\ngdf = gpd.read_parquet(url)\n`);
  assert.equal(all.note, "Reads the whole file, about 258 MB.");
  assert.equal(snippet({ tool: "python", scope: "all" }, ALETSCH, catalog).note, undefined);
  assert.equal(snippet({ tool: "python", scope: "all" }, ALETSCH, catalog, Number.NaN).note, undefined);
});

test("qgis glacier gives the five steps and the filter", () => {
  const qgis = snippet({ tool: "qgis", scope: "glacier" }, ALETSCH, catalog);
  assert.deepEqual(qgis.steps, STEPS);
  assert.equal(qgis.filter, `"rgi_id" = 'RGI2000-v7.0-G-11-02596'`);
  assert.equal(qgis.code, undefined);
  assert.equal(qgis.note, undefined);
});

test("qgis region filters on o1region, and all has no filter but the size", () => {
  const region = snippet({ tool: "qgis", scope: "region" }, ALETSCH, catalog);
  assert.deepEqual(region.steps, STEPS);
  assert.equal(region.filter, `"o1region" = '11'`);
  const all = snippet({ tool: "qgis", scope: "all" }, ALETSCH, catalog, SIZE);
  assert.deepEqual(all.steps, STEPS);
  assert.equal("filter" in all, false);
  assert.equal(all.note, "Reads the whole file, about 258 MB.");
});

test("the region comes from the RGI ID when the glacier has none", () => {
  const { filter } = snippet({ tool: "qgis", scope: "region" }, { rgiId: "RGI2000-v7.0-G-03-00002" }, catalog);
  assert.equal(filter, `"o1region" = '03'`);
});

const dialog = () => document.querySelector("dialog.usedata");
const code = () => dialog().querySelector(".usedata-code code")?.textContent;
const radio = (value) => dialog().querySelector(`input[type="radio"][value="${value}"]`);
const choose = (value) => {
  radio(value).checked = true;
  radio(value).dispatchEvent(new window.Event("change", { bubbles: true }));
};
const button = (root, label) =>
  [...root.querySelectorAll("button")].find((b) => b.textContent === label || b.getAttribute("aria-label") === label);
const click = (node) => node.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

const useData = mountUseData(document.body, { catalog });

test("the dialog opens on Python and this glacier with the exact snippet", () => {
  const opener = document.createElement("button");
  document.body.append(opener);
  opener.focus();
  useData.open(ALETSCH);
  assert.ok(dialog().open);
  assert.equal(radio("python").checked, true);
  assert.equal(radio("glacier").checked, true);
  assert.equal(code(), snippet({ tool: "python", scope: "glacier" }, ALETSCH, catalog).code);
  assert.equal(dialog().querySelectorAll('fieldset input[type="radio"]').length, 5);
  assert.deepEqual([...dialog().querySelectorAll("legend")].map((l) => l.textContent), ["I work in", "Fetch"]);
  assert.deepEqual([...dialog().querySelectorAll(".segment span")].map((s) => s.textContent),
    ["Python", "QGIS", "This glacier", "Its region", "All of RGI"]);
  click(dialog().querySelector(".usedata-close"));
  assert.equal(dialog().open, false);
  assert.equal(document.activeElement, opener, "focus returns to the opener");
});

test("Copy is an icon under the snippet's bottom left; it writes the snippet and says Copied", async () => {
  useData.open(ALETSCH);
  const copy = button(dialog(), "Copy");
  assert.equal(copy.textContent, "", "an icon, named by its label");
  assert.ok(copy.querySelector("use").getAttribute("href").endsWith("#copy"));
  assert.equal(copy.parentElement.previousElementSibling.tagName, "PRE");
  click(copy);
  await settle();
  assert.equal(copied.at(-1), code());
  assert.equal(copy.getAttribute("aria-label"), "Copied");
  assert.ok(copy.querySelector("use").getAttribute("href").endsWith("#check"));
  useData.close();
});

test("QGIS shows the steps, the URL and the filter, each with its own Copy", async () => {
  useData.open(ALETSCH);
  choose("qgis");
  assert.equal(dialog().querySelector(".usedata-code"), null, "QGIS has no Python block");
  const steps = [...dialog().querySelectorAll("ol li")];
  assert.equal(steps.length, 5);
  assert.equal(steps.map((li) => li.textContent).join("\n"), STEPS.join("\n"));
  assert.equal(steps[3].querySelector("code").textContent, URL_);
  click(button(steps[3], "Copy"));
  await settle();
  assert.equal(copied.at(-1), URL_);

  const filter = dialog().querySelector(".usedata-filter");
  assert.equal(filter.querySelector("code").textContent, `"rgi_id" = 'RGI2000-v7.0-G-11-02596'`);
  click(button(filter, "Copy"));
  await settle();
  assert.equal(copied.at(-1), `"rgi_id" = 'RGI2000-v7.0-G-11-02596'`);

  choose("all");
  assert.equal(dialog().querySelector(".usedata-filter"), null);
  choose("python");
  choose("glacier");
  useData.close();
});

test("All of RGI states the size from one HEAD request", async () => {
  useData.open(ALETSCH);
  choose("all");
  await waitFor(() => dialog().querySelector(".usedata-note")?.textContent === "Reads the whole file, about 258 MB.");
  assert.equal(code(), snippet({ tool: "python", scope: "all" }, ALETSCH, catalog).code);
  useData.close();
  useData.open(ALETSCH);
  choose("all");
  await settle();
  assert.equal(heads.filter((url) => url === URL_).length, 1);
  choose("glacier");
  useData.close();
});

test("a failed HEAD leaves the size note out", async () => {
  const other = {
    ...catalog,
    collections: { ...catalog.collections, glaciers: { ...catalog.collections.glaciers, dataUrl: "https://data.source.coop/missing.parquet" } },
  };
  const root = document.createElement("div");
  document.body.append(root);
  const api = mountUseData(root, { catalog: other });
  api.open(ALETSCH);
  const mine = root.querySelector("dialog");
  const all = mine.querySelector('input[value="all"]');
  all.checked = true;
  all.dispatchEvent(new window.Event("change", { bubbles: true }));
  await settle();
  assert.equal(mine.querySelector(".usedata-note"), null);
  assert.match(mine.querySelector(".usedata-code code").textContent, /read_parquet\(url\)/);
  api.close();
});

test("Escape closes the dialog", () => {
  useData.open(ALETSCH);
  dialog().dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(dialog().open, false);
});

const COMPLEX = { kind: "complex", rgiId: "RGI2000-v7.0-C-11-01323", o1region: "11" };
const COMPLEXES_URL = "https://data.source.coop/lqgentner/rgi/v7.0/complexes/rgi7.0-complexes.parquet";

test("a complex offers itself, its glaciers, its region and all complexes", () => {
  assert.equal(snippet({ tool: "python", scope: "complex" }, COMPLEX, catalog).code,
    `import geopandas as gpd\n\nurl = "${COMPLEXES_URL}"\ngdf = gpd.read_parquet(url, filters=[("rgi_id", "==", "RGI2000-v7.0-C-11-01323")])\n`);
  assert.equal(snippet({ tool: "python", scope: "members" }, COMPLEX, catalog).code,
    `import geopandas as gpd\n\nurl = "${URL_}"\ngdf = gpd.read_parquet(url, filters=[("complex_id", "==", "RGI2000-v7.0-C-11-01323")])\n`);
  const region = snippet({ tool: "qgis", scope: "region" }, COMPLEX, catalog);
  assert.equal(region.filter, `"o1region" = '11'`);
  assert.ok(region.steps.includes(`URI: ${COMPLEXES_URL}`));
  assert.equal(snippet({ tool: "python", scope: "all" }, COMPLEX, catalog, 214_686_136).note, "Reads the whole file, about 215 MB.");
  const bare = snippet({ tool: "qgis", scope: "region" }, { kind: "complex", rgiId: "RGI2000-v7.0-C-03-00002" }, catalog);
  assert.equal(bare.filter, `"o1region" = '03'`, "the region comes from a complex ID too");
});

test("the dialog offers a complex's scopes, and a glacier's again after it", () => {
  useData.open(COMPLEX);
  assert.deepEqual([...dialog().querySelectorAll(".segment span")].map((s) => s.textContent),
    ["Python", "QGIS", "This complex", "Its glaciers", "Its region", "All complexes"]);
  assert.equal(radio("complex").checked, true);
  assert.equal(code(), snippet({ tool: "python", scope: "complex" }, COMPLEX, catalog).code);
  useData.close();
  useData.open(ALETSCH);
  assert.deepEqual([...dialog().querySelectorAll(".segment span")].map((s) => s.textContent),
    ["Python", "QGIS", "This glacier", "Its region", "All of RGI"]);
  assert.equal(radio("glacier").checked, true);
  useData.close();
});
