/* Without storage (a private window, blocked site data) the welcome still works, each visit anew. */

import assert from "node:assert/strict";
import { test } from "node:test";

import { loadPage, load } from "./helpers/browser.js";

const { window, document } = await loadPage();
Object.defineProperty(window, "localStorage", {
  configurable: true,
  get() {
    throw new window.DOMException("blocked", "SecurityError");
  },
});
const { mountWelcome } = await load("js/welcome.js");

const mount = () => {
  const root = document.createElement("div");
  document.body.append(root);
  return mountWelcome(root, { title: "Explore the glaciers of RGI 7.0", autoShow: true, onTour() {} });
};

test("without storage the welcome shows, closes, and shows again on the next visit", () => {
  const first = mount();
  assert.equal(first.node.hidden, false);
  assert.doesNotThrow(() => first.node.querySelector('button[aria-label="Close"]').click());
  assert.equal(first.node.hidden, true);
  assert.equal(mount().node.hidden, false);
});
