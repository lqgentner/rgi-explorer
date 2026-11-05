import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { FakeMap, loadPage, load } from "./helpers/browser.js";

const { window, document } = await loadPage({ phone: true });
const { mountStatus } = await load("js/status.js");
const { mountZoom } = await load("js/layers.js");

const catalog = {
  citation: "RGI 7.0 Consortium. (2023). Randolph Glacier Inventory.",
  license: { id: "CC-BY-4.0", href: "https://example.org/license" },
};

test("the credits show at load in the info button's box, and fold on the first drag of the map", () => {
  const root = document.createElement("div");
  const map = new FakeMap({ zoom: 5 });
  mountStatus(root, { map, onMove() {} }, catalog, () => ({ base: "standard", terrain: false }));
  const box = root.querySelector(".credits-box");
  const button = box.querySelector("button.credits-button");
  assert.ok(button.querySelector("use").getAttribute("href").endsWith("#info"));
  assert.equal(document.querySelector(".credits-panel"), null, "no separate panel");
  assert.ok(box.querySelector(".credits").textContent.includes("RGI Consortium 2023"));
  assert.ok(box.classList.contains("open"), "visible before the map moves");
  assert.equal(button.getAttribute("aria-expanded"), "true");

  map.fire("dragstart");
  assert.ok(!box.classList.contains("open"));
  assert.equal(button.getAttribute("aria-expanded"), "false");
  button.click();
  assert.ok(box.classList.contains("open"));
  map.fire("dragstart");
  assert.ok(box.classList.contains("open"), "only the first drag folds the credits");
  button.click();
  assert.ok(!box.classList.contains("open"));
});

test("the reader opening a glacier folds the credits as the first drag does, and only once", () => {
  const root = document.createElement("div");
  const map = new FakeMap({ zoom: 5 });
  const status = mountStatus(root, { map, onMove() {} }, catalog, () => ({ base: "standard", terrain: false }));
  const box = root.querySelector(".credits-box");
  status.fold();
  assert.ok(!box.classList.contains("open"));
  assert.equal(box.querySelector("button.credits-button").getAttribute("aria-expanded"), "false");
  box.querySelector("button.credits-button").click();
  status.fold();
  map.fire("dragstart");
  assert.ok(box.classList.contains("open"), "credits the reader unfolded stay open");
});

test("the phone hides the zoom buttons, which are drawn for a change of layout", () => {
  const root = document.createElement("div");
  mountZoom(root, { map: new FakeMap() });
  assert.ok(root.querySelector(".zoom-control"));
  const css = fs.readFileSync(new URL("../style.css", import.meta.url), "utf8");
  const phone = css.slice(css.indexOf("@media (max-width: 640px) {\n  #layers {"));
  assert.match(phone, /\.zoom-control\s*\{\s*display:\s*none;/);
});

test("Escape folds the credits and returns focus to the info button", () => {
  const root = document.createElement("div");
  document.body.append(root);
  mountStatus(root, { map: new FakeMap({ zoom: 5 }), onMove() {} }, catalog, () => ({ base: "standard", terrain: false }));
  const box = root.querySelector(".credits-box");
  box.querySelector(".credit").dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.ok(!box.classList.contains("open"));
  assert.equal(document.activeElement, box.querySelector(".credits-button"));
});

test("the phone hides the scale bar and folds the credits through style.css alone", () => {
  const css = fs.readFileSync(new URL("../style.css", import.meta.url), "utf8");
  const phone = css.slice(css.indexOf("@media (max-width: 640px)"));
  assert.match(phone, /\.scale\s*\{\s*display:\s*none;/);
  assert.match(phone, /\.credits-box:not\(\.open\) \.credits\s*\{\s*display:\s*none;/);
  const row = /\n  #status \{([^}]*)\}/.exec(phone)[1];
  assert.match(row, /left: 12px;\s*right: 12px;\s*bottom: 12px;\s*display: flex;/, "a row across the bottom");
  assert.match(row, /justify-content: space-between;/, "help in the left corner, info in the right");
  assert.match(row, /pointer-events: none;/, "taps between the buttons reach the map");
  assert.match(phone, /\.help-btn \{[^}]*width: 36px;\s*height: 36px;/);
  assert.match(phone, /\.credits-button \{[^}]*width: 36px;\s*height: 36px;/);
});
