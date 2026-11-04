/* The hypsometry chart: area per elevation band as horizontal bars. */

import { formatInt } from "./columns.js";
import { HYPSO_BAND_M } from "./config.js";
import { h, svg } from "./ui.js";

/*
 * The chart draws one unit to the pixel at the width it is shown, so its text
 * is 13 px, as the caption above it. Until it is shown and measured, it
 * assumes this width.
 */
const DEFAULT_WIDTH = 360;
const FONT = 13;
/* Left of the plot the rotated axis title, then the elevation ticks; right of it the median's and the mean's labels. */
const TITLE_X = FONT + 1;
const PLOT_LEFT = 76;
const RIGHT_ROOM = 58;
const PLOT_TOP = FONT / 2;
/*
 * A band is at most BAND_MAX px tall, so a small glacier's few bands do not
 * swell into blocks, and the plot at most PLOT_MAX. A plot shorter than
 * PLOT_MIN, too short for its axis title, pads the elevation axis evenly
 * above and below the bands.
 */
const BAND_MAX = 24;
const PLOT_MAX = 300;
const PLOT_MIN = 120;
const X_AXIS_H = 2 * FONT + 18;
const LABEL_GAP = FONT + 2;
const AXIS_INK = "#5f6368";
const PERCENT = new Intl.NumberFormat("en", { maximumFractionDigits: 1 });

/** The bands of a hypsometry: their center elevation and thousandths of the area. */
export function bands(z0, permille) {
  return permille.map((value, i) => ({ center: z0 + HYPSO_BAND_M * i, permille: value }));
}

/** A tick step that gives a handful of labels over the span, at least two bands apart on the plot. */
function tickStep(span, pxPerMeter) {
  for (const step of [50, 100, 200, 500, 1000, 2000, 5000]) if (span / step <= 6 && step * pxPerMeter >= 2 * FONT) return step;
  return 10000;
}

/** A percent step that puts at most five steps under the widest band. */
function percentStep(widest) {
  for (const step of [0.1, 0.2, 0.5, 1, 2, 5, 10, 20]) if (widest / step <= 5) return step;
  return 50;
}

const known = (v) => v !== null && v !== undefined;

/** The chart's accessible summary. */
function summarize(props, list) {
  const largest = list.reduce((a, b) => (b.permille > a.permille ? b : a));
  const low = list[0].center - HYPSO_BAND_M / 2;
  const high = list.at(-1).center + HYPSO_BAND_M / 2;
  return [
    `Hypsometry: share of the glacier area by ${HYPSO_BAND_M} m elevation band`,
    `from ${formatInt(low)} to ${formatInt(high)} m`,
    `largest band ${PERCENT.format(largest.permille / 10)}% at ${formatInt(largest.center)} m`,
    known(props.zmed_m) ? `median ${formatInt(props.zmed_m)} m` : null,
    known(props.zmean_m) ? `mean ${formatInt(props.zmean_m)} m` : null,
  ]
    .filter(Boolean)
    .join(", ");
}

/** Draws the chart into `chart`, `width` units wide, replacing what it held. */
function draw(chart, props, width) {
  const list = bands(props.hypso_z0_m, props.hypso_permille);
  const bandHeight = Math.min(BAND_MAX, PLOT_MAX / list.length);
  const plotHeight = Math.max(PLOT_MIN, bandHeight * list.length);
  /* The bands' span, padded evenly to fill a plot taller than they are. */
  const pad = ((plotHeight / bandHeight - list.length) * HYPSO_BAND_M) / 2;
  const low = list[0].center - HYPSO_BAND_M / 2 - pad;
  const high = list.at(-1).center + HYPSO_BAND_M / 2 + pad;
  const plot = { left: PLOT_LEFT, right: Math.max(PLOT_LEFT + 60, width - RIGHT_ROOM), top: PLOT_TOP, bottom: PLOT_TOP + plotHeight };
  const y = (elevation) => plot.top + ((high - elevation) / (high - low)) * plotHeight;
  const widest = Math.max(1, ...list.map((b) => b.permille));
  /* Bars scale to the widest band; x takes a share in percent, a tenth of the permille. */
  const x = (percent) => plot.left + ((percent * 10) / widest) * (plot.right - plot.left);
  const text = (attrs, content) => svg("text", { "font-size": FONT, fill: AXIS_INK, ...attrs }, content);

  const summary = summarize(props, list);
  chart.setAttribute("viewBox", `0 0 ${width} ${plot.bottom + X_AXIS_H}`);
  chart.setAttribute("aria-label", summary);
  chart.replaceChildren(svg("title", {}, summary));

  const axis = svg("g", { class: "axis y-axis" });
  axis.append(svg("line", { x1: plot.left, x2: plot.left, y1: plot.top, y2: plot.bottom, stroke: "#dadce0" }));
  const step = tickStep(high - low, plotHeight / (high - low));
  for (let tick = Math.ceil(low / step) * step; tick <= high; tick += step) {
    axis.append(
      svg("line", { x1: plot.left - 4, x2: plot.left, y1: y(tick), y2: y(tick), stroke: AXIS_INK }),
      text({ class: "tick", x: plot.left - 7, y: y(tick) + FONT * 0.35, "text-anchor": "end" }, formatInt(tick)),
    );
  }
  const middle = (plot.top + plot.bottom) / 2;
  axis.append(text({ x: TITLE_X, y: middle, transform: `rotate(-90 ${TITLE_X} ${middle})`, "text-anchor": "middle" }, "Elevation (m)"));
  chart.append(axis);

  const xAxis = svg("g", { class: "axis x-axis" });
  xAxis.append(svg("line", { x1: plot.left, x2: plot.right, y1: plot.bottom, y2: plot.bottom, stroke: "#dadce0" }));
  const percentTop = widest / 10;
  const pStep = percentStep(percentTop);
  /* Counted in steps, so a tick that should land on the widest band does not miss it by a rounding error. */
  for (let i = 0; i * pStep <= percentTop + 1e-9; i += 1) {
    const at = x(i * pStep);
    xAxis.append(
      svg("line", { x1: at, x2: at, y1: plot.bottom, y2: plot.bottom + 4, stroke: AXIS_INK }),
      text({ class: "tick", x: at, y: plot.bottom + 4 + FONT, "text-anchor": "middle" }, PERCENT.format(i * pStep)),
    );
  }
  xAxis.append(text({ x: (plot.left + plot.right) / 2, y: plot.bottom + 10 + 2 * FONT, "text-anchor": "middle" }, "Area (%)"));
  chart.append(xAxis);

  const bars = svg("g", { class: "bars" });
  list.forEach((band, i) => {
    bars.append(
      svg("rect", {
        x: plot.left,
        y: y(band.center + HYPSO_BAND_M / 2),
        width: x(band.permille / 10) - plot.left,
        height: Math.max(bandHeight - 0.5, 0.5),
        class: "bar",
        "data-center": band.center,
        "data-index": i,
      }),
    );
  });
  chart.append(bars);

  const marks = [];
  if (known(props.zmed_m)) marks.push({ name: "Median", value: props.zmed_m, class: "median", stroke: "#d93025" });
  if (known(props.zmean_m)) marks.push({ name: "Mean", value: props.zmean_m, class: "mean", stroke: AXIS_INK });
  marks.sort((a, b) => b.value - a.value);
  /* Each label on its line, the lower pushed down clear of the upper, and the pair moved up if that leaves the plot. */
  const lines = marks.map((mark) => y(Math.min(high, Math.max(low, mark.value))));
  const labels = [];
  for (const line of lines) labels.push(Math.max(line, (labels.at(-1) ?? -Infinity) + LABEL_GAP));
  const over = Math.max(0, (labels.at(-1) ?? 0) - plot.bottom);
  marks.forEach((mark, i) => {
    chart.append(
      svg("line", {
        class: mark.class,
        x1: plot.left,
        x2: plot.right,
        y1: lines[i],
        y2: lines[i],
        stroke: mark.stroke,
        "stroke-width": 1.5,
        "stroke-dasharray": "5 3",
      }),
      text({ x: plot.right + 4, y: labels[i] - over + FONT * 0.35, fill: mark.stroke }, mark.name),
    );
  });
}

/**
 * Draws the chart into `el`, replacing its content. Needs hypso_z0_m and
 * hypso_permille; draws the median, mean, minimum and maximum when present.
 * The chart redraws itself when its width changes, such as when its tab
 * first shows.
 */
export function renderHypsometry(el, props) {
  const chart = svg("svg", { width: "100%", role: "img", class: "hypsometry" });
  let drawn = 0;
  const fit = (width) => {
    const w = Math.round(width) || DEFAULT_WIDTH;
    if (w === drawn) return;
    drawn = w;
    draw(chart, props, w);
  };
  fit(DEFAULT_WIDTH);

  const { zmin_m: min, zmax_m: max } = props;
  const range = h("p", { class: "hypso-range" },
    [known(min) ? `Min ${formatInt(min)} m` : null, known(max) ? `Max ${formatInt(max)} m` : null].filter(Boolean).join(" · "));
  el.replaceChildren(chart, range);
  fit(chart.getBoundingClientRect().width);

  if (typeof ResizeObserver === "function") {
    const observer = new ResizeObserver(([entry]) => {
      if (!chart.isConnected) observer.disconnect();
      else fit(entry.contentRect.width);
    });
    observer.observe(chart);
  }
}
