/* The glacier card: photo area, header, actions and the Overview and Hypsometry tabs. */

import { ATTRIBUTE_COLUMNS, GROUP_TITLES, missingAttributes, nonEmpty, overviewRows } from "./columns.js";
import { renderHypsometry } from "./hypsometry.js";
import { CARD_COLUMNS, readRow } from "./parquet.js";
import { h, icon } from "./ui.js";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "hypsometry", label: "Hypsometry" },
];
const SHOWN_LINKS = 3;

/** The first-order region code inside an RGI ID, such as "11" in RGI2000-v7.0-G-11-02596. */
const regionOfId = (rgiId) => /-G-(\d{2})-/.exec(rgiId ?? "")?.[1] ?? null;

function infoButton(label, description) {
  if (!description) return [null, null];
  const popover = h("div", { class: "popover", hidden: true }, description);
  const button = h(
    "button",
    { type: "button", class: "info", "aria-label": `About ${label}`, "aria-expanded": "false" },
    "ⓘ",
  );
  button.addEventListener("click", () => {
    popover.hidden = !popover.hidden;
    button.setAttribute("aria-expanded", String(!popover.hidden));
  });
  return [button, popover];
}

/**
 * Mounts the card into `root` and returns `{ open(glacier), close() }`.
 * `glacier` is `{ rgiId, row?, props? }`.
 */
export function mountCard(root, ctx) {
  const state = { tab: "overview", rgi6Open: false, moreOpen: false, submissionOpen: false };
  let current = null;
  let controller = null;

  const photo = h("div", { class: "photo" });
  const head = h("header", { class: "card-head" });
  const closeButton = h("button", { type: "button", class: "icon-button card-close", "aria-label": "Close" }, icon("x"));
  const actions = h("div", { class: "card-actions" });
  const tablist = h("div", { class: "tabs", role: "tablist" });
  const panels = Object.fromEntries(
    TABS.map((tab) => [
      tab.id,
      h("div", {
        class: `tabpanel panel-${tab.id}`,
        role: "tabpanel",
        id: `card-panel-${tab.id}`,
        "aria-labelledby": `card-tab-${tab.id}`,
      }),
    ]),
  );
  const tabs = Object.fromEntries(
    TABS.map((tab) => [
      tab.id,
      h("button", {
        type: "button",
        class: "tab",
        role: "tab",
        id: `card-tab-${tab.id}`,
        "aria-controls": `card-panel-${tab.id}`,
      }, tab.label),
    ]),
  );
  tablist.append(...Object.values(tabs));
  const section = h("section", { class: "card", "aria-label": "Glacier", hidden: true },
    photo, closeButton, head, actions, tablist, ...Object.values(panels));
  root.append(section);

  function selectTab(id, focus = false) {
    state.tab = id;
    for (const tab of TABS) {
      const selected = tab.id === id;
      tabs[tab.id].setAttribute("aria-selected", String(selected));
      tabs[tab.id].tabIndex = selected ? 0 : -1;
      panels[tab.id].hidden = !selected;
    }
    if (focus) tabs[id].focus();
  }
  tablist.addEventListener("click", (event) => {
    const tab = TABS.find((t) => tabs[t.id].contains(event.target));
    if (tab) selectTab(tab.id);
  });
  tablist.addEventListener("keydown", (event) => {
    const at = TABS.findIndex((t) => t.id === state.tab);
    const next = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: TABS.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    selectTab(TABS[(next + TABS.length) % TABS.length].id, true);
  });

  const glacierNow = () => ({ rgiId: current.rgiId, row: current.row, props: current.props });

  function button(label, className, onClick) {
    const node = h("button", { type: "button", class: className }, label);
    node.addEventListener("click", onClick);
    return node;
  }
  actions.append(
    button("Use this data", "btn primary", () => ctx.onUseData?.(glacierNow())),
    button("Zoom to", "btn", () => ctx.onZoom?.(current.props.bbox ?? current.props)),
    button("Share", "btn", () => ctx.onShare?.()),
  );

  function renderHead() {
    const { rgiId, props } = current;
    const name = nonEmpty(props.display_name) ?? nonEmpty(props.glac_name);
    const code = nonEmpty(props.o1region) ?? regionOfId(rgiId);
    const region = (ctx.regions ?? []).find((r) => Number(r.level) === 1 && r.o1region === code)?.full_name;
    const subtitle = name ? [rgiId, region].filter(Boolean).join(" · ") : (region ?? "");
    head.replaceChildren(h("h2", { class: "card-title" }, name ?? rgiId), subtitle ? h("p", { class: "card-subtitle" }, subtitle) : null);
  }

  function renderValue(row) {
    if (row.list) return renderLinks(row);
    if (row.link) return h("a", { href: row.link, target: "_blank", rel: "noopener noreferrer" }, row.value);
    if (row.action) {
      const node = h("button", { type: "button", class: "link" }, row.value);
      node.addEventListener("click", () => ctx.onAction?.(row.action));
      return node;
    }
    return row.value;
  }

  function renderLinks(row) {
    const wrap = h("span", { class: "links" });
    if (!row.list.length) return row.value;
    const shown = state.rgi6Open ? row.list : row.list.slice(0, SHOWN_LINKS);
    wrap.append(...shown.map((id) => h("span", { class: "link-id" }, id)));
    if (row.list.length > shown.length) {
      const more = button(`+ ${row.list.length - shown.length} more`, "link more-links", () => {
        state.rgi6Open = true;
        renderOverview();
      });
      wrap.append(more);
    }
    return wrap;
  }

  function renderRow(row) {
    const [info, popover] = infoButton(row.label, row.description);
    return h("div", { class: row.more ? "row more" : "row", hidden: row.more && !state.moreOpen },
      h("div", { class: "row-label" }, row.label, info),
      h("div", { class: "row-value" }, renderValue(row)),
      popover);
  }

  function renderOverview() {
    const nodes = overviewRows(current.props, ctx.catalog.columns, ctx.regions).map(({ group, rows }) => {
      if (group === "key") {
        return h("div", { class: "key-grid" }, rows.map((row) => {
          const [info, popover] = infoButton(row.label, row.description);
          return h("div", { class: "key-tile" },
            h("div", { class: "row-label" }, row.label, info),
            h("div", { class: "key-value" }, row.value),
            popover);
        }));
      }
      if (!rows.length) return null;
      const body = rows.map(renderRow);
      if (rows.some((r) => r.more)) {
        const toggle = button(state.moreOpen ? "show less" : "show more", "link show-more", () => {
          state.moreOpen = !state.moreOpen;
          renderOverview();
        });
        body.push(toggle);
      }
      if (group === "submission") {
        const details = h("details", { class: "group group-submission", open: state.submissionOpen },
          h("summary", {}, GROUP_TITLES[group]), body);
        details.addEventListener("toggle", () => {
          state.submissionOpen = details.open;
        });
        return details;
      }
      return h("section", { class: `group group-${group}` }, h("h3", {}, GROUP_TITLES[group]), body);
    });
    panels.overview.replaceChildren(...nodes);
  }

  function renderHypso() {
    const { props, hypsoState } = current;
    if (props.hypso_permille && props.hypso_z0_m !== undefined) renderHypsometry(panels.hypsometry, props);
    else panels.hypsometry.replaceChildren(h("p", { class: "muted" }, hypsoState === "none" ? "No hypsometry data." : "Loading…"));
  }

  function render() {
    renderHead();
    renderOverview();
    renderHypso();
  }

  /** Hook for the photo area. */
  function renderPhotos(photos) {
    void photos;
  }

  async function load(glacier, mine, signal) {
    const isCurrent = () => current === mine && !signal.aborted;
    try {
      let row = glacier.row;
      if (row === undefined || row === null) row = (await ctx.parquet?.rowOf?.(mine.rgiId)) ?? null;
      if (!isCurrent()) return;
      if (row === null) {
        mine.hypsoState = "none";
        renderHypso();
        return;
      }
      mine.row = row;
      const wanted = missingAttributes(glacier.props);
      const columns = [...new Set([...CARD_COLUMNS, ...(wanted.length ? ATTRIBUTE_COLUMNS : [])])];
      const values = await readRow(ctx.parquet.handle, row, columns);
      if (!isCurrent()) return;
      Object.assign(mine.props, values);
      render();
    } catch {
      if (!isCurrent()) return;
      mine.hypsoState = "none";
      renderHypso();
    }
  }

  closeButton.addEventListener("click", () => {
    ctx.onClose?.();
    api.close();
  });

  const api = {
    open(glacier) {
      controller?.abort();
      controller = new AbortController();
      const { signal } = controller;
      const mine = { rgiId: glacier.rgiId, row: glacier.row, props: { ...glacier.props } };
      current = mine;
      state.rgi6Open = false;
      state.moreOpen = false;
      section.hidden = false;
      render();
      selectTab(state.tab);
      new Promise((resolve) => resolve(ctx.photos?.(glacier, signal)))
        .then((photos) => {
          if (current === mine && !signal.aborted) renderPhotos(photos);
        })
        .catch(() => {});
      return load(glacier, mine, signal);
    },
    close() {
      controller?.abort();
      controller = null;
      current = null;
      section.hidden = true;
    },
  };
  selectTab(state.tab);
  return api;
}
