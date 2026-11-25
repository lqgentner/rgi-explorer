/*
 * "Use this data": a tab for each way in. Python and DuckDB give a ready
 * snippet, QGIS the steps in the Portolan Registry plugin, and Citation the
 * references with their BibTeX. The first three read
 * one glacier, its region or all glaciers, or one complex, its region or all
 * complexes. A dialog on desktop and a pane in the bottom sheet on the phone.
 */

import { regionOfId } from "./state.js";
import { TIMEOUT_MS } from "./config.js";
import { closeButton, closeDialog, copyText, externalLink, h, icon, isDialogOpen, modal, openDialog, PHONE, svg, tablist } from "./ui.js";

const TABS = [
  { id: "python", label: "Python" },
  { id: "duckdb", label: "DuckDB" },
  { id: "qgis", label: "QGIS" },
  { id: "citation", label: "Citation" },
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
const PLUGIN_PAGE = "https://plugins.qgis.org/plugins/portolan_registry_qgis/";

/*
 * The references the catalog names, by lowercase DOI: the APA 7 text that
 * citation.doi.org gives for the DOI, when to cite it, as the RGI user guide
 * says (https://rgidata.org/user_guide/01_introduction.html#reference), and
 * BibTeX to match. The catalog gives each reference as text only; a DOI
 * missing here shows the catalog's text alone.
 */
const REFERENCES = {
  "10.5067/f6jmovy5navz": {
    label: "Dataset",
    when: "Cite it in every publication that uses RGI 7.0 data.",
    text: "RGI Consortium. (2023). Randolph Glacier Inventory - A Dataset of Global Glacier Outlines, Version 7 [Data set]. NASA National Snow and Ice Data Center Distributed Active Archive Center. https://doi.org/10.5067/F6JMOVY5NAVZ",
    bibtex: `@misc{rgi7_2023,
  author    = {{RGI Consortium}},
  title     = {{Randolph Glacier Inventory - A Dataset of Global Glacier
               Outlines, Version 7}},
  year      = {2023},
  publisher = {NASA National Snow and Ice Data Center Distributed Active
               Archive Center},
  doi       = {10.5067/F6JMOVY5NAVZ},
  url       = {https://doi.org/10.5067/F6JMOVY5NAVZ},
  note      = {Data set},
}
`,
  },
  "10.5281/zenodo.8362857": {
    label: "User guide",
    when: "Optional: cite it when referring to specific details that are not covered elsewhere.",
    text: "Maussion, F., Hock, R., Paul, F., Raup, B., Rastner, P., Zemp, M., Andreassen, L., Barr, I., Bolch, T., Kochtitzky, W., McNabb, R., & Tielidze, L. (2023). The Randolph Glacier Inventory version 7.0 User guide. Zenodo. https://doi.org/10.5281/ZENODO.8362857",
    bibtex: `@misc{maussion_rgi7_2023,
  author    = {Maussion, F. and Hock, R. and Paul, F. and Raup, B. and
               Rastner, P. and Zemp, M. and Andreassen, L. and Barr, I. and
               Bolch, T. and Kochtitzky, W. and McNabb, R. and Tielidze, L.},
  title     = {The {Randolph Glacier Inventory} version 7.0 User guide},
  year      = {2023},
  publisher = {Zenodo},
  doi       = {10.5281/zenodo.8362857},
  url       = {https://doi.org/10.5281/zenodo.8362857},
}
`,
  },
};

const scopesOf = (target) => SCOPES[target.kind] ?? SCOPES.glacier;
/** The scope a choice names for a target, or the target's first. */
const scopeOf = (scope, target) => scopesOf(target).find((s) => s.value === scope) ?? scopesOf(target)[0];
/** The collection a choice reads. */
const collectionOf = (scope, target, catalog) => catalog.collections[scopeOf(scope, target).file];
/** The file that "all" reads, whose size the note gives. */
const allFileOf = (target, catalog) => collectionOf("all", target, catalog).dataUrl;

/** A Python string literal. JSON's double-quoted form is one for this text. */
const py = (text) => JSON.stringify(String(text));
/** A SQL string literal, for DuckDB and for QGIS expressions. */
const sql = (text) => `'${String(text).replaceAll("'", "''")}'`;

const sizeNote = (bytes) =>
  Number.isFinite(bytes) && bytes > 0 ? `Reads the whole file, about ${Math.round(bytes / 1e6)} MB.` : undefined;

/**
 * What a tab shows for a choice. `bytes`, the size of the file "all" reads,
 * adds the size note to "all"; without it the note is left out.
 *
 * Python and DuckDB give `code`, as the Portolan reading guide writes it for
 * DuckDB. QGIS gives the names the Portolan Registry plugin lists
 * (`publisher`, `folder`, `collection`) and, unless the choice is "all", the
 * `filter` expression for the plugin's Rows field.
 *
 * @param {{tool: "python"|"duckdb"|"qgis", scope: string}} choice  a scope of the target's kind
 * @param {{kind?: "glacier"|"complex", rgiId: string, o1region?: string}} target  a glacier when `kind` is left out
 * @param {any} catalog  from loadCatalog
 * @param {number} [bytes]
 * @returns {{code?: string, filter?: string, note?: string, publisher?: string, folder?: string, collection?: string}}
 */
export function snippet({ tool, scope }, target, catalog, bytes) {
  const { rgiId, o1region } = target;
  const chosen = scopeOf(scope, target);
  const collection = collectionOf(scope, target, catalog);
  const url = collection.dataUrl;
  const note = chosen.value === "all" ? sizeNote(bytes) : undefined;
  const value = chosen.key === "o1region" ? o1region || regionOfId(rgiId) : rgiId;
  const key = chosen.key ? [chosen.key, value] : null;
  const result = {};

  if (tool === "qgis") {
    Object.assign(result, {
      publisher: catalog.title ?? "Randolph Glacier Inventory Mirror",
      folder: catalog.versionTitle ?? `RGI ${catalog.version}`,
      collection: collection.json?.title ?? collection.id,
    });
    if (key) result.filter = `"${key[0]}" = ${sql(key[1])}`;
  } else if (tool === "duckdb") {
    const where = key ? `\nWHERE ${key[0]} = ${sql(key[1])}` : "";
    result.code = `INSTALL spatial; LOAD spatial;\nINSTALL httpfs; LOAD httpfs;\n\nSELECT *\nFROM read_parquet(\n  ${sql(url)}\n)${where};\n`;
  } else {
    const filters = key ? `, filters=[(${py(key[0])}, "==", ${py(key[1])})]` : "";
    result.code = `import geopandas as gpd\n\nurl = ${py(url)}\ngdf = gpd.read_parquet(url${filters})\n`;
  }
  if (note) result.note = note;
  return result;
}

/**
 * The references to cite: the dataset, then the catalog's publications. Each
 * has a label and the citation text; a known DOI adds RGI's own text, when to
 * cite it, and BibTeX.
 *
 * @param {any} catalog  from loadCatalog
 * @returns {{label: string, text: string, when: string | null, bibtex: string | null}[]}
 */
export function references(catalog) {
  const entries = [{ doi: catalog.doi, citation: catalog.citation, label: "Dataset" }, ...(catalog.publications ?? [])];
  const seen = new Set();
  const refs = [];
  for (const entry of entries) {
    const doi = typeof entry?.doi === "string" ? entry.doi.toLowerCase() : null;
    const known = doi ? REFERENCES[doi] : undefined;
    const text = known?.text ?? (typeof entry?.citation === "string" ? entry.citation : "");
    /* A reference needs its text; a DOI the catalog names twice is cited once. */
    if (!text || (doi && seen.has(doi))) continue;
    if (doi) seen.add(doi);
    refs.push({ label: known?.label ?? entry.label ?? "Publication", text, when: known?.when ?? null, bibtex: known?.bibtex ?? null });
  }
  return refs;
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
function copyButton(text, label = "Copy") {
  const button = h("button", { type: "button", class: "icon-button copy" });
  const show = (glyph, name) => {
    button.replaceChildren(icon(glyph));
    button.setAttribute("aria-label", name);
    button.title = name;
  };
  show("copy", label);
  let timer = null;
  button.addEventListener("click", async () => {
    if (!(await copyText(text()))) return;
    show("check", "Copied");
    clearTimeout(timer);
    timer = setTimeout(() => show("copy", label), COPIED_MS);
  });
  return button;
}

/*
 * Syntax colours, as Quarto's documentation pages draw them: each token in a
 * span with Pandoc's class (kw keyword, im import, st string, dv number, op
 * operator, at attribute, fu function), coloured in style.css. The patterns
 * are case-sensitive and cover the snippets this file writes, no more.
 */
/** @type {Record<string, [string, RegExp][]>} */
const TOKENS = {
  python: [
    ["co", /#.*/],
    ["st", /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/],
    ["im", /\b(?:import|from|as)\b/],
    ["kw", /\b(?:def|return|if|else|for|in|and|or|not|with|lambda|None|True|False)\b/],
    ["dv", /\b\d+(?:\.\d+)?\b/],
    ["op", /==|!=|<=|>=|[=<>+\-*\/]/],
  ],
  sql: [
    ["co", /--.*/],
    ["st", /'(?:[^']|'')*'/],
    ["kw", /\b(?:INSTALL|LOAD|SELECT|FROM|WHERE|AND|OR|NOT|LIMIT|ORDER|GROUP|BY|AS)\b/],
    ["fu", /\b[A-Za-z_]\w*(?=\()/],
    ["dv", /\b\d+(?:\.\d+)?\b/],
    ["op", /<=|>=|<>|!=|[=<>*]/],
  ],
  bibtex: [
    ["kw", /@\w+/],
    ["at", /\b\w+(?=\s*=)/],
    ["op", /=/],
  ],
};
const TOKEN_RE = Object.fromEntries(
  Object.entries(TOKENS).map(([lang, rules]) => [lang, new RegExp(rules.map(([, re]) => `(${re.source})`).join("|"), "g")]),
);

/** `text` as nodes: plain text, and a span for each token of `lang`. */
export function highlight(text, lang) {
  const rules = TOKENS[lang];
  if (!rules) return [text];
  const nodes = [];
  let at = 0;
  for (const match of text.matchAll(TOKEN_RE[lang])) {
    const rule = rules[match.slice(1).findIndex((group) => group !== undefined)];
    if (match.index > at) nodes.push(text.slice(at, match.index));
    nodes.push(h("span", { class: rule[0] }, match[0]));
    at = match.index + match[0].length;
  }
  if (at < text.length) nodes.push(text.slice(at));
  return nodes;
}

/** A code block in `lang`, with its Copy in the top right corner. */
const codeBlock = (text, lang, className = "usedata-code", label = "Copy") =>
  h("div", { class: "usedata-block" }, h("pre", { class: className }, h("code", {}, highlight(text, lang))), copyButton(() => text, label));

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

const path = (...parts) => h("span", { class: "usedata-path" }, parts.join(" › "));

/*
 * The plugin's two load buttons as QGIS draws them: View on map in blue with
 * the add-layer icon, the GeoParquet's in white with the add-vector icon. Each
 * icon wears QGIS's green plus. style.css colours them, by class.
 */
/* QGIS's green plus: a rounded square with a white cross, its top left at (x, y). */
const plus = (x, y) => [
  svg("rect", { class: "plus", x, y, width: 6.5, height: 6.5, rx: 1.2 }),
  svg("path", { d: `M${x + 1.5} ${y + 3.25}h3.5M${x + 3.25} ${y + 1.5}v3.5`, stroke: "#fff", "stroke-width": 1.2 }),
];
/* The vertices of the add-vector icon's line: a V and a short tail at the top right. */
const VERTICES = [[2.5, 2.5], [6, 13], [10, 3], [13.5, 3]];
const QGIS_ICONS = {
  tiles: () => [svg("rect", { class: "sheet", x: 1.5, y: 1.5, width: 11, height: 11 }), ...plus(9, 9)],
  vector: () => [
    svg("path", { class: "ink", d: `M${VERTICES.map((v) => v.join(" ")).join(" ")}`, fill: "none", "stroke-width": 1 }),
    ...VERTICES.map(([cx, cy]) => svg("circle", { class: "vertex", cx, cy, r: 1.3, "stroke-width": 0.9 })),
    ...plus(9, 9),
  ],
};
const qgisButton = (text, kind) =>
  h(
    "span",
    { class: `qgis-button ${kind === "tiles" ? "primary" : ""}`.trim() },
    svg("svg", { class: "qgis-icon", viewBox: "0 0 16 16", "aria-hidden": "true" }, ...QGIS_ICONS[kind]()),
    text,
  );

/**
 * The QGIS tab, in two parts around the choice of rows: first the not-yet
 * banner and the steps to the vector tiles, which need no choice; then the
 * steps to the GeoParquet, which load only the rows chosen.
 */
function qgisPanel(guide) {
  const lead = [
    h("p", { class: "usedata-banner", role: "note" }, h("strong", {}, "Coming soon. "), "The RGI mirror is not in the Portolan registry yet."),
    h(
      "ol",
      { class: "usedata-steps" },
      h("li", {}, "Install the ", externalLink(PLUGIN_PAGE, "Portolan Registry plugin"), " from ", path("Plugins", "Manage and Install Plugins…"), ". It needs QGIS 3.34 or newer."),
      h("li", {}, "Open ", path("Web", "Portolan Registry", "Portolan Registry"), " and search for ", h("q", {}, guide.publisher), "."),
      h("li", {}, "Select ", path(guide.folder, guide.collection), "."),
      h("li", {}, "Under Add to map, click ", qgisButton("View on map", "tiles"), "."),
    ),
    h(
      "p",
      { class: "usedata-para" },
      "View on map adds the whole collection as vector tiles. QGIS fetches only the tiles on screen, so the layer stays fast at every zoom and needs no filter. Switch between the catalog's styles in the layer's Styles menu.",
    ),
    h("h3", { class: "usedata-subhead" }, "Load the attributes"),
    h("p", { class: "usedata-para" }, "For analysis, load the GeoParquet file instead. It has every attribute and the outlines at full resolution."),
  ];
  const steps = guide.filter !== undefined
    ? [
        h("li", {}, "Under Add to map, open the SQL tab and paste this filter into Rows:", codeBlock(guide.filter, "sql", "usedata-filter-code", "Copy filter")),
        h("li", {}, "Back on the Load tab, click ", qgisButton("Load data", "vector"), ". The plugin copies the matching rows into a layer."),
      ]
    : [h("li", {}, "Under Add to map, click ", qgisButton("Load full data", "vector"), ". The plugin copies every row into a layer.")];
  const rest = [
    h("ol", { class: "usedata-steps", start: 5 }, steps),
    h("p", { class: "usedata-note" }, "The first time, the plugin asks for DuckDB and shows the command that installs it."),
    guide.note ? h("p", { class: "usedata-note" }, guide.note) : null,
  ];
  return { lead, rest: rest.filter(Boolean) };
}

function citationPanel(catalog) {
  return [
    h("p", { class: "usedata-note usedata-lead" }, "If you use RGI 7.0 data in your publication, please cite the RGI references below. This mirror is unofficial and needs no separate citation."),
    references(catalog).map((ref) =>
      h(
        "section",
        { class: "usedata-ref" },
        h("h3", {}, ref.label),
        ref.when ? h("p", { class: "usedata-when" }, ref.when) : null,
        h("div", { class: "usedata-block" }, h("p", { class: "usedata-cite" }, ref.text), copyButton(() => ref.text, "Copy citation")),
        ref.bibtex ? codeBlock(ref.bibtex, "bibtex", "usedata-bibtex", "Copy BibTeX") : null,
      ),
    ),
  ];
}

let mounted = 0;

/**
 * Mount "Use this data" and return `{ open(target), close(), isOpen() }`. `target` is
 * `{ kind?, rgiId, o1region?, name? }`, a glacier when `kind` is left out;
 * the title names it by `name`, or by its ID. The
 * desktop gets a dialog in `root`, the phone a pane in `ctx.sheet` (or
 * `root`). Both are made once; the content moves to the one the layout
 * uses, and an open offer stays open across the change. The tab and the
 * scope stay as the reader left them.
 *
 * @param {HTMLElement} root
 * @param {{catalog: object, sheet?: HTMLElement, onToggle?: (open: boolean) => void}} ctx
 */
export function mountUseData(root, { catalog, sheet = root, onToggle }) {
  mounted += 1;
  const id = `usedata-${mounted}`;
  /** @type {{tool: "python"|"duckdb"|"qgis"|"citation", scope: string}} */
  const choice = { tool: "python", scope: "glacier" };
  let target = null;
  let bytes = null;

  const close = closeButton({ className: "pane-close usedata-close", tour: "use-data-close" });
  const subtitle = h("p", { class: "usedata-sub" });
  const tools = tablist(TABS, {
    prefix: id,
    label: "Tool",
    controls: () => `${id}-panel`,
    onPick(tool, focus) {
      if (tool === choice.tool && !focus) return;
      selectTab(tool, focus);
      render();
    },
  });
  tools.node.classList.add("usedata-tabs");
  /* The scope sits between the two: Python and DuckDB lead with it, QGIS asks for it halfway. */
  const lead = h("div", { class: "usedata-lead-in" });
  const body = h("div", { class: "usedata-body" });
  let scopes = segmented(`${id}-scope`, "Load", SCOPES.glacier, choice.scope);
  const panel = h("div", { class: "usedata-panel", role: "tabpanel", id: `${id}-panel` }, lead, scopes, body);
  const content = [
    h("div", { class: "pane-header" }, h("h2", { id: `${id}-title` }, "Use this data"), close),
    subtitle,
    tools.node,
    panel,
  ];
  const pane = h("div", { class: "usedata usedata-pane", role: "dialog", "aria-labelledby": `${id}-title`, hidden: true });
  const dialog = h("dialog", { class: "modal usedata", "aria-labelledby": `${id}-title` });
  sheet.append(pane);
  root.append(dialog);
  /* The container the layout uses; the content lives in it. */
  let container = null;

  function selectTab(tool, focus = false) {
    choice.tool = tool;
    tools.select(tool, focus);
    panel.setAttribute("aria-labelledby", tools.tabs[tool].id);
  }
  selectTab(choice.tool);

  function render() {
    if (!target) return;
    subtitle.textContent = target.name?.trim() || target.rgiId;
    lead.replaceChildren();
    /* The references are the same for every target, so Citation needs no scope. */
    scopes.hidden = choice.tool === "citation";
    if (choice.tool === "citation") {
      body.replaceChildren(...citationPanel(catalog).flat());
      return;
    }
    const result = snippet(/** @type {{tool: "python"|"duckdb"|"qgis", scope: string}} */ (choice), target, catalog, bytes ?? undefined);
    if (choice.tool === "qgis") {
      const { lead: before, rest } = qgisPanel(result);
      lead.replaceChildren(...before);
      body.replaceChildren(...rest);
      return;
    }
    const parts = [codeBlock(result.code, choice.tool === "duckdb" ? "sql" : "python")];
    if (result.note) parts.push(h("p", { class: "usedata-note" }, result.note));
    body.replaceChildren(...parts);
  }

  const isOpen = () => (container === pane ? !pane.hidden : isDialogOpen(dialog));
  const show = () => (container === pane ? (pane.hidden = false) : openDialog(dialog));
  const hide = () => (container === pane ? (pane.hidden = true) : closeDialog(dialog));
  const surface = modal({ nodes: [pane, dialog], isOpen, show, hide, onToggle, backdrop: true });

  /* Move the content to the layout's container, open there if it was open: no close and open to hear. */
  function place() {
    const next = PHONE.matches ? pane : dialog;
    if (next === container) return;
    const open = container !== null && isOpen();
    /* Closing the modal dialog hands focus back to its opener, which the pane covers: take it along. */
    const focused = open && container.contains(document.activeElement);
    if (open) hide();
    /* The scope choice may have been replaced since, so the nodes come from the page. */
    const nodes = container ? [...container.childNodes] : content;
    container = next;
    container.append(...nodes);
    if (open) show();
    if (focused) tools.tabs[choice.tool].focus();
  }
  place();
  PHONE.addEventListener("change", place);

  const listen = (group) =>
    group.addEventListener("change", (event) => {
      choice.scope = /** @type {HTMLInputElement} */ (event.target).value;
      render();
    });
  listen(scopes);

  /* A glacier and a complex offer different scopes; a new kind starts on its first. */
  function setKind(next) {
    if (scopesOf(next) === scopesOf(target ?? {})) return;
    choice.scope = scopesOf(next)[0].value;
    bytes = null;
    const fresh = segmented(`${id}-scope`, "Load", scopesOf(next), choice.scope);
    scopes.replaceWith(fresh);
    scopes = fresh;
    listen(scopes);
  }

  const api = {
    isOpen,
    /* Open on a target, or show another in the open offer. */
    open(next) {
      setKind(next);
      target = next;
      render();
      surface.open();
      tools.tabs[choice.tool].focus();
      const shown = target;
      sizeOf(allFileOf(target, catalog)).then((size) => {
        if (size === bytes || scopesOf(shown) !== scopesOf(target)) return;
        bytes = size;
        if (isOpen()) render();
      });
    },
    close: () => surface.close(),
  };
  close.addEventListener("click", api.close);
  return api;
}
