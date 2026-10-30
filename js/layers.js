/*
 * The map's controls: the base map and RGI layer switcher, the 3D button with
 * its notice, and the zoom buttons. Each mount function reads PHONE once.
 */

import { GLACIERS, PREVIEWS } from "./previews.js";
import { PALETTE, REGION_DASH, TOGGLE_MINZOOM } from "./styles.js";
import { PHONE, h, icon } from "./ui.js";
import { imageryUrl } from "./viewpreview.js";

const SVG_NS = "http://www.w3.org/2000/svg";

const BASES = {
  standard: { label: "Standard", image: "assets/base-standard.webp" },
  imagery: { label: "Imagery", image: "assets/base-imagery.webp" },
};

const TOGGLES = [
  { name: "regions", label: "RGI regions" },
  { name: "centerlines", label: "Centerlines" },
  { name: "intersects", label: "Intersects" },
];

/* The previews' size in pixels: the square that js/previews.js draws in. */
const PREVIEW_PX = 48;
/* The thumbnail's image, at twice its CSS size. */
const THUMB_PX = 192;
/* How long the map rests before the base map pictures follow it. */
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
/* A region outline, dashed as on the map but finer, to read at the preview's small size. */
const PREVIEW_DASH = 0.5;
const regionLine = (level, color, width) => ({
  ...line(color, width),
  "stroke-dasharray": REGION_DASH[level].map((n) => n * width * PREVIEW_DASH).join(" "),
});
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

/** A small picture of what a toggle draws, in the map's colors, from js/previews.js. */
function preview(name) {
  const path = ([d, attrs]) =>
    svg("path", { d, "stroke-linejoin": "round", "stroke-linecap": "round", "fill-rule": "evenodd", ...attrs });
  return svg(
    "svg",
    { class: "layer-preview", viewBox: `0 0 ${PREVIEW_PX} ${PREVIEW_PX}`, "aria-hidden": "true" },
    svg("rect", { width: PREVIEW_PX, height: PREVIEW_PX, fill: PREVIEW_LAND }),
    ...previewPaths(name).map(path),
  );
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

/**
 * The toggle buttons and the sync functions that update them. With `hints`,
 * a toggle whose layer has no data at the zoom says from which zoom it shows.
 */
function toggleButtons({ layers, onToggle, zoom, hints }) {
  const on = new Set(layers);
  const parts = TOGGLES.map(({ name, label }) => {
    const hint = hints ? h("span", { class: "layer-hint" }) : null;
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
      if (!hint) continue;
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
 * Draw the base map and RGI layer controls. The RGI toggles show fixed
 * previews. With `map`, the base map pictures show the view once the map has
 * rested for PREVIEW_DELAY_MS: the imagery picture is one Esri export, and the
 * standard picture comes from `standardPicture(px)`, a promise of an image URL
 * or null. A picture that is hidden catches up when it shows.
 *
 * @returns {{setBase(base: string): void, setLayers(set: Iterable<string>): void, refreshZoom(): void}}
 */
export function mountLayers(root, { base, layers, onBase, onToggle, zoom, map = null, standardPicture = null }) {
  /* The desktop panel keeps to one row of tiles and leaves the zoom hints out. */
  const toggles = toggleButtons({ layers, onToggle, zoom, hints: PHONE.matches });
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
  /* The pictures that lag the view, and where each shows: set below for the phone or the desktop. */
  const picturesBehind = new Set();
  let pictureImage = () => null;
  /* The latest picture of the view that loaded, by base map. */
  const latest = {};

  /** Bring the pictures that show up to the view. */
  function catchUp() {
    if (!map) return;
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
  /* Mark every picture behind the view, and catch up the ones that show. */
  const follow = () => {
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
  const badge = h("span", { class: "layers-badge" }, icon("layers-2"), "Layers");
  /* Closed, the picture says "Layers"; open, it names the map a click swaps to. */
  const caption = h("span", { class: "layers-caption" });
  const thumb = h("button", { type: "button", class: "layers-thumb" }, h("span", { class: "layers-picture" }, image, badge, caption));
  const other = () => (current === "standard" ? "imagery" : "standard");
  const syncThumb = () => {
    image.src = latest[other()] ?? BASES[other()].image;
    image.dataset.want = image.src;
    caption.textContent = BASES[other()].label;
    /* The name starts with the visible "Layers", which the open control swaps for the map's name. */
    thumb.setAttribute("aria-label", `Layers: show ${BASES[other()].label} map`);
    picturesBehind.add(other());
    catchUp();
  };
  syncThumb();

  /* The panel stays in the page to slide open; it is inert while closed. */
  const panel = h("div", { class: "layers-panel" }, h("div", { class: "layers-drawer" }, toggles.buttons));
  const wrapper = h("div", { class: "layers" }, thumb, panel);
  /*
   * A mouse opens the control while it rests on it, and focus while it stays
   * inside. A touch has no hover: a tap on the closed control opens it, and
   * the thumbnail swaps the base map only when it was open at the press. A
   * press elsewhere closes it. A mouse that leaves keeps it open while
   * keyboard focus is inside.
   */
  const isOpen = () => wrapper.classList.contains("open");
  const setOpen = (open) => {
    thumb.setAttribute("aria-expanded", String(open));
    panel.toggleAttribute("inert", !open);
    wrapper.classList.toggle("open", open);
    catchUp();
  };
  setOpen(false);
  let openAtPress = null;
  pictureImage = (key) => (other() === key ? image : null);
  wrapper.addEventListener("pointerenter", (event) => {
    if (event.pointerType !== "touch") setOpen(true);
  });
  wrapper.addEventListener("pointerleave", (event) => {
    if (event.pointerType !== "touch" && !wrapper.querySelector(":focus-visible")) setOpen(false);
  });
  wrapper.addEventListener("focusin", () => setOpen(true));
  wrapper.addEventListener("focusout", (event) => {
    if (!wrapper.contains(event.relatedTarget) && !wrapper.matches(":hover")) setOpen(false);
  });
  document.addEventListener("pointerdown", (event) => {
    if (!wrapper.contains(event.target)) setOpen(false);
  });
  thumb.addEventListener("pointerdown", () => {
    openAtPress = isOpen();
  });
  thumb.addEventListener("pointercancel", () => {
    openAtPress = null;
  });
  /* A click from the keyboard has no press of its own, and detail 0. */
  thumb.addEventListener("click", (event) => {
    const wasOpen = event.detail === 0 ? isOpen() : openAtPress ?? isOpen();
    openAtPress = null;
    if (!wasOpen) {
      setOpen(true);
      return;
    }
    current = other();
    syncThumb();
    onBase(current);
  });
  wrapper.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    thumb.focus();
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
