/*
 * The map's controls: the base map and RGI layer switcher, the 3D button,
 * the zoom buttons and the locate button. Each draws once for both layouts and
 * follows PHONE as it changes; style.css shows the layout's own parts.
 */

import { GLACIERS, PREVIEWS } from "./previews.js";
import { PALETTE, REGION_DASH } from "./styles.js";
import { PHONE, h, icon, inertAround, svg } from "./ui.js";
import { imageryUrl } from "./viewpreview.js";

const BASES = {
  standard: { label: "Standard" },
  imagery: { label: "Imagery" },
};

const TOGGLES = [
  { name: "regions", label: "Glacier regions" },
  { name: "centerlines", label: "Centerlines" },
  { name: "intersects", label: "Intersects" },
];

/* The previews' size in pixels: the square that js/previews.js draws in. */
const PREVIEW_PX = 48;
/* The thumbnail's image, at twice its CSS size. */
const THUMB_PX = 192;
/* How long the map rests before the base map pictures follow it. */
const PREVIEW_DELAY_MS = 500;


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

/** The toggle buttons and the sync function that updates them. */
function toggleButtons({ layers, onToggle }) {
  const on = new Set(layers);
  const parts = TOGGLES.map(({ name, label }) => {
    const button = h(
      "button",
      { type: "button", class: "layer-toggle", dataset: { name } },
      preview(name),
      h("span", { class: "layer-name" }, label),
    );
    button.addEventListener("click", () => {
      const next = !on.has(name);
      if (next) on.add(name);
      else on.delete(name);
      sync();
      onToggle(name, next);
    });
    return { name, button };
  });

  function sync() {
    for (const { name, button } of parts) button.setAttribute("aria-pressed", String(on.has(name)));
  }
  sync();

  return {
    buttons: parts.map((p) => p.button),
    setLayers(set) {
      on.clear();
      for (const name of set) on.add(name);
      sync();
    },
  };
}

/** A one-pixel picture in `color`, for a picture that has not loaded yet. */
const swatch = (color = "transparent") =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1" fill="${color}"/></svg>`,
  )}`;

/**
 * Draw the base map and RGI layer controls: on desktop the other base map's
 * picture, which opens a drawer of toggles; on the phone a round button that
 * opens a pane. Both are drawn once, and a change of layout moves the toggles
 * across and closes the control left behind. The RGI toggles show fixed
 * previews. Each base map picture starts as the map's plain background from
 * `backgrounds`, `{ standard, imagery }`, as the map shows before its tiles
 * arrive. With `map`, the pictures show the view once the map has rested for
 * PREVIEW_DELAY_MS: the imagery picture is one Esri export, and the standard
 * picture comes from `standardPicture(px)`, a promise of an image URL or null.
 * A picture that is hidden catches up when it shows. `onPane(open)` hears the
 * phone's pane open and close. Without `map`, the control draws before the map
 * exists, and `attach({ map, standardPicture, backgrounds })` hands it the map
 * once it does.
 *
 * @returns {{setBase(base: string): void, setLayers(set: Iterable<string>): void, attach(next: {map: any, standardPicture?: (px: number) => Promise<string | null>, backgrounds?: object}): void}}
 */
export function mountLayers(root, { base, layers, onBase, onToggle, onPane, map = null, standardPicture = null, backgrounds = {} }) {
  const toggles = toggleButtons({ layers, onToggle });
  let current = base;
  const other = () => (current === "standard" ? "imagery" : "standard");

  /* Each base map's picture of the view: a promise of its URL, or of null. */
  const pictureOf = {
    imagery: () => Promise.resolve(imageryUrl(map, THUMB_PX)),
    standard: () => standardPicture?.(THUMB_PX) ?? Promise.resolve(null),
  };
  /* The pictures that lag the view. */
  const picturesBehind = new Set();
  /* The latest picture of the view that loaded, by base map. */
  const latest = {};
  const pictureSrc = (key) => latest[key] ?? swatch(backgrounds[key]);

  /* The phone's pane: the base map tiles and the toggles, opened by a round button. */
  const tiles = Object.entries(BASES).map(([key, { label }]) => {
    const img = h("img", { src: pictureSrc(key), alt: "", width: 48, height: 48 });
    const button = h("button", { type: "button", class: "base-tile" }, img, h("span", { class: "layer-name" }, label));
    button.addEventListener("click", () => {
      current = key;
      syncBase();
      onBase(key);
    });
    return { key, button, img };
  });
  const close = h("button", { type: "button", class: "icon-button pane-close", "aria-label": "Close", dataset: { tour: "layers-close" } }, icon("x"));
  const paneToggles = h("div", { class: "tile-row" });
  /* No title: the close button sits in the first section's heading row, and a line parts the sections. */
  const pane = h(
    "div",
    { class: "layers-pane", role: "group", "aria-label": "Layers", hidden: true },
    h(
      "section",
      { class: "pane-section" },
      h("div", { class: "pane-header" }, h("h3", {}, "Map type"), close),
      h("div", { class: "tile-row" }, tiles.map((t) => t.button)),
    ),
    h("section", { class: "pane-section" }, h("h3", {}, "RGI layers"), paneToggles),
  );
  const openPane = h("button", { type: "button", class: "round-button layers-open", "aria-label": "Layers", dataset: { tour: "layers-phone" } }, icon("layers-2"));

  /* The desktop's control: the other base map's picture, and a drawer of toggles beside it. */
  const image = h("img", { alt: "", width: 96, height: 96 });
  const badge = h("span", { class: "layers-badge" }, icon("layers-2"), "Layers");
  /* Closed, the picture says "Layers"; open, it names the map a click swaps to. */
  const caption = h("span", { class: "layers-caption" });
  const thumb = h("button", { type: "button", class: "layers-thumb", dataset: { tour: "layers-desktop" } }, h("span", { class: "layers-picture" }, image, badge, caption));
  const drawer = h("div", { class: "layers-drawer" });
  /* The panel stays in the page to slide open; it is inert while closed. */
  const panel = h("div", { class: "layers-panel" }, drawer);
  const wrapper = h("div", { class: "layers" }, thumb, panel);

  /** The image that shows the picture of `key` now, or null when none shows. */
  const pictureImage = (key) => {
    if (PHONE.matches) return pane.hidden ? null : tiles.find((t) => t.key === key).img;
    return other() === key ? image : null;
  };

  /* The first pictures of the view wait for the map's first rest. */
  let started = false;

  /** Bring the pictures that show up to the view. */
  function catchUp() {
    if (!map || !started) return;
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
  const listen = () => {
    let timer = null;
    map.on("movestart", () => clearTimeout(timer));
    map.on("idle", () => {
      clearTimeout(timer);
      timer = setTimeout(follow, PREVIEW_DELAY_MS);
    });
  };
  if (map) listen();

  const syncBase = () => {
    for (const { key, button } of tiles) button.setAttribute("aria-pressed", String(key === current));
    image.src = pictureSrc(other());
    image.dataset.want = image.src;
    caption.textContent = BASES[other()].label;
    /* The name starts with the visible "Layers", which the open control swaps for the map's name. */
    thumb.setAttribute("aria-label", `Layers: show ${BASES[other()].label} map`);
    picturesBehind.add(other());
    catchUp();
  };

  /*
   * While the pane is open a scrim darkens the page behind it, and the rest of
   * the page is inert. A tap on the scrim closes the pane. The notice stays
   * live, and the elements that were inert already stay so.
   */
  const scrim = h("div", { class: "layers-scrim", hidden: true });
  let restore = null;
  const showPane = (show) => {
    if (show === !pane.hidden) return;
    pane.hidden = !show;
    scrim.hidden = !show;
    if (show) restore = inertAround(pane, scrim);
    else restore?.();
    /* Heard after each real change, so the tour can ask the reader to close the pane. */
    onPane?.(show);
  };

  openPane.addEventListener("click", () => {
    showPane(true);
    catchUp();
    close.focus();
  });
  const closePane = () => {
    showPane(false);
    openPane.focus();
  };
  close.addEventListener("click", closePane);
  scrim.addEventListener("click", closePane);
  pane.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closePane();
  });

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
  let openAtPress = null;
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
    syncBase();
    onBase(current);
  });
  wrapper.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    thumb.focus();
    setOpen(false);
  });

  /* Draw every picture afresh, from the latest that loaded or the map's background. */
  const drawPictures = () => {
    for (const tile of tiles) tile.img.src = pictureSrc(tile.key);
    for (const key of Object.keys(BASES)) picturesBehind.add(key);
    syncBase();
  };

  /*
   * The toggles go where the layout shows them, the control left behind
   * closes, and the pictures that now show catch up with the latest.
   */
  const place = () => {
    if (PHONE.matches) {
      setOpen(false);
      paneToggles.append(...toggles.buttons);
    } else {
      showPane(false);
      drawer.append(...toggles.buttons);
    }
    drawPictures();
  };
  PHONE.addEventListener("change", place);
  setOpen(false);
  place();
  started = true;

  /*
   * The pane and its scrim go in the body. Inside root they would share
   * root's stacking context, which sits below the bottom sheet.
   */
  root.append(wrapper, openPane);
  document.body.append(scrim, pane);

  return {
    setLayers: toggles.setLayers,
    setBase(next) {
      current = next;
      syncBase();
    },
    /*
     * The pictures take the map's backgrounds now, and follow its view from
     * its first rest, as when the map comes with the mount.
     */
    attach(next) {
      backgrounds = next.backgrounds ?? {};
      drawPictures();
      map = next.map;
      standardPicture = next.standardPicture ?? null;
      listen();
    },
  };
}

/**
 * Draw the 3D button, a toggle that reads "3D" and stays pressed while 3D is on.
 *
 * @returns {{set(on: boolean): void}}
 */
export function mountTerrain(root, { on, onChange }) {
  let state = false;

  const button = h("button", { type: "button", class: "terrain-btn", "aria-label": "3D terrain", title: "3D terrain" }, "3D");
  root.append(button);

  const apply = (next) => {
    state = next;
    button.setAttribute("aria-pressed", String(next));
  };
  button.addEventListener("click", () => {
    apply(!state);
    onChange(state);
  });
  apply(Boolean(on));

  return { set: apply };
}

/**
 * Draw the zoom in and zoom out buttons, set in 3D's font rather than as icons.
 * The phone is touch only, and style.css hides them there.
 */
export function mountZoom(root, rgiMap) {
  const zoomButton = (text, label, action) => {
    const button = h("button", { type: "button", class: "zoom-btn", "aria-label": label, title: label }, text);
    button.addEventListener("click", action);
    return button;
  };
  root.append(
    h(
      "div",
      { class: "zoom-control" },
      zoomButton("+", "Zoom in", () => rgiMap.zoomIn()),
      zoomButton("\u2212", "Zoom out", () => rgiMap.zoomOut()),
    ),
  );
}

/**
 * Draw the button that shows the reader's location, in both layouts; `onLocate` hears its presses.
 *
 * @returns {HTMLElement}
 */
export function mountLocate(root, { onLocate }) {
  const button = h("button", { type: "button", class: "locate-btn", "aria-label": "Show my location", title: "Show my location" }, icon("locate-fixed"));
  button.addEventListener("click", onLocate);
  root.append(button);
  return button;
}
