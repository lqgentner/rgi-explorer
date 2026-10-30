/* The halo's measure of the globe. */

import assert from "node:assert/strict";
import test from "node:test";

import { FakeMap, loadPage, load } from "./helpers/browser.js";

await loadPage();
const { globeDisc } = await load("js/sky.js");

const rad = (deg) => (deg * Math.PI) / 180;

test("the globe's outline at a pole is as large as at the Mercator edge", () => {
  const disc = (lat) => {
    const map = new FakeMap({ center: [0, lat], zoom: 1 });
    /* A stand-in projection: orthographic about the centre, enough to compare sizes. */
    const unit = (lng, la) => [Math.cos(rad(la)) * Math.cos(rad(lng)), Math.cos(rad(la)) * Math.sin(rad(lng)), Math.sin(rad(la))];
    const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
    const east = [0, 1, 0];
    const north = [-Math.sin(rad(lat)), 0, Math.cos(rad(lat))];
    map.project = ([lng, la]) => ({ x: dot(unit(lng, la), east), y: -dot(unit(lng, la), north) });
    return globeDisc(map, 800, 600);
  };
  const edge = disc(85.05);
  for (const lat of [89.9, 90]) {
    const pole = disc(lat);
    assert.ok(Object.values(pole).every(Number.isFinite), `latitude ${lat}: ${JSON.stringify(pole)}`);
    assert.ok(Math.abs(pole.ry - edge.ry) / edge.ry < 0.2, `latitude ${lat}: ry ${pole.ry} against ${edge.ry}`);
  }
});
