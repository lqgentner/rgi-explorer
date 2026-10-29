/* The search input and its result list. */

import { h, icon, PHONE } from "./ui.js";
import { searchPlaces } from "./photon.js";
import { MIN_QUERY, rankHits, searchGlaciers, searchRegions } from "./search.js";

const DEBOUNCE_MS = 250;
const ICONS = { glacier: "mountain-snow", region: "square-dashed", place: "map-pin" };

/**
 * Mount the search box in `root`.
 *
 * @param {HTMLElement} root
 * @param {object} options
 * @param {(hit: object) => void} options.onPick
 * @param {() => Promise<object>} options.loadGlacierIndex  called once, on first focus or input
 * @param {object[]} options.regions
 * @param {() => {lat: number, lon: number, zoom: number}} options.view
 * @returns {{setClosable(close: (() => void) | null): void, clear(): void}}
 *   setClosable shows a Close button that calls `close`, or hides it for null.
 *   clear empties the input and closes the list.
 */
export function mountSearch(root, { onPick, loadGlacierIndex, regions, view }) {
  const listId = "search-list";
  const input = h("input", {
    type: "search",
    role: "combobox",
    "aria-label": "Search glaciers, regions and places",
    "aria-autocomplete": "list",
    "aria-controls": listId,
    "aria-expanded": "false",
    autocomplete: "off",
    placeholder: "Search glaciers, regions and places",
  });
  const list = h("ul", { id: listId, role: "listbox", hidden: true });
  const closeButton = h(
    "button",
    { type: "button", class: "icon-button search-close", "aria-label": "Close", hidden: true },
    icon("x"),
  );
  const searchIcon = icon("search");
  searchIcon.classList.add("search-icon");
  let onClose = null;
  closeButton.addEventListener("click", () => onClose?.());
  root.append(searchIcon, input, closeButton, list);

  let glacierIndex = null;
  let indexLoad = null;
  let query = "";
  let seq = 0;
  let timer = null;
  let controller = null;
  let local = [];
  let places = [];
  let hits = [];
  let active = -1;

  function close() {
    list.hidden = true;
    list.replaceChildren();
    hits = [];
    active = -1;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  }

  const keyOf = (hit) => `${hit.kind}|${hit.title}|${hit.subtitle}`;

  /* Draw the ranked hits. With `keepActive` the row the user selected stays selected. */
  function render(keepActive) {
    const kept = keepActive && active >= 0 ? keyOf(hits[active]) : null;
    hits = rankHits(local, places);
    list.replaceChildren(
      ...hits.map((hit, i) =>
        h(
          "li",
          { id: `${listId}-${i}`, role: "option", "aria-selected": "false" },
          icon(ICONS[hit.kind]),
          h("span", { class: "title" }, hit.title),
          h("span", { class: "subtitle" }, hit.subtitle),
        ),
      ),
    );
    list.hidden = hits.length === 0;
    input.setAttribute("aria-expanded", String(hits.length > 0));
    setActive(kept ? hits.findIndex((hit) => keyOf(hit) === kept) : -1);
  }

  function hide() {
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
  }

  function setActive(next) {
    active = next;
    [...list.children].forEach((row, i) => row.setAttribute("aria-selected", String(i === active)));
    if (active >= 0) input.setAttribute("aria-activedescendant", `${listId}-${active}`);
    else input.removeAttribute("aria-activedescendant");
  }

  /* Stop the pending Photon request and close the list, with `value` in the input. */
  function reset(value) {
    clearTimeout(timer);
    controller?.abort();
    seq += 1;
    input.value = value;
    query = "";
    close();
  }

  function pick(hit) {
    if (!hit) return;
    reset(hit.title);
    /* On the phone the keyboard covers the map, so a pick puts it away. */
    if (PHONE.matches) input.blur();
    onPick(hit);
  }

  function searchLocal() {
    local = [
      ...(glacierIndex ? searchGlaciers(glacierIndex, query) : []),
      ...searchRegions(regions, query),
    ];
  }

  function ensureIndex() {
    if (indexLoad) return;
    indexLoad = loadGlacierIndex().then(
      (loaded) => {
        glacierIndex = loaded;
        if (query.length >= MIN_QUERY) {
          searchLocal();
          render(true);
        }
      },
      () => {
        indexLoad = null;
      },
    );
  }

  async function askPhoton(mine) {
    controller = new AbortController();
    try {
      const found = await searchPlaces(query, view(), { signal: controller.signal });
      if (mine !== seq) return;
      places = found;
    } catch {
      if (mine !== seq) return;
      places = [];
    }
    render(true);
  }

  function update() {
    ensureIndex();
    clearTimeout(timer);
    controller?.abort();
    seq += 1;
    query = input.value.trim();
    places = [];
    if (query.length < MIN_QUERY) {
      local = [];
      close();
      return;
    }
    searchLocal();
    render(false);
    const mine = seq;
    timer = setTimeout(() => askPhoton(mine), DEBOUNCE_MS);
  }

  input.addEventListener("focus", () => {
    ensureIndex();
    if (hits.length) {
      list.hidden = false;
      input.setAttribute("aria-expanded", "true");
    }
  });
  root.addEventListener("focusout", (event) => {
    if (!root.contains(event.relatedTarget)) hide();
  });
  list.addEventListener("mousedown", (event) => event.preventDefault());
  input.addEventListener("input", update);
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!hits.length) return;
      event.preventDefault();
      const down = event.key === "ArrowDown";
      if (active < 0) setActive(down ? 0 : hits.length - 1);
      else setActive((active + (down ? 1 : -1) + hits.length) % hits.length);
    } else if (event.key === "Enter") {
      pick(hits[active] ?? hits[0]);
    } else if (event.key === "Escape") {
      reset("");
    }
  });
  list.addEventListener("click", (event) => {
    const row = event.target.closest('[role="option"]');
    if (row) pick(hits[[...list.children].indexOf(row)]);
  });

  return {
    setClosable(close) {
      onClose = close ?? null;
      closeButton.hidden = !onClose;
    },
    clear() {
      reset("");
    },
  };
}
