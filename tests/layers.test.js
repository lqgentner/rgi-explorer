import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { FakeMap, loadPage, load } from "./helpers/browser.js";

const { window, document } = await loadPage();
const { mountLayers, mountTerrain, mountZoom } = await load("js/layers.js");

const BACKGROUNDS = { standard: "#f8f4f0", imagery: "#3c4043" };
/** The color of the plain picture an image shows. */
const fill = (img) => /fill="([^"]+)"/.exec(decodeURIComponent(img.getAttribute("src")))?.[1];

function layers(extra = {}) {
  const root = document.createElement("div");
  const calls = { bases: [], toggles: [] };
  const api = mountLayers(root, {
    base: "standard",
    layers: new Set(["regions"]),
    onBase: (b) => calls.bases.push(b),
    onToggle: (n, on) => calls.toggles.push([n, on]),
    backgrounds: BACKGROUNDS,
    ...extra,
  });
  return { root, calls, api };
}

const hover = (root, type = "pointerenter") => root.firstElementChild.dispatchEvent(new window.Event(type));

const CSS = fs.readFileSync(new URL("../style.css", import.meta.url), "utf8");
/** The body of the first rule in `css` whose selectors are exactly `selectors`, one per line. */
function rule(selectors, css = CSS) {
  const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const head = new RegExp(`(^|\\n)[ \\t]*${selectors.map(escape).join(",\\s*")}\\s*\\{`);
  const match = head.exec(css);
  assert.ok(match, `no rule for ${selectors.join(", ")}`);
  const start = match.index + match[0].length;
  return css.slice(start, css.indexOf("}", start));
}

test("the desktop drawer gives its toggles one width, as wide as the longest label, on one line", () => {
  const drawer = rule([".layers-drawer"]);
  assert.match(drawer, /display:\s*grid;/);
  assert.match(drawer, /grid-auto-flow:\s*column;/);
  /*
   * The panel is as wide as its content, so the equal columns grow to the
   * widest toggle. Shrunk to fit the card's narrow width, it would size them
   * at min-content, where 1fr columns keep to their minimum.
   */
  assert.match(drawer, /grid-auto-columns:\s*minmax\(var\(--tile\),\s*1fr\);/);
  assert.match(rule([".layers-panel"]), /(^|[\s;])width:\s*max-content;/);
  const toggle = rule([".layers .layer-toggle"]);
  assert.match(toggle, /white-space:\s*nowrap;/);
  assert.match(toggle, /(^|[\s;])width:\s*auto;/, "the column sets the width, so a long label never runs into the next");
});

test("the narrow window's drawer column lets a long label wrap under its preview", () => {
  const narrow = CSS.slice(CSS.indexOf("@media (min-width: 641px) and (max-width: 814px) {"));
  assert.match(rule(["body.card-open .layers-drawer"], narrow), /grid-auto-flow:\s*row;/);
  assert.match(rule(["body.card-open .layers .layer-toggle"], narrow), /white-space:\s*normal;/);
});

test("every tile's picture sits at the top, so a label that wraps leaves the row of pictures straight", () => {
  assert.match(rule([".layer-toggle", ".base-tile"]), /justify-content:\s*flex-start;/);
});

test("the phone's round button stays out of the desktop, through style.css", () => {
  const { root } = layers();
  assert.ok(root.querySelector(".layers-open"), "drawn for a change of layout");
  const css = fs.readFileSync(new URL("../style.css", import.meta.url), "utf8");
  const desktop = css.slice(css.indexOf("@media (min-width: 641px) {"));
  assert.match(desktop, /#layers \.layers-open,\s*#sheet\s*\{\s*display:\s*none;/);
});

test("the desktop thumbnail shows the other base map under a Layers badge, names it open and swaps on click", () => {
  const { root, calls } = layers();
  const thumb = root.querySelector(".layers-thumb");
  const caption = () => thumb.querySelector(".layers-caption").textContent;
  assert.equal(fill(thumb.querySelector("img")), "#3c4043", "the imagery's plain background until a picture loads");
  assert.equal(thumb.querySelector(".layers-badge").textContent, "Layers");
  assert.ok(thumb.querySelector(".layers-badge use").getAttribute("href").endsWith("#layers-2"));
  assert.equal(caption(), "Imagery");
  assert.equal(thumb.getAttribute("aria-label"), "Layers: show Imagery map");
  hover(root);
  thumb.click();
  assert.deepEqual(calls.bases, ["imagery"]);
  assert.equal(fill(thumb.querySelector("img")), "#f8f4f0");
  assert.equal(caption(), "Standard");
  assert.equal(thumb.getAttribute("aria-label"), "Layers: show Standard map");
  thumb.click();
  assert.deepEqual(calls.bases, ["imagery", "standard"]);
});

test("setBase swaps the thumbnail without calling onBase", () => {
  const { root, calls, api } = layers();
  api.setBase("imagery");
  assert.equal(root.querySelector(".layers-caption").textContent, "Standard");
  assert.deepEqual(calls.bases, []);
});

test("toggles are pressed buttons that call onToggle, and setLayers syncs them", () => {
  const { root, calls, api } = layers();
  const toggle = (label) => [...root.querySelectorAll(".layer-toggle")].find((b) => b.textContent.includes(label));
  assert.deepEqual([...root.querySelectorAll(".layer-toggle")].map((b) => b.querySelector(".layer-name").textContent), [
    "Glacier regions",
    "Centerlines",
    "Intersects",
  ]);
  assert.ok(toggle("Centerlines").querySelector("svg"));
  assert.equal(toggle("Glacier regions").getAttribute("aria-pressed"), "true");
  toggle("Intersects").click();
  assert.deepEqual(calls.toggles, [["intersects", true]]);
  assert.equal(toggle("Intersects").getAttribute("aria-pressed"), "true");
  api.setLayers(new Set(["centerlines"]));
  assert.equal(toggle("Glacier regions").getAttribute("aria-pressed"), "false");
  assert.equal(toggle("Centerlines").getAttribute("aria-pressed"), "true");
  assert.equal(toggle("Intersects").getAttribute("aria-pressed"), "false");
  assert.equal(calls.toggles.length, 1);
});

test("the control opens on hover and focus", () => {
  const { root } = layers();
  const panel = root.querySelector(".layers-panel");
  const wrapper = root.firstElementChild;
  const thumb = root.querySelector(".layers-thumb");
  assert.equal(panel.hasAttribute("inert"), true);
  assert.ok(!wrapper.classList.contains("open"));
  assert.equal(thumb.getAttribute("aria-expanded"), "false");
  hover(root);
  assert.equal(panel.hasAttribute("inert"), false);
  assert.ok(wrapper.classList.contains("open"));
  assert.equal(thumb.getAttribute("aria-expanded"), "true");
  hover(root, "pointerleave");
  assert.equal(panel.hasAttribute("inert"), true);
  assert.ok(!wrapper.classList.contains("open"));
  thumb.dispatchEvent(new window.Event("focusin", { bubbles: true }));
  assert.equal(panel.hasAttribute("inert"), false);
});

test("a mouse that leaves keeps the control open while keyboard focus is inside", () => {
  const { root } = layers();
  document.body.append(root);
  const panel = root.querySelector(".layers-panel");
  hover(root);
  root.querySelector(".layers-thumb").focus();
  /* jsdom has no input modality: stand in for the keyboard's :focus-visible. */
  const matches = window.Element.prototype.querySelector;
  root.firstElementChild.querySelector = function (selector) {
    return selector === ":focus-visible" ? document.activeElement : matches.call(this, selector);
  };
  hover(root, "pointerleave");
  assert.equal(panel.hasAttribute("inert"), false);
  root.remove();
});

test("a keyboard click on the open control swaps the base map, whatever an earlier press saw", () => {
  const { root, calls } = layers();
  const thumb = root.querySelector(".layers-thumb");
  /* A press that never became a click, on the closed control. */
  thumb.dispatchEvent(new window.Event("pointerdown", { bubbles: true }));
  hover(root);
  thumb.dispatchEvent(new window.MouseEvent("click", { bubbles: true, detail: 0 }));
  assert.deepEqual(calls.bases, ["imagery"]);
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

const NOTICE = "The terrain is newer than the RGI outlines, so their edges may not match.";

function terrain(start = false) {
  const root = document.createElement("div");
  const changes = [];
  const api = mountTerrain(root, { on: start, onChange: (on) => changes.push(on) });
  return { root, changes, api, button: root.querySelector(".terrain-btn") };
}

test("the 3D button names the mode it switches to, and reports", () => {
  const { button, changes, api } = terrain();
  const reads = () => [button.textContent, button.getAttribute("aria-label")];
  assert.deepEqual(reads(), ["3D", "Switch to 3D"]);
  assert.equal(button.hasAttribute("aria-pressed"), false, "an action, not a toggle: its label changes");
  button.click();
  assert.deepEqual(changes, [true]);
  assert.deepEqual(reads(), ["2D", "Switch to 2D"]);
  assert.equal(button.hasAttribute("aria-pressed"), false);
  api.set(false);
  assert.deepEqual(reads(), ["3D", "Switch to 3D"]);
  api.set(true);
  assert.deepEqual(reads(), ["2D", "Switch to 2D"]);
  assert.deepEqual(changes, [true], "set() does not report");
});

test("a 3D button that opens in 3D reads 2D", () => {
  const { button } = terrain(true);
  assert.equal(button.textContent, "2D");
  assert.equal(button.getAttribute("aria-label"), "Switch to 2D");
});

test("the 3D button looks the same in 2D and 3D: no pressed style", () => {
  assert.doesNotMatch(CSS, /\.terrain-btn\[aria-pressed/);
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
    thumb.dispatchEvent(new window.MouseEvent("click", { bubbles: true, detail: 1 }));
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
