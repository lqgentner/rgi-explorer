import assert from "node:assert/strict";
import test from "node:test";

import { FakeMap, loadPage, load } from "./helpers/browser.js";

const { window, document } = await loadPage();
const { mountLayers, mountTerrain, mountZoom } = await load("js/layers.js");

function layers(extra = {}) {
  const root = document.createElement("div");
  const calls = { bases: [], toggles: [] };
  const api = mountLayers(root, {
    base: "standard",
    layers: new Set(["regions"]),
    onBase: (b) => calls.bases.push(b),
    onToggle: (n, on) => calls.toggles.push([n, on]),
    zoom: () => 12,
    ...extra,
  });
  return { root, calls, api };
}

const hover = (root, type = "pointerenter") => root.firstElementChild.dispatchEvent(new window.Event(type));

test("the desktop thumbnail shows the other base map under a Layers badge, names it open and swaps on click", () => {
  const { root, calls } = layers();
  const thumb = root.querySelector(".layers-thumb");
  const caption = () => thumb.querySelector(".layer-name").textContent;
  assert.ok(thumb.querySelector("img").getAttribute("src").endsWith("assets/base-imagery.webp"));
  assert.equal(thumb.querySelector(".layers-badge").textContent, "Layers");
  assert.ok(thumb.querySelector(".layers-badge use").getAttribute("href").endsWith("#layers-2"));
  assert.equal(caption(), "Imagery");
  hover(root);
  thumb.click();
  assert.deepEqual(calls.bases, ["imagery"]);
  assert.ok(thumb.querySelector("img").getAttribute("src").endsWith("assets/base-standard.webp"));
  assert.equal(caption(), "Standard");
  thumb.click();
  assert.deepEqual(calls.bases, ["imagery", "standard"]);
});

test("setBase swaps the thumbnail without calling onBase", () => {
  const { root, calls, api } = layers();
  api.setBase("imagery");
  assert.equal(root.querySelector(".layers-thumb .layer-name").textContent, "Standard");
  assert.deepEqual(calls.bases, []);
});

test("the desktop toggles leave the zoom hints out", () => {
  const { root, api } = layers({ zoom: () => 6 });
  api.refreshZoom();
  assert.equal(root.querySelector(".layer-hint"), null);
  assert.ok(![...root.querySelectorAll(".layer-toggle")].some((b) => b.textContent.includes("visible from")));
});

test("toggles are pressed buttons that call onToggle, and setLayers syncs them", () => {
  const { root, calls, api } = layers();
  const toggle = (label) => [...root.querySelectorAll(".layer-toggle")].find((b) => b.textContent.includes(label));
  assert.deepEqual([...root.querySelectorAll(".layer-toggle")].map((b) => b.querySelector(".layer-name").textContent), [
    "RGI regions",
    "Centerlines",
    "Ice divides",
  ]);
  assert.ok(toggle("Centerlines").querySelector("svg"));
  assert.equal(toggle("RGI regions").getAttribute("aria-pressed"), "true");
  toggle("Ice divides").click();
  assert.deepEqual(calls.toggles, [["intersects", true]]);
  assert.equal(toggle("Ice divides").getAttribute("aria-pressed"), "true");
  api.setLayers(new Set(["centerlines"]));
  assert.equal(toggle("RGI regions").getAttribute("aria-pressed"), "false");
  assert.equal(toggle("Centerlines").getAttribute("aria-pressed"), "true");
  assert.equal(toggle("Ice divides").getAttribute("aria-pressed"), "false");
  assert.equal(calls.toggles.length, 1);
});

test("the control opens on hover and focus", () => {
  const { root } = layers();
  const panel = root.querySelector(".layers-panel");
  const wrapper = root.firstElementChild;
  assert.equal(panel.hasAttribute("inert"), true);
  assert.ok(!wrapper.classList.contains("open"));
  hover(root);
  assert.equal(panel.hasAttribute("inert"), false);
  assert.ok(wrapper.classList.contains("open"));
  hover(root, "pointerleave");
  assert.equal(panel.hasAttribute("inert"), true);
  assert.ok(!wrapper.classList.contains("open"));
  root.querySelector(".layers-thumb").dispatchEvent(new window.Event("focusin", { bubbles: true }));
  assert.equal(panel.hasAttribute("inert"), false);
});

test("the zoom buttons zoom the map", () => {
  const root = document.createElement("div");
  const map = new FakeMap();
  mountZoom(root, { map });
  root.querySelector('button[aria-label="Zoom in"]').click();
  root.querySelector('button[aria-label="Zoom out"]').click();
  root.querySelector('button[aria-label="Zoom out"]').click();
  assert.deepEqual(map.calls, ["zoomIn", "zoomOut", "zoomOut"]);
  assert.ok(root.querySelector('button[aria-label="Zoom in"] use').getAttribute("href").endsWith("#plus"));
});

const NOTICE = "3D terrain is newer than the RGI outlines. Mapterhorn elevation and the outlines come from different years, so edges may not match.";

function terrain(start = false) {
  const root = document.createElement("div");
  const changes = [];
  const api = mountTerrain(root, { on: start, onChange: (on) => changes.push(on) });
  return { root, changes, api, button: root.querySelector(".terrain-btn") };
}

test("the 3D button toggles and reports", () => {
  const { button, changes, api } = terrain();
  assert.equal(button.textContent, "3D");
  assert.equal(button.getAttribute("aria-pressed"), "false");
  button.click();
  assert.deepEqual(changes, [true]);
  assert.equal(button.getAttribute("aria-pressed"), "true");
  api.set(false);
  assert.equal(button.getAttribute("aria-pressed"), "false");
  assert.deepEqual(changes, [true]);
});

test("the terrain notice shows once per session and survives a throwing sessionStorage", () => {
  window.sessionStorage.clear();
  let { root, button } = terrain();
  assert.equal(root.querySelector(".terrain-notice"), null);
  button.click();
  assert.equal(root.querySelector(".terrain-notice").textContent.includes(NOTICE), true);
  button.click();
  button.click();
  assert.equal(root.querySelector(".terrain-notice"), null, "turning 3D off and on does not show it again");
  window.sessionStorage.clear();
  ({ root, button } = terrain());
  button.click();
  root.querySelector('button[aria-label="Dismiss"]').click();
  assert.equal(root.querySelector(".terrain-notice"), null);
  assert.equal(window.sessionStorage.getItem("rgi-explorer.terrain-notice"), "dismissed");

  ({ root, button } = terrain());
  button.click();
  assert.equal(root.querySelector(".terrain-notice"), null);

  window.sessionStorage.clear();
  Object.defineProperty(window, "sessionStorage", {
    configurable: true,
    get() {
      throw new Error("blocked");
    },
  });
  ({ root, button } = terrain());
  button.click();
  assert.ok(root.querySelector(".terrain-notice"));
  root.querySelector('button[aria-label="Dismiss"]').click();
  assert.equal(root.querySelector(".terrain-notice"), null);
  button.click();
  button.click();
  assert.equal(root.querySelector(".terrain-notice"), null);
});

test("a tap opens the closed control, and only a tap on the open one swaps the base map", () => {
  const { root, calls } = layers();
  document.body.append(root);
  const panel = root.querySelector(".layers-panel");
  const thumb = root.querySelector(".layers-thumb");
  const touch = (node, type) => {
    const event = new window.Event(type, { bubbles: type === "pointerdown" });
    event.pointerType = "touch";
    node.dispatchEvent(event);
  };
  const tap = () => {
    touch(root.firstElementChild, "pointerenter");
    touch(thumb, "pointerdown");
    thumb.dispatchEvent(new window.Event("focusin", { bubbles: true }));
    touch(root.firstElementChild, "pointerleave");
    thumb.click();
  };
  tap();
  assert.equal(panel.hasAttribute("inert"), false);
  assert.deepEqual(calls.bases, []);
  tap();
  assert.equal(panel.hasAttribute("inert"), false);
  assert.deepEqual(calls.bases, ["imagery"]);
  touch(document.body, "pointerdown");
  assert.equal(panel.hasAttribute("inert"), true);
  root.remove();
});

test("Escape closes the control and returns focus to the thumbnail", () => {
  const { root } = layers();
  document.body.append(root);
  hover(root);
  root.querySelector(".layer-toggle").dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(root.querySelector(".layers-panel").hasAttribute("inert"), true);
  assert.equal(document.activeElement, root.querySelector(".layers-thumb"));
  root.remove();
});
