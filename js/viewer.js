/*
 * The image viewer: a modal dialog that shows the strip's images whole, one
 * at a time. Each image's large file and credit are fetched only when it is
 * shown, once. The credit and ‹ n / N › sit in one dock fixed under the
 * images and ✕ in the corner, so no control moves from image to image. Swipe,
 * the arrow keys or the arrows (desktop only) move between images; Escape, ✕
 * and, on the desktop, a click outside the image close it.
 */

import { closeDialog, h, icon, isDialogOpen, openDialog, PHONE } from "./ui.js";

/**
 * @typedef {object} ViewerItem
 * @property {string} alt
 * @property {string} [thumb]  shown until the large file arrives
 * @property {number} [ratio]  width / height, when known before anything loads: a placeholder of that shape shows meanwhile
 * @property {() => Promise<string | null> | string | null} large
 * @property {() => Node} credit
 */

let dialog = null;
let track = null;
let prev = null;
let next = null;
let closeButton = null;
let credit = null;
let controls = null;
let count = null;
/* Tells a screen reader what the shown image is, and its place, as it changes. */
let status = null;
/* The phone's background: two blurred layers behind the track, cross-faded, so a swipe does not move it. */
let backdrops = [];
/* The picture the background should show; a layer fades in only once this has loaded. */
let wanted = null;
/* The slide an arrow's smooth scroll is heading to: until it gets there, the scroll does not choose the current image. */
let aiming = null;
/** The open viewer: { items, slides, srcs, credits, index, loaded, onClose, returnFocus }. */
let state = null;

const isOpen = () => Boolean(dialog && isDialogOpen(dialog));

/* Who hears the viewer open and close: the tour. */
const toggleListeners = new Set();

/** Hear the viewer open (`fn(true)`) and close (`fn(false)`), by any route. */
export function onViewerToggle(fn) {
  toggleListeners.add(fn);
}

function show() {
  const was = isOpen();
  openDialog(dialog);
  if (!was) for (const fn of toggleListeners) fn(true);
}

function hide() {
  const was = isOpen();
  closeDialog(dialog);
  if (was) for (const fn of toggleListeners) fn(false);
}

/*
 * Close, then let the caller show the image closed on, then focus it without
 * scrolling: the browser's own focus restore and a scrolling focus would both
 * bring back the image that opened the viewer.
 */
function close() {
  if (!state) return;
  const { index, onClose, returnFocus } = state;
  state = null;
  hide();
  onClose?.(index);
  const target = typeof returnFocus === "function" ? returnFocus(index) : returnFocus;
  target?.focus({ preventScroll: true });
}

/** Fill slide `i` the first time it is shown: its stand-in, its large file and its credit. */
function load(i) {
  const mine = state;
  if (mine.loaded.has(i)) return;
  mine.loaded.add(i);
  const item = mine.items[i];
  const { img } = mine.slides[i];
  const setSrc = (src) => {
    img.src = src;
    mine.srcs[i] = src;
    if (mine.index === i) backdrop(src);
  };
  if (item.thumb) setSrc(item.thumb);
  mine.credits[i] = item.credit();
  let answer;
  try {
    answer = item.large();
  } catch {
    return;
  }
  Promise.resolve(answer)
    .then((url) => {
      if (url && state === mine) setSrc(url);
    })
    .catch(() => {});
}

/*
 * Fade the background to a blur of `src`, the slide's own file, so it costs
 * no download of its own. The hidden layer takes the new picture and, once
 * it has loaded, fades in on top; until then the shown colours stay.
 */
function backdrop(src) {
  if (!src || src === wanted) return;
  wanted = src;
  const shown = backdrops.find((layer) => layer.classList.contains("on"));
  if (shown?.getAttribute("src") === src) return;
  backdrops.find((layer) => layer !== shown).src = src;
}

/* A layer's picture has loaded: if it is still the one wanted, it goes on top and fades in. The other fades out after it (style.css). */
function reveal(layer) {
  if (!state || layer.getAttribute("src") !== wanted || layer.classList.contains("on")) return;
  const other = backdrops.find((l) => l !== layer);
  dialog.insertBefore(layer, track);
  layer.classList.add("on");
  other.classList.remove("on");
}

function scrollTo(i, smooth) {
  const { figure } = state.slides[i];
  const left = figure.offsetLeft;
  if (typeof track.scrollTo === "function") track.scrollTo({ left, behavior: smooth ? "smooth" : "instant" });
  else track.scrollLeft = left;
}

/** Make image `i` the current one; `scroll` moves the track there too. */
function go(i, { scroll = true, smooth = false } = {}) {
  if (!state) return;
  const index = Math.max(0, Math.min(state.items.length - 1, i));
  state.index = index;
  state.slides.forEach(({ figure }, j) => figure.classList.toggle("current", j === index));
  /* Disabled, not hidden, at the ends: the controls keep their places. */
  const focused = document.activeElement;
  prev.disabled = index === 0;
  next.disabled = index === state.items.length - 1;
  /* A disabled arrow would drop focus to the page: hand it to the other arrow, or ✕. */
  if (focused === next && next.disabled) (prev.disabled ? closeButton : prev).focus();
  else if (focused === prev && prev.disabled) (next.disabled ? closeButton : next).focus();
  count.textContent = `${index + 1} / ${state.items.length}`;
  const { alt } = state.items[index];
  status.textContent = state.items.length > 1 ? `${alt}, image ${index + 1} of ${state.items.length}` : alt;
  load(index);
  /* The neighbours' thumbnails are already loaded by the strip: show them, so a swipe never reveals an empty slide. */
  for (const j of [index - 1, index + 1]) {
    const img = state.slides[j]?.img;
    if (img && !img.getAttribute("src") && state.items[j].thumb) img.src = state.items[j].thumb;
  }
  credit.replaceChildren(state.credits[index]);
  backdrop(state.srcs[index]);
  aiming = scroll && smooth ? index : null;
  if (scroll) scrollTo(index, smooth);
}

function build() {
  closeButton = h("button", { type: "button", class: "icon-button viewer-close", "aria-label": "Close" }, icon("x"));
  /* Not a Tab stop: Chromium would otherwise focus the scroller and ring the whole screen. */
  track = h("div", { class: "viewer-track", tabindex: "-1" });
  prev = h("button", { type: "button", class: "icon-button viewer-prev", "aria-label": "Previous image" }, icon("chevron-left"));
  next = h("button", { type: "button", class: "icon-button viewer-next", "aria-label": "Next image" }, icon("chevron-right"));
  credit = h("div", { class: "viewer-credit" });
  count = h("span", { class: "viewer-count", "aria-hidden": "true" });
  status = h("span", { class: "viewer-status visually-hidden", "aria-live": "polite" });
  controls = h("div", { class: "viewer-controls" }, prev, count, next);
  const dock = h("div", { class: "viewer-dock" }, credit, controls, status);
  backdrops = [0, 1].map(() => h("img", { class: "viewer-backdrop", alt: "", "aria-hidden": "true" }));
  for (const layer of backdrops) layer.addEventListener("load", () => reveal(layer));
  dialog = h("dialog", { class: "viewer", "aria-label": "Images" }, ...backdrops, track, dock, closeButton);
  document.body.append(dialog);

  /* On the desktop, a click around the image closes, as on the page behind it. The phone swipes there. */
  track.addEventListener("click", (event) => {
    if (!state || PHONE.matches) return;
    if (event.target.closest(".viewer-image")) return;
    close();
  });

  closeButton.addEventListener("click", close);
  /* The next step starts from state.index, which is already the target of a scroll still on its way. */
  prev.addEventListener("click", () => go(state.index - 1, { smooth: true }));
  next.addEventListener("click", () => go(state.index + 1, { smooth: true }));
  dialog.addEventListener("keydown", (event) => {
    if (!state) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      go(state.index + (event.key === "ArrowLeft" ? -1 : 1), { smooth: true });
    }
  });
  /* The browser's own Escape handling closes the dialog without telling us. */
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });
  /* A swipe moves the track; the slide that starts nearest its left edge becomes current, whatever the gap between slides. */
  track.addEventListener(
    "scroll",
    () => {
      if (!state || !track.clientWidth) return;
      let best = 0;
      let distance = Infinity;
      state.slides.forEach(({ figure }, i) => {
        const d = Math.abs(figure.offsetLeft - track.scrollLeft);
        if (d < distance) [best, distance] = [i, d];
      });
      /* On an arrow's way, the slides it passes are not current: the counter and credit would flip back and forth. */
      if (aiming !== null) {
        if (best === aiming) aiming = null;
        return;
      }
      if (best !== state.index) go(best, { scroll: false });
    },
    { passive: true },
  );
  /* The scroll ended, or the person took over: the scroll chooses again. */
  for (const type of ["scrollend", "pointerdown", "touchstart", "wheel"]) {
    track.addEventListener(type, () => (aiming = null), { passive: true });
  }
  /* The layouts size the slides alike, but the viewport changed: centre the current one again. */
  PHONE.addEventListener("change", () => {
    if (state) scrollTo(state.index, false);
  });
}

/**
 * Opens the viewer on `items` at `index`. `onClose(index)` hears the image it
 * closed on; focus then goes to `returnFocus`, an element or a function of
 * that index.
 */
export function openViewer(items, index, { onClose, returnFocus } = {}) {
  if (!items.length) return;
  if (!dialog) build();
  if (isOpen()) hide();
  const slides = items.map((item) => {
    const img = h("img", { class: "viewer-image", alt: item.alt });
    const stage = h("div", { class: "viewer-stage" }, img);
    /*
     * The picture's shape, so style.css draws any file in it, the thumbnail
     * too, as large as fits: nothing jumps when the large one comes. A shape
     * known beforehand also draws a placeholder until the picture loads.
     */
    const shape = (ratio) => stage.style.setProperty("--ar", String(ratio));
    if (item.ratio) shape(item.ratio);
    img.addEventListener("load", () => {
      if (img.naturalWidth && img.naturalHeight) shape(img.naturalWidth / img.naturalHeight);
    });
    const figure = h("figure", { class: "viewer-slide" }, stage);
    return { figure, img };
  });
  for (const layer of backdrops) {
    layer.classList.remove("on");
    layer.removeAttribute("src");
  }
  wanted = null;
  aiming = null;
  controls.hidden = items.length < 2;
  track.replaceChildren(...slides.map((s) => s.figure));
  state = {
    items,
    slides,
    srcs: [],
    credits: [],
    index: 0,
    loaded: new Set(),
    onClose,
    returnFocus,
  };
  show();
  go(index);
  /* Focus starts on ✕, not on the dialog, which would ring the whole screen. */
  closeButton.focus();
}
