/* The hypsometry chart: area per elevation band as horizontal bars. */

import { formatInt } from "./columns.js";
import { HYPSO_BAND_M } from "./config.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const WIDTH = 360;
const PLOT = { left: 52, right: 296, top: 8, height: 300 };
const LABEL_GAP = 12;

/** The bands of a hypsometry: their center elevation and thousandths of the area. */
export function bands(z0, permille) {
  return permille.map((value, i) => ({ center: z0 + HYPSO_BAND_M * i, permille: value }));
}

function svg(tag, attrs = {}, text) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  if (text !== undefined) node.textContent = text;
  return node;
}

/** A tick step that gives a handful of labels over the span. */
function tickStep(span) {
  for (const step of [50, 100, 200, 500, 1000, 2000, 5000]) if (span / step <= 6) return step;
  return 10000;
}

/**
 * Draws the chart into `el`, replacing its content. Needs hypso_z0_m and
 * hypso_permille; draws the median, mean, minimum and maximum when present.
 */
export function renderHypsometry(el, props) {
  const list = bands(props.hypso_z0_m, props.hypso_permille);
  const low = list[0].center - HYPSO_BAND_M / 2;
  const high = list.at(-1).center + HYPSO_BAND_M / 2;
  const y = (elevation) => PLOT.top + ((high - elevation) / (high - low)) * PLOT.height;
  const bandHeight = PLOT.height / list.length;
  const widest = Math.max(1, ...list.map((b) => b.permille));
  const bottom = PLOT.top + PLOT.height;

  const median = props.zmed_m;
  const mean = props.zmean_m;
  const summary = [
    "Hypsometry: share of the glacier area by elevation band",
    `from ${formatInt(low)} to ${formatInt(high)} m`,
    median === null || median === undefined ? null : `median ${formatInt(median)} m`,
    mean === null || mean === undefined ? null : `mean ${formatInt(mean)} m`,
  ]
    .filter(Boolean)
    .join(", ");

  const chart = svg("svg", {
    viewBox: `0 0 ${WIDTH} ${bottom + 8}`,
    width: "100%",
    role: "img",
    "aria-label": summary,
    class: "hypsometry",
  });
  chart.append(svg("title", {}, summary));

  const axis = svg("g", { class: "axis" });
  axis.append(svg("line", { x1: PLOT.left, x2: PLOT.left, y1: PLOT.top, y2: bottom, stroke: "#dadce0" }));
  const step = tickStep(high - low);
  for (let tick = Math.ceil(low / step) * step; tick <= high; tick += step) {
    axis.append(
      svg("line", { x1: PLOT.left - 4, x2: PLOT.left, y1: y(tick), y2: y(tick), stroke: "#5f6368" }),
      svg("text", { x: PLOT.left - 7, y: y(tick) + 3.5, "text-anchor": "end", "font-size": 10, fill: "#5f6368" }, formatInt(tick)),
    );
  }
  chart.append(axis);

  const bars = svg("g", { class: "bars" });
  list.forEach((band, i) => {
    const width = (band.permille / widest) * (PLOT.right - PLOT.left);
    bars.append(
      svg("rect", {
        x: PLOT.left,
        y: y(band.center + HYPSO_BAND_M / 2),
        width,
        height: Math.max(bandHeight - 0.5, 0.5),
        class: "bar",
        "data-center": band.center,
        "data-index": i,
      }),
    );
  });
  chart.append(bars);

  const marks = [];
  if (median !== null && median !== undefined) marks.push({ name: "Median", value: median, class: "median", stroke: "#d93025" });
  if (mean !== null && mean !== undefined) marks.push({ name: "Mean", value: mean, class: "mean", stroke: "#5f6368" });
  let lastLabel = -Infinity;
  for (const mark of marks.sort((a, b) => b.value - a.value)) {
    const line = y(Math.min(high, Math.max(low, mark.value)));
    const label = Math.max(line, lastLabel + LABEL_GAP);
    lastLabel = label;
    chart.append(
      svg("line", {
        class: mark.class,
        x1: PLOT.left,
        x2: PLOT.right,
        y1: line,
        y2: line,
        stroke: mark.stroke,
        "stroke-width": 1.5,
        "stroke-dasharray": "5 3",
      }),
      svg("text", { x: PLOT.right + 4, y: label + 3.5, "font-size": 10, fill: mark.stroke }, mark.name),
    );
  }

  const range = document.createElement("p");
  range.className = "hypso-range";
  const { zmin_m: min, zmax_m: max } = props;
  const known = (v) => v !== null && v !== undefined;
  range.textContent = [known(min) ? `Min ${formatInt(min)} m` : null, known(max) ? `Max ${formatInt(max)} m` : null]
    .filter(Boolean)
    .join(" · ");
  el.replaceChildren(chart, range);
}
