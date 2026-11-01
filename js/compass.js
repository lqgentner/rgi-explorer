/*
 * The compass: a needle that points to the map's north, with an arrow either
 * side that turns the map. A click on the needle faces north and leaves 3D.
 * It draws once for both layouts; style.css makes it a capsule on the desktop
 * and a round button on the phone, which shows only while the map is turned
 * or in 3D.
 */

import { h, svg } from "./ui.js";

/* How far one click on an arrow turns the map, in degrees. */
export const ROTATE_STEP = 22.5;

/* A bearing closer to 0 than this, in degrees, faces north. */
const NORTH = 0.5;

/*
 * The arrows in the capsule's 54 x 40 px box. Each arc shares the centre of
 * the capsule's round end, 7 px in from its edge. Each head is isosceles: its
 * base lies along the radius where the stroke ends and its tip along the
 * stroke's direction, and the top of the stroke is as far above the middle as
 * the tip is below it.
 */
const ARROWS = [
  { d: "M13.25 8.89 A13 13 0 0 0 9.1 27.08", head: "6.08 29.04 12.37 32.11 12.12 25.12" },
  { d: "M40.75 8.89 A13 13 0 0 1 44.9 27.08", head: "47.92 29.04 41.63 32.11 41.88 25.12" },
];

/**
 * Draw the compass into `root`. The arrows call `onRotate` with ROTATE_STEP,
 * positive for Rotate left, which turns the map counter-clockwise; the needle
 * calls `onReset`.
 *
 * @returns {{update(view: {bearing: number, pitch: number, terrain: boolean}): void}}
 */
export function mountCompass(root, { onRotate, onReset }) {
  const button = (className, label, action, ...children) => {
    const node = h("button", { type: "button", class: className, "aria-label": label, title: label }, ...children);
    node.addEventListener("click", action);
    return node;
  };
  const needle = svg(
    "svg",
    { class: "compass-needle", width: 28, height: 28, viewBox: "0 0 28 28", "aria-hidden": "true" },
    svg("polygon", { class: "needle-north", points: "14,0 18.7,14 9.3,14" }),
    svg("polygon", { class: "needle-south", points: "9.3,14 18.7,14 14,28" }),
  );
  const arrows = svg(
    "svg",
    { class: "compass-arrows", width: 54, height: 40, viewBox: "0 0 54 40", "aria-hidden": "true" },
    ...ARROWS.flatMap(({ d, head }) => [
      svg("path", { class: "compass-arc", d }),
      svg("polygon", { class: "compass-head", points: head }),
    ]),
  );
  const compass = h(
    "div",
    { class: "compass", role: "group", "aria-label": "Map direction" },
    button("compass-turn compass-left", "Rotate left", () => onRotate(ROTATE_STEP)),
    button("compass-north", "Face north", () => onReset(), needle),
    button("compass-turn compass-right", "Rotate right", () => onRotate(-ROTATE_STEP)),
    arrows,
  );
  root.append(compass);

  return {
    update({ bearing, pitch, terrain }) {
      needle.style.transform = `rotateX(${pitch}deg) rotateZ(${-bearing}deg)`;
      compass.toggleAttribute("data-idle", Math.abs(bearing) < NORTH && !terrain);
    },
  };
}
