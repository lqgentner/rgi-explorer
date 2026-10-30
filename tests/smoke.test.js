/* Checks the published catalog end to end. Runs only with SMOKE=1. */

import assert from "node:assert/strict";
import test from "node:test";

import * as hyparquet from "hyparquet";
import { PMTiles } from "pmtiles";

import { DISPLAY } from "../js/columns.js";
import { CATALOG_URL, HYPSO_BAND_M } from "../js/config.js";
import { loadCatalog } from "../js/catalog.js";

globalThis.hyparquet = hyparquet;
const { SEARCH_COLUMNS, openParquet, readColumns } = await import("../js/parquet.js");

const ROOT = process.env.SMOKE_CATALOG || CATALOG_URL;
const LAYERS = ["glaciers", "regions", "region-boundaries", "region-labels", "glacier-labels", "centerlines", "intersects"];
const GLACIER_COUNT = 274531;

test("the live catalog serves the data the page reads", { skip: process.env.SMOKE !== "1", timeout: 120_000 }, async (t) => {
  const catalog = await loadCatalog(ROOT);
  const { glaciers } = catalog.collections;

  await t.test("resolves all five collections", () => {
    assert.deepEqual(Object.keys(catalog.collections).sort(), [
      "centerlines",
      "complexes",
      "glaciers",
      "intersects",
      "regions",
    ]);
  });

  await t.test("describes every displayed column", () => {
    for (const { column } of DISPLAY) assert.ok(catalog.columns.has(column), `no description for ${column}`);
  });

  await t.test("states the hypsometry band height", () => {
    const { description } = catalog.columns.get("hypso_z0_m");
    assert.ok(description.includes(`+ ${HYPSO_BAND_M} * n`), description);
  });

  await t.test("lists every tile layer", async () => {
    const metadata = await new PMTiles(glaciers.pmtilesUrl).getMetadata();
    const ids = (metadata.vector_layers ?? []).map((layer) => layer.id);
    for (const name of LAYERS) assert.ok(ids.includes(name), `missing layer ${name} in ${ids}`);
  });

  await t.test("reads the GeoParquet", async () => {
    const handle = await openParquet(glaciers.dataUrl);
    const rows = handle.groups.reduce((sum, group) => sum + group.count, 0);
    assert.equal(rows, GLACIER_COUNT, "the glacier count changed: update GLACIER_COUNT for a new mirror revision");

    const names = new Set(handle.metadata.schema.map((element) => element.name));
    for (const column of SEARCH_COLUMNS) assert.ok(names.has(column), `no column ${column}`);

    const { display_name: displayNames } = await readColumns(handle, ["display_name"], 0);
    assert.ok(
      displayNames.some((name) => typeof name === "string" && name.length > 0),
      "row group 0 holds no display_name",
    );
  });
});
