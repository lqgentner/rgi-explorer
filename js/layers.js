/*
 * The map's controls: the base map and RGI layer switcher, the 3D button with
 * its notice, and the zoom buttons. Each mount function reads PHONE once.
 */

import { TOGGLE_MINZOOM } from "./styles.js";
import { PHONE, h, icon } from "./ui.js";

const SVG_NS = "http://www.w3.org/2000/svg";

const BASES = {
  standard: { label: "Standard", image: "assets/base-standard.webp" },
  imagery: { label: "Imagery", image: "assets/base-imagery.webp" },
};

const TOGGLES = [
  { name: "regions", label: "RGI regions" },
  { name: "centerlines", label: "Centerlines" },
  { name: "intersects", label: "Ice divides" },
];

const NOTICE_KEY = "rgi-explorer.terrain-notice";
const NOTICE_TEXT =
  "3D terrain is newer than the RGI outlines. Mapterhorn elevation and the outlines come from different years, so edges may not match.";

/** An SVG element with attributes. */
function svg(tag, attrs = {}, ...children) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  node.append(...children);
  return node;
}

/** A small inline picture of what a toggle draws. */
function preview(name) {
  const tile = svg("svg", { class: "layer-preview", viewBox: "0 0 48 48", "aria-hidden": "true" }, svg("rect", { width: 48, height: 48, fill: "#e8eaed" }));
  if (name === "regions") {
    tile.append(
      svg("path", { d: "M4 10 L24 4 L30 22 L10 28 Z", fill: "#a8c7fa", stroke: "#1a73e8", "stroke-width": 1.5 }),
      svg("path", { d: "M26 24 L44 18 L44 42 L20 44 Z", fill: "#c4eed0", stroke: "#188038", "stroke-width": 1.5 }),
    );
  } else if (name === "centerlines") {
    tile.append(
      svg("path", { d: "M8 8 C20 16 16 28 26 40", fill: "none", stroke: "#1a73e8", "stroke-width": 2 }),
      svg("path", { d: "M30 6 C32 18 40 24 40 38", fill: "none", stroke: "#1a73e8", "stroke-width": 2 }),
    );
  } else {
    tile.append(
      svg("path", { d: "M6 40 L20 10 L30 26 L42 8", fill: "none", stroke: "#202124", "stroke-width": 2, "stroke-dasharray": "4 3" }),
      svg("path", { d: "M10 14 L38 36", fill: "none", stroke: "#202124", "stroke-width": 2, "stroke-dasharray": "4 3" }),
    );
  }
  return tile;
}

/** The toggle buttons and the sync functions that update them. */
function toggleButtons({ layers, onToggle, zoom }) {
  const on = new Set(layers);
  const parts = TOGGLES.map(({ name, label }) => {
    const hint = h("span", { class: "layer-hint" });
    const button = h(
      "button",
      { type: "button", class: "layer-toggle", dataset: { name } },
      preview(name),
      h("span", { class: "layer-name" }, label),
      hint,
    );
    button.addEventListener("click", () => {
      const next = !on.has(name);
      if (next) on.add(name);
      else on.delete(name);
      sync();
      onToggle(name, next);
    });
    return { name, button, hint };
  });

  function sync() {
    for (const { name, button } of parts) button.setAttribute("aria-pressed", String(on.has(name)));
  }
  function refreshZoom() {
    const z = zoom();
    for (const { name, hint } of parts) {
      const from = TOGGLE_MINZOOM[name];
      hint.textContent = z < from ? `visible from zoom ${from}` : "";
    }
  }
  sync();
  refreshZoom();

  return {
    buttons: parts.map((p) => p.button),
    refreshZoom,
    setLayers(set) {
      on.clear();
      for (const name of set) on.add(name);
      sync();
    },
  };
}

/**
 * Draw the base map and RGI layer controls.
 *
 * @returns {{setBase(base: string): void, setLayers(set: Iterable<string>): void, refreshZoom(): void}}
 */
export function mountLayers(root, { base, layers, onBase, onToggle, zoom }) {
  const toggles = toggleButtons({ layers, onToggle, zoom });
  let current = base;
  const api = {
    setLayers: toggles.setLayers,
    refreshZoom: toggles.refreshZoom,
  };

  if (PHONE.matches) {
    const tiles = Object.entries(BASES).map(([key, { label, image }]) => {
      const button = h(
        "button",
        { type: "button", class: "base-tile" },
        h("img", { src: image, alt: "", width: 48, height: 48 }),
        h("span", { class: "layer-name" }, label),
      );
      button.addEventListener("click", () => {
        current = key;
        syncBase();
        onBase(key);
      });
      return { key, button };
    });
    const syncBase = () => {
      for (const { key, button } of tiles) button.setAttribute("aria-pressed", String(key === current));
    };
    syncBase();

    const close = h("button", { type: "button", class: "icon-button", "aria-label": "Close" }, icon("x"));
    const pane = h(
      "div",
      { class: "layers-pane", hidden: true },
      h("div", { class: "pane-header" }, h("h2", {}, "Layers"), close),
      h("h3", {}, "Map type"),
      h("div", { class: "tile-row" }, tiles.map((t) => t.button)),
      h("h3", {}, "RGI layers"),
      h("div", { class: "tile-row" }, toggles.buttons),
    );
    const open = h("button", { type: "button", class: "round-button", "aria-label": "Layers" }, icon("layers-2"));
    open.addEventListener("click", () => {
      pane.hidden = false;
      close.focus();
    });
    const closePane = () => {
      pane.hidden = true;
      open.focus();
    };
    close.addEventListener("click", closePane);
    pane.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closePane();
    });
    root.append(open, pane);
    api.setBase = (next) => {
      current = next;
      syncBase();
    };
    return api;
  }

  const image = h("img", { alt: "", width: 96, height: 96 });
  const caption = h("span", { class: "layers-caption" });
  const thumb = h("button", { type: "button", class: "layers-thumb" }, image, caption);
  const other = () => (current === "standard" ? "imagery" : "standard");
  const syncThumb = () => {
    image.src = BASES[other()].image;
    caption.textContent = BASES[other()].label;
    thumb.setAttribute("aria-label", `Show ${BASES[other()].label} map`);
  };
  syncThumb();
  thumb.addEventListener("click", () => {
    current = other();
    syncThumb();
    onBase(current);
  });

  const chevron = h(
    "button",
    { type: "button", class: "layers-chevron", "aria-label": "Layer options", "aria-expanded": "false" },
    icon("chevron-right"),
  );
  const panel = h("div", { class: "layers-panel", hidden: true }, toggles.buttons);
  const wrapper = h("div", { class: "layers" }, thumb, panel, chevron);
  /* A click pins the panel open. Hover and focus open it only while they last. */
  let pinned = false;
  const setOpen = (open) => {
    if (!open) pinned = false;
    panel.hidden = !open;
    chevron.setAttribute("aria-expanded", String(open));
    wrapper.classList.toggle("open", open);
  };
  wrapper.addEventListener("pointerenter", () => setOpen(true));
  wrapper.addEventListener("pointerleave", () => {
    if (!pinned) setOpen(false);
  });
  wrapper.addEventListener("focusin", () => setOpen(true));
  wrapper.addEventListener("focusout", (event) => {
    if (!wrapper.contains(event.relatedTarget)) setOpen(false);
  });
  chevron.addEventListener("click", () => {
    if (panel.hidden || !pinned) {
      setOpen(true);
      pinned = true;
    } else {
      setOpen(false);
    }
  });
  wrapper.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    chevron.focus();
    setOpen(false);
  });
  root.append(wrapper);
  api.setBase = (next) => {
    current = next;
    syncThumb();
  };
  return api;
}

/** Read a session value, or null when storage is unavailable. */
function readSession(key) {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSession(key, value) {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    /* The notice stays dismissed for this page only. */
  }
}

/**
 * Draw the 3D button. A notice about the terrain's age shows the first time 3D
 * turns on, until the reader dismisses it for the session.
 *
 * @returns {{set(on: boolean): void}}
 */
export function mountTerrain(root, { on, onChange }) {
  let state = false;
  let shown = false;
  let notice = null;

  const button = h("button", { type: "button", class: "terrain-btn", "aria-pressed": "false" }, "3D");
  root.append(button);

  const hideNotice = () => {
    notice?.remove();
    notice = null;
  };
  const showNotice = () => {
    if (shown || readSession(NOTICE_KEY) === "dismissed") return;
    shown = true;
    const dismiss = h("button", { type: "button", class: "icon-button", "aria-label": "Dismiss" }, icon("x"));
    dismiss.addEventListener("click", () => {
      hideNotice();
      writeSession(NOTICE_KEY, "dismissed");
    });
    notice = h("div", { class: "terrain-notice", role: "status" }, h("p", {}, NOTICE_TEXT), dismiss);
    root.append(notice);
  };
  const apply = (next) => {
    state = next;
    button.setAttribute("aria-pressed", String(next));
    if (next) showNotice();
    else hideNotice();
  };
  button.addEventListener("click", () => {
    apply(!state);
    onChange(state);
  });
  apply(Boolean(on));

  return { set: apply };
}

/** Draw the zoom in and zoom out buttons. The phone is touch only and gets none. */
export function mountZoom(root, rgiMap) {
  if (PHONE.matches) return;
  const zoomButton = (name, label, action) => {
    const button = h("button", { type: "button", class: "zoom-btn", "aria-label": label }, icon(name));
    button.addEventListener("click", action);
    return button;
  };
  root.append(
    h(
      "div",
      { class: "zoom-control" },
      zoomButton("plus", "Zoom in", () => rgiMap.map.zoomIn()),
      zoomButton("minus", "Zoom out", () => rgiMap.map.zoomOut()),
    ),
  );
}
