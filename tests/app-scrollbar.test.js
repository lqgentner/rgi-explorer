/* The desktop sidebar measures its scrollbar and keeps it outside the content. */

import assert from "node:assert/strict";
import { test } from "node:test";

import * as hyparquet from "hyparquet";

import { load, loadPage, waitFor } from "./helpers/browser.js";
import { makeParquet, servedFetch } from "./helpers/served.js";

const ID = "RGI2000-v7.0-G-11-00001";

test("the sidebar measures its scrollbar, keeps it outside the content and fits the map past it", async () => {
  const page = await loadPage({ url: `https://lqgentner.github.io/rgi-explorer/?glacier=${ID}`, fetch: servedFetch(makeParquet()) });
  globalThis.hyparquet = hyparquet;
  const card = page.document.getElementById("card");
  let outer = 423;
  Object.defineProperty(card, "offsetWidth", { get: () => outer });
  Object.defineProperty(card, "clientWidth", { get: () => 408 });
  await load("js/app.js");
  const root = page.document.documentElement;
  await waitFor(() => page.map?.lastFit);
  assert.equal(root.style.getPropertyValue("--scrollbar"), "15px");
  assert.equal(page.map.lastFit.options.padding.left, 408 + 15 + 24);
  outer = 425;
  page.window.dispatchEvent(new page.window.Event("resize"));
  assert.equal(root.style.getPropertyValue("--scrollbar"), "17px", "zoom changes the width, so a resize measures again");
  page.setPhone(true);
  assert.equal(root.style.getPropertyValue("--scrollbar"), "0px", "the phone has no sidebar");
  page.map.fire("idle");
});
