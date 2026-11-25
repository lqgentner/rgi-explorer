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

const doc = window.document;
const key = (node, name) => {
  const event = new window.KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true });
  node.dispatchEvent(event);
  return event;
};

test("closeButton is a named round ✕, with its place's class and the tour's name", () => {
  const plain = ui.closeButton();
  assert.equal(plain.getAttribute("aria-label"), "Close");
  assert.equal(plain.className, "icon-button");
  assert.equal(plain.type, "button");
  assert.ok(plain.querySelector("use").getAttribute("href").endsWith("#x"));
  const named = ui.closeButton({ className: "tour-close", label: "End tour", tour: "x-close" });
  assert.equal(named.className, "icon-button tour-close");
  assert.equal(named.getAttribute("aria-label"), "End tour");
  assert.equal(named.dataset.tour, "x-close");
});

test("copyText says whether the clipboard took the text", async () => {
  const written = [];
  Object.defineProperty(globalThis.navigator, "clipboard", { configurable: true, value: { writeText: async (t) => void written.push(t) } });
  assert.equal(await ui.copyText("a"), true);
  Object.defineProperty(globalThis.navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new Error("denied"); } } });
  assert.equal(await ui.copyText("b"), false);
  assert.deepEqual(written, ["a"]);
});

test("tablist: one Tab stop, arrows that wrap, Home and End, and a click, each heard as a pick", () => {
  const picks = [];
  const items = [{ id: "a", label: "A" }, { id: "b", label: "B" }, { id: "c", label: "C" }];
  const list = ui.tablist(items, { prefix: "t", label: "Things", controls: (id) => `panel-${id}`, onPick: (id, focus) => {
    picks.push([id, focus]);
    list.select(id, focus);
  } });
  doc.body.append(list.node);
  list.select("a");
  assert.equal(list.node.getAttribute("role"), "tablist");
  assert.equal(list.node.getAttribute("aria-label"), "Things");
  assert.deepEqual(Object.values(list.tabs).map((t) => [t.id, t.getAttribute("aria-controls"), t.tabIndex]),
    [["t-tab-a", "panel-a", 0], ["t-tab-b", "panel-b", -1], ["t-tab-c", "panel-c", -1]]);
  assert.equal(key(list.tabs.a, "ArrowLeft").defaultPrevented, true);
  assert.equal(doc.activeElement, list.tabs.c, "the arrows wrap round and focus the tab");
  key(list.tabs.c, "Home");
  key(list.tabs.a, "End");
  list.tabs.b.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  assert.equal(key(list.tabs.b, "Enter").defaultPrevented, false, "other keys pass");
  assert.deepEqual(picks, [["c", true], ["a", true], ["c", true], ["b", false]]);
  assert.equal(list.tabs.b.getAttribute("aria-selected"), "true");
  list.node.remove();
});

/* A pane with its opener: shown and hidden by its attribute. */
function pane() {
  const opener = ui.h("button", {}, "Open");
  const node = ui.h("div", { hidden: true }, ui.h("button", {}, "Inside"));
  doc.body.append(opener, node);
  const toggles = [];
  const surface = ui.modal({
    nodes: [node],
    isOpen: () => !node.hidden,
    show: () => (node.hidden = false),
    hide: () => (node.hidden = true),
    onToggle: (open) => toggles.push(open),
  });
  return { opener, node, toggles, surface };
}

test("modal hears each real change once, and focuses the opener again on close", () => {
  const { opener, node, toggles, surface } = pane();
  opener.focus();
  surface.open();
  node.querySelector("button").focus();
  surface.open();
  assert.equal(node.hidden, false);
  surface.close();
  surface.close();
  assert.deepEqual(toggles, [true, false]);
  assert.equal(doc.activeElement, opener, "the opener of the first open, not the focus inside");

  surface.open(opener);
  node.querySelector("button").focus();
  surface.close({ refocus: false });
  assert.notEqual(doc.activeElement, opener, "left to the caller");
});

test("modal closes on Escape only while open, and takes the key from the page", () => {
  const { node, toggles, surface } = pane();
  assert.equal(key(node, "Escape").defaultPrevented, false, "closed, it lets Escape pass");
  surface.open();
  assert.equal(key(node, "Escape").defaultPrevented, true);
  assert.equal(node.hidden, true);
  assert.deepEqual(toggles, [true, false]);
});

test("modal runs a dialog's cancel and Escape through onEscape, and its backdrop closes only from outside the box", () => {
  const dialog = ui.h("dialog", {}, ui.h("p", {}, "Text"));
  doc.body.append(dialog);
  let escapes = 0;
  const surface = ui.modal({
    nodes: [dialog],
    isOpen: () => ui.isDialogOpen(dialog),
    show: () => ui.openDialog(dialog),
    hide: () => ui.closeDialog(dialog),
    backdrop: true,
  });
  const otherNode = ui.h("dialog");
  const other = ui.modal({ nodes: [otherNode], isOpen: () => true, show() {}, hide() {}, onEscape: () => (escapes += 1) });
  dialog.getBoundingClientRect = () => ({ left: 100, right: 300, top: 100, bottom: 300 });
  const at = (type, x, y, target = dialog) => target.dispatchEvent(new window.MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));

  surface.open();
  const cancel = new window.Event("cancel", { cancelable: true });
  dialog.dispatchEvent(cancel);
  assert.equal(cancel.defaultPrevented, true);
  assert.equal(ui.isDialogOpen(dialog), false, "the cancel closes it through the bookkeeping");

  surface.open();
  at("pointerdown", 150, 150);
  at("click", 150, 150);
  assert.ok(ui.isDialogOpen(dialog), "a click on the dialog's own padding keeps it open");
  at("pointerdown", 150, 150);
  at("click", 20, 20);
  assert.ok(ui.isDialogOpen(dialog), "a drag that ends outside keeps it open");
  at("pointerdown", 20, 20);
  at("click", 20, 20);
  assert.equal(ui.isDialogOpen(dialog), false, "a click outside the box closes it");

  other.close();
  assert.equal(escapes, 0, "close() itself is not an Escape");
  const custom = new window.Event("cancel", { cancelable: true });
  otherNode.dispatchEvent(custom);
  assert.equal(key(otherNode, "Escape").defaultPrevented, true);
  assert.equal(custom.defaultPrevented, true);
  assert.equal(escapes, 2, "a cancel and an Escape each run onEscape, not close");
});
