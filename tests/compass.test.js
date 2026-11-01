import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { loadPage, load } from "./helpers/browser.js";

const { document } = await loadPage();
const { mountCompass, ROTATE_STEP } = await load("js/compass.js");

function compass() {
  const root = document.createElement("div");
  const calls = [];
  const api = mountCompass(root, { onRotate: (d) => calls.push(d), onReset: () => calls.push("reset") });
  const node = root.querySelector(".compass");
  const button = (label) => node.querySelector(`button[aria-label="${label}"]`);
  return { root, node, api, calls, button };
}

test("the compass is a labelled group of three buttons over the arrows", () => {
  const { node, button } = compass();
  assert.equal(node.getAttribute("role"), "group");
  assert.equal(node.getAttribute("aria-label"), "Map direction");
  assert.deepEqual(
    [...node.querySelectorAll("button")].map((b) => b.getAttribute("aria-label")),
    ["Rotate left", "Face north", "Rotate right"],
  );
  for (const label of ["Rotate left", "Face north", "Rotate right"]) assert.equal(button(label).title, label);
  assert.deepEqual(
    [...node.querySelectorAll(".compass-arrows .compass-arc")].map((p) => p.getAttribute("d")),
    ["M13.25 8.89 A13 13 0 0 0 9.1 27.08", "M40.75 8.89 A13 13 0 0 1 44.9 27.08"],
  );
  assert.deepEqual(
    [...node.querySelectorAll(".compass-arrows .compass-head")].map((p) => p.getAttribute("points")),
    ["6.08 29.04 12.37 32.11 12.12 25.12", "47.92 29.04 41.63 32.11 41.88 25.12"],
  );
  assert.equal(button("Face north").querySelector(".needle-north").getAttribute("points"), "14,0 18.7,14 9.3,14");
  assert.equal(button("Face north").querySelector(".needle-south").getAttribute("points"), "9.3,14 18.7,14 14,28");
});

test("the arrows turn 45° each way and the needle resets", () => {
  const { calls, button } = compass();
  assert.equal(ROTATE_STEP, 45);
  button("Rotate left").click();
  button("Rotate right").click();
  button("Face north").click();
  assert.deepEqual(calls, [45, -45, "reset"]);
});

test("the needle turns and tilts with the map, and the compass is idle only facing north in 2D", () => {
  const { node, api } = compass();
  const needle = node.querySelector(".compass-needle");
  api.update({ bearing: 40, pitch: 60, terrain: true });
  assert.equal(needle.style.transform, "rotateX(60deg) rotateZ(-40deg)");
  assert.equal(node.hasAttribute("data-idle"), false);
  api.update({ bearing: 0, pitch: 60, terrain: true });
  assert.equal(node.hasAttribute("data-idle"), false, "3D shows the phone compass even facing north");
  api.update({ bearing: 1e-9, pitch: 0, terrain: false });
  assert.equal(node.hasAttribute("data-idle"), true, "float noise counts as north");
  api.update({ bearing: -0, pitch: 0, terrain: false });
  assert.equal(node.hasAttribute("data-idle"), true);
  api.update({ bearing: 40, pitch: 0, terrain: false });
  assert.equal(node.hasAttribute("data-idle"), false);
});

test("style.css hides the idle compass on the phone only, and shrinks the desktop buttons to 36 px", () => {
  const css = fs.readFileSync(new URL("../style.css", import.meta.url), "utf8");
  const phone = css.slice(css.indexOf("@media (max-width: 640px) {"));
  const desktop = css.slice(0, css.indexOf("@media (max-width: 640px) {"));
  assert.match(phone, /\.compass\[data-idle\]\s*\{[^}]*visibility:\s*hidden/);
  assert.doesNotMatch(desktop, /\.compass\[data-idle\]/);
  assert.match(desktop, /\.terrain-btn\s*\{[^}]*width:\s*36px;[^}]*height:\s*36px;[^}]*border-radius:\s*11px/);
  assert.match(desktop, /\.zoom-btn\s*\{[^}]*width:\s*36px;[^}]*height:\s*36px/);
  assert.match(css, /@media \(min-width: 641px\) and \(max-width: 814px\)/);
});

test("style.css gives the needle a round 20 px target at the centre and the arrows a half each", () => {
  const css = fs.readFileSync(new URL("../style.css", import.meta.url), "utf8");
  const desktop = css.slice(0, css.indexOf("@media (max-width: 640px) {"));
  const rule = (selector) => desktop.match(new RegExp(`\\n${selector.replace(/[.]/g, "\\.")}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
  const north = rule(".compass-north");
  for (const declaration of ["position: absolute", "left: 17px", "top: 10px", "width: 20px", "height: 20px", "border-radius: 50%"]) {
    assert.ok(north.includes(declaration), `.compass-north has ${declaration}`);
  }
  assert.ok(rule(".compass-turn").includes("flex: 1"), "each arrow takes half the capsule");
  assert.ok(rule(".compass-needle").includes("pointer-events: none"), "the 28 px needle doesn't widen the 20 px target");
});
