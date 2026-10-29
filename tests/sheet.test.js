/*
 * The phone sheet: how a gesture is classified, and the sheet's two heights.
 * Its own file because the sheet's state lives in its module.
 */

import assert from "node:assert/strict";
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

const { FLICK, LOCK_PX, initSheet, lockAxis, popupPadding, setSheetOpen, snapTarget } = await load("js/sheet.js");
initSheet();

const root = () => document.documentElement.style;
const progress = () => Number(root().getPropertyValue("--sheet-progress"));
const isOpen = () => el("sheet").classList.contains("expanded");
const inert = () => el("sheet-body").hasAttribute("inert");

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

test("a gesture is classified once it has moved", () => {
  assert.equal(LOCK_PX, 8);
  assert.equal(FLICK, 0.5);
  assert.equal(lockAxis(3, 4), null, "5 px is still a tap");
  assert.equal(lockAxis(2, 9), "y");
  assert.equal(lockAxis(9, 2), "x");
});

test("release snaps to the nearer height unless it was flicked", () => {
  assert.equal(snapTarget(0.3, 0), "compact");
  assert.equal(snapTarget(0.6, 0), "open");
  assert.equal(snapTarget(0.2, 0.8), "open");
  assert.equal(snapTarget(0.9, -0.8), "compact");
});

test("the sheet starts compact, its body out of reach", () => {
  assert.equal(isOpen(), false);
  assert.equal(el("sheet-handle").getAttribute("aria-expanded"), "false");
  assert.equal(el("sheet-handle").getAttribute("aria-label"), "Show the glacier details");
  assert.ok(inert(), "Tab cannot reach the photo and the tabs");
  assert.equal(root().getPropertyValue("--sheet-visible"), "90px");
  assert.equal(root().getPropertyValue("--sheet-travel"), "410px");
  assert.equal(progress(), 0);
  assert.deepEqual(popupPadding(), { bottom: 90 });
});

test("the handle opens and closes the sheet", () => {
  el("sheet-handle").click();
  assert.ok(isOpen());
  assert.equal(inert(), false);
  assert.equal(progress(), 1);
  assert.equal(root().getPropertyValue("--sheet-visible"), "500px");
  assert.equal(el("sheet-handle").getAttribute("aria-label"), "Hide the glacier details");
  el("sheet-handle").click();
  assert.equal(isOpen(), false);
  assert.ok(inert());
});

test("a swipe up the band opens the sheet and swallows only the band's click", () => {
  const band = el("sheet-band");
  pointer(band, "pointerdown", 400);
  pointer(band, "pointermove", 300);
  assert.ok(progress() > 0 && progress() < 1, `the sheet follows the finger (${progress()})`);
  assert.ok(el("sheet").classList.contains("dragging"));
  pointer(band, "pointermove", 200);
  pointer(band, "pointerup", 200);
  assert.ok(isOpen());
  assert.equal(el("sheet").classList.contains("dragging"), false);
  assert.equal(click(el("map")).defaultPrevented, false, "a click elsewhere is the user's");
  assert.equal(click(band).defaultPrevented, true, "the band's is the drag's");
});

test("pulling the body down from its top closes the sheet", () => {
  setSheetOpen(true);
  const body = el("sheet-body");
  body.scrollTop = 50;
  touch(body, "touchstart", 300);
  let move = touch(body, "touchmove", 420);
  touch(body, "touchend", 420);
  assert.ok(isOpen(), "scrolled down, the pull scrolls the body");
  assert.equal(move.defaultPrevented, false);

  body.scrollTop = 0;
  touch(body, "touchstart", 300);
  move = touch(body, "touchmove", 420);
  touch(body, "touchend", 420);
  assert.equal(move.defaultPrevented, true, "the sheet takes the gesture from the scroller");
  assert.equal(isOpen(), false);
});
