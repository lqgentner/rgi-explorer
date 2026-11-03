/*
 * Map-independent DOM helpers. External text must enter through nodes or
 * textContent, never HTML interpolation.
 */

/*
 * A phone: a screen at most 640px wide. Match the query in style.css.
 */
export const PHONE = window.matchMedia("(max-width: 640px)");

export const el = (id) => document.getElementById(id);

/** The width a classic scrollbar takes from `node`; 0 where scrollbars overlay the content. */
export const scrollbarWidth = (node) => Math.max(0, (node?.offsetWidth ?? 0) - (node?.clientWidth ?? 0));

/**
 * Make the page inert around `keep`, for a pane that covers it: each child of
 * the body that holds none of `keep`, except the scripts and the notice, which
 * stays live. Returns the function that undoes it. Elements that were inert
 * already stay so.
 */
export function inertAround(...keep) {
  const nodes = [...document.body.children].filter(
    (node) => !keep.some((kept) => node.contains(kept)) && !node.matches("script, .notice") && !node.inert,
  );
  for (const node of nodes) node.inert = true;
  return () => {
    for (const node of nodes) node.inert = false;
  };
}

/* A dialog opens as a modal, or by its attribute where showModal is missing. */
export const isDialogOpen = (dialog) => dialog.open || dialog.hasAttribute("open");
export function openDialog(dialog) {
  if (typeof dialog.showModal !== "function") dialog.setAttribute("open", "");
  else if (!dialog.open) dialog.showModal();
}
export function closeDialog(dialog) {
  if (typeof dialog.close === "function" && dialog.open) dialog.close();
  else dialog.removeAttribute("open");
}

/*
 * Append children as nodes or text. Set known DOM properties directly and other
 * keys as attributes. `style` takes an object of CSSOM properties. A string
 * throws, because the CSP blocks style attributes.
 */
export function h(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined) continue;
    if (key === "class") node.className = value;
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key === "style") {
      if (typeof value !== "object") throw new TypeError("h() takes style as an object of CSSOM properties");
      Object.assign(node.style, value);
    }
    else if (key in node) node[key] = value;
    else node.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child);
  }
  return node;
}

/** `items` without the empty ones, with `separator` between them, for a node's children. */
export const joined = (items, separator) => items.filter(Boolean).flatMap((item, i) => (i ? [separator, item] : [item]));

/* A link out of the explorer: the icon says it opens a new tab, and stays on the line of the link's last word. */
export function externalLink(href, text) {
  const words = String(text);
  const cut = words.lastIndexOf(" ") + 1;
  const tail = h("span", { class: "nowrap" }, words.slice(cut), icon("external-link"));
  return h("a", { class: "external", href, target: "_blank", rel: "noopener noreferrer", title: "Opens in a new tab" }, words.slice(0, cut), tail);
}

const SVG_NS = "http://www.w3.org/2000/svg";
/* Lucide's sprite holds every icon as a symbol named like the icon. */
const ICON_SPRITE = "node_modules/lucide-static/sprite.svg";

/** An SVG element with attributes, and children as nodes or text; null and undefined are skipped. */
export function svg(tag, attrs = {}, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  node.append(...children.filter((child) => child !== null && child !== undefined));
  return node;
}

/** An inline SVG for any lucide-static icon name, drawn in the current text color. */
export function icon(name) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", "icon");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS(SVG_NS, "use");
  use.setAttribute("href", `${ICON_SPRITE}#${name}`);
  svg.append(use);
  return svg;
}

/* Native popovers light-dismiss; anchor positioning keeps one beside its button. */
const POPOVERS = typeof HTMLElement !== "undefined" && "popover" in HTMLElement.prototype;
const ANCHORS = globalThis.CSS?.supports?.("anchor-name: --a") ?? false;
/*
 * The gap between a button and its popover, and how far the popover starts
 * left of the button, in pixels. Match .popover in style.css.
 */
const POPOVER_GAP = 8;
const POPOVER_SHIFT = 10;
/* The arrow keeps this far from the popover's sides, clear of its rounded corners. */
const ARROW_INSET = 12;
let anchors = 0;

/** Place a popover under its button's left edge, or above it when there is no room below. */
function place(node, button) {
  const at = button.getBoundingClientRect();
  const { width, height } = node.getBoundingClientRect();
  const below = at.bottom + POPOVER_GAP;
  const top = below + height <= window.innerHeight ? below : Math.max(0, at.top - POPOVER_GAP - height);
  const left = Math.max(8, Math.min(at.left - POPOVER_SHIFT, window.innerWidth - width - 8));
  Object.assign(node.style, { top: `${top}px`, left: `${left}px` });
}

/** A flick that ends a scroll the page makes carries it on for its speed times this, in ms. */
export const GLIDE_MS = 300;
/* Slower flicks, in px/ms, stop where they are. */
const GLIDE_MIN = 0.1;
/** Movement in px before a gesture counts as vertical or horizontal. */
export const LOCK_PX = 8;
/* A drag's speed is measured over this many ms before its release. */
const SPEED_MS = 100;

/** The gesture's axis once it has moved LOCK_PX, before that null. */
export function lockAxis(dx, dy) {
  if (Math.hypot(dx, dy) < LOCK_PX) return null;
  return Math.abs(dy) > Math.abs(dx) ? "y" : "x";
}

/**
 * A drag's recent positions along y. `speed(time)` is its speed at a release
 * at `time` in px/ms, positive upward. Samples at one instant, which coalesced
 * moves can send, count as 1 ms apart, so they read as a fast flick that
 * scrolls. A finger held still sends no moves, so after a pause it is 0.
 */
export function dragSpeed() {
  const samples = [];
  return {
    add(y, time) {
      samples.push({ y, time });
      while (samples.length > 2 && time - samples[0].time > SPEED_MS) samples.shift();
    },
    speed(time) {
      const last = samples.at(-1);
      const first = samples.find((sample) => time - sample.time <= SPEED_MS) ?? last;
      return last ? (first.y - last.y) / (last.time - first.time || 1) : 0;
    },
  };
}

/** Carry on a scroll of `scroller` that a flick at `velocity` px/ms ended, positive downward through the content. */
export function glide(scroller, velocity) {
  if (Math.abs(velocity) > GLIDE_MIN) scroller.scrollBy?.({ top: velocity * GLIDE_MS, behavior: "smooth" });
}

/* The nearest ancestor of `node` that scrolls vertically, or null. */
function scrollerOf(node) {
  for (let at = node.parentElement; at; at = at.parentElement) {
    const { overflowY } = window.getComputedStyle(at);
    if ((overflowY === "auto" || overflowY === "scroll") && at.scrollHeight > at.clientHeight) return at;
  }
  return null;
}

/*
 * An open popover lies in the top layer, so a scroll that starts on it would
 * reach only the page, which does not scroll. A wheel or a vertical drag on
 * it scrolls the panel under its button instead, until `signal` aborts. A
 * drag that a handler nearer the target took, such as the phone's sheet, or
 * that the browser scrolls itself, is left to them: the window hears it last.
 */
function passScroll(node, button, signal) {
  let drag = null;
  node.addEventListener("wheel", (event) => {
    const scroller = scrollerOf(button);
    if (!scroller || event.ctrlKey) return;
    event.preventDefault();
    scroller.scrollBy({ top: event.deltaY * [1, 16, scroller.clientHeight][event.deltaMode] });
  }, { passive: false, signal });
  node.addEventListener("touchstart", (event) => {
    const [{ clientX, clientY }] = event.touches;
    drag = event.touches.length === 1 ? { x: clientX, y: clientY, axis: null, speed: dragSpeed() } : null;
  }, { passive: true, signal });
  window.addEventListener("touchmove", (event) => {
    if (!drag || event.touches.length !== 1) return;
    if (event.defaultPrevented || !event.cancelable) {
      drag = null;
      return;
    }
    const [{ clientX, clientY }] = event.touches;
    if (!drag.axis) {
      drag.axis = lockAxis(clientX - drag.x, clientY - drag.y);
      if (!drag.axis) return;
      drag.scroller = scrollerOf(button);
      if (drag.axis !== "y" || !drag.scroller) {
        drag = null;
        return;
      }
    }
    event.preventDefault();
    drag.scroller.scrollTop += drag.y - clientY;
    drag.y = clientY;
    drag.speed.add(clientY, event.timeStamp);
  }, { passive: false, signal });
  const end = (event) => {
    const { speed, scroller } = drag ?? {};
    drag = null;
    if (scroller) glide(scroller, speed.speed(event.timeStamp));
  };
  window.addEventListener("touchend", end, { signal });
  window.addEventListener("touchcancel", () => (drag = null), { signal });
}

/** Point the popover's arrow at its button, from whichever side it opened on. */
function aim(node, button) {
  const at = button.getBoundingClientRect();
  const box = node.getBoundingClientRect();
  const x = Math.max(ARROW_INSET, Math.min(at.left + at.width / 2 - box.left, box.width - ARROW_INSET));
  node.dataset.side = box.top >= at.top ? "below" : "above";
  node.style.setProperty("--arrow-x", `${x}px`);
}

/**
 * A popover that `button` toggles, holding `children`. It opens below the
 * button, or above when there is no room, over the page rather than in its
 * flow, and a click elsewhere or Escape closes it. Insert it anywhere.
 */
export function popover(button, className, ...children) {
  const node = h("div", { class: `popover ${className}` }, ...children);
  button.setAttribute("aria-expanded", "false");
  if (!POPOVERS) {
    node.hidden = true;
    button.addEventListener("click", () => {
      node.hidden = !node.hidden;
      button.setAttribute("aria-expanded", String(!node.hidden));
    });
    return node;
  }
  node.popover = "auto";
  button.popoverTargetElement = node;
  if (ANCHORS) {
    const name = `--popover-${(anchors += 1)}`;
    button.style.setProperty("anchor-name", name);
    node.style.setProperty("position-anchor", name);
  }
  /*
   * Without anchors the popover cannot follow a scroll, so a scroll closes it
   * while it is open. With them a scroll can flip it, so the arrow follows.
   */
  let scrolling = null;
  node.addEventListener("toggle", (event) => {
    const open = event.newState === "open";
    button.setAttribute("aria-expanded", String(open));
    scrolling?.abort();
    if (!open) return;
    scrolling = new AbortController();
    const { signal } = scrolling;
    passScroll(node, button, signal);
    if (!ANCHORS) {
      place(node, button);
      aim(node, button);
      window.addEventListener("scroll", () => node.hidePopover(), { capture: true, once: true, signal });
      return;
    }
    aim(node, button);
    let frame = 0;
    const follow = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => aim(node, button));
    };
    window.addEventListener("scroll", follow, { capture: true, passive: true, signal });
    window.addEventListener("resize", follow, { signal });
    signal.addEventListener("abort", () => cancelAnimationFrame(frame));
  });
  return node;
}
