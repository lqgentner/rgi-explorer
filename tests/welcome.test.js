/* The first-visit welcome: its text, the user guide link, and the mark that keeps it gone. */

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import { loadPage, load } from "./helpers/browser.js";

const page = await loadPage();
const { window, document } = page;
const { mountHelp, mountWelcome, welcomeTitle } = await load("js/welcome.js");

const KEY = "rgi-explorer:welcome";
const TITLE = "Explore the 274,531 glaciers of the Randolph Glacier Inventory\u00a07.0";
const button = (root, label) => [...root.querySelectorAll("button")].find((b) => b.textContent === label);

function welcome(extra = {}) {
  const root = document.createElement("div");
  document.body.append(root);
  const calls = { tour: 0, privacy: 0 };
  const api = mountWelcome(root, {
    title: TITLE,
    autoShow: true,
    onTour: () => (calls.tour += 1),
    onPrivacy: () => (calls.privacy += 1),
    ...extra,
  });
  return { root, api, calls };
}

beforeEach(() => window.localStorage.clear());

test("the title names the glacier count and the version, or the version alone", () => {
  assert.equal(welcomeTitle(274531, "7.0"), TITLE);
  assert.equal(welcomeTitle(null, "7.0"), "Explore the glaciers of the Randolph Glacier Inventory\u00a07.0");
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
  const lines = node.querySelectorAll("p");
  assert.equal(lines.length, 1, "one paragraph, to save a line on the phone");
  assert.equal(lines[0].textContent, "Search for a glacier or click one on the map. New to RGI? Read the user guide.");
  const link = node.querySelector("a");
  assert.equal(link.textContent, "Read the user guide");
  const tail = link.querySelector(".nowrap");
  assert.equal(tail?.textContent, "guide", "the last word and the icon stay on one line");
  assert.ok(tail.querySelector("svg.icon"));
  assert.equal(link.href, "https://rgidata.org/user_guide/");
  assert.equal(link.target, "_blank");
  assert.equal(link.rel, "noopener noreferrer");
  assert.ok(button(node, "Take the tour"));
  assert.ok(node.querySelector('button[aria-label="Close"]'));
  assert.equal(button(node, "Start exploring"), undefined);
});

test("Privacy shares the tour's row, opens the note and leaves the welcome open", () => {
  const { api, calls } = welcome();
  const privacy = button(api.node, "Privacy");
  assert.ok(privacy, "a Privacy button");
  assert.equal(privacy.type, "button");
  assert.equal(privacy.parentElement, button(api.node, "Take the tour").parentElement, "one row with the tour");
  assert.ok(privacy.compareDocumentPosition(button(api.node, "Take the tour")) & window.Node.DOCUMENT_POSITION_FOLLOWING, "Privacy comes first");
  privacy.click();
  assert.equal(calls.privacy, 1);
  assert.equal(api.node.hidden, false, "reading the note does not close the welcome");
  assert.equal(window.localStorage.getItem(KEY), null);
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
  assert.equal(api.node.querySelector("h2").textContent, "Explore the glaciers of the Randolph Glacier Inventory\u00a07.0");
});

test("the help button ends the desktop controls, calls onHelp, and moves beside the credits on the phone", () => {
  const desktop = document.createElement("div");
  desktop.append(document.createElement("button"));
  const phone = document.createElement("div");
  phone.append(Object.assign(document.createElement("div"), { className: "credits-box" }));
  let helped = 0;
  const { button: help } = mountHelp({ desktop, phone }, { onHelp: () => (helped += 1) });
  assert.equal(help.getAttribute("aria-label"), "Help");
  assert.equal(help.type, "button");
  assert.ok(help.classList.contains("help-btn"));
  assert.ok(help.querySelector("use")?.getAttribute("href").endsWith("#circle-question-mark"));
  assert.equal(desktop.lastElementChild, help);
  help.click();
  assert.equal(helped, 1);

  page.setPhone(true);
  assert.equal(phone.firstElementChild, help, "on the phone it sits before the credits");
  page.setPhone(false);
  assert.equal(desktop.lastElementChild, help, "back across the breakpoint it ends the controls again");
});

test("links out of the explorer share the card's accent blue and icon size wherever they sit", async () => {
  const fs = await import("node:fs");
  const css = fs.readFileSync(new URL("../style.css", import.meta.url), "utf8");
  assert.match(css, /\na\.external \{\s*color: var\(--accent\);\s*\}/);
  assert.match(css, /\na\.external \.icon \{\s*width: 0\.9em;/);
});

test("the welcome and the tour have concentric corners: the button radius plus 12 px of padding", async () => {
  const fs = await import("node:fs");
  const css = fs.readFileSync(new URL("../style.css", import.meta.url), "utf8");
  assert.match(css, /--card-radius: calc\(var\(--radius\) \+ 12px\);/);
  for (const selector of ["welcome", "tour"]) {
    const rule = new RegExp(`\\n\\.${selector} \\{[^}]*\\}`).exec(css)?.[0] ?? "";
    assert.match(rule, /border-radius: var\(--card-radius\);/, `.${selector} radius`);
    assert.match(rule, /padding: 12px;/, `.${selector} padding`);
  }
});
