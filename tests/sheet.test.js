/*
 * The phone sheet: how a gesture is classified, and the sheet's three heights.
 * Its own file because the sheet's state lives in its module.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

import { load, loadPage } from "./helpers/browser.js";

const page = await loadPage({ phone: true });
const { window, document } = page;
const el = (id) => document.getElementById(id);

/* jsdom lays nothing out: the sheet is 500 px tall and its body starts 90 px from its top. */
const stub = (node, name, value) =>
  Object.defineProperty(node, name, { configurable: true, writable: true, value });
stub(el("sheet"), "offsetHeight", 500);
stub(el("sheet-body"), "offsetTop", 90);
stub(el("sheet-body"), "scrollTop", 0);

const { FLICK, LEVELS, MIDDLE_CUT, PEEK_PX, initSheet, onLevel, popupPadding, setSheetLevel, sheetLevel, snapTarget } =
  await load("js/sheet.js");
const { GLIDE_MS, LOCK_PX, lockAxis } = await load("js/ui.js");
initSheet();

const root = () => document.documentElement.style;
const visible = () => root().getPropertyValue("--sheet-visible");
const rise = () => Number(root().getPropertyValue("--sheet-rise"));
const inert = () => el("sheet-body").hasAttribute("inert");
/* 90 px of band and the photo's top; 65 % of the sheet; the whole sheet. */
const STOPS = [90 + 20, 325, 500];

function pointer(target, type, y, { x = 100, time } = {}) {
  const event = new window.PointerEvent(type, {
    bubbles: true, cancelable: true, pointerType: "touch", pointerId: 1, isPrimary: true, clientX: x, clientY: y,
  });
  if (time !== undefined) Object.defineProperty(event, "timeStamp", { value: time });
  target.dispatchEvent(event);
  return event;
}

function touch(target, type, y, { fingers = 1, cancelable = true, time } = {}) {
  const touches = Array.from({ length: fingers }, (_, i) => ({ clientX: 100 + 40 * i, clientY: y }));
  const event = new window.TouchEvent(type, { bubbles: true, cancelable, touches });
  if (time !== undefined) Object.defineProperty(event, "timeStamp", { value: time });
  target.dispatchEvent(event);
  return event;
}

const click = (target) => {
  const event = new window.MouseEvent("click", { bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
};

/* A slow vertical drag on the body by touch, from y `from` to `to`. */
function pull(from, to) {
  const body = el("sheet-body");
  touch(body, "touchstart", from);
  const move = touch(body, "touchmove", to);
  touch(body, "touchend", to);
  return move;
}

test("a gesture is classified once it has moved", () => {
  assert.equal(LOCK_PX, 8);
  assert.equal(FLICK, 0.5);
  assert.equal(lockAxis(3, 4), null, "5 px is still a tap");
  assert.equal(lockAxis(2, 9), "y");
  assert.equal(lockAxis(9, 2), "x");
});

test("release snaps to the nearest height, or a flick's next one", () => {
  assert.deepEqual(LEVELS, ["compact", "middle", "full"]);
  assert.equal(PEEK_PX, 20);
  assert.equal(snapTarget(200, 0, STOPS), "compact");
  assert.equal(snapTarget(300, 0, STOPS), "middle");
  assert.equal(snapTarget(460, 0, STOPS), "full");
  assert.equal(snapTarget(160, 0.8, STOPS), "middle", "a flick up goes one height up");
  assert.equal(snapTarget(360, 0.8, STOPS), "full");
  assert.equal(snapTarget(500, 0.8, STOPS), "full");
  assert.equal(snapTarget(490, -0.8, STOPS), "middle", "a flick down goes one height down");
  assert.equal(snapTarget(320, -0.8, STOPS), "compact");
  assert.equal(snapTarget(110, -0.8, STOPS), "compact");
});

test("the sheet starts compact, showing the photo's top, its body out of reach", () => {
  assert.equal(sheetLevel(), "compact");
  assert.equal(el("sheet").dataset.level, "compact");
  assert.equal(el("sheet-handle").getAttribute("aria-expanded"), "false");
  assert.equal(el("sheet-handle").getAttribute("aria-label"), "Show the glacier details");
  assert.ok(inert(), "Tab cannot reach the photo and the tabs");
  assert.equal(visible(), "110px");
  assert.equal(rise(), 0);
  assert.deepEqual(popupPadding(), { bottom: 110 });
});

test("the handle steps up through the heights, and from full back to compact", () => {
  el("sheet-handle").click();
  assert.equal(sheetLevel(), "middle");
  assert.equal(inert(), false);
  assert.equal(visible(), "325px");
  assert.equal(rise(), 1);
  assert.equal(el("sheet-handle").getAttribute("aria-expanded"), "true");
  el("sheet-handle").click();
  assert.equal(sheetLevel(), "full");
  assert.equal(visible(), "500px");
  assert.equal(el("sheet-handle").getAttribute("aria-label"), "Hide the glacier details");
  assert.deepEqual(popupPadding(), { bottom: 325 }, "a fit keeps to the space the middle sheet leaves");
  el("sheet-handle").click();
  assert.equal(sheetLevel(), "compact");
  assert.ok(inert());
});

test("a swipe up the band raises the sheet and swallows only the band's click", () => {
  setSheetLevel("compact");
  const band = el("sheet-band");
  pointer(band, "pointerdown", 400, { time: 0 });
  pointer(band, "pointermove", 300, { time: 100 });
  assert.equal(visible(), "210px", "the sheet follows the finger");
  assert.ok(rise() > 0.4 && rise() < 0.5, `the credits fade with it (${rise()})`);
  assert.ok(el("sheet").classList.contains("dragging"));
  pointer(band, "pointermove", 200, { time: 1000 });
  pointer(band, "pointerup", 200, { time: 1300 });
  assert.equal(sheetLevel(), "middle");
  assert.equal(el("sheet").classList.contains("dragging"), false);
  assert.equal(click(el("map")).defaultPrevented, false, "a click elsewhere is the user's");
  assert.equal(click(band).defaultPrevented, true, "the band's is the drag's");
});

test("the compact sheet's photo strip drags the sheet, and a tap on it raises it to the middle", () => {
  setSheetLevel("compact");
  const sheet = el("sheet");
  click(sheet);
  assert.equal(sheetLevel(), "middle");
  click(sheet);
  assert.equal(sheetLevel(), "middle", "only the compact sheet's strip opens it");

  setSheetLevel("compact");
  pointer(sheet, "pointerdown", 700, { time: 0 });
  pointer(sheet, "pointermove", 650, { time: 200 });
  pointer(sheet, "pointermove", 300, { time: 1000 });
  pointer(sheet, "pointerup", 300, { time: 1300 });
  assert.equal(sheetLevel(), "full");
});

test("below full height the body moves the sheet both ways", () => {
  setSheetLevel("middle");
  assert.equal(pull(500, 300).defaultPrevented, true);
  assert.equal(sheetLevel(), "full");
  setSheetLevel("middle");
  assert.equal(pull(300, 480).defaultPrevented, true);
  assert.equal(sheetLevel(), "compact");
});

test("at full height the body scrolls, and pulled down from its top it lowers the sheet", () => {
  setSheetLevel("full");
  const body = el("sheet-body");
  assert.equal(pull(500, 300).defaultPrevented, false, "a push up scrolls the body");
  assert.equal(sheetLevel(), "full");

  body.scrollTop = 50;
  assert.equal(pull(300, 420).defaultPrevented, false, "scrolled down, the pull scrolls the body");
  assert.equal(sheetLevel(), "full");

  body.scrollTop = 0;
  assert.equal(pull(300, 420).defaultPrevented, true, "the sheet takes the gesture from the scroller");
  assert.equal(sheetLevel(), "middle");
});

test("a drag up the body that reaches full height goes on to scroll the body, and a flick glides on", () => {
  const body = el("sheet-body");
  const glides = [];
  body.scrollBy = ({ top, behavior }) => glides.push({ top, behavior });
  setSheetLevel("middle");
  body.scrollTop = 0;
  touch(body, "touchstart", 600, { time: 0 });
  touch(body, "touchmove", 500, { time: 400 });
  assert.equal(visible(), "425px");
  assert.equal(body.scrollTop, 0, "below full height the sheet moves, not the body");
  assert.equal(touch(body, "touchmove", 410, { time: 800 }).defaultPrevented, true);
  assert.equal(visible(), "500px");
  assert.equal(body.scrollTop, 15, "the 15 px past full height scroll the body");
  touch(body, "touchmove", 400, { time: 820 });
  assert.equal(body.scrollTop, 25);
  touch(body, "touchend", 400, { time: 830 });
  assert.equal(sheetLevel(), "full");
  assert.deepEqual(glides, [{ top: 0.5 * GLIDE_MS, behavior: "smooth" }], "0.5 px/ms carries the scroll on");

  glides.length = 0;
  setSheetLevel("middle");
  body.scrollTop = 0;
  touch(body, "touchstart", 600, { time: 0 });
  touch(body, "touchmove", 380, { time: 400 });
  touch(body, "touchmove", 430, { time: 800 });
  assert.equal(body.scrollTop, 0, "back below full height, the body is back at its start");
  touch(body, "touchend", 430, { time: 1200 });
  assert.equal(sheetLevel(), "full", "the nearest height");
  assert.deepEqual(glides, []);
  delete body.scrollBy;
  body.scrollTop = 0;
});

test("the credits ride on the sheet's edge, fade as it rises and hide once it rests above compact", () => {
  const css = fs.readFileSync(new URL("../style.css", import.meta.url), "utf8");
  const phone = css.slice(css.indexOf("/* Phone: the search bar, the bottom sheet"));
  assert.match(phone, /body\.card-open #status \{\s*translate: 0 calc\(-1 \* var\(--sheet-visible[^;]*;\s*opacity: calc\(1 - var\(--sheet-rise/);
  assert.match(phone, /#sheet:not\(\[data-level="compact"\]\):not\(\.dragging\)\) #status \{\s*visibility: hidden;/);
  assert.match(phone, /body:has\(#sheet\.dragging\) #status \{\s*transition: none;/);
});

test("the sheet's close button sits concentric in its corner, its disc centred on the name", () => {
  const css = fs.readFileSync(new URL("../style.css", import.meta.url), "utf8");
  assert.match(css, /--sheet-x-inset: 16px;/, "the band's own 16 px margin, which the name and the buttons keep too");
  assert.match(css, /#sheet \{[^}]*border-radius: calc\(var\(--radius\) \+ var\(--sheet-x-inset\)\) calc\(var\(--radius\) \+ var\(--sheet-x-inset\)\) 0 0;/,
    "the corner is the disc's radius plus its inset");
  assert.match(css, /#sheet-head \.card-close \{\s*top: var\(--sheet-x-inset\);\s*right: var\(--sheet-x-inset\);/);
});

test("at compact the buttons sit as far under the name's baseline as above the picture", () => {
  const css = fs.readFileSync(new URL("../style.css", import.meta.url), "utf8");
  assert.match(css, /#sheet\[data-level="compact"\] #sheet-head \.card-actions \{\s*padding-top: 9px;/,
    "16 px less the 7 px the name's line box leaves under its baseline");
});

/* Last: the sheet keeps the middle height the key numbers gave. */
test("the middle sheet cuts through the second row of the key numbers once they are laid out", () => {
  const rect = (top, height) => ({ top, bottom: top + height, height, left: 0, right: 100, width: 100 });
  const grid = document.createElement("div");
  grid.className = "key-grid";
  const tiles = [0, 1, 2, 3].map((i) => {
    const tile = document.createElement("div");
    tile.getBoundingClientRect = () => rect(i < 2 ? 640 : 704, 56);
    return tile;
  });
  grid.append(...tiles);
  grid.getClientRects = () => [rect(640, 120)];
  el("sheet-body").append(grid);
  el("sheet").getBoundingClientRect = () => rect(300, 500);

  setSheetLevel("middle");
  assert.equal(MIDDLE_CUT, 0.5);
  assert.equal(visible(), `${704 - 300 + 28}px`, "the second row's top half shows");
  grid.getClientRects = () => [];
  setSheetLevel("compact");
  setSheetLevel("middle");
  assert.equal(visible(), "432px", "while another tab hides them the height stays");
  grid.remove();
});

test("onLevel tells the reader's drag, handle and tap from the page's own moves", () => {
  const seen = [];
  onLevel((level, byReader) => seen.push([level, byReader]));
  // A press elsewhere ends the swallowing of an earlier drag's click.
  pointer(el("map"), "pointerdown", 0);
  setSheetLevel("compact");
  click(el("sheet"));
  el("sheet-handle").click();
  const band = el("sheet-band");
  pointer(band, "pointerdown", 200, { time: 0 });
  pointer(band, "pointermove", 600, { time: 1000 });
  pointer(band, "pointerup", 600, { time: 1300 });
  pull(500, 300);
  setSheetLevel("full", { byReader: true });
  page.setPhone(false);
  page.setPhone(true);
  assert.deepEqual(seen, [
    ["compact", false],
    ["middle", true],
    ["full", true],
    ["compact", true],
    ["middle", true],
    ["full", true],
    ["full", false],
    ["compact", false],
  ], "the breakpoint moves the sheet, not the reader");
});
