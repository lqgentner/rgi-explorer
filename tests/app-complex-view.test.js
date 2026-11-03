/* A shared ?complex= link with a view opens the panel and keeps the sender's view. */

import assert from "node:assert/strict";
import { test } from "node:test";

import * as hyparquet from "hyparquet";

import { load, loadPage, settle, waitFor } from "./helpers/browser.js";
import { parquetFiles, servedFetch } from "./helpers/served.js";

test("?complex= with a view opens the panel without a fit", async () => {
  const page = await loadPage({
    url: "https://lqgentner.github.io/rgi-explorer/?complex=RGI2000-v7.0-C-11-01323#12/46.5/8",
    fetch: servedFetch(parquetFiles()),
  });
  globalThis.hyparquet = hyparquet;
  await load("js/app.js");
  const panel = await waitFor(() => {
    const section = page.document.querySelector("#card section.complex-card");
    return section && !section.hidden && section.querySelector("table.members") && section;
  });
  await settle(10);
  assert.equal(panel.querySelector(".card-title").textContent, "RGI2000-v7.0-C-11-01323");
  assert.equal(page.map.layout("complex-outline").visibility, "visible");
  assert.equal(page.map.calls.filter((call) => call.startsWith("fitBounds")).length, 0, "the shared view stays");
  assert.equal(new URL(page.window.location.href).searchParams.get("complex"), "RGI2000-v7.0-C-11-01323");
});
