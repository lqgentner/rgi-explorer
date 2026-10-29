import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { loadPage, REPO } from "./helpers/browser.js";

const { window } = await loadPage();
const ui = await import("../js/ui.js");

test("el finds an element by id", () => {
  assert.equal(ui.el("map"), window.document.getElementById("map"));
});

test("h builds nodes with properties, attributes and children", () => {
  const node = ui.h("button", { class: "go", "data-x": "1", disabled: true }, "Go", [null, "!"]);
  assert.equal(node.className, "go");
  assert.equal(node.getAttribute("data-x"), "1");
  assert.equal(node.disabled, true);
  assert.equal(node.textContent, "Go!");
});

test("h never parses a string as markup", () => {
  assert.equal(ui.h("p", {}, "<img src=x>").children.length, 0);
});

test("h sets a style object through the CSSOM and refuses a style string", () => {
  const node = ui.h("div", { style: { background: "var(--line)" } });
  assert.equal(node.style.background, "var(--line)");
  assert.throws(() => ui.h("div", { style: "background: red" }), TypeError);
});

/* The CSP's style-src blocks style attributes. Inline styles go through the CSSOM. */
test("no module in js/ writes a style attribute", () => {
  const dir = path.join(REPO, "js");
  const found = [];
  for (const name of fs.readdirSync(dir).filter((file) => file.endsWith(".js"))) {
    fs.readFileSync(path.join(dir, name), "utf8").split("\n").forEach((line, i) => {
      if (/["']?\bstyle["']?\s*:\s*["'`]/.test(line) || /setAttribute(NS)?\([^)]*["']style["']/.test(line)) {
        found.push(`js/${name}:${i + 1}: ${line.trim()}`);
      }
    });
  }
  assert.deepEqual(found, []);
});

test("PHONE asks the 640px query the stylesheet uses", () => {
  assert.equal(ui.PHONE.media, "(max-width: 640px)");
});

test("icon names a symbol in the Lucide sprite, for any icon", () => {
  for (const name of ["layers-2", "search", "x", "info", "copy", "share-2", "maximize", "box", "chevron-down", "mountain"]) {
    const svg = ui.icon(name);
    assert.equal(svg.namespaceURI, "http://www.w3.org/2000/svg");
    assert.equal(svg.tagName, "svg");
    assert.equal(
      svg.querySelector("use").getAttribute("href"),
      `node_modules/lucide-static/sprite.svg#${name}`,
    );
  }
});
