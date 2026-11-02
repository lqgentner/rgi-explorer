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

test("the tour's card step points at the sheet, and at the sidebar card across the breakpoint", async () => {
  click(button($(".welcome"), "Take the tour"));
  click(button($(".tour"), "Next"));
  click(button($(".tour"), "Take me to a glacier"));
  await waitFor(() => ringed()[0] === $("#sheet"));

  page.setPhone(false);
  assert.deepEqual(ringed(), [$("#card")]);
  assert.equal($(".help-btn").parentElement, $("#controls"));
});
