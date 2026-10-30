/* The URL state round-trips, falls back on bad values and keeps foreign parameters. */

import assert from "node:assert/strict";
import test from "node:test";

import { CATALOG_URL, DEFAULT_VIEW, resolveCatalogUrl, startView, viewForZone } from "../js/config.js";
import { parseState, writeState } from "../js/state.js";

const FULL =
  "https://x/rgi-explorer/?glacier=RGI2000-v7.0-G-11-02596&base=imagery&layers=regions,centerlines&3d=1#11/46.48/7.99";

test("round-trips a full state", () => {
  const s = parseState(new URL(FULL));
  assert.equal(s.glacier, "RGI2000-v7.0-G-11-02596");
  assert.deepEqual(s.view, { zoom: 11, lat: 46.48, lon: 7.99 });
  assert.equal(s.base, "imagery");
  assert.equal(s.terrain, true);
  assert.deepEqual([...s.layers], ["regions", "centerlines"]);
  assert.equal(writeState(s, new URL(FULL)), FULL);
});

test("defaults leave the query empty", () => {
  const s = parseState(new URL("https://x/rgi-explorer/"));
  assert.deepEqual([...s.layers], ["regions"]);
  assert.equal(writeState(s, new URL("https://x/rgi-explorer/")), "https://x/rgi-explorer/");
});

test("layers= with no value means every toggle off", () => {
  const url = new URL("https://x/?layers=");
  const s = parseState(url);
  assert.equal(s.layers.size, 0);
  assert.equal(writeState(s, url), "https://x/?layers=");
});

test("bad values fall back to defaults", () => {
  const s = parseState(new URL("https://x/?glacier=nonsense&base=moon&layers=foo,regions&3d=yes#abc"));
  assert.equal(s.glacier, null);
  assert.equal(s.base, "standard");
  assert.deepEqual([...s.layers], ["regions"]);
  assert.equal(s.terrain, false);
  assert.equal(s.view, null);
});

test("a glacier id of the wrong case or with padding is dropped", () => {
  for (const id of ["rgi2000-v7.0-g-11-02596", "%20RGI2000-v7.0-G-11-02596"]) {
    assert.equal(parseState(new URL(`https://x/?glacier=${id}`)).glacier, null, id);
  }
});

test("a hash out of range or half numeric gives no view", () => {
  for (const hash of ["#11/91/0", "#11/0/181", "#25/0/0", "#-1/0/0", "#11/-91/0", "#11/0/-181", "#Infinity/0/0", "#1e3/0/0", "#11/46.48", "#11/a/7.99", "#11/1/2/3"]) {
    assert.equal(parseState(new URL(`https://x/${hash}`)).view, null, hash);
  }
});

test("view numbers are rounded and trailing zeros dropped", () => {
  const state = parseState(new URL("https://x/"));
  state.view = { zoom: 3.14159, lat: 46.123456, lon: -7.5 };
  assert.equal(writeState(state, new URL("https://x/")), "https://x/#3.14/46.1235/-7.5");
});

test("a query parameter the state does not own survives writeState", () => {
  const url = new URL("https://x/rgi-explorer/?catalog=catalog/catalog.json&base=imagery");
  const s = parseState(url);
  s.base = "standard";
  s.terrain = true;
  assert.equal(writeState(s, url), "https://x/rgi-explorer/?catalog=catalog%2Fcatalog.json&3d=1");
});

test("the catalog is the published one without a catalog parameter", () => {
  assert.equal(resolveCatalogUrl(new URLSearchParams("")), CATALOG_URL);
  assert.equal(resolveCatalogUrl(new URLSearchParams("catalog=")), CATALOG_URL);
});

test("an absolute catalog parameter is kept", () => {
  const search = new URLSearchParams("catalog=https://other.example/c/catalog.json");
  assert.equal(resolveCatalogUrl(search, "https://x/"), "https://other.example/c/catalog.json");
});

test("a relative catalog parameter resolves against the page", () => {
  const search = new URLSearchParams("catalog=catalog/catalog.json");
  assert.equal(
    resolveCatalogUrl(search, "http://localhost:8000/?catalog=catalog/catalog.json"),
    "http://localhost:8000/catalog/catalog.json",
  );
});

test("a malformed catalog parameter falls back to the published catalog", () => {
  assert.equal(resolveCatalogUrl(new URLSearchParams("catalog=http://"), "https://x/"), CATALOG_URL);
  assert.equal(resolveCatalogUrl(new URLSearchParams("catalog=catalog/c.json"), undefined), CATALOG_URL);
});

test("a layers value with no known name takes the default toggles", () => {
  const url = new URL("https://x/rgi-explorer/?layers=bogus,nope");
  const s = parseState(url);
  assert.deepEqual([...s.layers], ["regions"]);
  assert.equal(writeState(s, url), "https://x/rgi-explorer/");
});

test("the opening view turns toward the time zone", () => {
  assert.deepEqual(viewForZone("Europe/Zurich", 1), { ...DEFAULT_VIEW, lat: 48, lon: 15 });
  assert.deepEqual(viewForZone("America/Los_Angeles", -8), { ...DEFAULT_VIEW, lat: 35, lon: -120 });
  assert.deepEqual(viewForZone("America/Argentina/Mendoza", -3), { ...DEFAULT_VIEW, lat: -15, lon: -45 });
  assert.deepEqual(viewForZone("Pacific/Kiritimati", 14), { ...DEFAULT_VIEW, lat: -15, lon: 180 });
});

test("a zone without an area keeps the default view", () => {
  assert.equal(viewForZone("UTC", 0), DEFAULT_VIEW);
  assert.equal(viewForZone("Etc/GMT+5", -5), DEFAULT_VIEW);
  assert.equal(viewForZone(undefined, 0), DEFAULT_VIEW);
  assert.equal(viewForZone("Europe/Zurich", Number.NaN), DEFAULT_VIEW);
});

test("startView reads the browser's zone", () => {
  const view = startView();
  assert.equal(view.zoom, DEFAULT_VIEW.zoom);
  assert.ok(Math.abs(view.lon) <= 180 && Math.abs(view.lat) <= 90);
});
