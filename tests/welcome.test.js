/* The first-visit welcome: its text, the user guide link, and the mark that keeps it gone. */

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import { loadPage, load } from "./helpers/browser.js";

const page = await loadPage();
const { window, document } = page;
const { mountWelcome, welcomeTitle } = await load("js/welcome.js");

const KEY = "rgi-explorer:welcome";
const TITLE = "Explore the 274,531 glaciers of RGI 7.0";
const button = (root, label) => [...root.querySelectorAll("button")].find((b) => b.textContent === label);

function welcome(extra = {}) {
  const root = document.createElement("div");
  document.body.append(root);
  const calls = { tour: 0 };
  const api = mountWelcome(root, { title: TITLE, autoShow: true, onTour: () => (calls.tour += 1), ...extra });
  return { root, api, calls };
}

beforeEach(() => window.localStorage.clear());

test("the title names the glacier count and the version, or the version alone", () => {
  assert.equal(welcomeTitle(274531, "7.0"), TITLE);
  assert.equal(welcomeTitle(null, "7.0"), "Explore the glaciers of RGI 7.0");
});

test("on a first visit the welcome shows its heading, two lines, the user guide and the tour", () => {
  const { api } = welcome();
  const node = api.node;
  assert.equal(api.shown, true);
  assert.equal(node.hidden, false);
  assert.equal(node.tagName, "SECTION");
  const heading = node.querySelector("h2");
  assert.equal(heading.textContent, TITLE);
  assert.equal(node.getAttribute("aria-labelledby"), heading.id);
  assert.ok(node.textContent.includes("Search for a glacier or click one on the map."));
  assert.ok(node.textContent.includes("New to RGI? "));
  const link = node.querySelector("a");
  assert.equal(link.textContent, "Read the user guide");
  assert.equal(link.href, "https://rgidata.org/user_guide/");
  assert.equal(link.target, "_blank");
  assert.equal(link.rel, "noopener noreferrer");
  assert.ok(button(node, "Take the tour"));
  assert.ok(node.querySelector('button[aria-label="Close"]'));
  assert.equal(button(node, "Start exploring"), undefined);
});

test("the close button hides the welcome for good", () => {
  const { api } = welcome();
  api.node.querySelector('button[aria-label="Close"]').click();
  assert.equal(api.node.hidden, true);
  assert.equal(api.shown, false);
  assert.equal(window.localStorage.getItem(KEY), "seen");
  assert.equal(welcome().api.node.hidden, true, "a later visit shows no welcome");
});

test("Take the tour hides the welcome, marks it seen and starts the tour", () => {
  const { api, calls } = welcome();
  button(api.node, "Take the tour").click();
  assert.equal(api.node.hidden, true);
  assert.equal(window.localStorage.getItem(KEY), "seen");
  assert.equal(calls.tour, 1);
});

test("without autoShow the welcome stays hidden, and dismissing it marks nothing", () => {
  const { api } = welcome({ autoShow: false });
  assert.equal(api.node.hidden, true);
  api.dismiss();
  assert.equal(window.localStorage.getItem(KEY), null);
});

test("dismissing a shown welcome marks it seen", () => {
  const { api } = welcome();
  api.dismiss();
  assert.equal(api.node.hidden, true);
  assert.equal(window.localStorage.getItem(KEY), "seen");
});

test("show() brings the welcome back after it was seen", () => {
  window.localStorage.setItem(KEY, "seen");
  const { api } = welcome();
  assert.equal(api.node.hidden, true);
  api.show();
  assert.equal(api.node.hidden, false);
  assert.equal(api.shown, true);
});

test("a catalog without a count gives a heading without a number", () => {
  const { api } = welcome({ title: welcomeTitle(null, "7.0") });
  assert.equal(api.node.querySelector("h2").textContent, "Explore the glaciers of RGI 7.0");
});
