/* The image viewer: opening at an image, loading its large file once, moving, closing. */

import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

import { load, loadPage, settle } from "./helpers/browser.js";

const { document, window, setPhone } = await loadPage();
const { openViewer } = await load("js/viewer.js");
const { h } = await load("js/ui.js");

const click = (node) => node.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
const key = (node, k) => node.dispatchEvent(new window.KeyboardEvent("keydown", { key: k, bubbles: true }));
const dialog = () => document.querySelector("dialog.viewer");
const isOpen = () => Boolean(dialog()?.open || dialog()?.hasAttribute("open"));
const current = () => dialog().querySelector(".viewer-slide.current");
const count = () => dialog().querySelector(".viewer-dock .viewer-count").textContent;

/** Three fake items; `large` answers `answers[i]` and every call is recorded. */
function items(answers = ["https://big/0.jpg", "https://big/1.jpg", null]) {
  const calls = { large: [], credit: [] };
  const list = answers.map((answer, i) => ({
    alt: `Image ${i}`,
    thumb: i === 2 ? `https://thumb/${i}.jpg` : i === 0 ? undefined : `https://thumb/${i}.jpg`,
    large: () => {
      calls.large.push(i);
      return Promise.resolve(answer);
    },
    credit: () => {
      calls.credit.push(i);
      return h("div", {}, `credit ${i}`);
    },
  }));
  return { list, calls };
}

function closeIfOpen() {
  if (isOpen()) key(dialog(), "Escape");
}

test("the viewer opens at the given image with its counter", () => {
  const { list } = items();
  openViewer(list, 1, {});
  assert.ok(isOpen());
  assert.equal(dialog().parentElement, document.body);
  assert.equal(dialog().querySelectorAll(".viewer-slide").length, 3);
  assert.equal(count(), "2 / 3");
  closeIfOpen();
});

test("only the shown image asks for its large file, once", async () => {
  const { list, calls } = items();
  openViewer(list, 1, {});
  assert.deepEqual(calls.large, [1]);
  assert.deepEqual(calls.credit, [1]);
  key(dialog(), "ArrowRight");
  assert.deepEqual(calls.large, [1, 2]);
  key(dialog(), "ArrowLeft");
  assert.deepEqual(calls.large, [1, 2], "a slide loads once");
  await settle();
  closeIfOpen();
});

test("the large file replaces the thumbnail, a null keeps it, and no thumb waits empty", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const { list } = items();
  list[0].large = () => gate;
  openViewer(list, 0, {});
  const first = dialog().querySelectorAll(".viewer-slide .viewer-image")[0];
  assert.equal(first.getAttribute("src"), null, "the imagery has no stand-in");
  release("https://big/0.jpg");
  await settle();
  assert.equal(first.getAttribute("src"), "https://big/0.jpg");
  key(dialog(), "ArrowRight");
  key(dialog(), "ArrowRight");
  const third = dialog().querySelectorAll(".viewer-slide .viewer-image")[2];
  assert.equal(third.getAttribute("src"), "https://thumb/2.jpg");
  await settle();
  assert.equal(third.getAttribute("src"), "https://thumb/2.jpg", "a null answer keeps the thumbnail");
  closeIfOpen();
});

test("Escape closes, reports the image and returns focus", () => {
  const opener = document.createElement("button");
  document.body.append(opener);
  opener.focus();
  const closed = [];
  const { list } = items();
  openViewer(list, 0, { onClose: (i) => closed.push(i), returnFocus: opener });
  key(dialog(), "ArrowRight");
  key(dialog(), "Escape");
  assert.equal(isOpen(), false);
  assert.deepEqual(closed, [1]);
  assert.equal(document.activeElement, opener);
});

test("the close button closes too", () => {
  const closed = [];
  const { list } = items();
  openViewer(list, 2, { onClose: (i) => closed.push(i) });
  const close = dialog().querySelector(".viewer-close");
  assert.ok(close.querySelector('use[href$="#x"]'));
  assert.equal(close.getAttribute("aria-label"), "Close");
  click(close);
  assert.equal(isOpen(), false);
  assert.deepEqual(closed, [2]);
});

test("the arrows carry Lucide's chevrons and stay in place at the ends: disabled, not hidden", () => {
  const { list } = items();
  openViewer(list, 0, {});
  const prev = dialog().querySelector(".viewer-prev");
  const next = dialog().querySelector(".viewer-next");
  assert.ok(prev.querySelector('use[href$="#chevron-left"]'));
  assert.ok(next.querySelector('use[href$="#chevron-right"]'));
  assert.equal(prev.hidden, false);
  assert.equal(prev.disabled, true);
  assert.equal(next.disabled, false);
  click(next);
  click(next);
  assert.equal(count(), "3 / 3");
  assert.equal(next.disabled, true);
  assert.equal(next.hidden, false);
  assert.equal(prev.disabled, false);
  closeIfOpen();
});

test("one image has no counter or arrows", () => {
  const { list } = items(["https://big/0.jpg"]);
  openViewer(list, 0, {});
  assert.equal(dialog().querySelector(".viewer-controls").hidden, true);
  closeIfOpen();
});

test("the credit and controls sit in one dock outside the images, the same for every image", () => {
  const { list } = items();
  openViewer(list, 0, {});
  const dock = dialog().querySelector(".viewer-dock");
  assert.equal(dialog().querySelector(".viewer-track").contains(dock), false);
  assert.equal(dock.querySelector(".viewer-credit").textContent, "credit 0");
  assert.equal(count(), "1 / 3");
  key(dialog(), "ArrowRight");
  assert.equal(dialog().querySelector(".viewer-dock"), dock);
  assert.equal(dock.querySelector(".viewer-credit").textContent, "credit 1");
  assert.equal(count(), "2 / 3");
  key(dialog(), "ArrowLeft");
  assert.equal(dock.querySelector(".viewer-credit").textContent, "credit 0", "a credit built once is shown again");
  closeIfOpen();
});

test("on the desktop a click outside the image closes the viewer; the image, the dock and the phone's background do not", () => {
  const { list } = items();
  openViewer(list, 1, {});
  click(current().querySelector(".viewer-image"));
  assert.ok(isOpen(), "a click on the image keeps it open");
  click(dialog().querySelector(".viewer-dock .viewer-credit"));
  assert.ok(isOpen(), "a click on the credit keeps it open");
  setPhone(true);
  try {
    click(current().querySelector(".viewer-stage"));
    assert.ok(isOpen(), "on the phone a tap between swipes does not close it");
  } finally {
    setPhone(false);
  }
  click(current().querySelector(".viewer-stage"));
  assert.equal(isOpen(), false, "on the desktop the area around the image closes it");
});

test("the phone's background is one blurred layer that stays put and follows the shown image", async () => {
  const { list } = items();
  openViewer(list, 1, {});
  const layers = [...dialog().querySelectorAll("img.viewer-backdrop")];
  assert.equal(layers.length, 2, "two layers, to cross-fade");
  for (const layer of layers) {
    assert.equal(dialog().querySelector(".viewer-track").contains(layer), false, "not in the track, so a swipe does not move it");
    assert.equal(layer.getAttribute("aria-hidden"), "true");
  }
  const shown = () => dialog().querySelectorAll("img.viewer-backdrop.on");
  assert.equal(shown().length, 1);
  assert.equal(shown()[0].getAttribute("src"), "https://thumb/1.jpg", "the stand-in first");
  await settle();
  assert.equal(shown()[0].getAttribute("src"), "https://big/1.jpg", "then the large file");
  const before = shown()[0];
  key(dialog(), "ArrowRight");
  assert.equal(shown().length, 1);
  assert.notEqual(shown()[0], before, "the other layer fades in");
  assert.equal(shown()[0].getAttribute("src"), "https://thumb/2.jpg");
  closeIfOpen();
});

test("the layer pane and the dialog share the light scrim, and the desktop viewer has the strong one", () => {
  const css = fs.readFileSync(new URL("../style.css", import.meta.url), "utf8");
  const rule = (sel) => [...css.matchAll(new RegExp(`(^|\\n)\\s*${sel}\\s*{([^}]*)}`, "g"))].map((m) => m[2]).join("\n");
  assert.match(css, /--scrim:\s*rgb\(32 33 36 \/ 40%\)/);
  assert.match(css, /--scrim-strong:\s*rgb\(32 33 36 \/ 80%\)/);
  assert.match(rule("\\.layers-scrim"), /background:\s*var\(--scrim\)/);
  assert.match(rule("dialog\\.usedata::backdrop"), /background:\s*var\(--scrim\)/);
  assert.match(rule("dialog\\.viewer"), /background:\s*var\(--scrim-strong\)/, "the full-screen dialog is the scrim");
  const phone = [...css.matchAll(/@media \(max-width: 640px\)\s*{([\s\S]*?)\n}/g)].map((m) => m[1]).join("\n");
  assert.match(phone, /\.viewer-backdrop\s*{[^}]*filter:\s*blur\(/);
});

test("crossing the breakpoint keeps the viewer open on the same image", () => {
  const { list } = items();
  openViewer(list, 2, {});
  setPhone(true);
  try {
    assert.ok(isOpen());
    assert.equal(count(), "3 / 3");
  } finally {
    setPhone(false);
    closeIfOpen();
  }
});

test("closing hands focus to returnFocus(index) without scrolling, after onClose", () => {
  const order = [];
  const target = document.createElement("button");
  document.body.append(target);
  const options = [];
  const real = target.focus.bind(target);
  target.focus = (opts) => { options.push(opts); order.push("focus"); real(opts); };
  const { list } = items();
  openViewer(list, 0, { onClose: (i) => order.push(`close ${i}`), returnFocus: (i) => (i === 1 ? target : null) });
  key(dialog(), "ArrowRight");
  key(dialog(), "Escape");
  assert.deepEqual(order, ["close 1", "focus"]);
  assert.deepEqual(options, [{ preventScroll: true }]);
  assert.equal(document.activeElement, target);
});
