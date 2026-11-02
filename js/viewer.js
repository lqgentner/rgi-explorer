/*
 * The image viewer: a modal dialog that shows the strip's images whole, one
 * at a time. Each image's large file and credit are fetched only when it is
 * shown, once. The credit and ‹ n / N › sit in one dock fixed under the
 * images and ✕ in the corner, so no control moves from image to image. Swipe,
 * the arrow keys or the arrows (desktop only) move between images; Escape, ✕
 * and, on the desktop, a click outside the image close it.
 */

import { PHONE, h, icon } from "./ui.js";

/**
 * @typedef {object} ViewerItem
 * @property {string} alt
 * @property {string} [thumb]  shown until the large file arrives
 * @property {(size: [number, number]) => Promise<string | null> | string | null} large
 * @property {(size: [number, number]) => Node} credit
 */

/**
 * The pixel size to ask a server for: `width` by `height` CSS pixels at
 * `scale`, scaled down evenly so the longest side is at most `max`.
 */
export function viewerCropSize(width, height, { scale = 2, max = 4096 } = {}) {
  const [w, hgt] = [width * scale, height * scale];
  const k = Math.min(1, max / Math.max(w, hgt));
  return [Math.round(w * k), Math.round(hgt * k)];
}

let dialog = null;
let track = null;
let prev = null;
let next = null;
let closeButton = null;
let credit = null;
let controls = null;
let count = null;
/** The open viewer: { items, slides, credits, index, size, loaded, onClose, returnFocus }. */
let state = null;

const isOpen = () => Boolean(dialog && (dialog.open || dialog.hasAttribute("open")));

function show() {
  if (typeof dialog.showModal === "function") {
    if (!dialog.open) dialog.showModal();
  } else dialog.setAttribute("open", "");
}

function hide() {
  if (typeof dialog.close === "function" && dialog.open) dialog.close();
  else dialog.removeAttribute("open");
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
  const { img, blur } = mine.slides[i];
  /* The phone's background is a blur of the same file, so it costs no download of its own. */
  const setSrc = (src) => {
    img.src = src;
    blur.src = src;
  };
  if (item.thumb) setSrc(item.thumb);
  mine.credits[i] = item.credit(mine.size);
  let answer;
  try {
    answer = item.large(mine.size);
  } catch {
    return;
  }
  Promise.resolve(answer)
    .then((url) => {
      if (url && state === mine) setSrc(url);
    })
    .catch(() => {});
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
  load(index);
  credit.replaceChildren(state.credits[index]);
  if (scroll) scrollTo(index, smooth);
}

function build() {
  closeButton = h("button", { type: "button", class: "icon-button viewer-close", "aria-label": "Close" }, icon("x"));
  track = h("div", { class: "viewer-track" });
  prev = h("button", { type: "button", class: "icon-button viewer-prev", "aria-label": "Previous image" }, icon("chevron-left"));
  next = h("button", { type: "button", class: "icon-button viewer-next", "aria-label": "Next image" }, icon("chevron-right"));
  credit = h("div", { class: "viewer-credit" });
  count = h("span", { class: "viewer-count" });
  controls = h("div", { class: "viewer-controls" }, prev, count, next);
  const dock = h("div", { class: "viewer-dock" }, credit, controls);
  dialog = h("dialog", { class: "viewer", "aria-label": "Images" }, track, dock, closeButton);
  document.body.append(dialog);

  /* On the desktop, a click around the image closes, as on the page behind it. The phone swipes there. */
  track.addEventListener("click", (event) => {
    if (!state || PHONE.matches) return;
    if (event.target.closest(".viewer-image")) return;
    close();
  });

  closeButton.addEventListener("click", close);
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
  /* A swipe moves the track; the slide nearest its centre becomes current. */
  track.addEventListener(
    "scroll",
    () => {
      if (!state || !track.clientWidth) return;
      const i = Math.round(track.scrollLeft / track.clientWidth);
      if (i !== state.index) go(i, { scroll: false });
    },
    { passive: true },
  );
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
    const blur = h("img", { class: "viewer-blur", alt: "", "aria-hidden": "true" });
    const img = h("img", { class: "viewer-image", alt: item.alt });
    const figure = h("figure", { class: "viewer-slide" }, h("div", { class: "viewer-stage" }, blur, img));
    return { figure, img, blur };
  });
  controls.hidden = items.length < 2;
  track.replaceChildren(...slides.map((s) => s.figure));
  state = {
    items,
    slides,
    credits: [],
    index: 0,
    /*
     * One export pixel per CSS pixel. Asking Esri for twice that costs four
     * times the bytes and can tip it into a finer level, which in places is
     * a patchwork of scenes from different dates.
     */
    size: viewerCropSize(window.innerWidth, window.innerHeight, { scale: 1 }),
    loaded: new Set(),
    onClose,
    returnFocus,
  };
  show();
  go(index);
  /* Focus starts on ✕, not on the dialog, which would ring the whole screen. */
  closeButton.focus();
}
