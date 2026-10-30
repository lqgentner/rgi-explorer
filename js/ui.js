/*
 * Map-independent DOM helpers. External text must enter through nodes or
 * textContent, never HTML interpolation.
 */

/*
 * A phone: a screen at most 640px wide. Match the query in style.css.
 */
export const PHONE = window.matchMedia("(max-width: 640px)");

export const el = (id) => document.getElementById(id);

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

const SVG_NS = "http://www.w3.org/2000/svg";
/* Lucide's sprite holds every icon as a symbol named like the icon. */
const ICON_SPRITE = "node_modules/lucide-static/sprite.svg";

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
