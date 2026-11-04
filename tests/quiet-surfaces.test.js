/* The lower-priority surfaces: frosted, and opaque for readers who ask for less transparency or more contrast. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("../style.css", import.meta.url), "utf8");
const rule = (selector, from = css) => new RegExp(`(^|\\n)\\s*${selector} \\{([^}]*)\\}`).exec(from)?.[2] ?? "";

test("the tour card and the phone's help and info buttons take the quiet surface", () => {
  assert.match(rule("\\.tour"), /background: var\(--quiet-card\);\s*backdrop-filter: var\(--quiet-filter\);/);
  const phone = css.slice(css.indexOf("@media (max-width: 640px) {\n  #layers"));
  assert.match(rule("\\.help-btn,\\n  \\.credits-box:not\\(\\.open\\)", phone), /background: var\(--quiet-button\);\s*backdrop-filter: var\(--quiet-filter\);/);
  /* The open credits stand on white; the tour's small grey count takes the darker grey. */
  assert.match(rule("\\.tour-count"), /color: var\(--quiet-muted\);/);
  /* No white fill on the card: an outlined button lets the frost through. */
  assert.match(rule("\\.tour \\.btn:not\\(\\.primary\\)"), /background: none;\s*color: var\(--quiet-accent\);/);
});

test("less transparency or more contrast makes them opaque", () => {
  const block = /@media \(prefers-reduced-transparency: reduce\), \(prefers-contrast: more\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "";
  for (const token of ["--quiet-button: var(--surface)", "--quiet-card: var(--surface)", "--quiet-filter: none", "--quiet-muted: var(--muted)", "--quiet-accent: var(--accent)"]) {
    assert.ok(block.includes(token), token);
  }
});
