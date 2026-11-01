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

/*
 * A pinhole camera as MapLibre's globe has: a point behind the camera
 * projects mirrored, through the far side of the screen. `nudge` moves the
 * camera forward by that many pixels, as MapLibre's camera differs a little
 * from the one globeDisc models.
 */
function pinhole(map, width, height, nudge = 0) {
  const fov = 0.6435011087932844;
  const { lng, lat } = map.getCenter();
  const radius = (512 * 2 ** map.getZoom()) / (2 * Math.PI) / Math.cos(rad(lat));
  const focal = (0.5 * height) / Math.tan(fov / 2);
  const unit = (lo, la) => [Math.cos(rad(la)) * Math.cos(rad(lo)), Math.cos(rad(la)) * Math.sin(rad(lo)), Math.sin(rad(la))];
  const dot = (a, b) => a.reduce((sum, v, i) => sum + v * b[i], 0);
  const up = unit(lng, lat);
  const north = [-Math.sin(rad(lat)) * Math.cos(rad(lng)), -Math.sin(rad(lat)) * Math.sin(rad(lng)), Math.cos(rad(lat))];
  const right = [-Math.sin(rad(lng)), Math.cos(rad(lng)), 0];
  const pitch = rad(map.getPitch());
  const orbit = up.map((u, i) => u * (radius + focal * Math.cos(pitch)) - north[i] * focal * Math.sin(pitch));
  const ahead = up.map((u, i) => u * radius - orbit[i]);
  const forward = ahead.map((v) => v / Math.hypot(...ahead));
  const camera = orbit.map((c, i) => c + forward[i] * nudge);
  const down = [0, 1, 2].map((i) => forward[(i + 1) % 3] * right[(i + 2) % 3] - forward[(i + 2) % 3] * right[(i + 1) % 3]);
  map.project = ([lo, la]) => {
    const v = unit(lo, la).map((c, i) => c * radius - camera[i]);
    const z = dot(v, forward);
    return { x: width / 2 + (focal * dot(v, right)) / z, y: height / 2 + (focal * dot(v, down)) / z };
  };
}

test("the globe's outline stays on screen when the horizon runs out behind the camera", () => {
  const map = new FakeMap({ center: [13.198, 48.1405], zoom: 5.57 });
  map.pitch = 60;
  pinhole(map, 1100, 800);
  const disc = globeDisc(map, 1100, 800);
  /* The limb crosses the middle column at y ≈ 130 and the sides at y ≈ 191. */
  const at = (x) => disc.y - disc.ry * Math.sqrt(1 - ((x - disc.x) / disc.rx) ** 2);
  assert.ok(Math.abs(at(550) - 130) < 3, `top ${at(550)}: ${JSON.stringify(disc)}`);
  assert.ok(Math.abs(at(0) - 191) < 3, `side ${at(0)}: ${JSON.stringify(disc)}`);
});

test("a horizon sample on the camera's plane does not throw the outline off", () => {
  const map = new FakeMap({ center: [7.3675, 50.4105], zoom: 4.56 });
  map.pitch = 60;
  /* A sample lies 0.2 px in front of the modelled camera, so behind this one. */
  pinhole(map, 1100, 800, 1);
  const disc = globeDisc(map, 1100, 800);
  /* The limb crosses the middle column at y ≈ 203 and the sides at y ≈ 296. */
  const at = (x) => disc.y - disc.ry * Math.sqrt(1 - ((x - disc.x) / disc.rx) ** 2);
  assert.ok(Math.abs(at(550) - 203) < 3, `top ${at(550)}: ${JSON.stringify(disc)}`);
  assert.ok(Math.abs(at(0) - 296) < 3, `side ${at(0)}: ${JSON.stringify(disc)}`);
});
