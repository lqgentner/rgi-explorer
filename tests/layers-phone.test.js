import assert from "node:assert/strict";
import test from "node:test";

import { loadPage, load } from "./helpers/browser.js";

const { window, document } = await loadPage({ phone: true });
const { mountLayers } = await load("js/layers.js");

test("the phone layer button opens a pane with map types and RGI layers", () => {
  const root = document.createElement("div");
  const bases = [];
  const toggles = [];
  mountLayers(root, {
    base: "standard",
    layers: new Set(["regions"]),
    onBase: (b) => bases.push(b),
    onToggle: (n, on) => toggles.push([n, on]),
    zoom: () => 12,
  });
  const fab = root.querySelector('button[aria-label="Layers"]');
  assert.ok(fab.querySelector("use").getAttribute("href").endsWith("#layers-2"));
  const pane = root.querySelector(".layers-pane");
  assert.equal(pane.hidden, true);
  fab.click();
  assert.equal(pane.hidden, false);
  const headings = [...pane.querySelectorAll("h2, h3")].map((n) => n.textContent);
  assert.deepEqual(headings, ["Layers", "Map type", "RGI layers"]);

  const tile = (label) => [...pane.querySelectorAll("button")].find((b) => b.textContent.includes(label));
  assert.equal(tile("Standard").getAttribute("aria-pressed"), "true");
  assert.equal(tile("Imagery").getAttribute("aria-pressed"), "false");
  tile("Imagery").click();
  assert.deepEqual(bases, ["imagery"]);
  assert.equal(tile("Imagery").getAttribute("aria-pressed"), "true");
  assert.equal(tile("Standard").getAttribute("aria-pressed"), "false");

  assert.equal(tile("RGI regions").getAttribute("aria-pressed"), "true");
  tile("Centerlines").click();
  assert.deepEqual(toggles, [["centerlines", true]]);
  assert.equal(tile("Centerlines").getAttribute("aria-pressed"), "true");

  pane.querySelector('button[aria-label="Close"]').click();
  assert.equal(pane.hidden, true);
});

test("Escape closes the pane and returns focus to the layers button", () => {
  const root = document.createElement("div");
  document.body.append(root);
  mountLayers(root, { base: "standard", layers: new Set(), onBase() {}, onToggle() {}, zoom: () => 12 });
  const fab = root.querySelector('button[aria-label="Layers"]');
  fab.click();
  const pane = root.querySelector(".layers-pane");
  pane.querySelector('button[aria-label="Close"]').dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(pane.hidden, true);
  assert.equal(document.activeElement, fab);
});
