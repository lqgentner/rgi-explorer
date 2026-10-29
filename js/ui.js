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
