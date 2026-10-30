/*
 * The complex panel: the imagery crop, header, actions, what RGI publishes
 * for the complex, and a table of its glaciers. It takes the glacier card's
 * place; one of the two is open at a time.
 */

import { IMAGERY_CREDIT, infoButton, markCurrent, photoCredit } from "./card.js";
import { complexRows, formatArea } from "./columns.js";
import { esriCrop } from "./photo.js";
import { h, icon } from "./ui.js";

/* The imagery crop's pixel size, and the rows at its top that something covers. */
const CROP = { size: [816, 400], top: 0 };
const AREA_UNIT = "km²";
const READ_FAILED = "The complex could not be read.";

/** The first-order region code inside a complex ID, such as "11" in RGI2000-v7.0-C-11-01323. */
const regionOfId = (complexId) => /-C-(\d{2})-/.exec(complexId ?? "")?.[1] ?? null;

/**
 * Mounts the panel into `root` and returns `{ open(complexId), close() }`.
 * `ctx.read(complexId)` resolves with the complex's row, or null when it is
 * unknown; `ctx.members(props)` resolves with `{ rgiId, name, area }` for each
 * glacier, largest first. With `ctx.band`, the close button, the header and
 * the actions go there and the rest stays in `root`.
 */
export function mountComplexCard(root, ctx) {
  let current = null;

  const photo = h("div", { class: "photo" });
  const head = h("header", { class: "card-head" });
  const closeButton = h("button", { type: "button", class: "icon-button card-close", "aria-label": "Close" }, icon("x"));
  const actions = h("div", { class: "card-actions" });
  const facts = h("section", { class: "group group-complex" });
  const members = h("section", { class: "group members" });
  const top = ctx.band ? [] : [closeButton, head, actions];
  const section = h("section", { class: "card complex-card", "aria-label": "Glacier complex", hidden: true },
    photo, ...top, facts, members);
  ctx.band?.append(closeButton, head, actions);
  const showBand = (on) => {
    if (ctx.band) for (const node of [closeButton, head, actions]) node.hidden = !on;
  };
  showBand(false);
  root.hidden = true;
  root.append(section);

  const regionCode = () => current.props?.o1region ?? regionOfId(current.id);

  function button(label, className, onClick) {
    const node = h("button", { type: "button", class: className }, label);
    node.addEventListener("click", onClick);
    return node;
  }
  actions.append(
    button("Use this data", "btn primary", () =>
      ctx.onUseData?.({ kind: "complex", rgiId: current.id, o1region: regionCode() })),
    button("Zoom to", "btn", () => ctx.onZoom?.(current.props?.bbox ?? null)),
    button("Share", "btn", () => ctx.onShare?.()),
  );

  function renderHead() {
    const code = regionCode();
    const region = (ctx.regions ?? []).find((r) => Number(r.level) === 1 && r.o1region === code)?.full_name;
    const area = current.props?.area_km2;
    ctx.onTitle?.(current.id);
    head.replaceChildren(
      h("h2", { class: "card-title" }, current.id),
      h("p", { class: "card-subtitle" }, ["Complex", region].filter(Boolean).join(" · ")),
      Number.isFinite(area) ? h("p", { class: "card-area" }, `${formatArea(area)} ${AREA_UNIT}`) : null,
    );
  }

  function renderFacts() {
    const { state, props } = current;
    if (state !== "done" || !props) {
      facts.replaceChildren(h("p", { class: "muted" }, state === "loading" ? "Loading…" : READ_FAILED));
      return;
    }
    facts.replaceChildren(
      ...complexRows(props, ctx.catalog.complexColumns ?? new Map(), ctx.regions).map((row) => {
        const [info, popover] = infoButton(row.label, row.description);
        return h("div", { class: "row" },
          h("div", { class: "row-label" }, row.label, info),
          h("div", { class: "row-value" }, row.value),
          popover);
      }),
    );
  }

  function renderMembers() {
    const list = current.members;
    if (!list) {
      members.replaceChildren(...(current.state === "loading" ? [h("h3", {}, "Glaciers"), h("p", { class: "muted" }, "Loading…")] : []));
      return;
    }
    const rows = list.map((member) => {
      const tr = h("tr", {},
        h("td", { class: "name", title: member.name ?? "" }, member.name ?? ""),
        h("td", {}, h("button", { type: "button", class: "link" }, member.rgiId)),
        h("td", { class: "num" }, Number.isFinite(member.area) ? formatArea(member.area) : ""));
      /* The ID's button and the rest of the row open the glacier alike. */
      tr.addEventListener("click", () => ctx.onOpenGlacier?.(member.rgiId));
      return tr;
    });
    members.replaceChildren(
      h("h3", {}, "Glaciers"),
      h("div", { class: "members-scroll" },
        h("table", { class: "members" },
          /* Fixed columns: the ID and the area keep their width and a long name is cut short. */
          h("colgroup", {}, h("col", { class: "name" }), h("col", { class: "id" }), h("col", { class: "num" })),
          h("thead", {}, h("tr", {}, h("th", {}, "Name"), h("th", {}, "RGI ID"), h("th", { class: "num" }, "Area", h("br"), AREA_UNIT))),
          h("tbody", {}, rows))),
    );
  }

  /** The imagery crop of the complex once its bbox is known; a plain block when it fails. */
  function renderPhoto() {
    const mine = current;
    const bbox = mine.props?.bbox;
    if (mine.cropFailed) {
      photo.replaceChildren(h("div", { class: "photo-placeholder", style: { background: "var(--line)" } }));
      return;
    }
    if (!bbox) {
      photo.replaceChildren();
      return;
    }
    const { size, top: covered } = ctx.crop ?? CROP;
    const image = h("img", { class: "photo-crop", src: esriCrop(bbox, ...size, covered), alt: "Satellite imagery of the complex", loading: "lazy" });
    image.addEventListener("error", () => {
      if (current !== mine) return;
      mine.cropFailed = true;
      renderPhoto();
    });
    photo.replaceChildren(image, photoCredit("Imagery", IMAGERY_CREDIT));
  }

  function render() {
    renderHead();
    renderFacts();
    renderMembers();
    renderPhoto();
  }

  async function load(mine) {
    try {
      mine.props = await ctx.read(mine.id);
      if (current !== mine) return;
      mine.state = mine.props ? "done" : "failed";
    } catch {
      if (current !== mine) return;
      mine.state = "failed";
    }
    render();
    if (!mine.props) return;
    let list;
    try {
      list = await ctx.members(mine.props);
    } catch {
      list = (mine.props.glacier_ids ?? []).map((rgiId) => ({ rgiId, name: null, area: null }));
    }
    if (current !== mine) return;
    mine.members = list;
    renderMembers();
  }

  closeButton.addEventListener("click", () => {
    ctx.onClose?.();
    api.close();
  });

  const api = {
    open(complexId) {
      const mine = { id: complexId, props: null, state: "loading", members: null, cropFailed: false };
      current = mine;
      root.hidden = false;
      section.hidden = false;
      markCurrent(root, section);
      showBand(true);
      render();
      return load(mine);
    },
    close() {
      current = null;
      section.hidden = true;
      showBand(false);
      root.hidden = true;
    },
  };
  return api;
}
