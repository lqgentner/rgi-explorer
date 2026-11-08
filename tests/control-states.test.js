/* The map's controls answer a hover and a press alike, on both layouts. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("../style.css", import.meta.url), "utf8");
const app = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");

/* Every button over the map: zoom, 3D, locate, help, the phone's Layers and credits, the compass's three. */
const CONTROLS = [".zoom-btn", ".terrain-btn", ".locate-btn", ".help-btn", ".round-button", ".credits-button", ".compass button"];
const list = (state, indent = "") => CONTROLS.map((selector) => `${selector}${state}`).join(`,\n${indent}`);
const rule = (selectors) => new RegExp(`(^|\\n)\\s*${selectors.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\{([^}]*)\\}`).exec(css)?.[2] ?? "";

test("a real hover darkens each control a step, and no tap leaves it behind", () => {
  const at = css.indexOf(list(":hover", "  "));
  assert.ok(at > 0, "the controls share one hover rule");
  assert.match(css.slice(0, at), /@media \(hover: hover\) \{\s*$/, "inside (hover: hover)");
  assert.match(rule(list(":hover", "  ")), /background: var\(--surface-2\);/);
});

test("a press darkens each control a step further, on touch too", () => {
  assert.match(rule(list(":active")), /background: var\(--surface-3\);/);
  assert.match(rule(list("")), /-webkit-tap-highlight-color: transparent;/, "no browser highlight beside it");
  assert.match(app, /document\.addEventListener\("touchstart", \(\) => \{\}, \{ passive: true \}\);/, "iOS Safari's :active");
});

test("the phone's frosted help button takes the same steps in its tint", () => {
  const phone = css.slice(css.indexOf("@media (max-width: 640px) {\n  #layers"));
  assert.match(phone, /\.help-btn:hover \{\s*--frost-tint: var\(--surface-2\);/);
  assert.match(phone, /\.help-btn:active \{\s*--frost-tint: var\(--surface-3\);/);
});

test("no other rule gives a control its own hover or press", () => {
  for (const selector of CONTROLS) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const states = css.match(new RegExp(`${escaped}:(hover|active)[^{]*\\{[^}]*background`, "g")) ?? [];
    assert.equal(states.length, 2, `${selector}: ${states.join(" | ")}`);
  }
});

test("the layer tiles' hover ring shows only on a real hover, so a tapped tile does not stay grey", () => {
  const at = css.indexOf("  .layer-toggle:hover .layer-preview,\n  .base-tile:hover img {");
  assert.ok(at > 0, "the tiles' hover rule");
  assert.match(css.slice(0, at), /@media \(hover: hover\) \{\s*$/, "inside (hover: hover)");
  assert.doesNotMatch(css, /(^|\n)\.(layer-toggle|base-tile):hover/, "no hover outside it");
});

test("no hover anywhere outlives a tap: every :hover rule sits inside (hover: hover)", () => {
  const open = [];
  const outside = [];
  for (const [index, line] of css.split("\n").entries()) {
    if (/:hover/.test(line) && !/^(\/\*|\*)/.test(line.trim()) && !open.some((head) => head.includes("@media (hover: hover)"))) {
      outside.push(`${index + 1}: ${line.trim()}`);
    }
    for (const char of line) {
      if (char === "{") open.push(line);
      else if (char === "}") open.pop();
    }
  }
  assert.deepEqual(outside, []);
});
