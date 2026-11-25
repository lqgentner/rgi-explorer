/* "Use this data": the snippets, the QGIS guide, the references and the desktop dialog. */

import assert from "node:assert/strict";
import { test } from "node:test";

import { load, loadPage, settle, waitFor } from "./helpers/browser.js";
import { fixtureCatalog } from "./helpers/served.js";

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
const { snippet, references, highlight, mountUseData } = await load("js/usedata.js");
const catalog = await fixtureCatalog(loadCatalog);

const URL_ = "https://data.source.coop/lqgentner/rgi/v7.0/glaciers/rgi7.0-glaciers.parquet";
const ALETSCH = { rgiId: "RGI2000-v7.0-G-11-02596", o1region: "11" };
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

const duck = (where) => `INSTALL spatial; LOAD spatial;\nINSTALL httpfs; LOAD httpfs;\n\nSELECT *\nFROM read_parquet(\n  '${URL_}'\n)${where};\n`;

test("duckdb loads spatial and httpfs, as the Portolan reading guide does, and filters in SQL", () => {
  assert.equal(snippet({ tool: "duckdb", scope: "glacier" }, ALETSCH, catalog).code, duck("\nWHERE rgi_id = 'RGI2000-v7.0-G-11-02596'"));
  assert.equal(snippet({ tool: "duckdb", scope: "region" }, ALETSCH, catalog).code, duck("\nWHERE o1region = '11'"));
  const all = snippet({ tool: "duckdb", scope: "all" }, ALETSCH, catalog, SIZE);
  assert.equal(all.code, duck(""));
  assert.equal(all.note, "Reads the whole file, about 258 MB.");
  const quoted = snippet({ tool: "duckdb", scope: "glacier" }, { rgiId: "it's" }, catalog).code;
  assert.match(quoted, /WHERE rgi_id = 'it''s';/, "a quote doubles in a SQL string");
});

test("qgis names what the plugin lists, and the filter for its Rows field", () => {
  const qgis = snippet({ tool: "qgis", scope: "glacier" }, ALETSCH, catalog);
  assert.deepEqual(qgis, {
    publisher: "Randolph Glacier Inventory Mirror",
    folder: "RGI 7.0",
    collection: "RGI 7.0 glaciers",
    filter: `"rgi_id" = 'RGI2000-v7.0-G-11-02596'`,
  });
  assert.equal(snippet({ tool: "qgis", scope: "region" }, ALETSCH, catalog).filter, `"o1region" = '11'`);
  const all = snippet({ tool: "qgis", scope: "all" }, ALETSCH, catalog, SIZE);
  assert.equal("filter" in all, false);
  assert.equal(all.note, "Reads the whole file, about 258 MB.");
});

test("the region comes from the RGI ID when the glacier has none", () => {
  const { filter } = snippet({ tool: "qgis", scope: "region" }, { rgiId: "RGI2000-v7.0-G-03-00002" }, catalog);
  assert.equal(filter, `"o1region" = '03'`);
});

test("the references are the dataset, then the user guide, in APA 7, each with BibTeX", () => {
  const refs = references(catalog);
  assert.deepEqual(refs.map((r) => r.label), ["Dataset", "User guide"]);
  assert.equal(refs[0].text,
    "RGI Consortium. (2023). Randolph Glacier Inventory - A Dataset of Global Glacier Outlines, Version 7 [Data set]. NASA National Snow and Ice Data Center Distributed Active Archive Center. https://doi.org/10.5067/F6JMOVY5NAVZ");
  assert.equal(refs[1].text,
    "Maussion, F., Hock, R., Paul, F., Raup, B., Rastner, P., Zemp, M., Andreassen, L., Barr, I., Bolch, T., Kochtitzky, W., McNabb, R., & Tielidze, L. (2023). The Randolph Glacier Inventory version 7.0 User guide. Zenodo. https://doi.org/10.5281/ZENODO.8362857");
  assert.equal(refs[0].when, "Cite it in every publication that uses RGI 7.0 data.");
  assert.equal(refs[1].when, "Optional: cite it when referring to specific details that are not covered elsewhere.", "in RGI's own words");
  assert.match(refs[0].bibtex, /^@misc\{rgi7_2023,\n  author    = \{\{RGI Consortium\}\},/);
  assert.match(refs[0].bibtex, /publisher = \{NASA National Snow and Ice Data Center Distributed Active\n {15}Archive Center\}/);
  assert.match(refs[0].bibtex, /doi       = \{10\.5067\/F6JMOVY5NAVZ\}/);
  assert.match(refs[1].bibtex, /title     = \{The \{Randolph Glacier Inventory\} version 7\.0 User guide\}/);
  assert.match(refs[1].bibtex, /author    = \{Maussion, F\. and Hock, R\.[^}]* and Tielidze, L\.\}/);
  assert.match(refs[1].bibtex, /publisher = \{Zenodo\}/);
  for (const { bibtex } of refs) {
    assert.ok(bibtex.split("\n").every((line) => line.length <= 80), "no line runs past the box");
    assert.equal([...bibtex].filter((c) => c === "{").length, [...bibtex].filter((c) => c === "}").length, "braces balance");
  }
});

test("a known DOI needs no text from the catalog, and a DOI named twice is cited once", () => {
  const refs = references({ ...catalog, citation: undefined, publications: [...catalog.publications, { doi: "10.5067/F6JMOVY5NAVZ", citation: "again" }] });
  assert.deepEqual(refs.map((r) => r.label), ["Dataset", "User guide"]);
});

test("a reference with an unknown DOI keeps its text without BibTeX; one without text is left out", () => {
  const refs = references({ ...catalog, publications: [{ doi: "10.1/x", citation: "Someone (2024). A paper." }, { doi: "10.1/y" }] });
  assert.deepEqual(refs.slice(1), [{ label: "Publication", text: "Someone (2024). A paper.", when: null, bibtex: null }]);
});

const tokens = (text, lang) => highlight(text, lang).map((n) => (typeof n === "string" ? n : `[${n.className}:${n.textContent}]`)).join("");

test("highlight wraps tokens in Pandoc's classes and keeps the text", () => {
  for (const [tool, lang] of [["python", "python"], ["duckdb", "sql"]]) {
    for (const scope of ["glacier", "region", "all"]) {
      const { code } = snippet({ tool, scope }, ALETSCH, catalog);
      assert.equal(highlight(code, lang).map((n) => (typeof n === "string" ? n : n.textContent)).join(""), code);
    }
  }
  assert.equal(tokens('import geopandas as gpd\ngdf = gpd.read_parquet(url, filters=[("rgi_id", "==", "x")])', "python"),
    '[im:import] geopandas [im:as] gpd\ngdf [op:=] gpd.read_parquet(url, filters[op:=][([st:"rgi_id"], [st:"=="], [st:"x"])])');
  assert.equal(tokens("SELECT *\nFROM read_parquet('a''b')\nWHERE o1region = '11';", "sql"),
    "[kw:SELECT] [op:*]\n[kw:FROM] [fu:read_parquet]([st:'a''b'])\n[kw:WHERE] o1region [op:=] [st:'11'];");
  assert.equal(tokens("@misc{k,\n  year      = {2023},\n}", "bibtex"), "[kw:@misc]{k,\n  [at:year]      [op:=] {2023},\n}");
  assert.deepEqual(highlight("plain", "text"), ["plain"], "an unknown language stays plain");
});

const dialog = () => document.querySelector("dialog.usedata");
const code = () => dialog().querySelector(".usedata-code code")?.textContent;
const radio = (value) => dialog().querySelector(`input[type="radio"][value="${value}"]`);
const choose = (value) => {
  radio(value).checked = true;
  radio(value).dispatchEvent(new window.Event("change", { bubbles: true }));
};
const tabs = () => [...dialog().querySelectorAll('[role="tab"]')];
const tab = (label) => tabs().find((t) => t.textContent === label);
const selected = () => tabs().find((t) => t.getAttribute("aria-selected") === "true")?.textContent;
const button = (root, label) =>
  [...root.querySelectorAll("button")].find((b) => b.textContent === label || b.getAttribute("aria-label") === label);
const click = (node) => node.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
const key = (node, name) => node.dispatchEvent(new window.KeyboardEvent("keydown", { key: name, bubbles: true }));
const scopeShown = () => !dialog().querySelector("fieldset.segmented").hidden;

const useData = mountUseData(document.body, { catalog });

test("the dialog opens on Python and this glacier with the exact snippet", () => {
  const opener = document.createElement("button");
  document.body.append(opener);
  opener.focus();
  useData.open(ALETSCH);
  assert.ok(dialog().open);
  assert.deepEqual(tabs().map((t) => t.textContent), ["Python", "DuckDB", "QGIS", "Citation"]);
  assert.equal(selected(), "Python");
  assert.equal(document.activeElement, tab("Python"), "focus starts on the chosen tab");
  assert.equal(dialog().querySelector('[role="tabpanel"]').getAttribute("aria-labelledby"), tab("Python").id);
  assert.equal(dialog().querySelector(".usedata-sub").textContent, ALETSCH.rgiId, "a glacier without a name shows its ID");
  assert.ok(dialog().querySelector(".usedata-close").classList.contains("pane-close"), "the grey close of the other panes");
  assert.equal(radio("glacier").checked, true);
  assert.equal(code(), snippet({ tool: "python", scope: "glacier" }, ALETSCH, catalog).code);
  assert.deepEqual([...dialog().querySelectorAll("legend")].map((l) => l.textContent), ["Load"]);
  assert.deepEqual([...dialog().querySelectorAll(".segment span")].map((s) => s.textContent),
    ["This glacier", "Its region", "All glaciers"]);
  click(dialog().querySelector(".usedata-close"));
  assert.equal(dialog().open, false);
  assert.equal(document.activeElement, opener, "focus returns to the opener");
});

test("the tabs switch by click and by arrow keys, and keep the scope", () => {
  useData.open(ALETSCH);
  choose("region");
  click(tab("DuckDB"));
  assert.equal(selected(), "DuckDB");
  assert.equal(code(), snippet({ tool: "duckdb", scope: "region" }, ALETSCH, catalog).code);
  key(tab("DuckDB"), "ArrowLeft");
  assert.equal(selected(), "Python");
  assert.equal(document.activeElement, tab("Python"));
  key(tab("Python"), "ArrowLeft");
  assert.equal(selected(), "Citation", "the arrows wrap round");
  key(tab("Citation"), "Home");
  assert.equal(selected(), "Python");
  assert.deepEqual(tabs().map((t) => t.tabIndex), [0, -1, -1, -1], "only the chosen tab is in the tab order");
  choose("glacier");
  useData.close();
});

test("the title names the glacier when it has a name", () => {
  useData.open({ ...ALETSCH, name: "Grosser Aletschgletscher" });
  assert.equal(dialog().querySelector(".usedata-sub").textContent, "Grosser Aletschgletscher");
  useData.close();
  useData.open({ ...ALETSCH, name: " " });
  assert.equal(dialog().querySelector(".usedata-sub").textContent, ALETSCH.rgiId, "a blank name gives way to the ID");
  useData.close();
});

test("the tab stays as the reader left it at the next open", () => {
  useData.open(ALETSCH);
  click(tab("DuckDB"));
  useData.close();
  useData.open(ALETSCH);
  assert.equal(selected(), "DuckDB");
  assert.equal(document.activeElement, tab("DuckDB"));
  click(tab("Python"));
  useData.close();
});

test("Copy is an icon in the snippet's top right corner; it writes the snippet and says Copied", async () => {
  useData.open(ALETSCH);
  const copy = button(dialog(), "Copy");
  assert.equal(copy.textContent, "", "an icon, named by its label");
  assert.ok(copy.querySelector("use").getAttribute("href").endsWith("#copy"));
  assert.equal(copy.previousElementSibling.tagName, "PRE");
  assert.ok(copy.parentElement.classList.contains("usedata-block"), "the block places it in the corner");
  assert.ok(dialog().querySelector(".usedata-code code span.im"), "the snippet is coloured");
  click(copy);
  await settle();
  assert.equal(copied.at(-1), code());
  assert.equal(copy.getAttribute("aria-label"), "Copied");
  assert.ok(copy.querySelector("use").getAttribute("href").endsWith("#check"));
  useData.close();
});

const steps = () => [...dialog().querySelectorAll(".usedata-steps > li")];
const prose = (li) => [...li.childNodes].filter((n) => !n.matches?.(".usedata-block")).map((n) => n.textContent).join("");
const FILTER = `"rgi_id" = 'RGI2000-v7.0-G-11-02596'`;

test("QGIS: the banner, the vector tiles, then the choice of rows and the GeoParquet", async () => {
  useData.open(ALETSCH);
  click(tab("QGIS"));
  assert.ok(scopeShown());
  assert.equal(dialog().querySelector(".usedata-code"), null, "QGIS has no snippet");
  const panel = dialog().querySelector('[role="tabpanel"]');
  const banner = panel.querySelector(".usedata-banner");
  assert.equal(banner.getAttribute("role"), "note");
  assert.equal(panel.querySelector(".usedata-banner, .usedata-steps, fieldset"), banner, "the banner comes first");
  assert.equal(banner.textContent, "Coming soon. The RGI mirror is not in the Portolan registry yet.");

  const [tiles, parquet] = panel.querySelectorAll("ol.usedata-steps");
  const fieldset = panel.querySelector("fieldset");
  const follows = (a, b) => Boolean(a.compareDocumentPosition(b) & window.Node.DOCUMENT_POSITION_FOLLOWING);
  assert.ok(follows(tiles, fieldset) && follows(fieldset, parquet), "the choice of rows sits between the tiles and the GeoParquet");
  assert.equal(panel.querySelector(".usedata-subhead").textContent, "Load the attributes");
  assert.equal(parquet.start, 5, "the numbering runs on");

  assert.deepEqual(steps().map(prose), [
    "Install the Portolan Registry plugin from Plugins › Manage and Install Plugins…. It needs QGIS 3.34 or newer.",
    "Open Web › Portolan Registry › Portolan Registry and search for Randolph Glacier Inventory Mirror.",
    "Select RGI 7.0 › RGI 7.0 glaciers.",
    "Under Add to map, click View on map.",
    "Under Add to map, open the SQL tab and paste this filter into Rows:",
    "Back on the Load tab, click Load data. The plugin copies the matching rows into a layer.",
  ]);
  assert.match(tiles.nextElementSibling.textContent, /^View on map adds the whole collection as vector tiles\. .* needs no filter\./);
  assert.equal(steps()[0].querySelector("a").href, "https://plugins.qgis.org/plugins/portolan_registry_qgis/");
  const shown = (li) => [...li.querySelectorAll(".qgis-button")].map((b) => [b.textContent, b.classList.contains("primary"), b.querySelector("svg").getAttribute("aria-hidden")]);
  assert.deepEqual(shown(steps()[3]), [["View on map", true, "true"]], "the plugin's blue button, its icon hidden");
  assert.deepEqual(shown(steps()[5]), [["Load data", false, "true"]]);
  assert.equal(steps()[4].querySelector("pre code").textContent, FILTER);
  click(button(steps()[4], "Copy filter"));
  await settle();
  assert.equal(copied.at(-1), FILTER);

  choose("region");
  assert.equal(steps()[4].querySelector("pre code").textContent, `"o1region" = '11'`);
  assert.equal(steps()[3].textContent, "Under Add to map, click View on map.", "the tiles need no choice");
  choose("glacier");
  click(tab("Python"));
  assert.equal(panel.querySelector(".usedata-banner"), null, "Python leads with the choice again");
  assert.equal(panel.firstElementChild.nextElementSibling, panel.querySelector("fieldset"));
  useData.close();
});

test("QGIS for all glaciers loads the full data in one step after the tiles", () => {
  useData.open(ALETSCH);
  click(tab("QGIS"));
  choose("all");
  assert.equal(steps().length, 5);
  assert.equal(steps()[4].textContent, "Under Add to map, click Load full data. The plugin copies every row into a layer.");
  choose("glacier");
  click(tab("Python"));
  useData.close();
});

test("Citation hides the scope and gives each reference with Copy and its BibTeX", async () => {
  useData.open(ALETSCH);
  click(tab("Citation"));
  assert.equal(scopeShown(), false);
  assert.equal(dialog().querySelector(".usedata-lead").textContent,
    "If you use RGI 7.0 data in your publication, please cite the RGI references below. This mirror is unofficial and needs no separate citation.");
  const refs = [...dialog().querySelectorAll(".usedata-ref")];
  assert.deepEqual(refs.map((r) => r.querySelector("h3").textContent), ["Dataset", "User guide"]);
  assert.equal(refs[0].querySelector(".usedata-when").textContent, references(catalog)[0].when);
  assert.equal(refs[0].querySelector(".usedata-cite").textContent, references(catalog)[0].text);
  assert.equal(dialog().querySelector(".usedata-ref a"), null, "no DOI link");
  click(button(refs[0], "Copy citation"));
  await settle();
  assert.equal(copied.at(-1), references(catalog)[0].text);
  click(button(refs[1], "Copy BibTeX"));
  await settle();
  assert.equal(copied.at(-1), references(catalog)[1].bibtex);
  assert.equal(refs[1].querySelector(".usedata-bibtex code").textContent, references(catalog)[1].bibtex);
  click(tab("Python"));
  assert.ok(scopeShown(), "the scope comes back");
  useData.close();
});

test("All glaciers states the size from one HEAD request", async () => {
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

test("a complex offers itself, its region and all complexes", () => {
  assert.equal(snippet({ tool: "python", scope: "complex" }, COMPLEX, catalog).code,
    `import geopandas as gpd\n\nurl = "${COMPLEXES_URL}"\ngdf = gpd.read_parquet(url, filters=[("rgi_id", "==", "RGI2000-v7.0-C-11-01323")])\n`);
  const region = snippet({ tool: "qgis", scope: "region" }, COMPLEX, catalog);
  assert.equal(region.filter, `"o1region" = '11'`);
  assert.equal(region.collection, "RGI 7.0 glacier complexes");
  assert.match(snippet({ tool: "duckdb", scope: "complex" }, COMPLEX, catalog).code, /FROM read_parquet\(\n  'https:\/\/data\.source\.coop\/lqgentner\/rgi\/v7\.0\/complexes\/rgi7\.0-complexes\.parquet'\n\)\nWHERE rgi_id = 'RGI2000-v7\.0-C-11-01323';/);
  assert.equal(snippet({ tool: "python", scope: "all" }, COMPLEX, catalog, 214_686_136).note, "Reads the whole file, about 215 MB.");
  const bare = snippet({ tool: "qgis", scope: "region" }, { kind: "complex", rgiId: "RGI2000-v7.0-C-03-00002" }, catalog);
  assert.equal(bare.filter, `"o1region" = '03'`, "the region comes from a complex ID too");
});

test("the dialog offers a complex's scopes, and a glacier's again after it", () => {
  useData.open(COMPLEX);
  assert.deepEqual([...dialog().querySelectorAll(".segment span")].map((s) => s.textContent),
    ["This complex", "Its region", "All complexes"]);
  assert.equal(radio("complex").checked, true);
  assert.equal(code(), snippet({ tool: "python", scope: "complex" }, COMPLEX, catalog).code);
  click(tab("QGIS"));
  assert.match(steps()[2].textContent, /› RGI 7\.0 glacier complexes\.$/);
  click(tab("Python"));
  useData.close();
  useData.open(ALETSCH);
  assert.deepEqual([...dialog().querySelectorAll(".segment span")].map((s) => s.textContent),
    ["This glacier", "Its region", "All glaciers"]);
  assert.equal(radio("glacier").checked, true);
  useData.close();
});

test("the dialogs' corner is concentric with their ✕, as on the phone's sheet, and only their body scrolls", async () => {
  const fs = await import("node:fs");
  const css = fs.readFileSync(new URL("../style.css", import.meta.url), "utf8");
  const rule = (sel) => css.match(new RegExp(`\\n${sel} \\{([^}]*)\\}`))?.[1] ?? "";
  const box = rule("dialog\\.modal");
  assert.match(box, /--inset-x: var\(--sheet-x-inset\);/);
  assert.match(box, /padding: var\(--sheet-x-inset\) var\(--inset-x\) 0;/, "the ✕ sits the sheet's inset from the top and right; the body runs to the bottom edge");
  assert.match(box, /border-radius: calc\(var\(--radius\) \+ var\(--sheet-x-inset\)\);/, "its radius plus that inset");
  assert.match(rule("dialog\\.modal\\[open\\]"), /overflow: hidden;/);
  assert.match(rule("\\.usedata-panel,\\ndialog\\.privacy \\.privacy-body"), /overflow-y: auto;/);
  const phone = css.match(/\n  \.usedata-pane \{([^}]*)\}/)?.[1] ?? "";
  assert.match(phone, /display: flex;/);
  assert.match(phone, /overflow: hidden;/, "on the phone too, the pane itself does not scroll");
});
