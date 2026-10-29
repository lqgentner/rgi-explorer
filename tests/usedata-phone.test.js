/* "Use this data" on the phone: a pane in the sheet, not a dialog. */

import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

import { load, loadPage } from "./helpers/browser.js";

const ROOT = "https://data.source.coop/lqgentner/rgi/catalog.json";
const DIR = new URL("./fixtures/catalog/", import.meta.url);

const { document, window } = await loadPage({ phone: true });
const { loadCatalog } = await load("js/catalog.js");
const { snippet, mountUseData } = await load("js/usedata.js");
const catalog = await loadCatalog(ROOT, async (url) =>
  JSON.parse(fs.readFileSync(new URL(url.slice(ROOT.length - "catalog.json".length), DIR), "utf8")));
const ALETSCH = { rgiId: "RGI2000-v7.0-G-11-02596", o1region: "11" };

test("the phone opens a pane in the sheet with the same snippet", () => {
  const sheet = document.getElementById("sheet");
  const useData = mountUseData(sheet, { catalog });
  assert.equal(document.querySelector("dialog"), null);
  const pane = sheet.querySelector(".usedata-pane");
  assert.equal(pane.hidden, true);

  useData.open(ALETSCH);
  assert.equal(pane.hidden, false);
  assert.equal(pane.getAttribute("role"), "dialog");
  assert.equal(pane.querySelector(".usedata-code code").textContent,
    snippet({ tool: "python", scope: "glacier" }, ALETSCH, catalog).code);

  pane.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(pane.hidden, true);
  useData.open(ALETSCH);
  pane.querySelector(".usedata-close").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  assert.equal(pane.hidden, true);
});
