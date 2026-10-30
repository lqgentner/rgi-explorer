/* The catalog walk resolves assets, column labels, citation and license. */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { loadCatalog } from "../js/catalog.js";

const BASE = "https://data.source.coop/lqgentner/rgi/";
const ROOT = `${BASE}catalog.json`;
const DIR = new URL("./fixtures/catalog/", import.meta.url);

/** Serves the fixture files for URLs under BASE. `edit(path, json)` may change the JSON. */
function fixtureFetch(edit = () => {}) {
  return async (url) => {
    assert.ok(url.startsWith(BASE), `unexpected URL ${url}`);
    const path = url.slice(BASE.length);
    const json = JSON.parse(await readFile(new URL(path, DIR), "utf8"));
    edit(path, json);
    return json;
  };
}

test("resolves the glaciers assets to absolute URLs", async () => {
  const c = await loadCatalog(ROOT, fixtureFetch());
  assert.equal(c.version, "7.0");
  assert.equal(c.collections.glaciers.dataUrl, "https://data.source.coop/lqgentner/rgi/v7.0/glaciers/rgi7.0-glaciers.parquet");
  assert.equal(c.collections.glaciers.pmtilesUrl, "https://data.source.coop/lqgentner/rgi/v7.0/rgi7.0.pmtiles");
  assert.equal(c.collections.regions.styleUrl, "https://data.source.coop/lqgentner/rgi/v7.0/regions/styles/regions.json");
  assert.equal(c.collections.glaciers.id, "rgi-v7-0-glaciers");
});

test("resolves against the URL the JSON was fetched from", async () => {
  const fetched = [];
  const local = "http://localhost:8000/catalog/catalog.json";
  const inner = fixtureFetch();
  const c = await loadCatalog(local, async (url) => {
    fetched.push(url);
    return inner(url.replace("http://localhost:8000/catalog/", BASE));
  });
  assert.equal(c.collections.glaciers.dataUrl, "http://localhost:8000/catalog/v7.0/glaciers/rgi7.0-glaciers.parquet");
  assert.ok(fetched.every((u) => u.startsWith("http://localhost:8000/catalog/")));
});

test("reads column labels from table:columns", async () => {
  const c = await loadCatalog(ROOT, fixtureFetch());
  assert.equal(c.columns.get("area_km2").unit, "km2");
  assert.equal(c.columns.get("rgi_id").unit, null);
  assert.equal(c.columns.get("rgi_id").classes, null);
  assert.equal(c.columns.get("term_type").classes.get(9), "Not assigned");
  assert.equal(c.columns.get("dem_source").classes.get("COPDEM90"), "Copernicus DEM, 90 m");
});

test("reads citation, doi and license", async () => {
  const c = await loadCatalog(ROOT, fixtureFetch());
  assert.match(c.citation, /^RGI 7\.0 Consortium\. \(2023\)/);
  assert.equal(c.doi, "10.5067/f6jmovy5navz");
  assert.deepEqual(c.license, { id: "CC-BY-4.0", href: "https://creativecommons.org/licenses/by/4.0/" });
});

test("a missing collection rejects with its name", async () => {
  const dropRegions = (path, json) => {
    if (path === "v7.0/catalog.json") {
      json.links = json.links.filter((l) => !(l.rel === "child" && l.href.includes("regions")));
    }
  };
  await assert.rejects(loadCatalog(ROOT, fixtureFetch(dropRegions)), /regions/);
});

test("the highest version wins whatever the link order", async () => {
  // Serve v7.1 and v6.0 as renamed copies of v7.0, listed on both sides of it.
  const rename = (json, from, to) => JSON.parse(JSON.stringify(json).replaceAll(from, to));
  const plain = fixtureFetch();
  const fetchJson = async (url) => {
    const path = url.slice(BASE.length);
    const other = /^v(7\.1|6\.0)\//.exec(path);
    if (path === "catalog.json") {
      const json = await plain(url);
      const child = (v) => ({ rel: "child", href: `./v${v}/catalog.json`, type: "application/json" });
      json.links.push(child("6.0"), child("7.1"));
      return json;
    }
    if (!other) return plain(url);
    const v = other[1];
    const json = await plain(url.replace(`/v${v}/`, "/v7.0/"));
    return rename(json, "rgi-v7-0-", `rgi-v${v.replace(".", "-")}-`);
  };
  const c = await loadCatalog(ROOT, fetchJson);
  assert.equal(c.version, "7.1");
  assert.match(c.collections.glaciers.dataUrl, /\/v7\.1\/glaciers\//);
});

test("the children of one catalog are fetched in parallel", async () => {
  const plain = fixtureFetch();
  let open = 0;
  let most = 0;
  const fetchJson = async (url) => {
    open += 1;
    most = Math.max(most, open);
    await new Promise((resolve) => setTimeout(resolve, 5));
    open -= 1;
    return plain(url);
  };
  const c = await loadCatalog(ROOT, fetchJson);
  assert.equal(c.version, "7.0");
  assert.ok(most >= 5, `the five collections load together, not one by one (at most ${most} at once)`);
});

test("a child that fails to load rejects the walk", async () => {
  const plain = fixtureFetch();
  const fetchJson = async (url) => {
    if (url.includes("/centerlines/")) throw new Error("centerlines: HTTP 503");
    return plain(url);
  };
  await assert.rejects(loadCatalog(ROOT, fetchJson), /centerlines: HTTP 503/);
});

test("the catalog carries the complexes column descriptions", async () => {
  const c = await loadCatalog(ROOT, fixtureFetch());
  assert.match(c.complexColumns.get("glacier_ids").description, /rgi_id of every glacier in this complex/);
  assert.equal(c.complexColumns.has("complex_id"), false, "the complexes table, not the glaciers table");
});
