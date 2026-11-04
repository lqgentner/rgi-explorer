/* The lower-priority surfaces: frosted, and opaque for readers who ask for less transparency or more contrast. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("../style.css", import.meta.url), "utf8");
const rule = (selector, from = css) => new RegExp(`(^|\\n)\\s*${selector} \\{([^}]*)\\}`).exec(from)?.[2] ?? "";

test("the frosted surfaces paint their glass past their edges and clip it back", () => {
  const glass = rule("\\.tour::before,\\n#status::before,\\n\\.help-btn::before,\\n\\.credits-box::before");
  assert.match(glass, /inset: calc\(-1 \* var\(--quiet-reach\)\);/, "it reaches past each edge");
  assert.match(glass, /backdrop-filter: var\(--quiet-filter\);/);
  assert.match(glass, /clip-path: inset\(var\(--quiet-reach\) round var\(--frost-radius\)\);/, "and is clipped back to the surface");
  assert.match(css, /--quiet-reach: calc\(2 \* var\(--quiet-blur\)\);/, "two blur radii");
  assert.doesNotMatch(glass, /overflow/);
});

test("the tour card everywhere, the status line on the desktop, and the help button and credits on the phone", () => {
  assert.match(rule("\\.tour"), /--frost-tint: var\(--quiet-card\);/);
  assert.match(rule("#status"), /--frost-tint: var\(--quiet-card\);/, "the desktop's status line");
  const phoneAt = css.indexOf("@media (max-width: 640px) {\n  #layers");
  const phone = css.slice(phoneAt);
  assert.match(phone, /#status::before \{\s*content: none;/, "the phone's row is no surface");
  assert.match(rule("\\.credits-box", phone), /--frost-tint: var\(--quiet-card\);/, "open credits, as the desktop's status line");
  assert.match(rule("\\.help-btn,\\n  \\.credits-box:not\\(\\.open\\)", phone), /--frost-tint: var\(--quiet-button\);/);
  assert.match(css.slice(0, phoneAt), /@media \(min-width: 641px\) \{\s*\.help-btn::before,\s*\.credits-box::before \{\s*content: none;/, "the desktop's help button stays opaque");
  assert.match(rule("\\.tour-count"), /color: var\(--quiet-muted\);/);
  assert.match(rule("\\.credit-label"), /color: var\(--quiet-muted\);/);
  /* No white fill on the card: an outlined button lets the frost through. */
  assert.match(rule("\\.tour \\.btn:not\\(\\.primary\\)"), /background: none;\s*color: var\(--quiet-accent\);/);
});

test("less transparency or more contrast makes them opaque", () => {
  const block = /@media \(prefers-reduced-transparency: reduce\), \(prefers-contrast: more\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
  for (const token of ["--quiet-button: var(--surface)", "--quiet-card: var(--surface)", "--quiet-filter: none", "--quiet-muted: var(--muted)", "--quiet-accent: var(--accent)"]) {
    assert.ok(block.includes(token), token);
  }
});

test("the photo's controls take a plainer glass than the map's frost: faint arrows, a light credit, a dark count", () => {
  assert.match(rule("\\.photo-prev,\\n\\.photo-next"), /background: var\(--photo-glass\);\s*backdrop-filter: var\(--photo-blur\);/);
  assert.match(rule("\\.photo-credit"), /background: var\(--photo-glass-strong\);\s*backdrop-filter: var\(--photo-blur\);/);
  assert.match(rule("\\.photo-count"), /background: var\(--photo-dark\);\s*color: #fff;/);
  assert.doesNotMatch(css, /\.photo-[a-z]+ \{[^}]*--quiet-/, "not the map's lifted frost, which washes the photo out");
  const block = /@media \(prefers-reduced-transparency: reduce\), \(prefers-contrast: more\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
  for (const token of ["--photo-glass: var(--surface)", "--photo-glass-strong: var(--surface)", "--photo-dark: var(--text)", "--photo-blur: none"]) {
    assert.ok(block.includes(token), token);
  }
});
