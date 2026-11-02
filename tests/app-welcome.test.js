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
  assert.equal(welcome.querySelector("h2").textContent, "Explore the 274,531 glaciers of RGI\u00a07.0");
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

test("the tour waits for a glacier, takes the reader to Upsala and ends on Use this data", async () => {
  click(button($(".welcome"), "Take the tour"));
  assert.deepEqual(ringed(), [$("#search")]);
  click(button($(".tour"), "Next"));
  assert.ok($(".tour").textContent.includes("2 of 4"));
  click(button($(".tour"), "Take me to a glacier"));
  await waitFor(() => location.search.includes(`glacier=${UPSALA}`));
  await waitFor(() => ringed()[0] === $("#card"));
  assert.ok(button($(".tour"), "Next"));

  click(button($(".tour"), "Next"));
  const [useData] = ringed();
  assert.equal(useData.dataset.tour, "use-data");
  assert.equal(useData.closest("[hidden]"), null, "the ring is on the card's own, visible button");
  click(useData);
  assert.equal($(".tour"), null);
  assert.deepEqual(ringed(), []);
  assert.ok($("dialog.usedata").open || $("dialog.usedata").hasAttribute("open"));
  assert.notEqual(document.activeElement, help(), "the data dialog keeps the focus");
});

test("help during the tour ends it, closes the card and shows the welcome", async () => {
  $("dialog.usedata").removeAttribute("open");
  click(help());
  click(button($(".welcome"), "Take the tour"));
  click(button($(".tour"), "Next"));
  click(button($(".tour"), "Take me to a glacier"));
  await waitFor(() => ringed()[0] === $("#card"));
  click(help());
  assert.equal($(".tour"), null);
  assert.deepEqual(ringed(), []);
  assert.equal(document.body.classList.contains("card-open"), false);
  assert.equal($(".welcome").hidden, false);
  assert.equal(document.activeElement, help());
});
