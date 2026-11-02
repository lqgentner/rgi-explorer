/* "Use this data" tells when it opens and closes, so the tour can follow it. */

import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

import { load, loadPage } from "./helpers/browser.js";

const ROOT = "https://data.source.coop/lqgentner/rgi/catalog.json";
const DIR = new URL("./fixtures/catalog/", import.meta.url);
const { document } = await loadPage({ fetch: async () => new Response("{}", { status: 404 }) });
const { loadCatalog } = await load("js/catalog.js");
const { mountUseData } = await load("js/usedata.js");
const catalog = await loadCatalog(ROOT, async (url) =>
  JSON.parse(fs.readFileSync(new URL(url.slice(ROOT.length - "catalog.json".length), DIR), "utf8")));

test("onToggle hears the dialog open and close, once each", () => {
  const calls = [];
  const useData = mountUseData(document.body, { catalog, onToggle: (open) => calls.push(open) });
  const glacier = { rgiId: "RGI2000-v7.0-G-11-02596", o1region: "11" };
  useData.open(glacier);
  useData.open(glacier);
  useData.close();
  useData.close();
  assert.deepEqual(calls, [true, false]);
});
