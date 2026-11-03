/* The whole page on a desktop: the first-visit welcome, the help button and the tour. */

import assert from "node:assert/strict";
import { test } from "node:test";

import * as hyparquet from "hyparquet";

import { load, loadPage, waitFor } from "./helpers/browser.js";
import { makeParquet, servedFetch } from "./helpers/served.js";

const UPSALA = "RGI2000-v7.0-G-17-04760";
const page = await loadPage({ fetch: servedFetch(makeParquet()) });
const { document, window } = page;
window.localStorage.clear();
globalThis.hyparquet = hyparquet;
await load("js/app.js");
await waitFor(() => document.querySelector("#search input"));

const $ = (sel) => document.querySelector(sel);
const click = (node) => node.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
const button = (root, label) => [...root.querySelectorAll("button")].find((b) => b.textContent === label && !b.hidden);
const ringed = () => [...document.querySelectorAll(".tour-target")];
const help = () => $("#controls .help-btn");

async function pick(text, title) {
  const input = $("#search input");
  input.focus();
  input.value = text;
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
  click(await waitFor(() => [...document.querySelectorAll("#search li")].find((li) => li.querySelector(".title").textContent === title)));
}

test("a first visit shows the welcome with the glacier count, and help ends the controls", async () => {
  const welcome = await waitFor(() => $("#sidebar .welcome"));
  assert.equal(welcome.hidden, false);
  assert.equal(welcome.querySelector("h2").textContent, "Explore the 274,531 glaciers of the Randolph Glacier Inventory\u00a07.0");
  assert.equal($("#controls").lastElementChild, help());
});

test("opening a glacier hides the welcome for good", async () => {
  await pick("aletsch", "Grosser Aletsch Gletscher");
  await waitFor(() => location.search.includes("glacier="));
  assert.equal($(".welcome").hidden, true);
  assert.equal(window.localStorage.getItem("rgi-explorer:welcome"), "seen");
});

test("help with a card open closes the card and shows the welcome", async () => {
  await waitFor(() => document.body.classList.contains("card-open"));
  click(help());
  assert.equal(document.body.classList.contains("card-open"), false);
  assert.ok(!location.search.includes("glacier="));
  assert.equal($(".welcome").hidden, false);
  assert.equal(document.activeElement, help());
});

const title = () => document.getElementById($(".tour").getAttribute("aria-labelledby")).textContent;
const usedataOpen = () => $("dialog.usedata").open || $("dialog.usedata").hasAttribute("open");

test("the tour moves on as the reader acts: a glacier, the card, Use this data, Layers", async () => {
  click(button($(".welcome"), "Take the tour"));
  assert.equal(title(), "Find a glacier");
  assert.deepEqual(ringed(), [$("#search input")]);
  click(button($(".tour"), "Take me to a glacier"));
  await waitFor(() => location.search.includes(`glacier=${UPSALA}`));
  await waitFor(() => title() === "The glacier card");
  assert.ok($(".tour").textContent.includes("2 of 4"));
  assert.deepEqual(ringed(), [$("#card")]);
  assert.ok(button($(".tour"), "Skip"));

  $("#card").scrollTop = 600;
  $("#card").dispatchEvent(new window.Event("scroll"));
  assert.equal(button($(".tour"), "Skip"), undefined, "a scroll of the card counts");
  click(button($(".tour"), "Next"));
  assert.equal($("#card").scrollTop, 0, "the card scrolls back so the step's button shows");
  assert.equal(title(), "Use this data");
  const [useData] = ringed();
  assert.equal(useData.dataset.tour, "use-data");
  assert.equal(useData.closest("[hidden]"), null, "the ring is on the card's own, visible button");

  click(useData);
  assert.ok(usedataOpen());
  assert.ok($(".tour").classList.contains("covering"));
  assert.ok($(".tour").textContent.includes("Close to continue the tour"));
  click($('dialog.usedata button[aria-label="Close"]'));
  assert.equal(title(), "Layers");
  assert.deepEqual(ringed(), [$("#layers .layers-thumb")]);

  click($("#layers .layers-thumb"));
  assert.equal(title(), "Layers", "a click that only opens the drawer changes nothing");
  click($('#layers .layer-toggle[data-name="centerlines"]'));
  assert.equal(title(), "You're all set.", "one layer is enough");
  click(button($(".tour"), "Done"));
  assert.equal($(".tour"), null);
  assert.equal(document.activeElement, help());
});

test("a keyboard switch to Hypsometry counts as using the card", async () => {
  /* Leave the layers as a first visit has them. */
  click($('#layers .layer-toggle[data-name="centerlines"]'));
  click(help());
  click(button($(".welcome"), "Take the tour"));
  click(button($(".tour"), "Take me to a glacier"));
  await waitFor(() => $(".tour") && title() === "The glacier card");
  const overview = $("#card-tab-overview");
  click(overview);
  assert.ok(button($(".tour"), "Skip"), "a switch back to Overview is not the switch the step asks for");
  overview.focus();
  overview.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  assert.ok(button($(".tour"), "Next"));
});

test("Use this data closed by a tap on empty map goes back to step 1", async () => {
  click(button($(".tour"), "Next"));
  assert.equal(title(), "Use this data");
  click(ringed()[0]);
  assert.ok($(".tour").classList.contains("covering"));
  page.map.fire("click", { point: { x: 900, y: 400 } });
  assert.equal(document.body.classList.contains("card-open"), false);
  assert.ok(!usedataOpen());
  assert.equal(title(), "Find a glacier");
});

test("help during the tour ends it, closes the card and shows the welcome", async () => {
  click(button($(".tour"), "Take me to a glacier"));
  await waitFor(() => title() === "The glacier card");
  click(help());
  assert.equal($(".tour"), null);
  assert.deepEqual(ringed(), []);
  assert.equal(document.body.classList.contains("card-open"), false);
  assert.equal($(".welcome").hidden, false);
  assert.equal(document.activeElement, help());
});
