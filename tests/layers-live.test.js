/* The layer previews follow the view once the map rests. */

import assert from "node:assert/strict";
import test, { mock } from "node:test";

import { FakeMap, loadPage, load } from "./helpers/browser.js";

const { window, document } = await loadPage();
const { mountLayers } = await load("js/layers.js");

/* A map with the RGI source, which the previews query. */
const fakeMap = (center, zoom) => new FakeMap({ center, zoom, style: { sources: { data: { type: "vector" } }, layers: [] } });

mock.timers.enable({ apis: ["setTimeout"] });

function setup(base = "standard", standardPicture = async () => "data:image/jpeg;standard") {
  const root = document.createElement("div");
  const map = fakeMap([0, 0], 11);
  map.sourceFeatures = [
    {
      sourceLayer: "intersects",
      geometry: { type: "LineString", coordinates: [[-0.01, 0], [0.01, 0]] },
      properties: {},
      tile: { z: 11, x: 1023, y: 1023 },
    },
  ];
  const api = mountLayers(root, { base, layers: new Set(), onBase() {}, onToggle() {}, zoom: () => map.getZoom(), map, standardPicture });
  const tile = (name) => root.querySelector(`.layer-toggle[data-name="${name}"] svg`);
  const rest = () => {
    map.fire("idle");
    mock.timers.tick(500);
  };
  return { root, map, tile, rest, api, image: root.querySelector(".layers-thumb img") };
}

test("the toggle previews draw the view once the map rests and the panel shows", () => {
  const { root, map, tile, rest } = setup();
  rest();
  assert.ok(!tile("intersects").classList.contains("live"), "a hidden panel waits");
  root.firstElementChild.dispatchEvent(new window.Event("pointerenter"));
  assert.ok(tile("intersects").classList.contains("live"));
  assert.equal(tile("intersects").querySelectorAll("clipPath").length, 1);
  const divide = tile("intersects").querySelector("path[clip-path]");
  assert.equal(divide.getAttribute("clip-path"), "url(#preview-intersects-0)");
  assert.ok(!tile("centerlines").classList.contains("live"), "a toggle without data in view keeps its fixed preview");

  map.sourceFeatures = [];
  rest();
  assert.ok(!tile("intersects").classList.contains("live"));
});

test("a move before the delay ends waits for the next rest", () => {
  const { root, map, tile } = setup();
  root.firstElementChild.dispatchEvent(new window.Event("pointerenter"));
  map.fire("idle");
  mock.timers.tick(300);
  map.fire("movestart");
  mock.timers.tick(500);
  assert.ok(!tile("intersects").classList.contains("live"));
});

const flush = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

test("the imagery thumbnail asks Esri for the view", async () => {
  const { image, rest } = setup();
  rest();
  await flush();
  assert.match(image.dataset.want, /^https:\/\/server\.arcgisonline\.com\/.*\/export\?bbox=/);
  assert.ok(image.getAttribute("src").endsWith("assets/base-imagery.webp"), "the old picture stays until the new one loads");
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
