/*
 * A row of images that scrolls sideways and snaps, one image at a time: a
 * swipe on the phone, a trackpad or the arrows on the desktop. Each image is
 * a keyed tile, so an update keeps the tiles whose key it still holds, and an
 * image that stays never moves or reloads. style.css sets the row's look per
 * layout; the same elements serve both.
 */

import { PHONE, h, icon } from "./ui.js";

/**
 * @typedef {object} StripItem
 * @property {string} key        names the image across updates
 * @property {string} src
 * @property {string} alt
 * @property {() => Node} credit  built when the tile is made or its src changes
 * @property {string} [className] the image's class
 * @property {() => void} [onError] hears the image fail to load
 */

/**
 * Mounts a strip into `photo` and returns `{ update(items), show(index), index }`.
 * `onOpen(index, button)` hears a click on an image; a credit's links sit
 * outside that button.
 */
export function mountStrip(photo, { label, onOpen }) {
  const strip = h("div", { class: "strip", role: "group", "aria-label": label });
  const arrow = (side, text, glyph) =>
    h("button", { type: "button", class: `icon-button photo-${side}`, "aria-label": text, hidden: true }, icon(glyph));
  const prev = arrow("prev", "Previous image", "chevron-left");
  const next = arrow("next", "Next image", "chevron-right");
  photo.append(strip, prev, next);

  /** key -> { tile, button, img, credit, count, item } */
  const tiles = new Map();
  let order = [];
  let index = 0;
  /* The image an arrow's smooth scroll is heading to; until it gets there, the scroll does not choose the shown image. */
  let aiming = null;

  const clamp = (i) => Math.max(0, Math.min(order.length - 1, i));

  function refreshArrows() {
    const many = order.length > 1;
    const focused = document.activeElement;
    prev.hidden = !many || index === 0;
    next.hidden = !many || index === order.length - 1;
    /* An arrow that hides while focused would drop focus to the page. */
    if (focused === next && next.hidden && !prev.hidden) prev.focus();
    else if (focused === prev && prev.hidden && !next.hidden) next.focus();
  }

  function makeTile(item) {
    const img = h("img", { src: item.src, alt: item.alt });
    img.addEventListener("error", () => tiles.get(item.key)?.item.onError?.());
    const button = h("button", { type: "button", class: "strip-open" }, img);
    button.addEventListener("click", () => onOpen?.(order.indexOf(item.key), button));
    const credit = item.credit();
    const tile = h("div", { class: "strip-tile", dataset: { key: item.key } }, button, credit);
    return { tile, button, img, credit, count: null, item };
  }

  function update(items) {
    const keys = items.map((item) => item.key);
    for (const [key, entry] of tiles) {
      if (keys.includes(key)) continue;
      entry.tile.remove();
      tiles.delete(key);
    }
    items.forEach((item, i) => {
      let entry = tiles.get(item.key);
      if (!entry) {
        entry = makeTile(item);
        tiles.set(item.key, entry);
      } else if (entry.item.src !== item.src) {
        entry.img.src = item.src;
        const credit = item.credit();
        entry.credit.replaceWith(credit);
        entry.credit = credit;
      }
      entry.item = item;
      entry.img.alt = item.alt;
      if (item.className) entry.img.className = item.className;
      else entry.img.removeAttribute("class");
      /* The first image is in view at once; the rest load as they near it. */
      if (i === 0) entry.img.removeAttribute("loading");
      else entry.img.setAttribute("loading", "lazy");
      /* The label replaces the image's alt, so it carries what the image shows, then its place. */
      entry.button.setAttribute("aria-label", items.length > 1 ? `${item.alt}, image ${i + 1} of ${items.length}` : item.alt);
      entry.count?.remove();
      entry.count = items.length > 1 ? h("span", { class: "photo-count" }, `${i + 1} / ${items.length}`) : null;
      if (entry.count) entry.tile.append(entry.count);
      /* Move a tile only when it is out of place: moving it would drop keyboard focus. */
      if (strip.children[i] !== entry.tile) strip.insertBefore(entry.tile, strip.children[i] ?? null);
    });
    order = keys;
    index = order.length ? clamp(index) : 0;
    refreshArrows();
  }

  /** Scroll so image `i` sits at the snap position: its centre on the strip's. */
  function show(i, { smooth = false } = {}) {
    if (!order.length) return;
    index = clamp(i);
    aiming = smooth ? index : null;
    refreshArrows();
    const tile = tiles.get(order[index]).tile;
    const left = tile.offsetLeft + tile.offsetWidth / 2 - strip.clientWidth / 2;
    if (typeof strip.scrollTo === "function") strip.scrollTo({ left, behavior: smooth ? "smooth" : "instant" });
    else strip.scrollLeft = left;
  }

  /* The shown image is the one whose centre is nearest the strip's. */
  strip.addEventListener(
    "scroll",
    () => {
      if (!strip.clientWidth || !order.length) return;
      const centre = strip.scrollLeft + strip.clientWidth / 2;
      let best = 0;
      let distance = Infinity;
      order.forEach((key, i) => {
        const { tile } = tiles.get(key);
        const d = Math.abs(tile.offsetLeft + tile.offsetWidth / 2 - centre);
        if (d < distance) [best, distance] = [i, d];
      });
      /* On an arrow's way, the images it passes are not shown: the arrows would flip back and forth. */
      if (aiming !== null) {
        if (best === aiming) aiming = null;
        return;
      }
      if (best === index) return;
      index = best;
      refreshArrows();
    },
    { passive: true },
  );
  /* The scroll ended, or the person took over: the scroll chooses again. */
  for (const type of ["scrollend", "pointerdown", "touchstart", "wheel"]) {
    strip.addEventListener(type, () => (aiming = null), { passive: true });
  }

  prev.addEventListener("click", () => show(index - 1, { smooth: true }));
  next.addEventListener("click", () => show(index + 1, { smooth: true }));
  /* The layouts size the images differently, so the shown one is centred again. */
  PHONE.addEventListener("change", () => show(index));

  return {
    update,
    show,
    /** The open button of image `i`, or null. */
    buttonAt: (i) => tiles.get(order[i])?.button ?? null,
    get index() {
      return index;
    },
  };
}
