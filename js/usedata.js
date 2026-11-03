/*
 * "Use this data": a ready snippet for GeoPandas, or the steps to add the
 * GeoParquet in QGIS, for one glacier, its region or all glaciers, or for one
 * complex, its region or all complexes. A dialog on desktop and a pane in the
 * bottom sheet on the phone.
 */

import { regionOfId } from "./state.js";
import { TIMEOUT_MS } from "./config.js";
import { closeDialog, h, icon, isDialogOpen, openDialog, PHONE } from "./ui.js";

const TOOLS = [
  { value: "python", label: "Python" },
  { value: "qgis", label: "QGIS" },
];
/* What each panel offers to fetch: the file it reads and the column it filters on. */
const SCOPES = {
  glacier: [
    { value: "glacier", label: "This glacier", file: "glaciers", key: "rgi_id" },
    { value: "region", label: "Its region", file: "glaciers", key: "o1region" },
    { value: "all", label: "All glaciers", file: "glaciers" },
  ],
  complex: [
    { value: "complex", label: "This complex", file: "complexes", key: "rgi_id" },
    { value: "region", label: "Its region", file: "complexes", key: "o1region" },
    { value: "all", label: "All complexes", file: "complexes" },
  ],
};
const COPIED_MS = 1500;

const scopesOf = (target) => SCOPES[target.kind] ?? SCOPES.glacier;
/** The scope a choice names for a target, or the target's first. */
const scopeOf = (scope, target) => scopesOf(target).find((s) => s.value === scope) ?? scopesOf(target)[0];
/** The data file a choice reads. */
const fileOf = (scope, target, catalog) => catalog.collections[scopeOf(scope, target).file].dataUrl;
/** The file that "all" reads, whose size the note gives. */
const allFileOf = (target, catalog) => fileOf("all", target, catalog);

/** A Python string literal. JSON's double-quoted form is one for this text. */
const py = (text) => JSON.stringify(String(text));
/** A QGIS expression string literal. */
const sql = (text) => `'${String(text).replaceAll("'", "''")}'`;

const sizeNote = (bytes) =>
  Number.isFinite(bytes) && bytes > 0 ? `Reads the whole file, about ${Math.round(bytes / 1e6)} MB.` : undefined;

/**
 * The snippet for a choice. `bytes`, the size of the file "all" reads, adds the
 * size note to "all"; without it the note is left out.
 *
 * @param {{tool: "python"|"qgis", scope: string}} choice  a scope of the target's kind
 * @param {{kind?: "glacier"|"complex", rgiId: string, o1region?: string}} target  a glacier when `kind` is left out
 * @param {object} catalog  from loadCatalog
 * @param {number} [bytes]
 * @returns {{code?: string, steps?: string[], filter?: string, note?: string}}
 */
export function snippet({ tool, scope }, target, catalog, bytes) {
  const { rgiId, o1region } = target;
  const chosen = scopeOf(scope, target);
  const url = fileOf(scope, target, catalog);
  const note = chosen.value === "all" ? sizeNote(bytes) : undefined;
  const value = chosen.key === "o1region" ? o1region || regionOfId(rgiId) : rgiId;
  const key = chosen.key ? [chosen.key, value] : null;

  if (tool === "qgis") {
    const result = {
      steps: [
        "Layer › Add Layer › Add Vector Layer…",
        "Source Type: Protocol: HTTP(S), cloud, etc.",
        "Protocol Type: HTTP/HTTPS/FTP.",
        `URI: ${url}`,
        'Leave Authentication at "No Authentication" and click Add.',
      ],
    };
    if (key) result.filter = `"${key[0]}" = ${sql(key[1])}`;
    if (note) result.note = note;
    return result;
  }

  const filters = key ? `, filters=[(${py(key[0])}, "==", ${py(key[1])})]` : "";
  const result = {
    code: `import geopandas as gpd\n\nurl = ${py(url)}\ngdf = gpd.read_parquet(url${filters})\n`,
  };
  if (note) result.note = note;
  return result;
}

/* The size of each data file, from one HEAD request per URL; null when unknown. */
const sizes = new Map();
function sizeOf(url) {
  if (!sizes.has(url)) {
    const read = (async () => {
      try {
        const response = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (!response.ok) return null;
        const bytes = Number(response.headers.get("Content-Length"));
        return Number.isFinite(bytes) && bytes > 0 ? bytes : null;
      } catch {
        return null;
      }
    })();
    sizes.set(url, read);
  }
  return sizes.get(url);
}

/**
 * An icon button that copies `text()` and shows a check, named "Copied", for
 * a moment. Fails quietly.
 */
function copyButton(text) {
  const button = h("button", { type: "button", class: "icon-button copy" });
  const show = (glyph, label) => {
    button.replaceChildren(icon(glyph));
    button.setAttribute("aria-label", label);
    button.title = label;
  };
  show("copy", "Copy");
  let timer = null;
  button.addEventListener("click", async () => {
    try {
      await globalThis.navigator.clipboard.writeText(text());
    } catch {
      return;
    }
    show("check", "Copied");
    clearTimeout(timer);
    timer = setTimeout(() => show("copy", "Copy"), COPIED_MS);
  });
  return button;
}

/** A segmented control as a radio group under a legend. */
function segmented(name, legend, options, checked) {
  return h(
    "fieldset",
    { class: "segmented" },
    h("legend", {}, legend),
    h(
      "div",
      { class: "segments" },
      options.map(({ value, label }) =>
        h(
          "label",
          { class: "segment" },
          h("input", { type: "radio", name, value, checked: value === checked }),
          h("span", {}, label),
        ),
      ),
    ),
  );
}

let mounted = 0;

/**
 * Mount "Use this data" and return `{ open(target), close() }`. `target` is
 * `{ kind?, rgiId, o1region? }`, a glacier when `kind` is left out. The
 * desktop gets a dialog in `root`, the phone a pane in `ctx.sheet` (or
 * `root`). Both are made once; the content moves to the one the layout
 * uses, and an open offer stays open across the change.
 *
 * @param {HTMLElement} root
 * @param {{catalog: object, sheet?: HTMLElement}} ctx
 */
export function mountUseData(root, { catalog, sheet = root, onToggle }) {
  mounted += 1;
  const id = `usedata-${mounted}`;
  const choice = { tool: "python", scope: "glacier" };
  let target = null;
  let bytes = null;
  let opener = null;

  const closeButton = h(
    "button",
    { type: "button", class: "icon-button usedata-close", "aria-label": "Close", dataset: { tour: "use-data-close" } },
    icon("x"),
  );
  const body = h("div", { class: "usedata-body" });
  const tools = segmented(`${id}-tool`, "I work in", TOOLS, choice.tool);
  let scopes = segmented(`${id}-scope`, "Fetch", SCOPES.glacier, choice.scope);
  const content = [
    h("div", { class: "pane-header" }, h("h2", { id: `${id}-title` }, "Use this data"), closeButton),
    tools,
    scopes,
    body,
  ];
  const pane = h("div", { class: "usedata usedata-pane", role: "dialog", "aria-labelledby": `${id}-title`, hidden: true });
  const dialog = h("dialog", { class: "usedata", "aria-labelledby": `${id}-title` });
  sheet.append(pane);
  root.append(dialog);
  /* The container the layout uses; the content lives in it. */
  let container = null;

  function render() {
    if (!target) return;
    const { code, steps, filter, note } = snippet(choice, target, catalog, bytes ?? undefined);
    const url = fileOf(choice.scope, target, catalog);
    const parts = [];
    if (code !== undefined) {
      parts.push(h("pre", { class: "usedata-code" }, h("code", {}, code)), h("div", { class: "usedata-actions" }, copyButton(() => code)));
    }
    if (steps) {
      parts.push(
        h(
          "ol",
          { class: "usedata-steps" },
          steps.map((step) => {
            const at = step.indexOf(url);
            if (at < 0) return h("li", {}, step);
            return h("li", {}, step.slice(0, at), h("code", { class: "usedata-url" }, url), copyButton(() => url));
          }),
        ),
      );
    }
    if (filter !== undefined) {
      parts.push(
        h(
          "div",
          { class: "usedata-filter" },
          h("p", {}, "Paste this filter into the layer's Query Builder (right-click the layer › Filter…):"),
          h("pre", {}, h("code", {}, filter)),
          h("div", { class: "usedata-actions" }, copyButton(() => filter)),
        ),
      );
    }
    if (note) parts.push(h("p", { class: "usedata-note" }, note));
    body.replaceChildren(...parts);
  }

  const isOpen = () => (container === pane ? !pane.hidden : isDialogOpen(dialog));

  /* onToggle hears each real change, after it happens. */
  function show() {
    const was = isOpen();
    if (container === pane) pane.hidden = false;
    else openDialog(dialog);
    if (!was) onToggle?.(true);
  }

  function hide() {
    const was = isOpen();
    if (container === pane) pane.hidden = true;
    else closeDialog(dialog);
    if (was) onToggle?.(false);
  }

  /* Move the content to the layout's container, open there if it was open. */
  function place() {
    const next = PHONE.matches ? pane : dialog;
    if (next === container) return;
    const open = container !== null && isOpen();
    if (open) hide();
    /* The scope choice may have been replaced since, so the nodes come from the page. */
    const nodes = container ? [...container.childNodes] : content;
    container = next;
    container.append(...nodes);
    if (open) show();
  }
  place();
  PHONE.addEventListener("change", place);

  const listen = (group, key) =>
    group.addEventListener("change", (event) => {
      choice[key] = event.target.value;
      render();
    });
  listen(tools, "tool");
  listen(scopes, "scope");

  /* A glacier and a complex offer different scopes; a new kind starts on its first. */
  function setKind(next) {
    if (scopesOf(next) === scopesOf(target ?? {})) return;
    choice.scope = scopesOf(next)[0].value;
    bytes = null;
    const fresh = segmented(`${id}-scope`, "Fetch", scopesOf(next), choice.scope);
    scopes.replaceWith(fresh);
    scopes = fresh;
    listen(scopes, "scope");
  }

  const api = {
    open(next) {
      setKind(next);
      target = next;
      opener = document.activeElement;
      render();
      show();
      container.querySelector("input:checked")?.focus();
      const shown = target;
      sizeOf(allFileOf(target, catalog)).then((size) => {
        if (size === bytes || scopesOf(shown) !== scopesOf(target)) return;
        bytes = size;
        if (isOpen()) render();
      });
    },
    close() {
      if (!isOpen()) return;
      hide();
      if (opener?.isConnected) opener.focus();
      opener = null;
    },
  };

  closeButton.addEventListener("click", () => api.close());
  for (const node of [pane, dialog]) {
    node.addEventListener("keydown", (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      api.close();
    });
  }
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    api.close();
  });
  return api;
}
