/* The guided tour: where its popover goes, its four steps, the wait for a glacier and the ways it ends. */

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import { loadPage, load } from "./helpers/browser.js";

const page = await loadPage();
const { window, document } = page;
const { mountTour, placeNear } = await load("js/tour.js");
const { PHONE } = await load("js/ui.js");

const VIEWPORT = { width: 1024, height: 768 };
const BOX = { width: 280, height: 120 };
const rect = (left, top, right, bottom) => ({ left, top, right, bottom, width: right - left, height: bottom - top });

test("the popover goes below a target near the top", () => {
  const at = placeNear(rect(16, 16, 392, 64), BOX, VIEWPORT, ["below"]);
  assert.equal(at.side, "below");
  assert.equal(at.top, 64 + 12);
  assert.equal(at.left, 16 + 188 - 140);
});

test("the popover goes above a target near the bottom when below has no room", () => {
  const at = placeNear(rect(500, 700, 540, 740), BOX, VIEWPORT, ["below", "above"]);
  assert.equal(at.side, "above");
  assert.equal(at.top, 700 - 12 - 120);
});

test("the popover goes right of a tall panel, inside the viewport", () => {
  const at = placeNear(rect(0, 0, 408, 768), BOX, VIEWPORT, ["right", "above", "below"]);
  assert.equal(at.side, "right");
  assert.equal(at.left, 420);
  assert.ok(at.top >= 8 && at.top + BOX.height <= VIEWPORT.height - 8);
});

test("with no side that fits, the first side is used and clamped inside the margin", () => {
  const at = placeNear(rect(0, 0, 1024, 768), BOX, VIEWPORT, ["below", "above"]);
  assert.equal(at.side, "below");
  assert.equal(at.top, 768 - 8 - 120);
  assert.equal(at.left, 512 - 140);
});

/* Four plain targets stand in for the page's; `open` stands in for a glacier card. */
let open = false;
let calls = null;
let targets = null;
let tour = null;

beforeEach(() => {
  tour?.end();
  document.body.replaceChildren();
  open = false;
  calls = { takeMe: 0, ends: [] };
  const target = (name) => document.body.appendChild(Object.assign(document.createElement("div"), { id: name }));
  targets = {
    search: target("search"),
    panel: target("panel"),
    phonePanel: target("phone-panel"),
    useData: document.body.appendChild(Object.assign(document.createElement("button"), { id: "use-data" })),
    terrain: target("terrain"),
  };
  tour = mountTour(document.body, {
    anchor: (name) => (name === "panel" && PHONE.matches ? targets.phonePanel : targets[name]),
    panelOpen: () => open,
    onTakeMe: () => (calls.takeMe += 1),
    onEnd: (how) => calls.ends.push(how),
  });
});

const popup = () => document.querySelector(".tour");
const button = (label) => [...popup().querySelectorAll("button")].find((b) => b.textContent === label && !b.hidden);
const ringed = () => [...document.querySelectorAll(".tour-target")].map((n) => n.id);

test("the tour starts on search, with the popover focused", () => {
  tour.start();
  assert.equal(tour.running, true);
  const node = popup();
  assert.equal(node.getAttribute("role"), "dialog");
  assert.equal(node.getAttribute("aria-modal"), "false");
  assert.equal(document.getElementById(node.getAttribute("aria-labelledby")).textContent, "Search");
  assert.ok(node.textContent.includes("Find a glacier by name or RGI ID, or jump to a place."));
  assert.ok(node.textContent.includes("1 of 4"));
  assert.equal(button("Back"), undefined, "no Back on the first step");
  assert.ok(node.querySelector('button[aria-label="End tour"]'));
  assert.deepEqual(ringed(), ["search"]);
  assert.equal(document.activeElement, node);
});

test("without a glacier, step 2 asks for one and offers to take the reader to one", () => {
  tour.start();
  button("Next").click();
  assert.ok(popup().textContent.includes("2 of 4"));
  assert.ok(popup().textContent.includes("Click a glacier to see its area, elevations and hypsometry."));
  assert.equal(button("Next"), undefined);
  button("Take me to a glacier").click();
  assert.equal(calls.takeMe, 1);
  assert.equal(document.activeElement, popup());
});

test("once a glacier opens, step 2 points at the card and offers Next", () => {
  tour.start();
  button("Next").click();
  open = true;
  tour.refresh();
  assert.deepEqual(ringed(), ["panel"]);
  assert.ok(button("Next"));
  assert.equal(button("Take me to a glacier"), undefined);
});

test("closing the card on step 3 falls back to step 2's wait", () => {
  open = true;
  tour.start();
  button("Next").click();
  button("Next").click();
  assert.equal(document.getElementById(popup().getAttribute("aria-labelledby")).textContent, "Use this data");
  assert.ok(popup().textContent.includes("This map reads the cloud-native RGI catalog directly, with no download."));
  assert.deepEqual(ringed(), ["use-data"]);
  open = false;
  tour.refresh();
  assert.ok(popup().textContent.includes("2 of 4"));
  assert.ok(button("Take me to a glacier"));
  assert.ok(!targets.useData.classList.contains("tour-target"));
});

test("clicking Use this data on step 3 ends the tour", () => {
  open = true;
  tour.start();
  button("Next").click();
  button("Next").click();
  targets.useData.click();
  assert.equal(popup(), null);
  assert.deepEqual(ringed(), []);
  assert.equal(tour.running, false);
  assert.deepEqual(calls.ends, [{ byTarget: true }]);
});

test("the last step is 3D and Done ends the tour", () => {
  open = true;
  tour.start();
  for (let i = 0; i < 3; i += 1) button("Next").click();
  assert.ok(popup().textContent.includes("4 of 4"));
  assert.ok(popup().textContent.includes("See the terrain in 3D."));
  assert.deepEqual(ringed(), ["terrain"]);
  button("Done").click();
  assert.equal(popup(), null);
  assert.deepEqual(calls.ends, [{ byTarget: false }]);
});

test("Escape and the close button end the tour", () => {
  tour.start();
  document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(tour.running, false);
  tour.start();
  popup().querySelector('button[aria-label="End tour"]').click();
  assert.equal(tour.running, false);
  assert.equal(calls.ends.length, 2);
  document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(calls.ends.length, 2, "an ended tour hears no more keys");
});

test("Back returns to the step before", () => {
  tour.start();
  button("Next").click();
  button("Back").click();
  assert.ok(popup().textContent.includes("1 of 4"));
  assert.deepEqual(ringed(), ["search"]);
});

test("across the breakpoint the step points at the layout's panel", () => {
  open = true;
  tour.start();
  button("Next").click();
  assert.deepEqual(ringed(), ["panel"]);
  page.setPhone(true);
  assert.deepEqual(ringed(), ["phone-panel"]);
  page.setPhone(false);
  assert.deepEqual(ringed(), ["panel"]);
});
