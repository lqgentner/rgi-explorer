import assert from "node:assert/strict";
import test from "node:test";

import { FakeMap, loadPage, load } from "./helpers/browser.js";

const { window, document } = await loadPage({ phone: true });
const { mountStatus } = await load("js/status.js");
const { mountZoom } = await load("js/layers.js");

const catalog = {
  citation: "RGI 7.0 Consortium. (2023). Randolph Glacier Inventory.",
  license: { id: "CC-BY-4.0", href: "https://example.org/license" },
};

test("the phone has no scale bar, and an info button opens the credits", () => {
  const root = document.createElement("div");
  const rgiMap = { map: new FakeMap({ zoom: 5 }), onMove() {} };
  mountStatus(root, rgiMap, catalog, () => ({ base: "standard", terrain: false }));
  assert.equal(root.querySelector(".scale-bar"), null);
  const button = root.querySelector("button");
  assert.ok(button.querySelector("use").getAttribute("href").endsWith("#info"));
  const panel = [...document.querySelectorAll(".credits-panel")].at(-1);
  assert.equal(root.querySelector(".credits-panel"), null);
  assert.equal(panel.parentElement, document.body, "the panel stacks above the bottom sheet, outside #status");
  assert.equal(panel.hidden, true);
  button.click();
  assert.equal(panel.hidden, false);
  assert.equal(button.getAttribute("aria-expanded"), "true");
  assert.ok(panel.textContent.includes("RGI Consortium 2023"));
  button.click();
  assert.equal(panel.hidden, true);
});

test("the phone draws no zoom buttons", () => {
  const root = document.createElement("div");
  mountZoom(root, { map: new FakeMap() });
  assert.equal(root.children.length, 0);
});

test("Escape closes the credits panel and returns focus to the info button", () => {
  const root = document.createElement("div");
  document.body.append(root);
  mountStatus(root, { map: new FakeMap({ zoom: 5 }), onMove() {} }, catalog, () => ({ base: "standard", terrain: false }));
  const button = root.querySelector("button");
  button.click();
  const panel = [...document.querySelectorAll(".credits-panel")].at(-1);
  panel.querySelector(".credit").dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(panel.hidden, true);
  assert.equal(document.activeElement, button);
});
