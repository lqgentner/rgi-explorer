/* The hypsometry chart. */

import assert from "node:assert/strict";
import test from "node:test";

import { loadPage, load } from "./helpers/browser.js";

const { document } = await loadPage();
const { bands, renderHypsometry } = await load("js/hypsometry.js");

const PERMILLE = [1, 1, 2, 3, 5, 4, 5, 5, 5, 13, 11, 14, 9, 15, 16, 17, 20, 18, 9, 12, 10, 23, 35, 35, 22, 29, 31,
  30, 28, 32, 38, 40, 46, 45, 42, 46, 50, 48, 44, 41, 36, 23, 15, 11, 7, 4, 2, 1, 0, 1];
const ALETSCH = { hypso_z0_m: 1625, hypso_permille: PERMILLE, zmin_m: 1578.3491, zmax_m: 4091.6558, zmed_m: 3152.1602, zmean_m: 3053.717 };

const draw = (props = ALETSCH) => {
  const el = document.createElement("div");
  renderHypsometry(el, props);
  return el;
};

test("bands start at hypso_z0_m in 50 m steps", () => {
  const b = bands(1625, PERMILLE);
  assert.equal(b.length, 50);
  assert.equal(b[0].center, 1625);
  assert.equal(b[49].center, 4075);
  assert.equal(b[49].permille, 1);
});

test("one bar per band, zero bands included, in the accent color", () => {
  const rects = [...draw().querySelectorAll("rect")];
  assert.equal(rects.length, 50);
  assert.ok(rects.every((r) => r.style.fill === "var(--accent)"));
  assert.equal(Number(rects[48].getAttribute("width")), 0);
  const ys = rects.map((r) => Number(r.getAttribute("y")));
  assert.ok(ys.every((y, i) => i === 0 || y < ys[i - 1]), "higher bands sit higher");
});

test("the widest bar fills the plot and the median line is dashed and red", () => {
  const el = draw();
  const widths = [...el.querySelectorAll("rect")].map((r) => Number(r.getAttribute("width")));
  assert.equal(Math.max(...widths), 244);
  const median = el.querySelector("line.median");
  assert.equal(median.getAttribute("stroke"), "#d93025");
  assert.ok(median.getAttribute("stroke-dasharray"));
  assert.ok(el.querySelector("line.mean").getAttribute("stroke-dasharray"));
});

test("the median sits above the mean and both are labelled", () => {
  const el = draw();
  const y = (sel) => Number(el.querySelector(sel).getAttribute("y1"));
  assert.ok(y("line.median") < y("line.mean"));
  const labels = [...el.querySelectorAll("text")].map((t) => t.textContent);
  assert.ok(labels.includes("Median") && labels.includes("Mean"));
});

test("close median and mean labels do not overlap", () => {
  const el = draw({ ...ALETSCH, zmean_m: ALETSCH.zmed_m - 5 });
  const at = (name) => Number([...el.querySelectorAll("text")].find((t) => t.textContent === name).getAttribute("y"));
  assert.ok(Math.abs(at("Median") - at("Mean")) >= 10);
});

test("the minimum and maximum show below", () => {
  assert.equal(draw().querySelector(".hypso-range").textContent, "Min 1,578 m · Max 4,092 m");
});

test("the chart has an accessible summary and elevation ticks", () => {
  const svg = draw().querySelector("svg");
  assert.equal(svg.getAttribute("viewBox").split(" ").length, 4);
  assert.equal(svg.getAttribute("width"), "100%");
  assert.match(svg.getAttribute("aria-label"), /median 3,152 m/);
  assert.equal(svg.querySelector("title").textContent, svg.getAttribute("aria-label"));
  assert.ok(svg.querySelectorAll(".axis text").length >= 3);
});

test("a glacier without a mean or median still draws", () => {
  const el = draw({ ...ALETSCH, zmean_m: null, zmed_m: undefined });
  assert.equal(el.querySelectorAll("rect").length, 50);
  assert.equal(el.querySelector("line.median"), null);
});
