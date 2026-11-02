/* The viewer tells when it opens and closes, by any route, so the tour can follow it. */

import assert from "node:assert/strict";
import { test } from "node:test";

import { load, loadPage } from "./helpers/browser.js";

const { document, window } = await loadPage();
const { onViewerToggle, openViewer } = await load("js/viewer.js");
const { h } = await load("js/ui.js");

const item = { alt: "Image", large: () => null, credit: () => h("div", {}, "credit") };
const dialog = () => document.querySelector("dialog.viewer");

test("onViewerToggle hears the viewer open and close, by its button and by Escape", () => {
  const calls = [];
  onViewerToggle((open) => calls.push(open));
  openViewer([item], 0, {});
  dialog().querySelector('button[aria-label="Close"]').click();
  assert.deepEqual(calls, [true, false]);
  openViewer([item], 0, {});
  dialog().dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.deepEqual(calls, [true, false, true, false]);
});
