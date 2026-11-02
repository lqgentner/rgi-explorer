/*
 * The phone sheet: how a gesture is classified, and the sheet's three heights.
 * Its own file because the sheet's state lives in its module.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

import { load, loadPage } from "./helpers/browser.js";

const { window, document } = await loadPage({ phone: true });
const el = (id) => document.getElementById(id);

/* jsdom lays nothing out: the sheet is 500 px tall and its body starts 90 px from its top. */
const stub = (node, name, value) =>
  Object.defineProperty(node, name, { configurable: true, writable: true, value });
stub(el("sheet"), "offsetHeight", 500);
stub(el("sheet-body"), "offsetTop", 90);
stub(el("sheet-body"), "scrollTop", 0);

const { FLICK, LEVELS, LOCK_PX, PEEK_PX, initSheet, lockAxis, popupPadding, setSheetLevel, sheetLevel, snapTarget } =
  await load("js/sheet.js");
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

function touch(target, type, y, { fingers = 1, cancelable = true } = {}) {
  const touches = Array.from({ length: fingers }, (_, i) => ({ clientX: 100 + 40 * i, clientY: y }));
  const event = new window.TouchEvent(type, { bubbles: true, cancelable, touches });
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
