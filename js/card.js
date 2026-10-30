/* The glacier card: photo area, header, actions and the Overview and Hypsometry tabs. */

import { ATTRIBUTE_COLUMNS, DISPLAY, GROUP_TITLES, formatArea, missingAttributes, nonEmpty, overviewRows } from "./columns.js";
import { renderHypsometry } from "./hypsometry.js";
import { CARD_COLUMNS, readRow } from "./parquet.js";
import { esriCrop } from "./photo.js";
import { h, icon, popover } from "./ui.js";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "hypsometry", label: "Hypsometry" },
];
const SHOWN_LINKS = 3;
/* The imagery crop's pixel size, and the rows at its top that something covers. */
const CROP = { size: [816, 400], top: 0 };
const IMAGERY_CREDIT = "Imagery: Esri, Maxar, Earthstar Geographics";
const isHttp = (url) => /^https?:\/\//i.test(url ?? "");
const AREA_UNIT = DISPLAY.find((d) => d.column === "area_km2").unit;

/** The first-order region code inside an RGI ID, such as "11" in RGI2000-v7.0-G-11-02596. */
const regionOfId = (rgiId) => /-G-(\d{2})-/.exec(rgiId ?? "")?.[1] ?? null;

function infoButton(label, description) {
  if (!description) return [null, null];
  const button = h("button", { type: "button", class: "info", "aria-label": `About ${label}` }, "ⓘ");
  return [button, popover(button, "info-popover", description)];
}

/**
 * A photo credit folded into an info button at the photo's bottom left. A click
 * opens it out to the right, inside the photo, as MapLibre's compact
 * attribution does; a press anywhere else but the photo arrows, or Escape,
 * folds it again. `onToggle(open)` hears each change.
 */
function photoCredit(label, className, open, onToggle, ...children) {
  const button = h("button", { type: "button", class: "icon-button photo-info", "aria-label": label }, icon("info"));
  const text = h("div", { class: `photo-attrib-text ${className}` }, ...children);
  const pill = h("div", { class: "photo-attrib" }, button, text);
  const close = () => {
    set(false);
    onToggle(false);
  };
  /* The arrows show the next photo's credit, so the credit stays open for them. */
  const outside = (event) => {
    if (!pill.isConnected) document.removeEventListener("pointerdown", outside, true);
    else if (!pill.contains(event.target) && !event.target.closest?.(".photo-prev, .photo-next")) close();
  };
  function set(next) {
    text.hidden = !next;
    button.setAttribute("aria-expanded", String(next));
    pill.classList.toggle("open", next);
    if (next) document.addEventListener("pointerdown", outside, true);
    else document.removeEventListener("pointerdown", outside, true);
  }
  button.addEventListener("click", () => {
    set(text.hidden);
    onToggle(!text.hidden);
  });
  pill.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || text.hidden) return;
    close();
    button.focus();
  });
  set(open);
  return pill;
}

/**
 * Mounts the card into `root` and returns `{ open(glacier), close() }`.
 * `glacier` is `{ rgiId, row?, props? }`. With `ctx.band`, the close button,
 * the header and the actions go there and the rest stays in `root`.
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
  const top = ctx.band ? [] : [closeButton, head, actions];
  const section = h("section", { class: "card", "aria-label": "Glacier", hidden: true },
    photo, ...top, tablist, ...Object.values(panels));
  ctx.band?.append(closeButton, head, actions);
  root.hidden = true;
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
    const area = Number.isFinite(props.area_km2) ? `${formatArea(props.area_km2)} ${AREA_UNIT}` : null;
    head.replaceChildren(
      h("h2", { class: "card-title" }, name ?? rgiId),
      subtitle ? h("p", { class: "card-subtitle" }, subtitle) : null,
      area ? h("p", { class: "card-area" }, area) : null,
    );
  }

  function renderValue(row) {
    if (row.list) return renderLinks(row);
    if (row.link) {
      /* The icon says the link leaves the explorer for a new tab. */
      const attrs = { class: "external", href: row.link, target: "_blank", rel: "noopener noreferrer", title: "Opens in a new tab" };
      return h("a", attrs, row.value, icon("external-link"));
    }
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
    const usable = Array.isArray(props.hypso_permille) && props.hypso_permille.length > 0 && Number.isFinite(props.hypso_z0_m);
    if (usable) renderHypsometry(panels.hypsometry, props);
    else panels.hypsometry.replaceChildren(h("p", { class: "muted" }, hypsoState === "done" ? "No hypsometry data." : "Loading…"));
  }

  function render() {
    renderHead();
    renderOverview();
    renderHypso();
    renderPhotoArea();
  }

  /**
   * The photo area: a carousel once photos arrive. Until then, and when there
   * are none, the imagery crop as soon as the bbox is known. A plain block
   * when the crop fails.
   */
  function renderPhotoArea() {
    const { photos, cropFailed } = current.photos;
    const { bbox } = current.props;
    if (photos?.length) photo.replaceChildren(...carousel(photos));
    else if (cropFailed) photo.replaceChildren(plainBlock());
    else if (bbox) photo.replaceChildren(...imageryCrop(bbox));
    else photo.replaceChildren();
  }

  const plainBlock = () => h("div", { class: "photo-placeholder", style: { background: "var(--line)" } });

  function imageryCrop(bbox) {
    const mine = current;
    const { size, top } = ctx.crop ?? CROP;
    const src = esriCrop(bbox, ...size, top);
    const existing = photo.querySelector("img.photo-crop");
    if (existing?.getAttribute("src") === src) return [...photo.childNodes];
    const image = h("img", { class: "photo-crop", src, alt: "Satellite imagery of the glacier", loading: "lazy" });
    image.addEventListener("error", () => {
      if (current !== mine) return;
      mine.photos.cropFailed = true;
      renderPhotoArea();
    });
    return [image, photoCredit("Image credit", "photo-credit", mine.photos.creditOpen, remember(mine), IMAGERY_CREDIT)];
  }

  /* An open credit stays open as the photos change. */
  const remember = (glacier) => (open) => {
    glacier.photos.creditOpen = open;
  };

  function carousel(photos) {
    const at = current.photos.index;
    const shown = photos[at];
    const title = head.querySelector(".card-title")?.textContent ?? "";
    const details = photoCredit("Photo details", "photo-details", current.photos.creditOpen, remember(current),
      h("p", {}, isHttp(shown.page) ? h("a", { href: shown.page, target: "_blank", rel: "noopener noreferrer" }, shown.source) : shown.source),
      shown.author ? h("p", {}, shown.author) : null,
      shown.license
        ? h("p", {}, isHttp(shown.licenseUrl)
          ? h("a", { href: shown.licenseUrl, target: "_blank", rel: "noopener noreferrer" }, shown.license)
          : shown.license)
        : null);
    const step = (delta, label, name) => {
      const node = h("button", { type: "button", class: `icon-button photo-${label}`, "aria-label": `${label === "prev" ? "Previous" : "Next"} photo` }, icon(name));
      node.addEventListener("click", () => {
        current.photos.index = (at + delta + photos.length) % photos.length;
        renderPhotoArea();
        photo.querySelector(`.photo-${label}`)?.focus();
      });
      return node;
    };
    return [
      h("img", { src: shown.src, alt: `Photo of ${title}`, loading: "lazy" }),
      photos.length > 1 ? step(-1, "prev", "chevron-left") : null,
      photos.length > 1 ? step(1, "next", "chevron-right") : null,
      details,
    ];
  }

  function renderPhotos(photos) {
    current.photos.photos = Array.isArray(photos) ? photos : [];
    current.photos.index = 0;
    renderPhotoArea();
  }

  async function load(glacier, mine, signal) {
    const isCurrent = () => current === mine && !signal.aborted;
    try {
      let row = glacier.row;
      if (row === undefined || row === null) row = (await ctx.parquet?.rowOf?.(mine.rgiId)) ?? null;
      if (!isCurrent()) return;
      if (row === null) {
        mine.hypsoState = "done";
        renderHypso();
        return;
      }
      mine.row = row;
      const wanted = missingAttributes(glacier.props);
      const columns = [...new Set([...CARD_COLUMNS, ...(wanted.length ? ATTRIBUTE_COLUMNS : [])])];
      const values = await readRow(ctx.parquet.handle, row, columns);
      if (!isCurrent()) return;
      Object.assign(mine.props, values);
      mine.hypsoState = "done";
      render();
    } catch {
      if (!isCurrent()) return;
      mine.hypsoState = "done";
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
      const mine = {
        rgiId: glacier.rgiId,
        row: glacier.row,
        props: { ...glacier.props },
        photos: { photos: null, index: 0, cropFailed: false, creditOpen: false },
      };
      current = mine;
      state.rgi6Open = false;
      state.moreOpen = false;
      root.hidden = false;
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
      root.hidden = true;
    },
  };
  selectTab(state.tab);
  return api;
}
