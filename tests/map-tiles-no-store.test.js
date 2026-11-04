/* The map reads the RGI PMTiles archive past the HTTP cache, through the real pmtiles library. */

import assert from "node:assert/strict";
import test from "node:test";

import * as pmtiles from "pmtiles";

import { loadCatalog } from "../js/catalog.js";
import { parseState } from "../js/state.js";
import { load, loadPage } from "./helpers/browser.js";
import { servedFetch } from "./helpers/served.js";

const ARCHIVE = "https://data.source.coop/lqgentner/rgi/v7.0/rgi7.0.pmtiles";

test("a tile request reads the archive with cache: no-store", async () => {
  const log = [];
  const url = "https://lqgentner.github.io/rgi-explorer/";
  const page = await loadPage({ url, fetch: servedFetch({}, log) });
  globalThis.pmtiles = pmtiles;
  let handler = null;
  globalThis.maplibregl.addProtocol = (name, fn) => {
    if (name === "pmtiles") handler = fn;
  };
  const { createMap } = await load("js/map.js");
  const catalog = await loadCatalog("https://data.source.coop/lqgentner/rgi/catalog.json");
  await createMap(page.document.getElementById("map"), catalog, parseState(new URL(url)));

  assert.ok(handler, "no pmtiles protocol");
  /* The archive is not served, so the read fails after its first request. */
  await handler({ url: `pmtiles://${ARCHIVE}/0/0/0`, type: "arrayBuffer" }, new AbortController()).catch(() => {});
  const reads = log.filter((r) => r.url === ARCHIVE);
  assert.ok(reads.length > 0, "the archive was not read");
  assert.deepEqual(reads.map((r) => r.cache), reads.map(() => "no-store"));
});
