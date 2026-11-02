/*
 * The glacier card on phones: a sheet docked to the bottom at three heights.
 * Compact shows the band (the handle, the name and "Use this data") and the
 * top of the photo; middle adds the ID or region line to the band and shows
 * the photo, the tabs and the first row of key numbers, and cuts through the
 * second so the reader sees there is more; full reaches the search bar's top,
 * and only there does the body scroll. A drag on the body that carries the
 * sheet to full height goes on to scroll the body in the same motion. A drag
 * writes two properties on the root: --sheet-visible, which style.css turns
 * into the sheet's transform, and --sheet-rise, 0 at compact and 1 from
 * middle up, which fades the credits that ride on the sheet's edge. Nothing
 * moves between input events but CSS transitions and the browser's smooth
 * scroll that carries on a flick.
 */

import { el, glide, PHONE } from "./ui.js";

/** Movement in px before a gesture counts as vertical or horizontal. */
export const LOCK_PX = 8;
/** Release speed in px/ms past which the sheet follows the flick. */
export const FLICK = 0.5;
/** The heights, lowest first. */
export const LEVELS = ["compact", "middle", "full"];
/** How much of the photo the compact sheet shows below the band, in px. */
export const PEEK_PX = 20;
/** The middle height, as a share of the full one, until the key numbers are laid out. */
export const MIDDLE_SHARE = 0.65;
/** The share of the key numbers' second row that the middle sheet shows. */
export const MIDDLE_CUT = 0.5;

/* Release speed is measured over this many ms before the release. */
const VELOCITY_WINDOW_MS = 100;
/* A click this soon after a drag is the drag's own click. */
const DRAG_CLICK_MS = 300;

const LABELS = {
  compact: "Show the glacier details",
  middle: "Show all the glacier details",
  full: "Hide the glacier details",
};
/* A tap on the handle moves up a height, and from the top back down to compact. */
const NEXT = { compact: "middle", middle: "full", full: "compact" };

/** The gesture's axis once it has moved LOCK_PX, before that null. */
export function lockAxis(dx, dy) {
  if (Math.hypot(dx, dy) < LOCK_PX) return null;
  return Math.abs(dy) > Math.abs(dx) ? "y" : "x";
}

/**
 * The height a released sheet settles at: with a flick, the next stop in its
 * direction, else the nearest stop.
 *
 * @param {number} visible   px of the sheet on screen at the release
 * @param {number} velocity  px/ms, positive upward
 * @param {number[]} stops   px on screen at each level, lowest first
 * @returns {string} one of LEVELS
 */
export function snapTarget(visible, velocity, stops) {
  let index;
  if (velocity > FLICK) {
    index = stops.findIndex((stop) => stop > visible);
    if (index < 0) index = stops.length - 1;
  } else if (velocity < -FLICK) {
    index = stops.findLastIndex((stop) => stop < visible);
    if (index < 0) index = 0;
  } else {
    index = 0;
    for (let i = 1; i < stops.length; i++) {
      if (Math.abs(stops[i] - visible) < Math.abs(stops[index] - visible)) index = i;
    }
  }
  return LEVELS[index];
}

let level = "compact";
/* The px on screen at each level, lowest first, and now. */
let stops = [0, 0, 0];
let visible = 0;
/* The middle height the key numbers last gave, kept while another tab hides them. */
let middle = null;
let observer = null;
/* The touch or pointer moving the sheet: its start, axis and recent positions. */
let gesture = null;

/* The height of an element's box with its margins, or 0 when it does not show. */
function outerHeight(node) {
  if (!node.getClientRects().length) return 0;
  const style = getComputedStyle(node);
  return node.offsetHeight + parseFloat(style.marginTop || 0) + parseFloat(style.marginBottom || 0);
}

/*
 * The middle height: through the second row of the open panel's key numbers,
 * measured from the sheet's top as if the body were scrolled to its top.
 * Without a second row laid out, the last such height, or MIDDLE_SHARE.
 */
function middleOf(full) {
  const body = el("sheet-body");
  const grid = [...body.querySelectorAll(".key-grid")].find((node) => node.getClientRects().length);
  const rows = grid ? [...grid.children].map((tile) => tile.getBoundingClientRect()) : [];
  const second = rows.find((row) => row.top > rows[0].bottom);
  if (second) {
    const top = second.top - el("sheet").getBoundingClientRect().top + body.scrollTop;
    middle = Math.round(top + second.height * MIDDLE_CUT);
  }
  return middle ?? Math.round(full * MIDDLE_SHARE);
}

/*
 * The band's height comes from the body's offset. The compact band leaves out
 * the ID or region line, which only the higher sheets show, whichever height
 * the sheet is at now.
 */
function measure() {
  const full = el("sheet").offsetHeight;
  const band = el("sheet-body").offsetTop;
  const extra = [...el("sheet-band").querySelectorAll(".card-subtitle")].reduce(
    (sum, node) => sum + outerHeight(node),
    0,
  );
  const compact = Math.min(full, band - extra + PEEK_PX);
  stops = [compact, Math.min(full, Math.max(compact, middleOf(full))), full];
  // The panels' content loads after they open, and moves the key numbers.
  for (const panel of el("sheet-body").children) observer?.observe(panel);
}

function show(px) {
  visible = px;
  const rise = stops[1] > stops[0] ? (px - stops[0]) / (stops[1] - stops[0]) : 1;
  const style = document.documentElement.style;
  style.setProperty("--sheet-visible", `${px}px`);
  style.setProperty("--sheet-rise", String(Math.min(1, Math.max(0, rise))));
}

/** Move the sheet to `next`, one of LEVELS; on desktop only the handle's state changes. */
export function setSheetLevel(next) {
  level = next;
  el("sheet").dataset.level = next;
  const handle = el("sheet-handle");
  handle.setAttribute("aria-expanded", String(next !== "compact"));
  handle.title = LABELS[next];
  handle.setAttribute("aria-label", LABELS[next]);
  if (!PHONE.matches) return;
  // Below the compact sheet's edge sit all but the top of the photo.
  el("sheet-body").toggleAttribute("inert", next === "compact");
  measure();
  show(stops[LEVELS.indexOf(next)]);
}

/** The sheet's height now, one of LEVELS. */
export const sheetLevel = () => level;

/** On desktop the sheet is unused and carries none of its state. */
function toWide() {
  gesture = null;
  el("sheet").classList.remove("dragging");
  for (const name of ["--sheet-visible", "--sheet-rise"]) document.documentElement.style.removeProperty(name);
  el("sheet-body").removeAttribute("inert");
  setSheetLevel("full");
}

/*
 * On phones, the padding that keeps a map fit clear of the sheet's visible
 * part. Above the middle height the map is mostly covered, and a fit keeps to
 * the space the middle sheet leaves.
 */
export function popupPadding() {
  return PHONE.matches ? { bottom: Math.min(visible, stops[1]) } : undefined;
}

const startsOnRange = (target) => target.closest?.('input[type="range"]') != null;

/* `scroller`, for a drag on the body, is the body: past full height the drag scrolls it. */
function begin(x, y, time, scroller = null) {
  measure();
  const from = stops[LEVELS.indexOf(level)];
  gesture = { x, y, axis: null, from, visible: from, samples: [], scroller, scrollFrom: scroller?.scrollTop ?? 0, past: 0 };
  track(y, time);
}

function track(y, time) {
  const { samples } = gesture;
  samples.push({ y, time });
  while (samples.length > 2 && time - samples[0].time > VELOCITY_WINDOW_MS) samples.shift();
}

function drag(y, time) {
  const at = gesture.from + gesture.y - y;
  gesture.visible = Math.min(stops.at(-1), Math.max(stops[0], at));
  if (gesture.scroller) {
    gesture.past = Math.max(0, at - stops.at(-1));
    gesture.scroller.scrollTop = gesture.scrollFrom + gesture.past;
  }
  el("sheet").classList.add("dragging");
  show(gesture.visible);
  track(y, time);
}

/* Settle a drag, released at `time`, at the height its position and speed point to. */
function release(time) {
  const { samples } = gesture;
  const last = samples.at(-1);
  const first = samples.find((sample) => time - sample.time <= VELOCITY_WINDOW_MS) ?? last;
  // Upward is positive; no time between samples reads as a flick. A finger held
  // still sends no moves, so after a pause only `last` is recent: no speed.
  const velocity = (first.y - last.y) / (last.time - first.time) || 0;
  const { visible: at, past, scroller } = gesture;
  gesture = null;
  el("sheet").classList.remove("dragging");
  if (!past) {
    setSheetLevel(snapTarget(at, velocity, stops));
    return;
  }
  // A drag that went on into the body's scroll stays at full height, and a flick carries the scroll on.
  setSheetLevel("full");
  glide(scroller, velocity);
}

/*
 * The compact sheet's body is inert, so a press on the photo's top lands on
 * the sheet itself. The band and that strip move the sheet.
 */
const grips = (target) => el("sheet-band").contains(target) || target === el("sheet");

/*
 * A drag on the band ends without the click that browsers may send at its
 * release. The next press starts a gesture of its own.
 */
function swallowNextClick() {
  const stop = () => {
    window.removeEventListener("click", swallow, { capture: true });
    window.removeEventListener("pointerdown", stop, { capture: true });
  };
  const swallow = (event) => {
    if (!grips(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    stop();
  };
  window.addEventListener("click", swallow, { capture: true });
  window.addEventListener("pointerdown", stop, { capture: true });
  setTimeout(stop, DRAG_CLICK_MS);
}

/*
 * The band and the compact sheet's photo strip drag on pointer events. A
 * gesture that never locks is a tap: on the band it clicks as usual, and on
 * the photo strip it raises the sheet to the middle.
 */
function wireGrips(sheet) {
  sheet.addEventListener("pointerdown", (event) => {
    if (!PHONE.matches || !event.isPrimary || event.button !== 0) return;
    if (!grips(event.target) || startsOnRange(event.target)) return;
    begin(event.clientX, event.clientY, event.timeStamp);
    gesture.pointerId = event.pointerId;
  });
  sheet.addEventListener("pointermove", (event) => {
    if (gesture?.pointerId !== event.pointerId) return;
    if (!gesture.axis) {
      gesture.axis = lockAxis(event.clientX - gesture.x, event.clientY - gesture.y);
      if (gesture.axis !== "y") return;
      // Captured only once it is a drag: a captured tap would click the sheet, not its target.
      sheet.setPointerCapture?.(event.pointerId);
    }
    if (gesture.axis === "y") drag(event.clientY, event.timeStamp);
  });
  const end = (event) => {
    if (gesture?.pointerId !== event.pointerId) return;
    if (gesture.axis !== "y") {
      gesture = null;
      return;
    }
    if (event.type === "pointerup") swallowNextClick();
    release(event.timeStamp);
  };
  sheet.addEventListener("pointerup", end);
  sheet.addEventListener("pointercancel", end);
  sheet.addEventListener("click", (event) => {
    if (PHONE.matches && event.target === sheet && level === "compact") setSheetLevel("middle");
  });
}

/*
 * Below full height a vertical drag on the body moves the sheet, and past
 * full height scrolls the body. At full height the body scrolls; scrolled to
 * its top, a pull down moves the sheet. Touch events, since only a cancelable
 * touchmove can take the gesture from the scroller.
 */
function wireContent(body) {
  // A drag that started on a grip belongs to its pointer, whatever other fingers do.
  const onGrip = () => gesture?.pointerId !== undefined;
  body.addEventListener(
    "touchstart",
    (event) => {
      // A second finger leaves the gesture under way alone.
      if (event.touches.length > 1 || onGrip()) return;
      gesture = null;
      if (!PHONE.matches || startsOnRange(event.target)) return;
      const [{ clientX, clientY }] = event.touches;
      begin(clientX, clientY, event.timeStamp, body);
    },
    { passive: true },
  );
  body.addEventListener(
    "touchmove",
    (event) => {
      if (!gesture || onGrip() || event.touches.length > 1) return;
      const [{ clientX, clientY }] = event.touches;
      if (!gesture.axis) {
        const dy = clientY - gesture.y;
        gesture.axis = lockAxis(clientX - gesture.x, dy);
        if (!gesture.axis) return;
        // An uncancelable move means the browser is already scrolling.
        const scrolls = level === "full" && (dy < 0 || body.scrollTop > 0);
        if (gesture.axis !== "y" || scrolls || !event.cancelable) {
          gesture = null;
          return;
        }
      }
      event.preventDefault();
      drag(clientY, event.timeStamp);
    },
    { passive: false },
  );
  const end = (event) => {
    if (onGrip()) return;
    if (gesture?.axis === "y") release(event.timeStamp);
    gesture = null;
  };
  body.addEventListener("touchend", end);
  body.addEventListener("touchcancel", end);
}

export function initSheet() {
  el("sheet-handle").addEventListener("click", () => setSheetLevel(NEXT[level]));
  wireGrips(el("sheet"));
  wireContent(el("sheet-body"));

  /*
   * The band's height changes with the glacier's name and the sheet's height;
   * the sheet's with the viewport; the panels' with their content, which
   * measure() watches once they are in the body.
   */
  if (typeof ResizeObserver === "function") {
    observer = new ResizeObserver(() => {
      if (!PHONE.matches || gesture?.axis === "y") return;
      measure();
      show(stops[LEVELS.indexOf(level)]);
    });
    observer.observe(el("sheet-band"));
    observer.observe(el("sheet"));
  }

  PHONE.addEventListener("change", (event) => {
    if (event.matches) setSheetLevel("compact");
    else toWide();
  });
  if (PHONE.matches) setSheetLevel("compact");
  else toWide();
}
