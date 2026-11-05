/* The hypsometry chart. */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

test("one bar per band, zero bands included, in the bars' one lighter blue", () => {
  const rects = [...draw().querySelectorAll("rect")];
  assert.equal(rects.length, 50);
  assert.ok(rects.every((r) => r.getAttribute("class") === "bar" && !r.hasAttribute("style")));
  const css = readFileSync(new URL("../style.css", import.meta.url), "utf8");
  assert.match(css, /\.hypsometry \.bar\s*\{\s*fill:\s*var\(--bar\);/);
  assert.match(css, /--bar:\s*#4a9ac2;/, "lighter than the buttons' --accent");
  assert.equal(Number(rects[48].getAttribute("width")), 0);
  const ys = rects.map((r) => Number(r.getAttribute("y")));
  assert.ok(ys.every((y, i) => i === 0 || y < ys[i - 1]), "higher bands sit higher");
});

test("the widest bar fills the plot and the median line is dashed and red", () => {
  const el = draw();
  const widths = [...el.querySelectorAll("rect")].map((r) => Number(r.getAttribute("width")));
  const plot = el.querySelector(".x-axis line");
  assert.equal(Math.max(...widths), Number(plot.getAttribute("x2")) - Number(plot.getAttribute("x1")));
  const median = el.querySelector("line.median");
  assert.equal(median.getAttribute("stroke"), "#cc3311");
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

test("an elevation that rounds to zero shows no minus sign", () => {
  /* G-01-15261: zmin_m -0.355. G-01-07871: z0 -25, so the lowest tick is Math.ceil(-0.1) * 500 = -0. */
  const el = draw({ ...ALETSCH, hypso_z0_m: -25, zmin_m: -0.3547835, zmean_m: -0.059 });
  assert.match(el.querySelector(".hypso-range").textContent, /^Min 0 m · /);
  assert.match(el.querySelector("svg").getAttribute("aria-label"), /mean 0 m/);
  const ticks = [...el.querySelectorAll(".axis text.tick")].map((t) => t.textContent);
  assert.ok(ticks.includes("0") && !ticks.some((t) => t === "-0"), String(ticks));
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

test("one band and 105 bands draw with finite geometry", () => {
  for (const n of [1, 105]) {
    const el = draw({ hypso_z0_m: 500, hypso_permille: Array.from({ length: n }, (_, i) => (i % 7) + 1), zmed_m: 500, zmean_m: 500 });
    const rects = [...el.querySelectorAll("rect")];
    assert.equal(rects.length, n);
    for (const node of el.querySelectorAll("rect, line, text")) {
      for (const a of ["x", "y", "width", "height", "x1", "x2", "y1", "y2"]) {
        if (node.hasAttribute(a)) assert.ok(Number.isFinite(Number(node.getAttribute(a))), `${a} on ${node.tagName}`);
      }
    }
  }
});

test("median and mean outside the bands are clamped to the plot", () => {
  const el = draw({ ...ALETSCH, zmed_m: 99999, zmean_m: -500 });
  const top = Number(el.querySelector("rect:last-child, .bars rect:last-child").getAttribute("y"));
  assert.ok(Number(el.querySelector("line.median").getAttribute("y1")) >= top - 0.01);
  const bottom = Number(el.querySelector(".y-axis line").getAttribute("y2"));
  assert.ok(Number(el.querySelector("line.mean").getAttribute("y1")) <= bottom + 0.01);
});

test("the axes are labelled: elevation on the left, area in percent below", () => {
  const svg = draw().querySelector("svg");
  const texts = [...svg.querySelectorAll("text")];
  const elevation = texts.find((t) => t.textContent === "Elevation (m)");
  assert.match(elevation.getAttribute("transform"), /rotate\(-90/);
  const [, , vbWidth, vbHeight] = svg.getAttribute("viewBox").split(" ").map(Number);
  assert.ok(Number(elevation.getAttribute("y")) > 0, "the rotated label stays inside the left edge");
  const area = texts.find((t) => t.textContent === "Area (%)");
  assert.ok(area);
  const bottom = Math.max(...[...svg.querySelectorAll("rect")].map((r) => Number(r.getAttribute("y")) + Number(r.getAttribute("height"))));
  assert.ok(Number(area.getAttribute("y")) > bottom && Number(area.getAttribute("y")) <= vbHeight);
  assert.ok(vbWidth >= 360);
});

test("the area ticks are percent on the bars' scale", () => {
  const el = draw();
  const ticks = [...el.querySelectorAll(".x-axis text.tick")];
  assert.deepEqual(ticks.map((t) => t.textContent), ["0", "1", "2", "3", "4", "5"]);
  const left = Number(el.querySelector("rect").getAttribute("x"));
  const widest = [...el.querySelectorAll("rect")].reduce((a, r) => Math.max(a, Number(r.getAttribute("width"))), 0);
  /* The widest band holds 50 ‰, 5 %: its bar ends at the 5 % tick. */
  assert.ok(Math.abs(Number(ticks.at(-1).getAttribute("x")) - (left + widest)) < 0.01);
  assert.ok(Math.abs(Number(ticks[0].getAttribute("x")) - left) < 0.01);
});

test("area ticks fit a band of any width", () => {
  const cases = [
    [[1000], ["0", "20", "40", "60", "80", "100"]],
    [[500, 500], ["0", "10", "20", "30", "40", "50"]],
    [[180, 820], ["0", "20", "40", "60", "80"]],
    [Array.from({ length: 200 }, () => 5), ["0", "0.1", "0.2", "0.3", "0.4", "0.5"]],
  ];
  for (const [permille, expected] of cases) {
    const el = draw({ hypso_z0_m: 1000, hypso_permille: permille });
    assert.deepEqual([...el.querySelectorAll(".x-axis text.tick")].map((t) => t.textContent), expected, String(permille.length));
  }
});

test("the summary names the band size and the largest band", () => {
  assert.match(draw().querySelector("svg").getAttribute("aria-label"), /50 m elevation band.*largest band 5% at 3,425 m/);
});

const heights = (el) => [...el.querySelectorAll("rect")].map((r) => Number(r.getAttribute("height")));

test("a small glacier's bands are no taller than 24 px, and its short plot pads the elevation axis evenly", () => {
  const el = draw({ hypso_z0_m: 2875, hypso_permille: [440, 290, 230, 40], zmin_m: 2850, zmax_m: 3022, zmed_m: 2912, zmean_m: 2919 });
  assert.ok(heights(el).every((height) => height <= 24), String(heights(el)));
  const axis = el.querySelector(".y-axis line");
  const [top, bottom] = [axis.getAttribute("y1"), axis.getAttribute("y2")].map(Number);
  const rects = [...el.querySelectorAll("rect")];
  const above = Number(rects.at(-1).getAttribute("y")) - top;
  const below = bottom - (Number(rects[0].getAttribute("y")) + Number(rects[0].getAttribute("height")));
  assert.ok(bottom - top >= 100, "tall enough for the axis title");
  assert.ok(above > 0 && Math.abs(above - below) < 1, `${above} above, ${below} below`);
});

test("a large glacier's bands share the 300 px plot", () => {
  const el = draw();
  const axis = el.querySelector(".y-axis line");
  assert.equal(Number(axis.getAttribute("y2")) - Number(axis.getAttribute("y1")), 300);
  assert.ok(heights(el).every((height) => height < 6));
});

test("the axis text is 13 px, as the caption above, drawn one unit to the pixel", () => {
  const svg = draw().querySelector("svg");
  for (const text of svg.querySelectorAll("text")) assert.equal(text.getAttribute("font-size"), "13", text.textContent);
  const css = readFileSync(new URL("../style.css", import.meta.url), "utf8");
  assert.match(css, /\.hypso-caption \{[^}]*font-size: 13px;/, "the caption's size");
  assert.match(css, /\.hypso-range \{\s*font-size: 13px;/, "the minimum and maximum line's");
  /* jsdom lays nothing out, so the chart keeps the width it assumes until it is measured. */
  assert.equal(svg.getAttribute("viewBox").split(" ")[2], "360");
});

test("the labels of a mean and median at the foot of the plot stay inside it", () => {
  const el = draw({ hypso_z0_m: 2875, hypso_permille: [500, 500], zmed_m: 2850, zmean_m: 2851 });
  const bottom = Number(el.querySelector(".y-axis line").getAttribute("y2"));
  const at = (name) => Number([...el.querySelectorAll("text")].find((t) => t.textContent === name).getAttribute("y"));
  assert.ok(at("Median") <= bottom + 6 && at("Mean") <= bottom + 6, `${at("Median")} ${at("Mean")} ${bottom}`);
  assert.ok(Math.abs(at("Median") - at("Mean")) >= 13);
});
