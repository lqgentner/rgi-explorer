/*
 * The complex panel: the imagery crop, header, actions, what RGI publishes
 * for the complex, and a table of its glaciers. It takes the glacier card's
 * place; one of the two is open at a time.
 */

import { cardFrame, imageryItem, imageryViewerItem, infoButton, keyGrid, placeholder, regionOfId } from "./card.js";
import { mountStrip } from "./strip.js";
import { GROUP_TITLES, complexRows, formatArea } from "./columns.js";
import { PHONE, h } from "./ui.js";
import { openViewer } from "./viewer.js";

const AREA_UNIT = "km²";
const READ_FAILED = "The complex could not be read.";

/**
 * Mounts the panel into `root` and returns `{ open(complexId), close() }`.
 * `ctx.read(complexId)` resolves with the complex's row, or null when it is
 * unknown; `ctx.members(props)` resolves with `{ rgiId, name, area }` for each
 * glacier, largest first. On the phone, with `ctx.band`, the close button,
 * the header and the actions go there and the rest in `ctx.sheet`, as
 * cardFrame says.
 */
export function mountComplexCard(root, ctx) {
  let current = null;

  /* The key numbers and the location, as the glacier card's overview shows them. */
  const facts = h("div", { class: "complex-facts" });
  const members = h("section", { class: "group members" });
  const regionCode = () => current.props?.o1region ?? regionOfId(current.id);
  const { photo, head, show } = cardFrame(root, ctx, {
    label: "Glacier complex",
    className: "card complex-card",
    body: [facts, members],
    onUseData: () => ctx.onUseData?.({ kind: "complex", rgiId: current.id, o1region: regionCode() }),
    onZoom: () => ctx.onZoom?.(current.props?.bbox ?? null),
  });
  const strip = mountStrip(photo, {
    label: "Complex image",
    onOpen: (index, button) => {
      const bbox = current?.props?.bbox;
      if (bbox) openViewer([imageryViewerItem(bbox, "Satellite imagery of the complex")], 0, { onClose: (i) => strip.show(i), returnFocus: button });
    },
  });
  const empty = placeholder();
  /* The crop is framed per layout, so a change of layout re-frames it in place. */
  PHONE.addEventListener("change", () => {
    if (current) renderPhoto();
  });

  function renderHead() {
    const code = regionCode();
    const region = (ctx.regions ?? []).find((r) => Number(r.level) === 1 && r.o1region === code)?.full_name;
    ctx.onTitle?.(current.id);
    head.replaceChildren(
      h("h2", { class: "card-title" }, current.id),
      h("p", { class: "card-subtitle" }, ["Complex", region].filter(Boolean).join(" · ")),
    );
  }

  function renderFacts() {
    const { state, props } = current;
    if (state !== "done" || !props) {
      facts.replaceChildren(h("p", { class: "muted" }, state === "loading" ? "Loading…" : READ_FAILED));
      return;
    }
    const row = (r) => {
      const [info, popover] = infoButton(r.label, r.description);
      return h("div", { class: "row" },
        h("div", { class: "row-label" }, r.label),
        h("div", { class: "row-value" }, r.value),
        info,
        popover);
    };
    facts.replaceChildren(
      ...complexRows(props, ctx.catalog.complexColumns ?? new Map(), ctx.regions).map(({ group, rows }) => {
        if (group === "key") return keyGrid(rows);
        if (!rows.length) return null;
        return h("section", { class: `group group-${group}` }, h("h3", {}, GROUP_TITLES[group]), rows.map(row));
      }).filter(Boolean),
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
    const onError = () => {
      if (current !== mine) return;
      mine.cropFailed = true;
      renderPhoto();
    };
    strip.update(bbox && !mine.cropFailed ? [imageryItem(bbox, { crop: ctx.crop, alt: "Satellite imagery of the complex", onError })] : []);
    if (mine.cropFailed) photo.append(empty);
    else empty.remove();
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

  return {
    open(complexId) {
      const mine = { id: complexId, props: null, state: "loading", members: null, cropFailed: false };
      current = mine;
      show(true);
      render();
      return load(mine);
    },
    close() {
      current = null;
      show(false);
    },
  };
}
