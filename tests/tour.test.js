/* The guided tour: where its popover goes, its four steps, the wait for a glacier and the ways it ends. */

import assert from "node:assert/strict";
import fs from "node:fs";
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


/* Plain targets stand in for the page's; `panelKind` and `terrain` stand in for the app's state. */
let panelKind = null;
let terrain = false;
let calls = null;
let targets = null;
let tour = null;

beforeEach(() => {
  tour?.end();
  if (PHONE.matches) page.setPhone(false);
  document.body.replaceChildren();
  panelKind = null;
  terrain = false;
  calls = { takeMe: 0, ends: [], steps: [] };
  const target = (name) => document.body.appendChild(Object.assign(document.createElement("div"), { id: name }));
  targets = {
    search: target("search"),
    searchBar: document.body.appendChild(Object.assign(document.createElement("input"), { id: "search-bar" })),
    panel: target("panel"),
    phonePanel: target("phone-panel"),
    useData: document.body.appendChild(Object.assign(document.createElement("button"), { id: "use-data" })),
    terrain: target("terrain"),
    done: target("done"),
    useDataClose: document.body.appendChild(Object.assign(document.createElement("button"), { id: "usedata-close" })),
    viewerClose: document.body.appendChild(Object.assign(document.createElement("button"), { id: "viewer-close" })),
  };
  tour = mountTour(document.body, {
    anchor: (name) => (name === "panel" && PHONE.matches ? targets.phonePanel : targets[name]),
    panel: () => panelKind,
    terrainOn: () => terrain,
    onTakeMe: () => {
      calls.takeMe += 1;
      return calls.takeMeResult;
    },
    onEnd: (how) => calls.ends.push(how),
    onStep: (step) => calls.steps.push(step),
  });
});

const popup = () => document.querySelector(".tour");
const title = () => document.getElementById(popup().getAttribute("aria-labelledby")).textContent;
const text = () => popup().querySelector("p").textContent;
const button = (label) => [...popup().querySelectorAll("button")].find((b) => b.textContent === label && !b.hidden);
const ringed = () => [...document.querySelectorAll(".tour-target")].map((n) => n.id);
const toCard = () => {
  tour.start();
  panelKind = panelKind ?? "glacier";
  tour.refresh();
};
/* Step 1 has no Skip, so the way to 3D is through a glacier and past the card steps. */
const toTerrain = () => {
  toCard();
  button("Skip").click();
  button("Skip").click();
};

test("step 1 asks for a glacier and offers to take the reader to one", () => {
  tour.start();
  assert.equal(tour.running, true);
  const node = popup();
  assert.equal(node.getAttribute("role"), "dialog");
  assert.equal(node.getAttribute("aria-modal"), "false");
  assert.equal(title(), "Find a glacier");
  assert.equal(text(), "To start, click a glacier on the map or search for one.");
  assert.ok(node.textContent.includes("1 of 4"));
  assert.ok(button("Take me to a glacier"));
  assert.ok(!button("Take me to a glacier").classList.contains("primary"), "an outline button");
  assert.equal(button("Skip"), undefined, "no Skip: it would skip the card steps too");
  assert.equal(button("Next"), undefined);
  assert.equal(button("Back"), undefined);
  assert.ok(node.querySelector('button[aria-label="End tour"]'));
  assert.deepEqual(ringed(), ["search-bar"], "only the search bar is ringed, not its results");
  assert.equal(document.activeElement, node);
});

test("a glacier opening moves step 1 on by itself", () => {
  toCard();
  assert.equal(title(), "The glacier card");
  assert.ok(popup().textContent.includes("2 of 4"));
  assert.deepEqual(ringed(), ["panel"]);
  assert.ok(button("Skip"));
  assert.ok(!button("Skip").classList.contains("primary"));
});

test("the card step's ? is the info icon, not a character", () => {
  toCard();
  const p = popup().querySelector("p");
  assert.ok(p.querySelector('svg.inline-icon use[href$="#circle-question-mark"]'));
  assert.equal(text(), "Its area, elevations and hypsometry. Tap a  to see what a value means.");
  assert.ok(!text().includes("?"));
});

test("an interaction turns Skip into a filled Next, which leads to Use this data", () => {
  toCard();
  tour.interacted();
  assert.equal(button("Skip"), undefined);
  assert.ok(button("Next").classList.contains("primary"));
  assert.deepEqual(ringed(), [], "the card is done: its ring goes, and Next is the way on");
  button("Next").click();
  assert.equal(title(), "Use this data");
  assert.equal(text(), "This map reads the cloud-native RGI catalog directly, with no download. Open Use this data to read it in Python or QGIS.");
  assert.ok(popup().textContent.includes("3 of 4"));
  assert.deepEqual(ringed(), ["use-data"]);
  assert.ok(button("Skip"));
});

test("an interaction off step 2 changes nothing", () => {
  tour.start();
  tour.interacted();
  panelKind = "glacier";
  tour.refresh();
  assert.ok(button("Skip"));
  assert.equal(button("Next"), undefined);
});

test("a complex panel gets its own title and text", () => {
  panelKind = "complex";
  toCard();
  assert.equal(title(), "The complex panel");
  assert.ok(text().startsWith("Its area and its glaciers."));
});

test("on the phone step 2 asks to swipe up, and follows the breakpoint", () => {
  toCard();
  page.setPhone(true);
  assert.ok(text().startsWith("Swipe up to see its area, elevations and hypsometry."));
  assert.deepEqual(ringed(), ["phone-panel"]);
  page.setPhone(false);
  assert.ok(text().startsWith("Its area, elevations and hypsometry."));
  assert.deepEqual(ringed(), ["panel"]);
});

test("closing the panel on step 3 goes back to step 1", () => {
  toCard();
  button("Skip").click();
  assert.equal(title(), "Use this data");
  panelKind = null;
  tour.refresh();
  assert.equal(title(), "Find a glacier");
});

test("opening Use this data on step 3 covers the tour, and closing it moves on to 3D", () => {
  toCard();
  button("Skip").click();
  tour.cover("useData", true);
  const node = popup();
  assert.ok(node.classList.contains("covering"));
  assert.equal(node.textContent.includes("Close to continue the tour"), true);
  assert.equal(node.querySelectorAll("button").length, 0, "no X of its own: the reader closes Use this data, not the message");
  assert.deepEqual(ringed(), ["usedata-close"], "the ring points at the close button to press");
  tour.cover("useData", false);
  assert.ok(!popup().classList.contains("covering"));
  assert.equal(title(), "3D");
  assert.equal(text(), "Switch to 3D to see the terrain.");
  assert.ok(popup().textContent.includes("4 of 4"));
  assert.deepEqual(ringed(), ["terrain"]);
});

test("Use this data closed together with the card goes back to step 1", () => {
  toCard();
  button("Skip").click();
  tour.cover("useData", true);
  panelKind = null;
  tour.cover("useData", false);
  assert.equal(title(), "Find a glacier");
});

test("the viewer covers a step and returns to it, keeping step 2's interaction", () => {
  toCard();
  tour.interacted();
  tour.cover("viewer", true);
  assert.ok(popup().classList.contains("covering"));
  assert.deepEqual(ringed(), ["viewer-close"]);
  tour.cover("viewer", false);
  assert.equal(title(), "The glacier card");
  assert.ok(button("Next"));
});

test("3D turning on finishes step 4 with the last card", () => {
  toTerrain();
  assert.equal(title(), "3D");
  terrain = true;
  tour.refresh();
  assert.equal(title(), "You're all set.");
  assert.equal(text(), "Have fun exploring the glaciers on your own.");
  assert.ok(!/of 4/.test(popup().textContent), "the last card has no counter");
  assert.ok(button("Done").classList.contains("primary"));
  assert.deepEqual(ringed(), []);
  button("Done").click();
  assert.equal(popup(), null);
  assert.deepEqual(calls.ends, [{ byTarget: false }]);
});

test("on the desktop the last card takes the 3D step's place, left of the 3D button", () => {
  window.innerWidth = 1280;
  window.innerHeight = 800;
  const button3d = rect(1228, 640, 1268, 680);
  targets.terrain.getBoundingClientRect = () => button3d;
  targets.done.getBoundingClientRect = () => button3d;
  toTerrain();
  assert.equal(title(), "3D");
  const step4 = { side: popup().dataset.side, top: popup().style.top, left: popup().style.left };
  assert.equal(step4.side, "left");
  terrain = true;
  tour.refresh();
  assert.equal(title(), "You're all set.");
  assert.deepEqual({ side: popup().dataset.side, top: popup().style.top, left: popup().style.left }, step4);
});

test("with 3D already on, Skip on step 3 goes straight to the last card", () => {
  terrain = true;
  toTerrain();
  assert.equal(title(), "You're all set.");
});

test("Escape ends the tour from the tour, and the close button does too", () => {
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

test("an Escape that something else handled, or one typed outside the tour, leaves the tour running", () => {
  tour.start();
  const input = document.body.appendChild(document.createElement("input"));
  input.focus();
  input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(tour.running, true, "Escape in the search clears the search, not the tour");
  popup().focus();
  const handled = new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  handled.preventDefault();
  popup().dispatchEvent(handled);
  assert.equal(tour.running, true, "an Escape another control handled stays with it");
  popup().dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(tour.running, false);
});

test("the popover follows its target when the target grows, as the search does with its results", () => {
  const observed = [];
  window.ResizeObserver = class {
    constructor(callback) {
      this.callback = callback;
      observed.push(this);
    }
    observe(node) {
      this.node = node;
    }
    disconnect() {
      this.node = null;
    }
  };
  try {
    tour.start();
    const watcher = observed.find((o) => o.node === targets.search);
    assert.ok(watcher, "the ringed target is watched");
    targets.search.getBoundingClientRect = () => rect(16, 16, 392, 300);
    watcher.callback([]);
    assert.equal(popup().style.top, `${300 + 12}px`);
    tour.end();
    assert.equal(watcher.node, null, "an ended tour stops watching");
  } finally {
    delete window.ResizeObserver;
  }
});

test("Take me to a glacier shows it is busy, and goes away when there is no glacier to take the reader to", async () => {
  let settle;
  calls.takeMeResult = new Promise((resolve) => (settle = resolve));
  tour.start();
  button("Take me to a glacier").click();
  assert.equal(calls.takeMe, 1);
  const busy = button("Opening…");
  assert.ok(busy, "the button says it is working");
  assert.equal(busy.disabled, true);
  settle(false);
  await calls.takeMeResult;
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(button("Take me to a glacier"), undefined);
  assert.equal(button("Opening…"), undefined);
  assert.equal(popup().querySelectorAll(".tour-actions button").length, 0, "only the X is left; a glacier the reader opens still moves on");
  assert.equal(title(), "Find a glacier");
  toCard();
  assert.equal(title(), "The glacier card");
});

test("the tour and the welcome hide under the phone's full-screen search and layers pane", () => {
  const css = fs.readFileSync(new URL("../style.css", import.meta.url), "utf8");
  assert.match(css, /body:has\(#search\.fullscreen\) \.tour,\s*body:has\(\.layers-pane:not\(\[hidden\]\)\) \.tour,\s*body:has\(#search\.fullscreen\) \.welcome \{\s*visibility: hidden;/);
});

test("the app hears each step the tour enters, once, so it can reveal the step's control", () => {
  tour.start();
  panelKind = "glacier";
  tour.refresh();
  tour.refresh();
  button("Skip").click();
  button("Skip").click();
  assert.deepEqual(calls.steps, ["find", "card", "data", "terrain"]);
});

test("on the phone search, 3D and the last card sit at the top; the card steps dock to the sheet's edge", () => {
  tour.start();
  page.setPhone(true);
  assert.equal(popup().style.top, "");
  assert.equal(popup().style.left, "");
  assert.equal(popup().dataset.dock, undefined, "search: at the top, under the search bar");
  panelKind = "glacier";
  tour.refresh();
  assert.equal(popup().dataset.dock, "sheet", "the card step rides on the sheet");
  assert.equal(popup().style.top, "");
  targets.phonePanel.getBoundingClientRect = () => rect(0, 300, 390, 844);
  targets.useData.getBoundingClientRect = () => rect(16, 390, 150, 426);
  button("Skip").click();
  assert.equal(popup().dataset.dock, "button", "Use this data rides with its button");
  assert.equal(popup().style.getPropertyValue("--tour-below"), `${426 - 300 + 8}px`, "the button's bottom, from the sheet's top, plus the gap");
  tour.cover("useData", true);
  assert.equal(popup().dataset.dock, undefined, "the cover message has its own place");
  tour.cover("useData", false);
  assert.equal(popup().dataset.dock, undefined, "3D: at the top again");
  page.setPhone(false);
  assert.equal(popup().dataset.dock, undefined, "the desktop places by script");
  const css = fs.readFileSync(new URL("../style.css", import.meta.url), "utf8");
  assert.match(css, /@media \(max-width: 640px\) \{\s*\.tour \{\s*top: calc\(12px \+ var\(--search-h\) \+ 12px\);\s*left: 12px;\s*right: 64px;\s*width: auto;/);
  assert.match(css, /\.tour\[data-dock="button"\] \{[^}]*translate: 0 max\(calc\(12px \+ var\(--search-h\) \+ 12px\), calc\(100dvh - var\(--sheet-visible, 160px\) - 12px - 100%\)\);/,
    "it rides 12 px above the sheet's edge, as the credits do, from the same variable the sheet moves by");
  assert.match(css, /body:has\(#sheet\.dragging\) \.tour\[data-dock\] \{\s*transition: none;/, "a drag moves it frame by frame, as it moves the sheet");
  assert.match(css, /\.tour\[data-dock="sheet"\],\s*\.tour\[data-dock="button"\] \{/, "at compact the button step rides above the sheet's edge like the card step");
  assert.match(css, /#sheet:not\(\[data-level="compact"\]\) ~ \.tour\[data-dock="button"\] \{\s*translate: 0 calc\(100dvh - var\(--sheet-visible, 160px\) \+ var\(--tour-below, 140px\)\);/,
    "with the sheet raised it sits under the button, so the button stays in view");
});

test("on the phone the welcome sits at the top under the search, clear of the round buttons", () => {
  const css = fs.readFileSync(new URL("../style.css", import.meta.url), "utf8");
  assert.match(css, /@media \(max-width: 640px\) \{\s*\.welcome \{\s*top: calc\(12px \+ var\(--search-h\) \+ 12px\);\s*bottom: auto;\s*left: 12px;\s*right: 64px;\s*width: auto;/);
});

test("the text runs to the card's padding; only the heading keeps clear of the X", () => {
  const css = fs.readFileSync(new URL("../style.css", import.meta.url), "utf8");
  for (const selector of ["welcome", "tour"]) {
    const rule = new RegExp(`\\n\\.${selector} \\{[^}]*\\}`).exec(css)?.[0] ?? "";
    assert.match(rule, /padding: 12px;/, `.${selector} padding`);
    assert.match(css, new RegExp(`\\.${selector} h2 \\{[^}]*padding: \\d+px 36px 0 8px;`), `.${selector} h2 clears the X, inset 8 px more than the buttons`);
    assert.match(css, new RegExp(`\\.${selector} p \\{[^}]*padding: 0 8px;`), `.${selector} text inset 8 px more than the buttons`);
  }
  assert.match(css, /\.welcome \.btn \{[^}]*margin: 8px 0 0 auto;/, "Take the tour sits on the right");
});

test("the last card follows its anchor as it grows, as the search does with its results", () => {
  const observed = [];
  window.ResizeObserver = class {
    constructor(callback) {
      this.callback = callback;
      observed.push(this);
    }
    observe(node) {
      this.node = node;
    }
    disconnect() {
      this.node = null;
    }
  };
  try {
    terrain = true;
    toTerrain();
    assert.equal(title(), "You're all set.");
    const watcher = observed.find((o) => o.node === targets.done);
    assert.ok(watcher, "the last card watches its anchor");
    targets.done.getBoundingClientRect = () => rect(16, 16, 392, 400);
    watcher.callback([]);
    assert.equal(popup().style.top, `${400 + 12}px`);
    assert.deepEqual(ringed(), [], "watched, not ringed");
  } finally {
    delete window.ResizeObserver;
  }
});

test("the ring on a focused search input survives the search's own focus style", () => {
  const css = fs.readFileSync(new URL("../style.css", import.meta.url), "utf8");
  assert.match(css, /#search input\.tour-target,\s*#search input\.tour-target:focus \{\s*outline: 3px solid var\(--accent\);/);
});

test("on the desktop the card's ring is a frame above the photo and the sticky tabs, fixed while the card scrolls", () => {
  const css = fs.readFileSync(new URL("../style.css", import.meta.url), "utf8");
  const desktop = /\n@media \(min-width: 641px\) \{\n  #card\.tour-target \{\s*outline: none;\s*\}\n\n  #card\.tour-target::after \{([^}]*)\}/.exec(css);
  assert.ok(desktop, "the outline, which the card's positioned children paint over, gives way to a pseudo-element");
  const frame = desktop[1];
  assert.match(frame, /content: "";/);
  assert.match(frame, /position: fixed;/, "fixed: the open card has no translate, so it holds still as the card scrolls");
  assert.match(frame, /inset: 0 auto 0 0;/);
  assert.match(frame, /width: var\(--sidebar-w\);/);
  assert.match(frame, /z-index: 10;/, "above the photo and the sticky tabs");
  assert.match(frame, /border: 3px solid var\(--accent\);/);
  assert.match(frame, /pointer-events: none;/);
});
