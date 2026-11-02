/*
 * The guided tour: five steps, each a small popover beside one control with a
 * ring around it, that move on when the reader does what the step asks. While
 * Use this data or the photo viewer covers the page, the tour only asks the
 * reader to close it, and picks up again when they do. Nothing else on the
 * page is blocked.
 */

import { PHONE, h, icon } from "./ui.js";

/* The popover's distance from its target, and from the viewport's edge. */
const GAP = 12;
const MARGIN = 8;

const PANEL_SIDES = ["right", "above", "below"];
const COUNTED = 4;
/* `[?]` in a text is the info buttons' icon. */
const STEPS = {
  find: {
    n: 1,
    title: "Find a glacier",
    text: "To start, click a glacier on the map or search for one.",
    anchor: "search",
    /* The ring goes round the bar alone; the popover follows the whole search, results included. */
    ring: "searchBar",
    sides: ["below"],
    skipTo: "terrain",
  },
  card: { n: 2, anchor: "panel", sides: PANEL_SIDES, skipTo: "data", needsPanel: true },
  data: {
    n: 3,
    title: "Use this data",
    text: "This map reads the cloud-native RGI catalog directly, with no download. Open Use this data to read it in Python or QGIS.",
    anchor: "useData",
    sides: PANEL_SIDES,
    skipTo: "terrain",
    needsPanel: true,
  },
  terrain: { n: 4, title: "3D", text: "Switch to 3D to see the terrain.", anchor: "terrain", sides: ["left", "below"], skipTo: "done" },
  /* On the desktop the last card takes the 3D step's place; the app anchors it to the 3D button. */
  done: { title: "You're all set.", text: "Have fun exploring the glaciers on your own.", sides: ["left", "below"] },
};
/* Step 2 names what is open, and on the phone first asks to raise the sheet. */
const CARD = {
  glacier: { title: "The glacier card", what: "its area, elevations and hypsometry" },
  complex: { title: "The complex panel", what: "its area and its glaciers" },
};
const COVER_TEXT = "Close to continue the tour";

function cardText(kind) {
  const { what } = CARD[kind];
  const lead = PHONE.matches ? `Swipe up to see ${what}.` : `${what[0].toUpperCase()}${what.slice(1)}.`;
  return `${lead} Tap a [?] to see what a value means.`;
}

/** A step's text as nodes, with each `[?]` drawn as the info icon. */
function textNodes(text) {
  return text.split("[?]").flatMap((part, i) => {
    if (!i) return [part];
    const glyph = icon("circle-question-mark");
    glyph.classList.add("inline-icon");
    return [glyph, part];
  });
}

const clamp = (value, low, high) => Math.max(low, Math.min(value, high));

/**
 * Where a box of `box` size goes beside `target`, as `{top, left, side}`: the
 * first of `sides` where it lies wholly inside the viewport's margin, centred
 * on the target along the other axis; else the first side, clamped inside.
 */
export function placeNear(target, box, viewport, sides) {
  const maxTop = viewport.height - MARGIN - box.height;
  const maxLeft = viewport.width - MARGIN - box.width;
  const centreLeft = clamp(target.left + target.width / 2 - box.width / 2, MARGIN, maxLeft);
  const centreTop = clamp(target.top + target.height / 2 - box.height / 2, MARGIN, maxTop);
  const at = {
    below: { top: target.bottom + GAP, left: centreLeft },
    above: { top: target.top - GAP - box.height, left: centreLeft },
    right: { top: centreTop, left: target.right + GAP },
    left: { top: centreTop, left: target.left - GAP - box.width },
  };
  const inside = ({ top, left }) => top >= MARGIN && top <= maxTop && left >= MARGIN && left <= maxLeft;
  const side = sides.find((s) => inside(at[s])) ?? sides[0];
  return { top: clamp(at[side].top, MARGIN, maxTop), left: clamp(at[side].left, MARGIN, maxLeft), side };
}
/**
 * Mount the tour on `root`. `anchor(name)` finds a step's control in the
 * current layout; `panel()` says what is open: null, "glacier" or "complex";
 * `terrainOn()` whether 3D is on; `onTakeMe()` opens the sample glacier and
 * may return a promise of false when there is none, which removes the offer;
 * `onStep(step)` hears each step the tour enters ("find", "card", "data",
 * "terrain", "done"), so the app can reveal its control; `onEnd({byTarget})`
 * hears the tour end.
 *
 * The app tells the tour what changed: `refresh()` after a panel opens or
 * closes, 3D turns on or off, or the layout changes; `interacted()` after the
 * reader used the card; `cover(by, open)` when Use this data ("useData") or
 * the viewer ("viewer") opens or closes.
 *
 * @returns {{start(): void, end(): void, refresh(): void, interacted(): void, cover(by: string, open: boolean): void, readonly running: boolean}}
 */
export function mountTour(root, { anchor, panel, terrainOn, onTakeMe, onStep, onEnd }) {
  let step = "find";
  let node = null;
  let ringed = null;
  /* Aborts the listeners of the whole tour. */
  let running = null;
  /* Watches the anchor as it grows and shrinks, as the search does with its results; the popover follows. */
  let watcher = null;
  /* "Take me to a glacier": offered, working, or gone for this tour when there is no glacier. */
  let takeMe = "offered";
  /* Whether the reader used the card on step 2. */
  let used = false;
  /* What covers the page now: null, "useData" or "viewer". */
  let covered = null;
  /* The step the app last heard of. */
  let told = null;

  /* The node the popover is placed against and follows as it grows or shrinks: the step's anchor. */
  let watched = null;
  function watch(target) {
    if (watched === target) return;
    watcher?.disconnect();
    watcher = null;
    watched = target;
    if (target && typeof window.ResizeObserver === "function") {
      watcher = new window.ResizeObserver(() => place());
      watcher.observe(target);
    }
  }

  function ring(target) {
    if (ringed === target) return;
    ringed?.classList.remove("tour-target");
    ringed = target;
    ringed?.classList.add("tour-target");
  }

  function place() {
    if (!node || covered) return;
    const at = watched;
    /*
     * On the phone style.css places it: the card steps dock to the sheet's
     * edge and follow a swipe frame by frame; the others sit at the top,
     * under the search.
     */
    if (PHONE.matches) {
      if (step === "card") node.dataset.dock = "sheet";
      else if (step === "data") dockToButton();
      else delete node.dataset.dock;
      node.dataset.side = "top";
      node.style.top = "";
      node.style.left = "";
      return;
    }
    delete node.dataset.dock;
    if (!at) return;
    const spot = placeNear(
      at.getBoundingClientRect(),
      node.getBoundingClientRect(),
      { width: window.innerWidth, height: window.innerHeight },
      STEPS[step].sides,
    );
    node.dataset.side = spot.side;
    node.style.top = `${spot.top}px`;
    node.style.left = `${spot.left}px`;
  }

  /*
   * Use this data rides with its button: above the sheet's edge at compact,
   * under the button once the sheet is raised, so the button stays in view.
   * The button's place in the sheet only changes with the sheet's level.
   */
  function dockToButton() {
    node.dataset.dock = "button";
    const sheet = anchor("panel")?.getBoundingClientRect();
    const button = watched?.getBoundingClientRect();
    if (sheet && button) node.style.setProperty("--tour-below", `${Math.round(button.bottom - sheet.top + GAP - 4)}px`);
  }

  /* Move on while a step's condition already holds, and back when its panel is gone. */
  function settle() {
    for (;;) {
      const kind = panel();
      if (step === "find" && kind) {
        step = "card";
        used = false;
      } else if (STEPS[step].needsPanel && !kind) step = "find";
      else if (step === "terrain" && terrainOn()) step = "done";
      else return;
    }
  }

  /* At most one filled button per step: its main action. */
  const outline = (label, onClick, extra = {}) => {
    const btn = h("button", { type: "button", class: "btn", ...extra }, label);
    btn.addEventListener("click", onClick);
    return btn;
  };
  const filled = (label, onClick) => {
    const btn = h("button", { type: "button", class: "btn primary" }, label);
    btn.addEventListener("click", onClick);
    return btn;
  };

  function buttons() {
    if (step === "done") return [filled("Done", () => end())];
    const skip = () => go(STEPS[step].skipTo);
    if (step === "card" && used) return [filled("Next", () => go("data"))];
    if (step === "find" && takeMe !== "gone") {
      const busy = takeMe === "working";
      return [outline(busy ? "Opening…" : "Take me to a glacier", takeMeThere, { disabled: busy }), outline("Skip", skip)];
    }
    return [outline("Skip", skip)];
  }

  function show({ focus = false } = {}) {
    if (!node) return;
    const close = h("button", { type: "button", class: "icon-button tour-close", "aria-label": "End tour" }, icon("x"));
    close.addEventListener("click", () => end());
    node.classList.toggle("covering", Boolean(covered));
    if (covered) node.dataset.cover = covered;
    else delete node.dataset.cover;
    /* No X of its own: the ring points at the close button that continues the tour. */
    if (covered) {
      delete node.dataset.dock;
      watch(null);
      ring(anchor(covered === "useData" ? "useDataClose" : "viewerClose"));
      node.style.top = "";
      node.style.left = "";
      node.replaceChildren(h("p", { id: "tour-title" }, COVER_TEXT));
      raise();
      return;
    }
    settle();
    if (step !== told) {
      told = step;
      onStep?.(step);
    }
    const kind = panel();
    const { n, anchor: name } = STEPS[step];
    const title = step === "card" ? CARD[kind].title : STEPS[step].title;
    const text = step === "card" ? cardText(kind) : STEPS[step].text;
    /*
     * The popover follows its anchor as it grows. The ring marks what to use:
     * none on the last card, and none on the card once it was used, so Next
     * reads as the way on.
     */
    const target = anchor(name ?? "done");
    watch(target);
    const done = step === "done" || (step === "card" && used);
    ring(done ? null : STEPS[step].ring ? anchor(STEPS[step].ring) : target);
    node.replaceChildren(
      h("h2", { id: "tour-title" }, title),
      h("p", {}, ...textNodes(text)),
      h("div", { class: "tour-actions" }, n ? h("span", { class: "tour-count" }, `${n} of ${COUNTED}`) : null, ...buttons()),
      close,
    );
    place();
    if (focus) node.focus();
  }

  /*
   * Over a modal dialog the message must sit in the top layer too: shown as a
   * manual popover after the dialog opened, it draws above it.
   */
  function raise() {
    if (typeof node.showPopover !== "function") return;
    if (node.matches(":popover-open")) node.hidePopover();
    node.showPopover();
  }

  function lower() {
    if (typeof node?.hidePopover === "function" && node.matches(":popover-open")) node.hidePopover();
  }

  /* The sample glacier can take a while: the glacier index loads first. */
  function takeMeThere() {
    takeMe = "working";
    show();
    node.focus();
    Promise.resolve(onTakeMe()).then(
      (found) => {
        takeMe = found === false ? "gone" : "offered";
      },
      () => {
        takeMe = "gone";
      },
    ).then(() => {
      if (node) show();
    });
  }

  /* A crossing of the breakpoint swaps the layout's controls and step 2's text. */
  const reanchor = () => show();

  function go(next) {
    step = next;
    if (next === "card") used = false;
    show({ focus: true });
  }

  function end({ byTarget = false } = {}) {
    if (!node) return;
    running.abort();
    PHONE.removeEventListener("change", reanchor);
    ring(null);
    watch(null);
    lower();
    node.remove();
    node = null;
    covered = null;
    onEnd({ byTarget });
  }

  return {
    start() {
      if (node) end();
      step = "find";
      takeMe = "offered";
      used = false;
      covered = null;
      told = null;
      node = h("div", { class: "tour", role: "dialog", "aria-modal": "false", "aria-labelledby": "tour-title", tabIndex: -1 });
      if ("popover" in node) node.popover = "manual";
      root.append(node);
      running = new window.AbortController();
      const { signal } = running;
      /*
       * Escape ends the tour from the tour or from nowhere in particular. One
       * that another control handled, or one typed in the search or a
       * popover, stays with that control.
       */
      document.addEventListener("keydown", (event) => {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        const at = document.activeElement;
        if (at && at !== document.body && !node.contains(at)) return;
        end();
      }, { signal });
      window.addEventListener("resize", place, { signal });
      document.addEventListener("transitionend", place, { signal });
      PHONE.addEventListener("change", reanchor);
      /* Outside the top layer the popover draws by its z-index, as before. */
      if (typeof node.showPopover === "function") node.showPopover();
      show({ focus: true });
    },
    end: () => end(),
    /** Re-read what is open, 3D and the layout, move on if a step is done, and re-anchor. */
    refresh() {
      show();
    },
    /** The reader used the card: on step 2, Skip becomes Next. */
    interacted() {
      if (!node || step !== "card" || used) return;
      used = true;
      show();
    },
    /** Use this data or the viewer opened (`open`) or closed. */
    cover(by, open) {
      if (!node) return;
      if (open) covered = by;
      else if (covered === by) {
        covered = null;
        if (by === "useData" && step === "data") step = panel() ? "terrain" : "find";
      } else return;
      show();
    },
    get running() {
      return node !== null;
    },
  };
}
