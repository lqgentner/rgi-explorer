/*
 * A fake fetch for whole-page tests. It answers the catalog fixture, Liberty and
 * the generated GeoParquet fixtures, with HEAD and single byte ranges as the
 * data host does.
 */

import fs from "node:fs";
import path from "node:path";

import { REPO } from "./browser.js";

export const DATA = "https://data.source.coop/lqgentner/rgi/";
export const GLACIERS_URL = `${DATA}v7.0/glaciers/rgi7.0-glaciers.parquet`;
export const COMPLEXES_URL = `${DATA}v7.0/complexes/rgi7.0-complexes.parquet`;
export const REGIONS_URL = `${DATA}v7.0/regions/rgi7.0-regions.parquet`;
const LIBERTY = "https://tiles.openfreemap.org/styles/liberty";
const FIXTURES = path.join(REPO, "tests", "fixtures");
/* The glaciers, complexes and regions fixtures that scripts/make_fixture_parquet.py writes. */
export const PARQUET_DIR = path.join(FIXTURES, "parquet");

/** The parquet fixtures as bytes, by the URL the catalog fixture gives each. */
export function parquetFiles() {
  return {
    [GLACIERS_URL]: fs.readFileSync(path.join(PARQUET_DIR, "glaciers.parquet")),
    [COMPLEXES_URL]: fs.readFileSync(path.join(PARQUET_DIR, "complexes.parquet")),
    [REGIONS_URL]: fs.readFileSync(path.join(PARQUET_DIR, "regions.parquet")),
  };
}

/**
 * The catalog fixture, read through `loadCatalog` from the page's own copy of
 * js/catalog.js, which `load()` returns.
 */
export function fixtureCatalog(loadCatalog) {
  return loadCatalog(`${DATA}catalog.json`, async (url) =>
    JSON.parse(fs.readFileSync(path.join(FIXTURES, "catalog", url.slice(DATA.length)), "utf8")));
}

/**
 * A JSON fixture. An asset served from `files` gets that file's size as its
 * file:size, as the published catalog gives each file's own.
 */
function json(file, url = "", files = {}) {
  const body = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const asset of Object.values(body.assets ?? {})) {
    const served = files[new URL(asset.href, url || "https://invalid/").href];
    if (served) asset["file:size"] = served.length;
  }
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

function bytes(data, method, range) {
  if (method === "HEAD") {
    return new Response(null, { status: 200, headers: { "Content-Length": String(data.length) } });
  }
  const match = /^bytes=(\d+)-(\d*)$/.exec(range ?? "");
  if (!match) return new Response(data, { status: 200 });
  const start = Number(match[1]);
  /* S3 refuses a range that starts past the end. */
  if (start >= data.length) {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${data.length}` } });
  }
  const end = match[2] ? Math.min(Number(match[2]) + 1, data.length) : data.length;
  return new Response(data.subarray(start, end), {
    status: 206,
    headers: { "Content-Range": `bytes ${start}-${end - 1}/${data.length}` },
  });
}

/**
 * A fetch over `files` (URL to bytes) and the JSON fixtures. Every request is
 * pushed to `log` as `{ url, method }`. `extra(url)` may answer first with a
 * Response. Anything else answers 404.
 */
export function servedFetch(files, log = [], extra = () => null) {
  return async (input, init = {}) => {
    const url = String(input?.url ?? input);
    const method = init.method ?? "GET";
    log.push({ url, method, cache: init.cache });
    const answer = await extra(url, init);
    if (answer) return answer;
    if (files[url]) return bytes(files[url], method, new Headers(init.headers).get("Range"));
    if (url === LIBERTY) return json(path.join(FIXTURES, "liberty.json"));
    if (url.startsWith(DATA) && url.endsWith(".json")) {
      const file = path.join(FIXTURES, "catalog", url.slice(DATA.length));
      if (file.startsWith(path.join(FIXTURES, "catalog")) && fs.existsSync(file)) return json(file, url, files);
    }
    return new Response("{}", { status: 404 });
  };
}
