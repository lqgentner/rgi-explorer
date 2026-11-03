/* The whole page on a phone: the help button rides with the credits, and the tour points at the sheet. */

import assert from "node:assert/strict";
import { test } from "node:test";

import * as hyparquet from "hyparquet";

import { load, loadPage, settle, waitFor } from "./helpers/browser.js";
import { parquetFiles, servedFetch } from "./helpers/served.js";

const page = await loadPage({ phone: true, fetch: servedFetch(parquetFiles()) });
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
  assert.equal(title(), "Layers");
  assert.equal($("#sheet").dataset.level, "compact", "the sheet lowers so the Layers button shows");
  assert.deepEqual(ringed(), [$("#layers .layers-open")], "the ring is on the round button");
  assert.equal($(".tour").dataset.dock, undefined, "at the top, level with the round button");
  page.setPhone(false);
  assert.equal(title(), "Layers");
  assert.deepEqual(ringed(), [$("#layers .layers-thumb")], "on the desktop the ring is on the control's picture");
  page.setPhone(true);

  /* The pane covers the tour, as Use this data does: the message asks to close it. */
  click($("#layers .layers-open"));
  assert.ok($(".tour").classList.contains("covering"));
  assert.ok($(".tour").textContent.includes("Close to continue the tour"));
  assert.deepEqual(ringed(), [$('.layers-pane button[aria-label="Close"]')], "the ring points at the pane's close button");
  assert.notEqual($(".tour").style.getPropertyValue("--tour-above"), "", "the message is placed from the pane's height");
  click([...document.querySelectorAll(".layers-pane .base-tile")].find((b) => b.textContent.includes("Imagery")));
  assert.ok($(".tour").classList.contains("covering"), "still covered until the pane closes");
  click($('.layers-pane button[aria-label="Close"]'));
  assert.ok(!$(".tour").classList.contains("covering"));
  assert.equal(title(), "You're all set.");
  page.setPhone(false);
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

test("a search pick opens the sheet to the middle, which is not the reader's use of the card", async () => {
  click($(".tour-close"));
  click($('#search button[aria-label="Close"]'));
  click($(".help-btn"));
  click(button($(".welcome"), "Take the tour"));
  const input = $("#search input");
  input.value = "aletsch";
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
  click(await waitFor(() => [...document.querySelectorAll("#search li")]
    .find((li) => li.querySelector(".title").textContent === "Grosser Aletsch Gletscher")));
  await waitFor(() => title() === "The glacier card");
  assert.equal($("#sheet").dataset.level, "middle");
  await settle();
  assert.ok(button($(".tour"), "Skip"));
  assert.equal(button($(".tour"), "Next"), undefined);
});

test("crossing the breakpoint is not the reader's use of the card, a tap on the photo strip is", async () => {
  page.setPhone(false);
  await settle();
  assert.equal(title(), "The glacier card");
  assert.equal($("#sheet").dataset.level, "full", "on the desktop the sheet carries the full level");
  assert.ok(button($(".tour"), "Skip"));
  assert.equal(button($(".tour"), "Next"), undefined);
  page.setPhone(true);
  await settle();
  assert.equal($("#sheet").dataset.level, "compact");
  assert.ok(button($(".tour"), "Skip"));
  click($("#sheet"));
  await waitFor(() => button($(".tour"), "Next"));
});
