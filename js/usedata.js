/*
 * "Use this data": a ready snippet for GeoPandas, or the steps to add the
 * GeoParquet in QGIS, for one glacier, its region or all of RGI. A dialog on
 * desktop and a pane in the bottom sheet on the phone.
 */

import { TIMEOUT_MS } from "./config.js";
import { PHONE, h, icon } from "./ui.js";

const TOOLS = [
  { value: "python", label: "Python" },
  { value: "qgis", label: "QGIS" },
];
const SCOPES = [
  { value: "glacier", label: "This glacier" },
  { value: "region", label: "Its region" },
  { value: "all", label: "All of RGI" },
];
const COPIED_MS = 1500;

/** The first-order region code inside an RGI ID, such as "11" in RGI2000-v7.0-G-11-02596. */
const regionOfId = (rgiId) => /-G-(\d{2})-/.exec(rgiId ?? "")?.[1] ?? null;

/** A Python string literal. JSON's double-quoted form is one for this text. */
const py = (text) => JSON.stringify(String(text));
/** A QGIS expression string literal. */
const sql = (text) => `'${String(text).replaceAll("'", "''")}'`;

const sizeNote = (bytes) =>
  Number.isFinite(bytes) && bytes > 0 ? `Reads the whole file, about ${Math.round(bytes / 1e6)} MB.` : undefined;

/**
 * The snippet for a choice. `bytes`, the size of the glaciers file, adds the
 * size note to "all"; without it the note is left out.
 *
 * @param {{tool: "python"|"qgis", scope: "glacier"|"region"|"all"}} choice
 * @param {{rgiId: string, o1region?: string}} glacier
 * @param {object} catalog  from loadCatalog
 * @param {number} [bytes]
 * @returns {{code?: string, steps?: string[], filter?: string, note?: string}}
 */
export function snippet({ tool, scope }, { rgiId, o1region }, catalog, bytes) {
  const url = catalog.collections.glaciers.dataUrl;
  const region = o1region || regionOfId(rgiId);
  const note = scope === "all" ? sizeNote(bytes) : undefined;
  const key = scope === "glacier" ? ["rgi_id", rgiId] : scope === "region" ? ["o1region", region] : null;

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

/** A button that copies `text()` and says "Copied" for a moment. Fails quietly. */
function copyButton(text, label = "Copy") {
  const button = h("button", { type: "button", class: "btn copy" }, label);
  let timer = null;
  button.addEventListener("click", async () => {
    try {
      await globalThis.navigator.clipboard.writeText(text());
    } catch {
      return;
    }
    button.textContent = "Copied";
    clearTimeout(timer);
    timer = setTimeout(() => {
      button.textContent = label;
    }, COPIED_MS);
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
 * Mount "Use this data" in `root` and return `{ open(glacier), close() }`.
 * `glacier` is `{ rgiId, o1region? }`. The phone gets a pane, the desktop a dialog.
 *
 * @param {HTMLElement} root
 * @param {{catalog: object}} ctx
 */
export function mountUseData(root, { catalog }) {
  const phone = PHONE.matches;
  mounted += 1;
  const id = `usedata-${mounted}`;
  const choice = { tool: "python", scope: "glacier" };
  let glacier = null;
  let bytes = null;
  let opener = null;

  const closeButton = h(
    "button",
    { type: "button", class: "icon-button usedata-close", "aria-label": "Close" },
    icon("x"),
  );
  const body = h("div", { class: "usedata-body" });
  const tools = segmented(`${id}-tool`, "I work in", TOOLS, choice.tool);
  const scopes = segmented(`${id}-scope`, "Fetch", SCOPES, choice.scope);
  const content = [
    h("div", { class: "pane-header" }, h("h2", { id: `${id}-title` }, "Use this data"), closeButton),
    tools,
    scopes,
    body,
  ];
  const container = phone
    ? h("div", { class: "usedata usedata-pane", role: "dialog", "aria-labelledby": `${id}-title`, hidden: true }, content)
    : h("dialog", { class: "usedata", "aria-labelledby": `${id}-title` }, content);
  root.append(container);

  function render() {
    if (!glacier) return;
    const { code, steps, filter, note } = snippet(choice, glacier, catalog, bytes ?? undefined);
    const url = catalog.collections.glaciers.dataUrl;
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

  const isOpen = () => (phone ? !container.hidden : container.open || container.hasAttribute("open"));

  for (const [group, key] of [[tools, "tool"], [scopes, "scope"]]) {
    group.addEventListener("change", (event) => {
      choice[key] = event.target.value;
      render();
    });
  }

  const api = {
    open(next) {
      glacier = next;
      opener = document.activeElement;
      render();
      if (phone) container.hidden = false;
      else if (typeof container.showModal === "function") {
        if (!container.open) container.showModal();
      } else container.setAttribute("open", "");
      container.querySelector("input:checked")?.focus();
      sizeOf(catalog.collections.glaciers.dataUrl).then((size) => {
        if (size === bytes) return;
        bytes = size;
        if (isOpen()) render();
      });
    },
    close() {
      if (!isOpen()) return;
      if (phone) container.hidden = true;
      else if (typeof container.close === "function" && container.open) container.close();
      else container.removeAttribute("open");
      if (opener?.isConnected) opener.focus();
      opener = null;
    },
  };

  closeButton.addEventListener("click", () => api.close());
  container.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    api.close();
  });
  container.addEventListener("cancel", (event) => {
    event.preventDefault();
    api.close();
  });
  return api;
}
