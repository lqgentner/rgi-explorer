import assert from "node:assert/strict";
import test from "node:test";

import { FakeMap, loadPage, load } from "./helpers/browser.js";

const { document } = await loadPage();
const { credits, metersPerPixel, mountStatus, scaleBar } = await load("js/status.js");

const catalog = {
  citation: "RGI 7.0 Consortium (2023). Randolph Glacier Inventory.",
  license: { id: "CC-BY-4.0", href: "https://creativecommons.org/licenses/by/4.0/" },
};
const UNOFFICIAL =
  "RGI Explorer and the RGI mirror are unofficial and not endorsed by the RGI Consortium.";

test("scale bar picks a round length", () => {
  assert.deepEqual(scaleBar(metersPerPixel(46.48, 11)), { px: 76, label: "2 km" });
  assert.deepEqual(scaleBar(0.5), { px: 40, label: "20 m" });
  assert.equal(scaleBar(10).label, "500 m");
  assert.equal(scaleBar(100).label, "5 km");
});

test("meters per pixel follow the 512 px tile formula", () => {
  assert.ok(Math.abs(metersPerPixel(0, 0) - 78271.517) < 0.01);
});

test("credits name Esri only on imagery and Mapterhorn only in 3D", () => {
  const esri = "Esri, Maxar, Earthstar Geographics, and the GIS User Community";
  const plain = credits({ base: "standard", terrain: false, catalog });
  assert.deepEqual(plain, [
    "© OpenStreetMap contributors",
    "OpenFreeMap",
    catalog.citation,
    "License: CC-BY-4.0",
    UNOFFICIAL,
  ]);
  const both = credits({ base: "imagery", terrain: true, catalog });
  assert.deepEqual(both, [
    "© OpenStreetMap contributors",
    "OpenFreeMap",
    esri,
    "Mapterhorn",
    catalog.citation,
    "License: CC-BY-4.0",
    UNOFFICIAL,
  ]);
});

test("credits always end with the unofficial note", () => {
  for (const base of ["standard", "imagery"]) {
    for (const terrain of [false, true]) {
      assert.equal(credits({ base, terrain, catalog }).at(-1), UNOFFICIAL);
    }
  }
});

test("the status line draws the scale and links, and refresh updates the credits", () => {
  const root = document.createElement("div");
  const map = new FakeMap({ center: [8, 46.48], zoom: 11 });
  const onMove = [];
  const rgiMap = { map, onMove: (cb) => onMove.push(cb) };
  let state = { base: "standard", terrain: false };
  const status = mountStatus(root, rgiMap, catalog, () => state);

  assert.equal(root.querySelector(".scale-label").textContent, "2 km");
  assert.equal(root.querySelector(".scale-bar").style.width, "76px");
  assert.ok(!root.textContent.includes("Esri"));
  const osm = [...root.querySelectorAll("a")].find((a) => a.textContent.startsWith("© OpenStreetMap"));
  assert.equal(osm.href, "https://www.openstreetmap.org/copyright");
  const license = [...root.querySelectorAll("a")].find((a) => a.textContent === "License: CC-BY-4.0");
  assert.equal(license.href, catalog.license.href);
  assert.equal(license.getAttribute("rel"), "noopener");
  assert.equal(license.target, "_blank");

  state = { base: "imagery", terrain: true };
  status.refresh();
  assert.ok(root.textContent.includes("Esri, Maxar"));
  assert.ok(root.textContent.includes("Mapterhorn"));

  onMove[0]({ zoom: 6, lat: 46.48, lon: 8 });
  map.zoom = 6;
  onMove[0]({ zoom: 6, lat: 46.48, lon: 8 });
  assert.equal(root.querySelector(".scale-label").textContent, "50 km");
});

test("credits render as text, never markup", () => {
  const root = document.createElement("div");
  const rgiMap = { map: new FakeMap({ zoom: 3 }), onMove() {} };
  mountStatus(root, rgiMap, { ...catalog, citation: "<img src=x>" }, () => ({ base: "standard", terrain: false }));
  assert.equal(root.querySelector("img"), null);
  assert.ok(root.textContent.includes("<img src=x>"));
});
