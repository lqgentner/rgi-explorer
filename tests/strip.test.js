/* The image strip: keyed tiles, counters, arrows, the shown image and opening one. */

import assert from "node:assert/strict";
import { test } from "node:test";

import { load, loadPage } from "./helpers/browser.js";

const { document, window, setPhone } = await loadPage();
const { mountStrip } = await load("js/strip.js");
const { h } = await load("js/ui.js");

const click = (node) => node.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

/** An item whose credit() calls are counted. */
function item(key, src = `https://x/${key}.jpg`) {
  const it = { key, src, alt: `Image ${key}`, calls: 0 };
  it.credit = () => {
    it.calls += 1;
    return h("div", { class: "photo-credit" }, `credit ${key}`);
  };
  return it;
}

function mount(opens = []) {
  const photo = document.createElement("div");
  document.body.append(photo);
  const strip = mountStrip(photo, { label: "Glacier images", onOpen: (i, button) => opens.push([i, button]) });
  return { photo, strip, tiles: () => [...photo.querySelectorAll(".strip-tile")] };
}

test("a tile per item in order, with a counter only from two images", () => {
  const { photo, strip, tiles } = mount();
  strip.update([item("a")]);
  assert.equal(tiles().length, 1);
  assert.equal(photo.querySelector(".photo-count"), null);
  strip.update([item("a"), item("b"), item("c")]);
  assert.deepEqual(tiles().map((t) => t.dataset.key), ["a", "b", "c"]);
  assert.deepEqual([...photo.querySelectorAll(".photo-count")].map((n) => n.textContent), ["1 / 3", "2 / 3", "3 / 3"]);
  assert.equal(photo.querySelector(".strip").getAttribute("aria-label"), "Glacier images");
  assert.equal(tiles()[1].querySelector(".strip-open").getAttribute("aria-label"), "Open image 2 of 3");
});

test("an update keeps an unchanged key's tile and image and appends new ones", () => {
  const { strip, tiles } = mount();
  const a = item("a");
  strip.update([a]);
  const [tile] = tiles();
  const img = tile.querySelector("img");
  strip.update([a, item("b"), item("c")]);
  assert.equal(tiles()[0], tile);
  assert.equal(tiles()[0].querySelector("img"), img);
  assert.equal(a.calls, 1);
});

test("a changed src updates the same image and asks for a new credit", () => {
  const { strip, tiles } = mount();
  const a = item("a");
  strip.update([a]);
  const img = tiles()[0].querySelector("img");
  strip.update([{ ...a, src: "https://x/a2.jpg" }]);
  assert.equal(tiles()[0].querySelector("img"), img);
  assert.equal(img.getAttribute("src"), "https://x/a2.jpg");
  assert.equal(a.calls, 2);
  assert.equal(tiles()[0].querySelectorAll(".photo-credit").length, 1, "the old credit is replaced, not kept");
});

test("an image takes its item's class and alt, and its error reaches the item", () => {
  const { strip, tiles } = mount();
  let errors = 0;
  strip.update([{ ...item("a"), className: "photo-crop", onError: () => (errors += 1) }]);
  const img = tiles()[0].querySelector("img");
  assert.equal(img.className, "photo-crop");
  assert.equal(img.alt, "Image a");
  img.dispatchEvent(new window.Event("error"));
  assert.equal(errors, 1);
});

test("only the first image loads eagerly", () => {
  const { strip, tiles } = mount();
  strip.update([item("a"), item("b"), item("c")]);
  const loading = tiles().map((t) => t.querySelector("img").getAttribute("loading"));
  assert.deepEqual(loading, [null, "lazy", "lazy"]);
});

test("the arrows show only from two images and hide at the ends", () => {
  const { photo, strip } = mount();
  const prev = photo.querySelector(".photo-prev");
  const next = photo.querySelector(".photo-next");
  strip.update([item("a")]);
  assert.equal(prev.hidden, true);
  assert.equal(next.hidden, true);
  strip.update([item("a"), item("b"), item("c")]);
  assert.equal(prev.hidden, true);
  assert.equal(next.hidden, false);
  click(next);
  click(next);
  assert.equal(strip.index, 2);
  assert.equal(next.hidden, true);
  assert.equal(prev.hidden, false);
  assert.ok(prev.querySelector('use[href$="#chevron-left"]'));
  assert.ok(next.querySelector('use[href$="#chevron-right"]'));
  assert.equal(prev.getAttribute("aria-label"), "Previous image");
  assert.equal(next.getAttribute("aria-label"), "Next image");
});

test("a click on an image opens it at its index; a credit link does not", () => {
  const opens = [];
  const { strip, tiles } = mount(opens);
  const linked = (key) => ({ ...item(key), credit: () => h("div", { class: "photo-credit" }, h("a", { href: "https://c" }, "x")) });
  strip.update([linked("a"), linked("b")]);
  const button = tiles()[1].querySelector(".strip-open");
  click(button);
  assert.deepEqual(opens, [[1, button]]);
  const link = tiles()[1].querySelector(".photo-credit a");
  link.addEventListener("click", (event) => event.preventDefault());
  click(link);
  assert.equal(opens.length, 1);
});

test("a change of layout keeps the shown image and re-centres it at once", () => {
  const { photo, strip } = mount();
  const scroller = photo.querySelector(".strip");
  const calls = [];
  scroller.scrollTo = (options) => calls.push(options);
  strip.update([item("a"), item("b"), item("c")]);
  strip.show(2);
  setPhone(true);
  try {
    assert.equal(strip.index, 2);
    assert.equal(calls.at(-1).behavior, "instant");
  } finally {
    setPhone(false);
  }
});

test("an arrow scrolls smoothly; show() jumps", () => {
  const { photo, strip } = mount();
  const scroller = photo.querySelector(".strip");
  const calls = [];
  scroller.scrollTo = (options) => calls.push(options);
  strip.update([item("a"), item("b")]);
  click(photo.querySelector(".photo-next"));
  assert.equal(calls.at(-1).behavior, "smooth");
  strip.show(0);
  assert.equal(calls.at(-1).behavior, "instant");
  assert.equal(strip.index, 0);
});

test("an update clamps the index", () => {
  const { strip } = mount();
  strip.update([item("a"), item("b"), item("c")]);
  strip.show(2);
  strip.update([item("a")]);
  assert.equal(strip.index, 0);
});

test("an update keeps keyboard focus on a tile that stays", () => {
  const { strip, tiles } = mount();
  const a = item("a");
  strip.update([a]);
  const button = tiles()[0].querySelector(".strip-open");
  button.focus();
  strip.update([a, item("b"), item("c")]);
  assert.equal(document.activeElement, button);
});

test("an arrow that hides while focused hands focus to the other arrow", () => {
  const { photo, strip } = mount();
  strip.update([item("a"), item("b")]);
  const next = photo.querySelector(".photo-next");
  next.focus();
  click(next);
  assert.equal(next.hidden, true);
  assert.equal(document.activeElement, photo.querySelector(".photo-prev"));
});

test("buttonAt returns the open button of image i", () => {
  const { strip, tiles } = mount();
  strip.update([item("a"), item("b")]);
  assert.equal(strip.buttonAt(1), tiles()[1].querySelector(".strip-open"));
  assert.equal(strip.buttonAt(5), null);
});
