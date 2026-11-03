/*
 * A scroll that starts on an open popover scrolls the panel under its button.
 * Its own file: jsdom has no popovers, so the page gets a stand-in before
 * js/ui.js reads whether there are any.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { load, loadPage } from "./helpers/browser.js";

const { window, document } = await loadPage();
Object.defineProperty(window.HTMLElement.prototype, "popover", { configurable: true, writable: true, value: null });
/* jsdom's listeners take only its own signals. */
globalThis.AbortController = window.AbortController;
const { GLIDE_MS, h, popover } = await load("js/ui.js");

const stub = (node, name, value) => Object.defineProperty(node, name, { configurable: true, writable: true, value });

const panel = h("div", { style: { overflowY: "auto" } });
stub(panel, "scrollHeight", 2000);
stub(panel, "clientHeight", 500);
stub(panel, "scrollTop", 100);
const glides = [];
panel.scrollBy = (options) => {
  if (options.behavior === "smooth") glides.push(options.top);
  else panel.scrollTop += options.top;
};
const button = h("button", { type: "button" });
const node = popover(button, "info-popover", "About it.");
panel.append(button, node);
document.body.append(panel);

function toggle(state) {
  const event = new window.Event("toggle");
  Object.defineProperty(event, "newState", { value: state });
  node.dispatchEvent(event);
}

function touch(type, y, { x = 100, time = 0 } = {}) {
  const touches = type === "touchend" ? [] : [{ clientX: x, clientY: y }];
  const event = new window.TouchEvent(type, { bubbles: true, cancelable: true, touches });
  Object.defineProperty(event, "timeStamp", { value: time });
  node.dispatchEvent(event);
  return event;
}

test("a drag up on the open popover scrolls the panel, once it is a drag, and a flick glides on", () => {
  toggle("open");
  touch("touchstart", 400, { time: 0 });
  assert.equal(touch("touchmove", 396, { time: 10 }).defaultPrevented, false, "4 px is still a tap");
  assert.equal(panel.scrollTop, 100);
  assert.equal(touch("touchmove", 300, { time: 50 }).defaultPrevented, true);
  assert.equal(panel.scrollTop, 200, "the panel follows the finger from where it went down");
  touch("touchmove", 200, { time: 100 });
  assert.equal(panel.scrollTop, 300);
  touch("touchend", 200, { time: 110 });
  assert.deepEqual(glides, [2 * GLIDE_MS], "2 px/ms carries on");
});

test("a sideways drag, or one a nearer handler took, is left alone", () => {
  touch("touchstart", 400);
  assert.equal(touch("touchmove", 400, { x: 140 }).defaultPrevented, false);
  touch("touchmove", 300, { x: 140 });
  assert.equal(panel.scrollTop, 300);

  const take = (event) => event.preventDefault();
  panel.addEventListener("touchmove", take);
  touch("touchstart", 400);
  touch("touchmove", 300);
  assert.equal(panel.scrollTop, 300, "the sheet's drag is the sheet's");
  panel.removeEventListener("touchmove", take);
});

test("a wheel on the open popover scrolls the panel; closed, the popover passes nothing on", () => {
  const wheel = new window.WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 3, deltaMode: 1 });
  node.dispatchEvent(wheel);
  assert.equal(wheel.defaultPrevented, true);
  assert.equal(panel.scrollTop, 348, "a line is 16 px");

  toggle("closed");
  touch("touchstart", 400);
  touch("touchmove", 300);
  assert.equal(panel.scrollTop, 348);
});
