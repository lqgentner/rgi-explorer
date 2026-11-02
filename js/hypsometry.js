/* The hypsometry chart: area per elevation band as horizontal bars. */

import { formatInt } from "./columns.js";
import { HYPSO_BAND_M } from "./config.js";

const SVG_NS = "http://www.w3.org/2000/svg";
const WIDTH = 360;
/* The plot area. Left of it the elevation ticks and the rotated axis title, below it the area axis. */
const PLOT = { left: 60, right: 304, top: 8, height: 300 };
const X_AXIS_H = 38;
const LABEL_GAP = 12;
const AXIS_INK = "#5f6368";
const PERCENT = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });

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

/** A percent step that puts at most five steps under the widest band. */
function percentStep(widest) {
  for (const step of [0.1, 0.2, 0.5, 1, 2, 5, 10, 20]) if (widest / step <= 5) return step;
  return 50;
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
  const largest = list.reduce((a, b) => (b.permille > a.permille ? b : a));
  const bottom = PLOT.top + PLOT.height;
  /* Bars scale to the widest band; x takes a share in percent, a tenth of the permille. */
  const x = (percent) => PLOT.left + ((percent * 10) / widest) * (PLOT.right - PLOT.left);

  const median = props.zmed_m;
  const mean = props.zmean_m;
  const summary = [
    `Hypsometry: share of the glacier area by ${HYPSO_BAND_M} m elevation band`,
    `from ${formatInt(low)} to ${formatInt(high)} m`,
    `largest band ${PERCENT.format(largest.permille / 10)}% at ${formatInt(largest.center)} m`,
    median === null || median === undefined ? null : `median ${formatInt(median)} m`,
    mean === null || mean === undefined ? null : `mean ${formatInt(mean)} m`,
  ]
    .filter(Boolean)
    .join(", ");

  const chart = svg("svg", {
    viewBox: `0 0 ${WIDTH} ${bottom + X_AXIS_H}`,
    width: "100%",
    role: "img",
    "aria-label": summary,
    class: "hypsometry",
  });
  chart.append(svg("title", {}, summary));

  const axis = svg("g", { class: "axis y-axis" });
  axis.append(svg("line", { x1: PLOT.left, x2: PLOT.left, y1: PLOT.top, y2: bottom, stroke: "#dadce0" }));
  const step = tickStep(high - low);
  for (let tick = Math.ceil(low / step) * step; tick <= high; tick += step) {
    axis.append(
      svg("line", { x1: PLOT.left - 4, x2: PLOT.left, y1: y(tick), y2: y(tick), stroke: AXIS_INK }),
      svg("text", { class: "tick", x: PLOT.left - 7, y: y(tick) + 3.5, "text-anchor": "end", "font-size": 10, fill: AXIS_INK }, formatInt(tick)),
    );
  }
  const middle = PLOT.top + PLOT.height / 2;
  axis.append(
    svg("text", { x: 11, y: middle, transform: `rotate(-90 11 ${middle})`, "text-anchor": "middle", "font-size": 10, fill: AXIS_INK }, "Elevation (m)"),
  );
  chart.append(axis);

  const xAxis = svg("g", { class: "axis x-axis" });
  xAxis.append(svg("line", { x1: PLOT.left, x2: PLOT.right, y1: bottom, y2: bottom, stroke: "#dadce0" }));
  const percentTop = widest / 10;
  const pStep = percentStep(percentTop);
  /* Counted in steps, so a tick that should land on the widest band does not miss it by a rounding error. */
  for (let i = 0; i * pStep <= percentTop + 1e-9; i += 1) {
    const at = x(i * pStep);
    xAxis.append(
      svg("line", { x1: at, x2: at, y1: bottom, y2: bottom + 4, stroke: AXIS_INK }),
      svg("text", { class: "tick", x: at, y: bottom + 14, "text-anchor": "middle", "font-size": 10, fill: AXIS_INK }, PERCENT.format(i * pStep)),
    );
  }
  xAxis.append(
    svg("text", { x: (PLOT.left + PLOT.right) / 2, y: bottom + 30, "text-anchor": "middle", "font-size": 10, fill: AXIS_INK }, "Area (%)"),
  );
  chart.append(xAxis);

  const bars = svg("g", { class: "bars" });
  list.forEach((band, i) => {
    const width = x(band.permille / 10) - PLOT.left;
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
  if (mean !== null && mean !== undefined) marks.push({ name: "Mean", value: mean, class: "mean", stroke: AXIS_INK });
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
