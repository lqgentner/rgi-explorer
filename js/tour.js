/*
 * The guided tour: four steps, each a small popover beside one control with a
 * ring around it. Nothing else on the page is blocked, so the reader can use
 * the control while its step is open. The glacier steps need a card; without
 * one, step 2 waits for the reader to click a glacier, or to ask for one.
 */

import { PHONE, h, icon } from "./ui.js";

/* The popover's distance from its target, and from the viewport's edge. */
const GAP = 12;
const MARGIN = 8;

const PANEL_SIDES = ["right", "above", "below"];
const STEPS = [
  { title: "Search", text: "Find a glacier by name or RGI ID, or jump to a place.", anchor: "search", sides: ["below"] },
  {
    title: "The glacier card",
    text: "Click a glacier to see its area, elevations and hypsometry. The ? next to a value explains it.",
    anchor: "panel",
    sides: PANEL_SIDES,
    needsPanel: true,
  },
  {
    title: "Use this data",
    text: "This map reads the cloud-native RGI catalog directly, with no download. Use this data shows how to read it in Python or QGIS.",
    anchor: "useData",
    sides: PANEL_SIDES,
    needsPanel: true,
    endsOnClick: true,
  },
  { title: "3D", text: "See the terrain in 3D.", anchor: "terrain", sides: ["left", "below"] },
];

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
 * current layout; `panelOpen()` says whether a glacier card or complex panel
 * is open; `onTakeMe()` opens the sample glacier and may return a promise of
 * false when there is none, which removes the offer; `onEnd({byTarget})` hears
 * the tour end, `byTarget` when the reader clicked Use this data.
 *
 * @returns {{start(): void, end(): void, refresh(): void, readonly running: boolean}}
 */
export function mountTour(root, { anchor, panelOpen, onTakeMe, onEnd }) {
  let step = 0;
  let node = null;
  let ringed = null;
  /* Aborts the listeners of the whole tour, and of the step on show. */
  let running = null;
  let showing = null;
  /* The ringed control grows and shrinks, as the search does with its results; the popover follows. */
  let watcher = null;
  /* "Take me to a glacier": offered, working, or gone for this tour when there is no glacier. */
  let takeMe = "offered";

  const waiting = () => STEPS[step].needsPanel && step === 1 && !panelOpen();

  function ring(target) {
    if (ringed === target) return;
    ringed?.classList.remove("tour-target");
    watcher?.disconnect();
    watcher = null;
    ringed = target;
    ringed?.classList.add("tour-target");
    if (ringed && typeof window.ResizeObserver === "function") {
      watcher = new window.ResizeObserver(() => place());
      watcher.observe(ringed);
    }
  }

  function place() {
    if (!node || !ringed) return;
    const at = placeNear(
      ringed.getBoundingClientRect(),
      node.getBoundingClientRect(),
      { width: window.innerWidth, height: window.innerHeight },
      waiting() ? STEPS[0].sides : STEPS[step].sides,
    );
    node.dataset.side = at.side;
    node.style.top = `${at.top}px`;
    node.style.left = `${at.left}px`;
  }

  function show({ focus = false } = {}) {
    if (step === 2 && !panelOpen()) step = 1;
    const { title, text, anchor: name, endsOnClick } = STEPS[step];
    const wait = waiting();
    showing?.abort();
    showing = new window.AbortController();

    const target = anchor(wait ? "search" : name);
    ring(target);
    if (endsOnClick && target) target.addEventListener("click", () => end({ byTarget: true }), { signal: showing.signal });

    const back = h("button", { type: "button", class: "btn", hidden: step === 0 }, "Back");
    back.addEventListener("click", () => go(step - 1));
    const last = step === STEPS.length - 1;
    const busy = wait && takeMe === "working";
    const forward = wait && takeMe === "gone"
      ? null
      : h("button", { type: "button", class: "btn primary", disabled: busy },
        wait ? (busy ? "Opening…" : "Take me to a glacier") : last ? "Done" : "Next");
    forward?.addEventListener("click", () => {
      if (wait) takeMeThere();
      else if (last) end();
      else go(step + 1);
    });
    const close = h("button", { type: "button", class: "icon-button tour-close", "aria-label": "End tour" }, icon("x"));
    close.addEventListener("click", () => end());

    node.replaceChildren(
      h("h2", { id: "tour-title" }, title),
      h("p", {}, text),
      h("div", { class: "tour-actions" }, h("span", { class: "tour-count" }, `${step + 1} of ${STEPS.length}`), back, forward),
      close,
    );
    place();
    if (focus) node.focus();
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

  /* A crossing of the breakpoint swaps the layout's controls. */
  const reanchor = () => show();

  function go(next) {
    step = next;
    show({ focus: true });
  }

  function end({ byTarget = false } = {}) {
    if (!node) return;
    running.abort();
    PHONE.removeEventListener("change", reanchor);
    showing?.abort();
    ring(null);
    node.remove();
    node = null;
    onEnd({ byTarget });
  }

  return {
    start() {
      if (node) end();
      step = 0;
      takeMe = "offered";
      node = h("div", { class: "tour", role: "dialog", "aria-modal": "false", "aria-labelledby": "tour-title", tabIndex: -1 });
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
      show({ focus: true });
    },
    end: () => end(),
    /** Re-read whether a panel is open and re-anchor the step. */
    refresh() {
      if (node) show();
    },
    get running() {
      return node !== null;
    },
  };
}
