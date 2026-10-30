/*
 * The map's controls: the base map and RGI layer switcher, the 3D button with
 * its notice, and the zoom buttons. Each mount function reads PHONE once.
 */

import { GLACIERS, PREVIEWS } from "./previews.js";
import { PALETTE, REGION_DASH, REGION2_MINZOOM, TOGGLE_MINZOOM } from "./styles.js";
import { PHONE, h, icon } from "./ui.js";
import { imageryUrl, viewShapes } from "./viewpreview.js";

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

/* The source layers the previews draw, and their sizes in pixels. */
const PREVIEW_LAYERS = ["glaciers", "region-boundaries", "centerlines", "intersects"];
const PREVIEW_PX = 48;
/* The thumbnail's image, at twice its CSS size. */
const THUMB_PX = 192;
/* How long the map rests before the previews follow it. */
const PREVIEW_DELAY_MS = 500;

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

/* The land behind the previews, near Liberty's own. */
const PREVIEW_LAND = "#eceff1";

const line = (color, width) => ({ fill: "none", stroke: color, "stroke-width": width });
/* A region outline, dashed as on the map. */
const regionLine = (level, color, width) => ({ ...line(color, width), "stroke-dasharray": REGION_DASH[level].map((n) => n * width).join(" ") });
const GLACIER_PAINT = { fill: PALETTE.glacier, stroke: PALETTE.glacierOutline, "stroke-width": 0.5 };

/** The paths each fixed preview draws, bottom first, as `[d, attributes]`. */
function previewPaths(name) {
  if (name === "regions") {
    return [[PREVIEWS.regions.region2, regionLine(2, PALETTE.region2, 0.75)], [PREVIEWS.regions.region1, regionLine(1, PALETTE.region1, 1.25)]];
  }
  if (name === "centerlines") {
    return [
      [GLACIERS, GLACIER_PAINT],
      [PREVIEWS.centerlines.centerline, line(PALETTE.centerline, 0.5)],
      [PREVIEWS.centerlines.centerlineMain, line(PALETTE.centerline, 1.5)],
    ];
  }
  return [[GLACIERS, GLACIER_PAINT], [PREVIEWS.intersects.divide, line(PALETTE.divide, 1.25)]];
}

/**
 * The paths a preview of the view draws, bottom first, as `[shape, attributes]`,
 * or null when none of the toggle's own lines show in the view.
 */
function livePaths(name, shapes, zoom) {
  const pick = (layer, keep, attrs) =>
    (shapes.layers[layer] ?? []).filter((shape) => keep(shape.properties)).map((shape) => [shape, attrs]);
  const all = () => true;
  let own;
  if (name === "regions") {
    own = [
      ...(zoom >= REGION2_MINZOOM ? pick("region-boundaries", (p) => Number(p.level) === 2, regionLine(2, PALETTE.region2, 0.75)) : []),
      ...pick("region-boundaries", (p) => Number(p.level) === 1, regionLine(1, PALETTE.region1, 1.25)),
    ];
  } else if (name === "centerlines") {
    own = [
      ...pick("centerlines", (p) => p.is_main !== true, line(PALETTE.centerline, 0.5)),
      ...pick("centerlines", (p) => p.is_main === true, line(PALETTE.centerline, 1.5)),
    ];
  } else {
    own = pick("intersects", all, line(PALETTE.divide, 1.25));
  }
  if (!own.some(([shape]) => shape.seen)) return null;
  return name === "regions" ? own : [...pick("glaciers", all, GLACIER_PAINT), ...own];
}

/**
 * Draw a toggle's preview into `tile`: the view's own data from `shapes`, or
 * the layer's data at a fixed place when the view holds none of it.
 */
function drawPreview(tile, name, shapes, zoom) {
  const live = shapes ? livePaths(name, shapes, zoom) : null;
  const parts = [svg("rect", { width: PREVIEW_PX, height: PREVIEW_PX, fill: PREVIEW_LAND })];
  const path = (d, attrs) => svg("path", { d, "stroke-linejoin": "round", "stroke-linecap": "round", "fill-rule": "evenodd", ...attrs });
  if (live) {
    const ids = new Map(shapes.clips.map((clip, i) => [clip.key, `preview-${name}-${i}`]));
    parts.push(
      svg(
        "defs",
        {},
        ...shapes.clips.map(({ key, x, y, width, height }) => svg("clipPath", { id: ids.get(key) }, svg("rect", { x, y, width, height }))),
      ),
    );
    for (const [{ clip, d }, attrs] of live) {
      parts.push(path(d, clip ? { ...attrs, "clip-path": `url(#${ids.get(clip)})` } : attrs));
    }
  } else {
    for (const [d, attrs] of previewPaths(name)) parts.push(path(d, attrs));
  }
  tile.replaceChildren(...parts);
  tile.classList.toggle("live", Boolean(live));
}

/** A small picture of what a toggle draws, in the map's colors. */
function preview(name) {
  const tile = svg("svg", { class: "layer-preview", viewBox: `0 0 ${PREVIEW_PX} ${PREVIEW_PX}`, "aria-hidden": "true" });
  drawPreview(tile, name, null, 0);
  return tile;
}

/**
 * Point `img` at `url` once that image has loaded, then call `done(url)`. The
 * old picture stays until then, and for good when the load fails or another
 * call or a direct `src` change comes first.
 */
function swapImage(img, url, done) {
  img.dataset.want = url;
  if (img.getAttribute("src") === url) return;
  const next = document.createElement("img");
  next.addEventListener("load", () => {
    if (img.dataset.want !== url) return;
    img.src = url;
    done(url);
  });
  next.src = url;
}

/** The toggle buttons and the sync functions that update them. */
function toggleButtons({ layers, onToggle, zoom }) {
  const on = new Set(layers);
  const parts = TOGGLES.map(({ name, label }) => {
    const hint = h("span", { class: "layer-hint" });
    const tile = preview(name);
    const button = h(
      "button",
      { type: "button", class: "layer-toggle", dataset: { name } },
      tile,
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
    return { name, button, hint, tile };
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
    /** Redraw the previews from `shapes`, the view's data, or from the fixed data for null. */
    drawPreviews(shapes) {
      const z = zoom();
      for (const { name, tile } of parts) drawPreview(tile, name, shapes, z);
    },
    setLayers(set) {
      on.clear();
      for (const name of set) on.add(name);
      sync();
    },
  };
}

/**
 * Draw the base map and RGI layer controls. With `map`, the previews show the
 * view once the map has rested for PREVIEW_DELAY_MS: the RGI toggles draw the
 * loaded tiles, the imagery picture is one Esri export, and the standard
 * picture comes from `standardPicture(px)`, a promise of an image URL or null.
 * A preview that is hidden catches up when it shows.
 *
 * @returns {{setBase(base: string): void, setLayers(set: Iterable<string>): void, refreshZoom(): void}}
 */
export function mountLayers(root, { base, layers, onBase, onToggle, zoom, map = null, standardPicture = null }) {
  const toggles = toggleButtons({ layers, onToggle, zoom });
  let current = base;
  const api = {
    setLayers: toggles.setLayers,
    refreshZoom: toggles.refreshZoom,
  };

  /* Each base map's picture of the view: a promise of its URL, or of null. */
  const pictureOf = {
    imagery: () => Promise.resolve(imageryUrl(map, THUMB_PX)),
    standard: () => standardPicture?.(THUMB_PX) ?? Promise.resolve(null),
  };
  /* Whether each preview lags the view, and where it shows: set below for the phone or the desktop. */
  let togglesBehind = false;
  const picturesBehind = new Set();
  let togglesShown = () => false;
  let pictureImage = () => null;
  /* The latest picture of the view that loaded, by base map. */
  const latest = {};

  /** Bring the previews that show up to the view. */
  function catchUp() {
    if (!map) return;
    if (togglesBehind && togglesShown()) {
      togglesBehind = false;
      toggles.drawPreviews(viewShapes(map, PREVIEW_LAYERS, PREVIEW_PX));
    }
    for (const key of picturesBehind) {
      const img = pictureImage(key);
      if (!img) continue;
      picturesBehind.delete(key);
      pictureOf[key]().then((url) => {
        /* The image may show the other base map by now. */
        if (url && pictureImage(key) === img) swapImage(img, url, (loaded) => {
          latest[key] = loaded;
        });
      });
    }
  }
  /* Mark every preview behind the view, and catch up the ones that show. */
  const follow = () => {
    togglesBehind = true;
    for (const key of Object.keys(BASES)) picturesBehind.add(key);
    catchUp();
  };
  if (map) {
    let timer = null;
    map.on("movestart", () => clearTimeout(timer));
    map.on("idle", () => {
      clearTimeout(timer);
      timer = setTimeout(follow, PREVIEW_DELAY_MS);
    });
  }

  if (PHONE.matches) {
    const tiles = Object.entries(BASES).map(([key, { label, image }]) => {
      const img = h("img", { src: image, alt: "", width: 48, height: 48 });
      const button = h(
        "button",
        { type: "button", class: "base-tile" },
        img,
        h("span", { class: "layer-name" }, label),
      );
      button.addEventListener("click", () => {
        current = key;
        syncBase();
        onBase(key);
      });
      return { key, button, img };
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
      catchUp();
      close.focus();
    });
    togglesShown = () => !pane.hidden;
    pictureImage = (key) => (pane.hidden ? null : tiles.find((t) => t.key === key).img);
    const closePane = () => {
      pane.hidden = true;
      open.focus();
    };
    close.addEventListener("click", closePane);
    pane.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closePane();
    });
    /*
     * The pane goes in the body. Inside root it would share root's stacking
     * context, which sits below the bottom sheet.
     */
    root.append(open);
    document.body.append(pane);
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
    image.src = latest[other()] ?? BASES[other()].image;
    image.dataset.want = image.src;
    caption.textContent = BASES[other()].label;
    thumb.setAttribute("aria-label", `Show ${BASES[other()].label} map`);
    picturesBehind.add(other());
    catchUp();
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
    catchUp();
  };
  togglesShown = () => !panel.hidden;
  pictureImage = (key) => (other() === key ? image : null);
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
