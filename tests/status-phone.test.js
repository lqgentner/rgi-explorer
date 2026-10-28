import assert from "node:assert/strict";
import test from "node:test";

import { FakeMap, loadPage, load } from "./helpers/browser.js";

const { document } = await loadPage({ phone: true });
const { mountStatus } = await load("js/status.js");
const { mountZoom } = await load("js/layers.js");

const catalog = {
  citation: "RGI citation",
  license: { id: "CC-BY-4.0", href: "https://example.org/license" },
};

test("the phone has no scale bar, and an info button opens the credits", () => {
  const root = document.createElement("div");
  const rgiMap = { map: new FakeMap({ zoom: 5 }), onMove() {} };
  mountStatus(root, rgiMap, catalog, () => ({ base: "standard", terrain: false }));
  assert.equal(root.querySelector(".scale-bar"), null);
  const button = root.querySelector("button");
  assert.ok(button.querySelector("use").getAttribute("href").endsWith("#info"));
  const panel = root.querySelector(".credits-panel");
  assert.equal(panel.hidden, true);
  button.click();
  assert.equal(panel.hidden, false);
  assert.equal(button.getAttribute("aria-expanded"), "true");
  assert.ok(panel.textContent.includes("RGI citation"));
  button.click();
  assert.equal(panel.hidden, true);
});

test("the phone draws no zoom buttons", () => {
  const root = document.createElement("div");
  mountZoom(root, { map: new FakeMap() });
  assert.equal(root.children.length, 0);
});
