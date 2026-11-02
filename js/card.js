/* The glacier card: photo area, header, actions and the Overview and Hypsometry tabs. */

import { ATTRIBUTE_COLUMNS, GROUP_TITLES, missingAttributes, nonEmpty, overviewRows } from "./columns.js";
import { renderHypsometry } from "./hypsometry.js";
import { CARD_COLUMNS, readRow } from "./parquet.js";
import { commonsThumb, esriCrop, findCropSource } from "./photo.js";
import { mountStrip } from "./strip.js";
import { PHONE, h, icon, popover } from "./ui.js";
import { openViewer } from "./viewer.js";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "hypsometry", label: "Hypsometry" },
];
const SHOWN_LINKS = 3;
/* The imagery crop's pixel size, and the rows at its top that something covers. */
const CROP = { size: [816, 400], top: 0 };
const IMAGERY_CREDIT = "Esri, Vantor, Earthstar Geographics";
/* The width of the Commons thumbnail the viewer shows. */
const VIEWER_PHOTO_WIDTH = 1600;
const isHttp = (url) => /^https?:\/\//i.test(url ?? "");

/** The first-order region code inside an RGI glacier or complex ID, such as "11" in RGI2000-v7.0-G-11-02596. */
export const regionOfId = (id) => /-[GC]-(\d{2})-/.exec(id ?? "")?.[1] ?? null;

/** A text button that calls `onClick`. */
/* A text button with a Lucide icon before its label. */
function button(label, className, onClick, glyph) {
  const node = h("button", { type: "button", class: className }, ...(glyph ? [icon(glyph)] : []), label);
  node.addEventListener("click", onClick);
  return node;
}

export function infoButton(label, description) {
  if (!description) return [null, null];
  const button = h("button", { type: "button", class: "info", "aria-label": `About ${label}` }, icon("circle-question-mark"));
  return [button, popover(button, "info-popover", description)];
}

/**
 * A photo's credit: one line of text along the photo's bottom left, set like
 * the map's credits, its items comma-separated. It needs no label: it sits on
 * what it credits.
 */
function photoCredit(...items) {
  return h("div", { class: "photo-credit" }, ...creditParts(items));
}

const creditParts = (items) => items.filter(Boolean).flatMap((item, i) => (i ? [", ", item] : [item]));

/**
 * Marks `section` as the panel last opened in `root`, which holds the glacier
 * card and the complex panel. On desktop the sidebar keeps drawing that panel
 * while it slides out; a panel the other replaced is not drawn.
 */
function markCurrent(root, section) {
  for (const panel of root.children) panel.classList.toggle("current", panel === section);
}

/** Hide `container` unless a panel in it shows. */
function settle(container) {
  container.hidden = ![...container.children].some((panel) => !panel.hidden);
}

/**
 * The frame the glacier card and the complex panel share: the photo area, the
 * header and the actions, in a section above `body`. On desktop the section
 * goes in `root` with the header and the actions under the photo, and only
 * the search bar's Close closes the panel. On the phone, with `ctx.band`, the
 * section goes in `ctx.sheet` (or `root`), and a close button of its own that
 * calls `ctx.onClose`, the header and the actions go in the band, hidden while the
 * panel is closed, so the other panel can use the band. A change of layout
 * moves them across. `onUseData` and `onZoom` serve the actions.
 * `show(on)` opens or closes the panel.
 */
/** The key numbers as tiles, each with its label and info button. */
export function keyGrid(rows) {
  return h("div", { class: "key-grid" }, rows.map((row) => {
    const [info, popover] = infoButton(row.label, row.description);
    return h("div", { class: "key-tile" },
      h("div", { class: "row-label" }, row.label, info),
      h("div", { class: "key-value" }, row.value),
      popover);
  }));
}

export function cardFrame(root, ctx, { label, className, body, onUseData, onZoom }) {
  const photo = h("div", { class: "photo" });
  const head = h("header", { class: "card-head" });
  const actions = h("div", { class: "card-actions" },
    button("Use this data", "btn primary", onUseData, "database"),
    button("Zoom to", "btn", onZoom, "scan-search"),
    button("Share", "btn", () => ctx.onShare?.(), "share-2"));
  const close = h("button", { type: "button", class: "icon-button card-close", "aria-label": "Close" }, icon("x"));
  close.addEventListener("click", () => ctx.onClose?.());
  const inBand = [close, head, actions];
  const section = h("section", { class: className, "aria-label": label, hidden: true }, photo, ...body);
  const sheet = ctx.sheet ?? root;
  let open = false;
  /* The container that holds the section now. */
  let home = null;

  const inSheet = () => Boolean(ctx.band) && PHONE.matches;

  function place() {
    if (inSheet()) {
      ctx.band.append(...inBand);
      for (const node of inBand) node.hidden = !open;
    } else {
      close.remove();
      photo.after(head, actions);
      head.hidden = false;
      actions.hidden = false;
    }
    home = inSheet() ? sheet : root;
    home.append(section);
    if (open) markCurrent(home, section);
    for (const container of new Set([root, sheet])) settle(container);
  }

  function show(on) {
    open = on;
    if (inSheet()) for (const node of inBand) node.hidden = !on;
    section.hidden = !on;
    home.hidden = !on;
    if (on) markCurrent(home, section);
  }
  place();
  if (ctx.band) PHONE.addEventListener("change", place);
  show(false);
  return { photo, head, show };
}

/** A plain block in place of an imagery crop that failed. */
export const placeholder = () => h("div", { class: "photo-placeholder", style: { background: "var(--image-placeholder)" } });

/**
 * The credit of an Esri crop of `bbox` at `size` with `top` rows covered.
 * Once Esri names the imagery's provider and capture date, they replace the
 * fixed credit; a credit no longer shown changes unseen.
 */
export function imageryCredit(bbox, size, top) {
  const credit = photoCredit(IMAGERY_CREDIT);
  findCropSource(bbox, ...size, top).then((source) => {
    if (source) credit.replaceChildren(...creditParts(["Esri", source.provider, source.date && `imaged ${source.date}`]));
  });
  return credit;
}

/** The strip item of the imagery crop of `bbox`, framed as `crop` says. */
export function imageryItem(bbox, { key = "imagery", crop = CROP, alt, onError }) {
  return {
    key,
    src: esriCrop(bbox, ...crop.size, crop.top),
    alt,
    className: "photo-crop",
    credit: () => imageryCredit(bbox, crop.size, crop.top),
    onError,
  };
}

const link = (href, text) => (isHttp(href) ? h("a", { href, target: "_blank", rel: "noopener noreferrer" }, text) : text);

/**
 * The strip item of a Commons photo. Its credit names the author, linked to
 * the file's page, and the license, linked to its deed; with no author, the
 * license alone.
 */
export function photoItem(photo, { alt, onError }) {
  const credit = () => {
    const author = photo.author ? h("span", { class: "credit-author" }, link(photo.page, photo.author)) : null;
    const license = photo.license ? link(photo.licenseUrl, photo.license) : null;
    const parts = [author, license].filter(Boolean).flatMap((part, i) => (i ? [" · ", part] : [part]));
    return h("div", { class: "photo-credit photo-credit-photo" }, ...parts);
  };
  return { key: photo.page, src: photo.src, alt, credit, onError };
}

/*
 * The viewer's crop: the glacier framed at 3:2, the shape of the photos it
 * sits among, and the same on every screen. 1200 px wide keeps World Imagery
 * on its even levels; asked for more detail, it can switch to a patchwork of
 * scenes from different dates (Dyngjujokull, near 1400 px and above).
 */
const VIEWER_CROP = [1200, 800];

/** The viewer item of the imagery crop of `bbox`: framed on its own, nothing covering it. */
export const imageryViewerItem = (bbox, alt) => ({
  alt,
  ratio: VIEWER_CROP[0] / VIEWER_CROP[1],
  large: () => esriCrop(bbox, ...VIEWER_CROP, 0),
  credit: () => imageryCredit(bbox, VIEWER_CROP, 0),
});

/** The viewer item of a Commons photo: a larger thumbnail and the full credit. */
function photoViewerItem(photo, alt) {
  const credit = () => {
    const parts = [
      photo.author,
      photo.license ? link(photo.licenseUrl, photo.license) : null,
      photo.source,
      isHttp(photo.page) ? h("a", { href: photo.page, target: "_blank", rel: "noopener noreferrer" }, "View on Commons") : null,
    ].filter(Boolean);
    return h("div", {}, ...parts.flatMap((part, i) => (i ? [" · ", part] : [part])));
  };
  return { alt, thumb: photo.src, large: () => commonsThumb(photo.file ?? "", VIEWER_PHOTO_WIDTH), credit };
}

/**
 * Mounts the card into `root` and returns `{ open(glacier), close() }`.
 * `glacier` is `{ rgiId, row?, props? }`. On the phone, with `ctx.band`, the
 * close button, the header and the actions go there and the rest in
 * `ctx.sheet`, as cardFrame says.
 * `ctx.onTitle(title)` hears the title each time the header draws.
 */
export function mountCard(root, ctx) {
  const state = { tab: "overview", rgi6Open: false, moreOpen: false, submissionOpen: false };
  let current = null;
  let controller = null;

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
  const { photo, head, show } = cardFrame(root, ctx, {
    label: "Glacier",
    className: "card",
    body: [tablist, ...Object.values(panels)],
    onUseData: () => ctx.onUseData?.(glacierNow()),
    onZoom: () => ctx.onZoom?.(current.props.bbox ?? current.props),
  });
  const strip = mountStrip(photo, {
    label: "Glacier images",
    onOpen: (index) => openViewer(viewerItems(), index, { onClose: (i) => strip.show(i), returnFocus: (i) => strip.buttonAt(i) }),
  });
  const empty = placeholder();

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

  function renderHead() {
    const { rgiId, props } = current;
    /* glac_name holds placeholders such as "Unnamed_23", so a glacier without a display_name shows its ID. */
    const name = nonEmpty(props.display_name);
    const code = nonEmpty(props.o1region) ?? regionOfId(rgiId);
    const region = (ctx.regions ?? []).find((r) => Number(r.level) === 1 && r.o1region === code)?.full_name;
    const subtitle = ["Glacier", name ? rgiId : null, region].filter(Boolean).join(" · ");
    ctx.onTitle?.(name ?? rgiId);
    head.replaceChildren(
      h("h2", { class: "card-title" }, name ?? rgiId),
      subtitle ? h("p", { class: "card-subtitle" }, subtitle) : null,
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
    /* The first ID that "+ N more" reveals takes the focus from the button it replaces. */
    wrap.append(...shown.map((id, i) => h("span", { class: "link-id", tabIndex: i === SHOWN_LINKS ? -1 : null }, id)));
    if (row.list.length > shown.length) {
      const more = button(`+ ${row.list.length - shown.length} more`, "link more-links", () => {
        state.rgi6Open = true;
        renderOverview();
        panels.overview.querySelector(".link-id[tabindex]")?.focus();
      });
      wrap.append(more);
    }
    return wrap;
  }

  function renderRow(row) {
    const [info, popover] = infoButton(row.label, row.description);
    return h("div", { class: row.more ? "row more" : "row", hidden: row.more && !state.moreOpen },
      h("div", { class: "row-label" }, row.label),
      h("div", { class: "row-value" }, renderValue(row)),
      info,
      popover);
  }

  function renderOverview() {
    const nodes = overviewRows(current.props, ctx.catalog.columns, ctx.regions).map(({ group, rows }) => {
      if (group === "key") return keyGrid(rows);
      if (!rows.length) return null;
      const body = rows.map(renderRow);
      if (rows.some((r) => r.more)) {
        const toggle = button(state.moreOpen ? "show less" : "show more", "link show-more", () => {
          state.moreOpen = !state.moreOpen;
          renderOverview();
          panels.overview.querySelector(`.group-${group} .show-more`)?.focus();
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
   * The photo area: the imagery crop first, as soon as the bbox is known, then
   * the photos as they arrive. A crop that fails leaves the photos alone, or
   * a plain block when there are none; a photo that fails drops out.
   */
  const IMAGERY_ALT = "Satellite imagery of the glacier";
  const photoAlt = () => `Photo of ${head.querySelector(".card-title")?.textContent ?? ""}`;

  /** What the strip shows, in order: the crop unless it failed, then the photos that loaded. */
  function shownImages() {
    const { photos, cropFailed, failed } = current.photos;
    const { bbox } = current.props;
    return {
      bbox: bbox && !cropFailed ? bbox : null,
      photos: (photos ?? []).filter((p) => !failed.has(p.page)),
    };
  }

  function renderPhotoArea() {
    const mine = current;
    const { bbox, photos } = shownImages();
    strip.update([
      /* Keyed by glacier: a new glacier's crop is a new image, so the last one's never shows under its title. */
      ...(bbox ? [imageryItem(bbox, { key: `imagery:${mine.rgiId}`, crop: ctx.crop, alt: IMAGERY_ALT, onError: cropFailedFor(mine) })] : []),
      ...photos.map((p) => photoItem(p, { alt: photoAlt(), onError: photoFailedFor(mine, p) })),
    ]);
    if (mine.photos.cropFailed && !photos.length) photo.append(empty);
    else empty.remove();
  }

  /** The viewer's items, in the strip's order. */
  function viewerItems() {
    const { bbox, photos } = shownImages();
    return [...(bbox ? [imageryViewerItem(bbox, IMAGERY_ALT)] : []), ...photos.map((p) => photoViewerItem(p, photoAlt()))];
  }

  const cropFailedFor = (mine) => () => {
    if (current !== mine) return;
    mine.photos.cropFailed = true;
    renderPhotoArea();
  };

  const photoFailedFor = (mine, p) => () => {
    if (current !== mine) return;
    mine.photos.failed.add(p.page);
    renderPhotoArea();
  };

  function renderPhotos(photos) {
    current.photos.photos = Array.isArray(photos) ? photos : [];
    renderPhotoArea();
  }

  /* The crop is framed per layout, so a change of layout re-frames it in place. */
  PHONE.addEventListener("change", () => {
    if (current) renderPhotoArea();
  });

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

  const api = {
    open(glacier) {
      controller?.abort();
      controller = new AbortController();
      const { signal } = controller;
      const mine = {
        rgiId: glacier.rgiId,
        row: glacier.row,
        props: { ...glacier.props },
        photos: { photos: null, cropFailed: false, failed: new Set() },
      };
      current = mine;
      state.rgi6Open = false;
      state.moreOpen = false;
      show(true);
      render();
      strip.show(0);
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
      show(false);
    },
  };
  selectTab(state.tab);
  return api;
}
