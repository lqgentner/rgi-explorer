/*
 * A fake fetch for whole-page tests. It answers the catalog fixture, Liberty and
 * the generated GeoParquet fixtures, with HEAD and single byte ranges as the
 * data host does.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { REPO } from "./browser.js";

export const DATA = "https://data.source.coop/lqgentner/rgi/";
export const GLACIERS_URL = `${DATA}v7.0/glaciers/rgi7.0-glaciers.parquet`;
export const COMPLEXES_URL = `${DATA}v7.0/complexes/rgi7.0-complexes.parquet`;
export const REGIONS_URL = `${DATA}v7.0/regions/rgi7.0-regions.parquet`;
const LIBERTY = "https://tiles.openfreemap.org/styles/liberty";
const FIXTURES = path.join(REPO, "tests", "fixtures");

/** The glaciers, complexes and regions fixture files as bytes, from scripts/make_fixture_parquet.py. */
export function makeParquet() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rgi-served-"));
  try {
    execFileSync("python", [path.join(REPO, "scripts", "make_fixture_parquet.py"), dir]);
    return {
      [GLACIERS_URL]: fs.readFileSync(path.join(dir, "glaciers.parquet")),
      [COMPLEXES_URL]: fs.readFileSync(path.join(dir, "complexes.parquet")),
      [REGIONS_URL]: fs.readFileSync(path.join(dir, "regions.parquet")),
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * The catalog fixture, read through `loadCatalog` from the page's own copy of
 * js/catalog.js, which `load()` returns.
 */
export function fixtureCatalog(loadCatalog) {
  return loadCatalog(`${DATA}catalog.json`, async (url) =>
    JSON.parse(fs.readFileSync(path.join(FIXTURES, "catalog", url.slice(DATA.length)), "utf8")));
}

const json = (file) =>
  new Response(fs.readFileSync(file), { status: 200, headers: { "Content-Type": "application/json" } });

function bytes(data, method, range) {
  if (method === "HEAD") {
    return new Response(null, { status: 200, headers: { "Content-Length": String(data.length) } });
  }
  const match = /^bytes=(\d+)-(\d*)$/.exec(range ?? "");
  if (!match) return new Response(data, { status: 200 });
  const start = Number(match[1]);
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
    log.push({ url, method });
    const answer = await extra(url, init);
    if (answer) return answer;
    if (files[url]) return bytes(files[url], method, new Headers(init.headers).get("Range"));
    if (url === LIBERTY) return json(path.join(FIXTURES, "liberty.json"));
    if (url.startsWith(DATA) && url.endsWith(".json")) {
      const file = path.join(FIXTURES, "catalog", url.slice(DATA.length));
      if (file.startsWith(path.join(FIXTURES, "catalog")) && fs.existsSync(file)) return json(file);
    }
    return new Response("{}", { status: 404 });
  };
}
