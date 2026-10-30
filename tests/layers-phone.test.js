import assert from "node:assert/strict";
import test from "node:test";

import { loadPage, load } from "./helpers/browser.js";

const { window, document, setPhone } = await loadPage({ phone: true });
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
  const pane = [...document.querySelectorAll(".layers-pane")].at(-1);
  assert.equal(root.querySelector(".layers-pane"), null);
  assert.equal(pane.parentElement, document.body, "the pane stacks above the bottom sheet, outside #layers");
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
  const pane = [...document.querySelectorAll(".layers-pane")].at(-1);
  pane.querySelector('button[aria-label="Close"]').dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(pane.hidden, true);
  assert.equal(document.activeElement, fab);
});

test("a phone toggle hidden at this zoom says so, and refreshZoom updates the hint", () => {
  let zoom = 6;
  const root = document.createElement("div");
  const api = mountLayers(root, { base: "standard", layers: new Set(), onBase() {}, onToggle() {}, zoom: () => zoom });
  const pane = [...document.querySelectorAll(".layers-pane")].at(-1);
  const toggle = (label) => [...pane.querySelectorAll(".layer-toggle")].find((b) => b.textContent.includes(label));
  assert.ok(toggle("Intersects").textContent.includes("visible from zoom 10"));
  assert.ok(toggle("Centerlines").textContent.includes("visible from zoom 8"));
  assert.ok(!toggle("RGI regions").textContent.includes("visible from"));
  zoom = 9;
  api.refreshZoom();
  assert.ok(!toggle("Centerlines").textContent.includes("visible from"));
  assert.ok(toggle("Intersects").textContent.includes("visible from zoom 10"));
});

test("a change of layout moves the toggles between the pane and the drawer, and closes the control left behind", () => {
  const root = document.createElement("div");
  document.body.append(root);
  const api = mountLayers(root, { base: "standard", layers: new Set(), onBase() {}, onToggle() {}, zoom: () => 6 });
  const pane = [...document.querySelectorAll(".layers-pane")].at(-1);
  const drawer = root.querySelector(".layers-drawer");
  root.querySelector(".layers-open").click();
  assert.equal(pane.querySelectorAll(".layer-toggle").length, 3);

  setPhone(false);
  assert.equal(pane.hidden, true, "the pane closes on desktop");
  assert.equal(drawer.querySelectorAll(".layer-toggle").length, 3);
  assert.equal(pane.querySelectorAll(".layer-toggle").length, 0);
  assert.ok([...drawer.querySelectorAll(".layer-hint")].every((hint) => hint.textContent === ""), "no hints on desktop");

  root.querySelector(".layers").dispatchEvent(new window.Event("focusin"));
  assert.ok(root.querySelector(".layers").classList.contains("open"));
  setPhone(true);
  assert.ok(!root.querySelector(".layers").classList.contains("open"), "the drawer closes on the phone");
  assert.equal(pane.querySelectorAll(".layer-toggle").length, 3);
  api.refreshZoom();
  assert.ok(pane.textContent.includes("visible from zoom 10"));
});
