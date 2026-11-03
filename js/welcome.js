/*
 * The first-visit welcome: what the map shows, how to start, the RGI user
 * guide and the tour. Once closed it stays gone on later visits.
 */

import { formatInt } from "./columns.js";
import { PHONE, externalLink, h, icon } from "./ui.js";

const KEY = "rgi-explorer:welcome";
const USER_GUIDE = "https://rgidata.org/user_guide/";

/** Whether this browser closed the welcome before; false when storage is unavailable. */
function readSeen() {
  try {
    return window.localStorage.getItem(KEY) === "seen";
  } catch {
    return false;
  }
}

function writeSeen() {
  try {
    window.localStorage.setItem(KEY, "seen");
  } catch {
    /* Without storage the welcome shows again on the next visit. */
  }
}

/** The welcome's heading: the glacier count when the catalog gives one. The version stays with its name. */
export function welcomeTitle(count, version) {
  const rgi = `the Randolph Glacier Inventory\u00a0${version}`;
  return count ? `Explore the ${formatInt(count)} glaciers of ${rgi}` : `Explore the glaciers of ${rgi}`;
}

/**
 * Mount the welcome in `root`, hidden. It shows on mount when `autoShow` is
 * true and this browser hasn't closed it before.
 *
 * @returns {{show(): void, dismiss(): void, readonly shown: boolean, readonly node: Element}}
 */
export function mountWelcome(root, { title, autoShow, onTour }) {
  const close = h("button", { type: "button", class: "icon-button welcome-close", "aria-label": "Close" }, icon("x"));
  const tour = h("button", { type: "button", class: "btn primary" }, "Take the tour");
  const node = h(
    "section",
    { class: "welcome", "aria-labelledby": "welcome-title", hidden: true },
    h("h2", { id: "welcome-title" }, title),
    /* One paragraph, to save a line on the phone. */
    h("p", {}, "Search for a glacier or click one on the map. New to RGI? ", externalLink(USER_GUIDE, "Read the user guide"), "."),
    tour,
    close,
  );
  root.append(node);

  const api = {
    show() {
      node.hidden = false;
    },
    /** Hide the welcome; a welcome that was showing is marked seen. */
    dismiss() {
      if (node.hidden) return;
      node.hidden = true;
      writeSeen();
    },
    get shown() {
      return !node.hidden;
    },
    node,
  };
  close.addEventListener("click", () => api.dismiss());
  tour.addEventListener("click", () => {
    api.dismiss();
    onTour();
  });
  if (autoShow && !readSeen()) api.show();
  return api;
}

/**
 * The help button: last in the desktop's controls; on the phone first in the
 * status line, before the credits, so it rides up with them over the sheet.
 * It moves when the page crosses the breakpoint.
 *
 * @returns {{button: HTMLButtonElement}}
 */
export function mountHelp({ desktop, phone }, { onHelp }) {
  const button = h("button", { type: "button", class: "help-btn", "aria-label": "Help" }, icon("circle-question-mark"));
  button.addEventListener("click", () => onHelp());
  const place = () => {
    if (PHONE.matches) phone.prepend(button);
    else desktop.append(button);
  };
  place();
  PHONE.addEventListener("change", place);
  return { button };
}
