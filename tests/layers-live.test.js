/* The base map pictures follow the view once the map rests; the toggle previews stay fixed. */

import assert from "node:assert/strict";
import test, { mock } from "node:test";

import { FakeMap, loadPage, load } from "./helpers/browser.js";

const { window, document } = await loadPage();
const { mountLayers } = await load("js/layers.js");

mock.timers.enable({ apis: ["setTimeout"] });

const BACKGROUNDS = { standard: "#f8f4f0", imagery: "#3c4043" };

function setup(base = "standard", standardPicture = async () => "data:image/jpeg;standard") {
  const root = document.createElement("div");
  const map = new FakeMap({ center: [0, 0], zoom: 11 });
  const api = mountLayers(root, {
    base, layers: new Set(), onBase() {}, onToggle() {}, map, standardPicture, backgrounds: BACKGROUNDS,
  });
  const rest = () => {
    map.fire("idle");
    mock.timers.tick(500);
  };
  return { root, map, rest, api, image: root.querySelector(".layers-thumb img") };
}

test("the toggle previews stay fixed when the map rests", () => {
  const { root, rest } = setup();
  const before = root.querySelector('.layer-toggle[data-name="intersects"] svg').outerHTML;
  root.firstElementChild.dispatchEvent(new window.Event("pointerenter"));
  rest();
  assert.equal(root.querySelector('.layer-toggle[data-name="intersects"] svg').outerHTML, before);
});

test("a move before the delay ends waits for the next rest", () => {
  const { map, image } = setup();
  map.fire("idle");
  mock.timers.tick(300);
  map.fire("movestart");
  mock.timers.tick(500);
  assert.doesNotMatch(image.dataset.want, /arcgisonline/);
});

const flush = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

test("the imagery thumbnail asks Esri for the view", async () => {
  const { image, rest } = setup();
  rest();
  await flush();
  assert.match(image.dataset.want, /^https:\/\/server\.arcgisonline\.com\/.*\/export\?bbox=/);
  assert.match(decodeURIComponent(image.getAttribute("src")), /^data:image\/svg\+xml,.*fill="#3c4043"/, "the plain background stays until the picture loads");
});

test("the standard thumbnail shows the hidden map's picture of the view", async () => {
  const sizes = [];
  const { image, rest } = setup("imagery", async (px) => {
    sizes.push(px);
    return "data:image/jpeg;standard";
  });
  rest();
  await flush();
  assert.deepEqual(sizes, [192]);
  assert.equal(image.dataset.want, "data:image/jpeg;standard");
});

test("a picture that arrives after the base map changed is dropped", async () => {
  let finish;
  const { image, rest, api } = setup("imagery", () => new Promise((resolve) => (finish = resolve)));
  rest();
  api.setBase("standard");
  finish("data:image/jpeg;late");
  await flush();
  assert.notEqual(image.dataset.want, "data:image/jpeg;late");
});
