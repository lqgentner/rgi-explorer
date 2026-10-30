/*
 * The complex panel: the imagery crop, header, actions, what RGI publishes
 * for the complex, and a table of its glaciers. It takes the glacier card's
 * place; one of the two is open at a time.
 */

import { cardFrame, imageryCrop, infoButton, placeholder, regionOfId } from "./card.js";
import { complexRows, formatArea } from "./columns.js";
import { h } from "./ui.js";

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

  const facts = h("section", { class: "group group-complex" });
  const members = h("section", { class: "group members" });
  const regionCode = () => current.props?.o1region ?? regionOfId(current.id);
  const { photo, head, show } = cardFrame(root, ctx, {
    label: "Glacier complex",
    className: "card complex-card",
    body: [facts, members],
    onUseData: () => ctx.onUseData?.({ kind: "complex", rgiId: current.id, o1region: regionCode() }),
    onZoom: () => ctx.onZoom?.(current.props?.bbox ?? null),
  });

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
          h("div", { class: "row-label" }, row.label),
          h("div", { class: "row-value" }, row.value),
          info,
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
    const onError = () => {
      if (current !== mine) return;
      mine.cropFailed = true;
      renderPhoto();
    };
    if (mine.cropFailed) photo.replaceChildren(placeholder());
    else if (bbox) photo.replaceChildren(...imageryCrop(photo, bbox, { crop: ctx.crop, alt: "Satellite imagery of the complex", onError }));
    else photo.replaceChildren();
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
