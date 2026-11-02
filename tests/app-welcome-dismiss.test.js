/* The welcome closes once the reader starts using the map or the search: they don't want the tour. */

import assert from "node:assert/strict";
import { test } from "node:test";

import * as hyparquet from "hyparquet";

import { load, loadPage, waitFor } from "./helpers/browser.js";
import { makeParquet, servedFetch } from "./helpers/served.js";

const page = await loadPage({ fetch: servedFetch(makeParquet()) });
const { document, window } = page;
window.localStorage.clear();
globalThis.hyparquet = hyparquet;
await load("js/app.js");
const welcome = await waitFor(() => document.querySelector(".welcome:not([hidden])"));
const help = () => document.querySelector(".help-btn");

test("the page's own camera moves leave the welcome; a wheel zoom by the reader closes it for good", () => {
  page.map.fire("movestart", {});
  assert.equal(welcome.hidden, false);
  page.map.fire("movestart", { originalEvent: new window.Event("wheel") });
  assert.equal(welcome.hidden, true);
  assert.equal(window.localStorage.getItem("rgi-explorer:welcome"), "seen");
});

test("focusing the search closes the welcome Help brought back", () => {
  help().click();
  assert.equal(welcome.hidden, false);
  document.querySelector("#search input").focus();
  assert.equal(welcome.hidden, true);
});

test("a click on the map closes the welcome too", () => {
  help().click();
  assert.equal(welcome.hidden, false);
  page.map.fire("click", { point: { x: 900, y: 400 } });
  assert.equal(welcome.hidden, true);
});
