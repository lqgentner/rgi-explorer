/*
 * The library globals that the inline module in index.html assigns before
 * js/app.js runs, so that tests can substitute fakes. Type-only: nothing here
 * is loaded by the page.
 */
import type * as maplibreglModule from "maplibre-gl";
import type * as pmtilesModule from "pmtiles";
import type * as hyparquetModule from "hyparquet";

declare global {
  var maplibregl: typeof maplibreglModule;
  var pmtiles: typeof pmtilesModule;
  var hyparquet: typeof hyparquetModule;
}
