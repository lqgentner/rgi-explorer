/* The lower-priority surfaces: frosted, and opaque for readers who ask for less transparency or more contrast. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("../style.css", import.meta.url), "utf8");
const rule = (selector, from = css) => new RegExp(`(^|\\n)\\s*${selector} \\{([^}]*)\\}`).exec(from)?.[2] ?? "";

test("the frosted surfaces paint their glass past their edges and clip it back", () => {
  const glass = rule("\\.welcome::before,\\n\\.tour::before,\\n#status::before,\\n\\.help-btn::before,\\n\\.credits-box::before");
  assert.match(glass, /inset: calc\(-1 \* var\(--quiet-reach\)\);/, "it reaches past each edge");
  assert.match(glass, /backdrop-filter: var\(--quiet-filter\);/);
  assert.match(glass, /clip-path: inset\(var\(--quiet-reach\) round var\(--frost-radius\)\);/, "and is clipped back to the surface");
  assert.match(css, /--quiet-reach: calc\(2 \* var\(--quiet-blur\)\);/, "two blur radii");
  assert.doesNotMatch(glass, /overflow/);
});

test("the welcome and the tour card everywhere, the status line on the desktop, and the help button and credits on the phone", () => {
  assert.match(css, /--quiet-glass: rgb\(255 255 255 \/ 60%\);/, "one tint for every frosted surface");
  assert.match(rule("\\.welcome"), /--frost-tint: var\(--quiet-glass\);/);
  assert.doesNotMatch(rule("\\.welcome"), /background:/, "no fill over the glass");
  assert.match(rule("\\.welcome p"), /color: var\(--quiet-muted\);/);
  assert.match(rule("\\.welcome a\\.external"), /color: var\(--quiet-accent\);/, "the user guide link keeps 5:1");
  assert.match(css, /\n\.welcome-close,\n\.tour-close \{\s*background: none;/, "the X has no disc on the glass");
  assert.match(rule("\\.tour"), /--frost-tint: var\(--quiet-glass\);/);
  assert.match(rule("\\.tour\\[popover\\]"), /background: none;/, "not the popover's Canvas, which the glass would frost instead of the map");
  assert.match(rule("#status"), /--frost-tint: var\(--quiet-glass\);/, "the desktop's status line");
  const phoneAt = css.indexOf("@media (max-width: 640px) {\n  #layers");
  const phone = css.slice(phoneAt);
  assert.match(phone, /#status::before \{\s*content: none;/, "the phone's row is no surface");
  assert.match(rule("\\.credits-box", phone), /--frost-tint: var\(--quiet-glass\);/, "the credits, folded or open");
  assert.match(phone, /\n  \.help-btn \{\s*--frost-tint: var\(--quiet-glass\);/, "and the help button");
  assert.match(css.slice(0, phoneAt), /@media \(min-width: 641px\) \{\s*\.help-btn::before,\s*\.credits-box::before \{\s*content: none;/, "the desktop's help button stays opaque");
  assert.match(rule("\\.tour-count"), /color: var\(--quiet-muted\);/);
  assert.match(rule("\\.credit-label"), /color: var\(--quiet-muted\);/);
  /* No white fill on the card: an outlined button lets the frost through. */
  assert.match(rule("\\.tour \\.btn:not\\(\\.primary\\)"), /background: none;\s*color: var\(--quiet-accent\);/);
});

test("less transparency or more contrast makes them opaque", () => {
  const block = /@media \(prefers-reduced-transparency: reduce\), \(prefers-contrast: more\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
  for (const token of ["--quiet-glass: var(--surface)", "--quiet-filter: none", "--quiet-muted: var(--muted)", "--quiet-accent: var(--accent)"]) {
    assert.ok(block.includes(token), token);
  }
});

test("the photo's controls take a plainer glass than the map's frost: faint arrows, and one glass in two tints for the credit and the count", () => {
  assert.match(rule("\\.photo-prev,\\n\\.photo-next"), /background: var\(--photo-glass\);\s*backdrop-filter: var\(--photo-blur\);/);
  assert.match(rule("\\.photo-credit"), /background: var\(--photo-chip-light\);\s*backdrop-filter: var\(--photo-blur\);/);
  assert.match(rule("\\.photo-count"), /background: var\(--photo-chip-dark\);\s*backdrop-filter: var\(--photo-blur\);\s*color: #fff;/);
  assert.match(css, /--photo-chip-light: rgb\(255 255 255 \/ var\(--photo-chip\)\);/, "the light tint");
  assert.match(css, /--photo-chip-dark: rgb\(20 35 43 \/ var\(--photo-chip\)\);/, "the dark tint, at the same strength");
  assert.doesNotMatch(css, /\.photo-[a-z]+ \{[^}]*--quiet-/, "not the map's lifted frost, which washes the photo out");
  const block = /@media \(prefers-reduced-transparency: reduce\), \(prefers-contrast: more\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
  for (const token of ["--photo-glass: var(--surface)", "--photo-glass-strong: var(--surface)", "--photo-chip: 100%", "--photo-blur: none"]) {
    assert.ok(block.includes(token), token);
  }
});
