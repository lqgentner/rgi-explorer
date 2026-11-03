/* The phone's full screen search. Its own file for a phone page. */

import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { loadPage } from "./helpers/browser.js";

const { document, setPhone } = await loadPage({ phone: true });
const window = document.defaultView;
const { buildGlacierIndex } = await import("../js/search.js");
const { mountSearch } = await import("../js/searchbox.js");

const index = buildGlacierIndex(
  { rgi_id: ["RGI2000-v7.0-G-11-00001"], display_name: ["Aletsch"], glac_name: [null] },
  new Map([["11", "Central Europe"]]),
);

function setup() {
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ features: [] }) });
  document.body.replaceChildren();
  const sidebar = document.createElement("aside");
  const root = document.createElement("div");
  sidebar.append(root);
  const map = document.createElement("div");
  const notice = document.createElement("div");
  notice.className = "notice";
  document.body.append(sidebar, map, notice);
  const picks = [];
  const api = mountSearch(root, {
    onPick: (hit) => picks.push(hit),
    loadGlacierIndex: async () => index,
    regions: [],
    view: () => ({ lat: 46, lon: 7, zoom: 5 }),
  });
  const input = root.querySelector("input");
  const type = (value) => {
    input.value = value;
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
  };
  return { root, sidebar, map, notice, input, picks, api, type };
}

const flush = async () => {
  for (let i = 0; i < 10; i += 1) await new Promise((resolve) => setImmediate(resolve));
};

test("focus opens the search full screen, and the page behind it is inert", () => {
  const { root, sidebar, map, notice, input } = setup();
  const back = root.querySelector(".search-back");
  assert.equal(back.getAttribute("aria-label"), "Back to the map");
  assert.ok(back.querySelector("use").getAttribute("href").endsWith("#arrow-left"));
  assert.ok(!root.classList.contains("fullscreen"));
  input.focus();
  assert.ok(root.classList.contains("fullscreen"));
  assert.ok(map.inert, "the map is out of reach");
  assert.ok(!sidebar.inert && !notice.inert, "the search and the notice are not");
});

test("the back button closes it with the open panel's name back, and leaves the page live", () => {
  const { root, map, input, api, type } = setup();
  api.setText("Aletsch");
  input.focus();
  type("rhone");
  root.querySelector(".search-back").click();
  assert.ok(!root.classList.contains("fullscreen"));
  assert.equal(input.value, "Aletsch");
  assert.notEqual(document.activeElement, input);
  assert.ok(!map.inert);
});

test("the results stay while the keyboard is put away, and a pick closes the full screen search", async () => {
  const { root, input, picks, type } = setup();
  input.focus();
  type("aletsch");
  await flush();
  const list = root.querySelector('[role="listbox"]');
  assert.equal(list.hidden, false);
  input.blur();
  assert.ok(root.classList.contains("fullscreen"));
  assert.equal(list.hidden, false, "full screen, the list stays");
  list.querySelector('[role="option"]').click();
  assert.equal(picks.length, 1);
  assert.ok(!root.classList.contains("fullscreen"));
});

test("Escape closes it, and so does a change to the desktop layout", () => {
  const { root, map, input } = setup();
  input.focus();
  input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.ok(!root.classList.contains("fullscreen"));
  input.focus();
  assert.ok(root.classList.contains("fullscreen"));
  setPhone(false);
  assert.ok(!root.classList.contains("fullscreen"));
  assert.ok(!map.inert);
  setPhone(true);
});

test("opening starts the search: a name already there is looked up, and nothing is selected", async () => {
  const { root, input, api } = setup();
  api.setText("Aletsch");
  input.focus();
  assert.equal(input.selectionStart, input.selectionEnd, "a selection would open the touch selection menu");
  await flush();
  const list = root.querySelector('[role="listbox"]');
  assert.equal(list.hidden, false);
  assert.ok(list.textContent.includes("Aletsch"));
});

test("the full screen search keeps the bar in place and passes its card to the input", () => {
  const css = fs.readFileSync(new URL("../style.css", import.meta.url), "utf8");
  const phone = css.slice(css.indexOf("/* Phone: the search bar, the bottom sheet"));
  const full = phone.slice(phone.indexOf("#search.fullscreen {"), phone.indexOf("}", phone.indexOf("#search.fullscreen {")));
  assert.doesNotMatch(full, /\b(top|left|right|inset|border-radius):/, "the bar neither moves nor changes shape");
  assert.match(phone, /#search\.fullscreen input \{[^}]*box-shadow: var\(--shadow\)/);
});

test("the full screen search's ✕ empties the input and keeps the search open", async () => {
  const { root, input, api, type } = setup();
  api.setClosable(() => assert.fail("the ✕ does not close the glacier"));
  input.focus();
  type("aletsch");
  await flush();
  const clear = root.querySelector(".search-clear");
  assert.equal(clear.getAttribute("aria-label"), "Clear the search");
  clear.click();
  assert.equal(input.value, "");
  assert.equal(root.querySelector('[role="listbox"]').hidden, true);
  assert.ok(root.classList.contains("fullscreen"));
  assert.equal(document.activeElement, input);
});
