/* The image viewer: opening at an image, loading its large file once, moving, closing. */

import assert from "node:assert/strict";
import { test } from "node:test";

import { load, loadPage, settle } from "./helpers/browser.js";

const { document, window, setPhone } = await loadPage();
const { openViewer, viewerCropSize } = await load("js/viewer.js");
const { h } = await load("js/ui.js");

const click = (node) => node.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
const key = (node, k) => node.dispatchEvent(new window.KeyboardEvent("keydown", { key: k, bubbles: true }));
const dialog = () => document.querySelector("dialog.viewer");
const isOpen = () => Boolean(dialog()?.open || dialog()?.hasAttribute("open"));
const current = () => dialog().querySelector(".viewer-slide.current");

/** Three fake items; `large` answers `answers[i]` and every call is recorded. */
function items(answers = ["https://big/0.jpg", "https://big/1.jpg", null]) {
  const calls = { large: [], credit: [] };
  const list = answers.map((answer, i) => ({
    alt: `Image ${i}`,
    thumb: i === 2 ? `https://thumb/${i}.jpg` : i === 0 ? undefined : `https://thumb/${i}.jpg`,
    large: (size) => {
      calls.large.push([i, size]);
      return Promise.resolve(answer);
    },
    credit: (size) => {
      calls.credit.push([i, size]);
      return h("div", {}, `credit ${i}`);
    },
  }));
  return { list, calls };
}

function closeIfOpen() {
  if (isOpen()) key(dialog(), "Escape");
}

test("viewerCropSize doubles the CSS size and keeps the longest side within 4096", () => {
  assert.deepEqual(viewerCropSize(1000, 600), [2000, 1200]);
  assert.deepEqual(viewerCropSize(3000, 1000), [4096, 1365]);
  assert.deepEqual(viewerCropSize(500, 300, { scale: 1 }), [500, 300]);
});

test("the viewer opens at the given image with its counter", () => {
  const { list } = items();
  openViewer(list, 1, {});
  assert.ok(isOpen());
  assert.equal(dialog().parentElement, document.body);
  assert.equal(dialog().querySelectorAll(".viewer-slide").length, 3);
  assert.equal(current().querySelector(".photo-count").textContent, "2 / 3");
  closeIfOpen();
});

test("only the shown image asks for its large file, once", async () => {
  const { list, calls } = items();
  openViewer(list, 1, {});
  const size = viewerCropSize(window.innerWidth, window.innerHeight);
  assert.deepEqual(calls.large, [[1, size]]);
  assert.deepEqual(calls.credit, [[1, size]]);
  key(dialog(), "ArrowRight");
  assert.deepEqual(calls.large.map(([i]) => i), [1, 2]);
  key(dialog(), "ArrowLeft");
  assert.deepEqual(calls.large.map(([i]) => i), [1, 2], "a slide loads once");
  await settle();
  closeIfOpen();
});

test("the large file replaces the thumbnail, a null keeps it, and no thumb waits empty", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const { list } = items();
  list[0].large = () => gate;
  openViewer(list, 0, {});
  const first = dialog().querySelectorAll(".viewer-slide img")[0];
  assert.equal(first.getAttribute("src"), null, "the imagery has no stand-in");
  release("https://big/0.jpg");
  await settle();
  assert.equal(first.getAttribute("src"), "https://big/0.jpg");
  key(dialog(), "ArrowRight");
  key(dialog(), "ArrowRight");
  const third = dialog().querySelectorAll(".viewer-slide img")[2];
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

test("the arrows carry Lucide's chevrons and hide at the ends", () => {
  const { list } = items();
  openViewer(list, 0, {});
  const prev = dialog().querySelector(".viewer-prev");
  const next = dialog().querySelector(".viewer-next");
  assert.ok(prev.querySelector('use[href$="#chevron-left"]'));
  assert.ok(next.querySelector('use[href$="#chevron-right"]'));
  assert.equal(prev.hidden, true);
  assert.equal(next.hidden, false);
  click(next);
  click(next);
  assert.equal(current().querySelector(".photo-count").textContent, "3 / 3");
  assert.equal(next.hidden, true);
  assert.equal(prev.hidden, false);
  closeIfOpen();
});

test("one image has no counter or arrows", () => {
  const { list } = items(["https://big/0.jpg"]);
  openViewer(list, 0, {});
  assert.equal(dialog().querySelector(".photo-count"), null);
  assert.equal(dialog().querySelector(".viewer-prev").hidden, true);
  assert.equal(dialog().querySelector(".viewer-next").hidden, true);
  closeIfOpen();
});

test("crossing the breakpoint keeps the viewer open on the same image", () => {
  const { list } = items();
  openViewer(list, 2, {});
  setPhone(true);
  try {
    assert.ok(isOpen());
    assert.equal(current().querySelector(".photo-count").textContent, "3 / 3");
  } finally {
    setPhone(false);
    closeIfOpen();
  }
});
