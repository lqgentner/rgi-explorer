/* The whole page on a phone: the help button rides with the credits, and the tour points at the sheet. */

import assert from "node:assert/strict";
import { test } from "node:test";

import * as hyparquet from "hyparquet";

import { load, loadPage, waitFor } from "./helpers/browser.js";
import { makeParquet, servedFetch } from "./helpers/served.js";

const page = await loadPage({ phone: true, fetch: servedFetch(makeParquet()) });
const { document, window } = page;
window.localStorage.clear();
globalThis.hyparquet = hyparquet;
await load("js/app.js");
await waitFor(() => document.querySelector("#search input"));

const $ = (sel) => document.querySelector(sel);
const click = (node) => node.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
const button = (root, label) => [...root.querySelectorAll("button")].find((b) => b.textContent === label && !b.hidden);
const ringed = () => [...document.querySelectorAll(".tour-target")];

test("on the phone the help button sits in the status line before the credits", async () => {
  const help = await waitFor(() => $(".help-btn"));
  assert.equal(help.parentElement, $("#status"));
  assert.equal($("#status").firstElementChild, help);
  assert.ok(help.compareDocumentPosition($("#status .credits-box")) & window.Node.DOCUMENT_POSITION_FOLLOWING);
});

const title = () => document.getElementById($(".tour").getAttribute("aria-labelledby")).textContent;
const text = () => $(".tour p").textContent;

test("on the phone the card step asks to swipe up, raising the sheet counts, and the breakpoint swaps it", async () => {
  click(button($(".welcome"), "Take the tour"));
  click(button($(".tour"), "Take me to a glacier"));
  await waitFor(() => $(".tour") && title() === "The glacier card");
  assert.deepEqual(ringed(), [$("#sheet")]);
  assert.ok(text().startsWith("Swipe up to see its area, elevations and hypsometry."));
  assert.ok(button($(".tour"), "Skip"));

  click($("#sheet-handle"));
  await waitFor(() => button($(".tour"), "Next"));

  assert.notEqual($("#sheet").dataset.level, "compact");
  click(button($(".tour"), "Next"));
  click(button($(".tour"), "Skip"));
  assert.equal(title(), "3D");
  assert.equal($("#sheet").dataset.level, "compact", "the sheet lowers so the 3D button shows");
  page.setPhone(false);
  assert.equal(title(), "3D");
});

test("across the breakpoint the card step swaps its text and ring", async () => {
  click($(".help-btn"));
  click(button($(".welcome"), "Take the tour"));
  click(button($(".tour"), "Take me to a glacier"));
  await waitFor(() => $(".tour") && title() === "The glacier card");
  assert.deepEqual(ringed(), [$("#card")]);
  assert.ok(text().startsWith("Its area, elevations and hypsometry."));
  assert.equal($(".help-btn").parentElement, $("#controls"));
  page.setPhone(true);
  assert.deepEqual(ringed(), [$("#sheet")]);
  assert.ok(text().startsWith("Swipe up to see"));
  assert.equal($(".help-btn").parentElement, $("#status"));
});
