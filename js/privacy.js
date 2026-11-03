/*
 * The privacy note: what the page stores in the browser, and which services
 * receive the visitor's IP address, from what the page does. The welcome links
 * to it, and the help button opens the welcome again, so it is always one
 * click away. One modal dialog serves both layouts.
 *
 * SERVICES names every host the page may contact; a test checks them against
 * the CSP in index.html, so a new host needs a line here.
 */

import { closeDialog, externalLink, h, icon, openDialog } from "./ui.js";

export const OPERATOR = { name: "Luis Gentner", email: "luis.gentner@geo.uzh.ch" };
export const UPDATED = "3 November 2026";

/**
 * @typedef {object} Service
 * @property {string} name
 * @property {string} by        who runs it, and where
 * @property {string} what      what the page loads from it
 * @property {string} gets      what it receives besides the IP address
 * @property {string | null} policy  its privacy policy, null when it publishes none
 * @property {string} [note]    what its policy leaves out
 * @property {string[]} hosts   the origins the page contacts
 */

/** @type {{title: string, services: Service[]}[]} */
export const SERVICES = [
  {
    title: "On every visit",
    services: [
      {
        name: "GitHub Pages",
        by: "GitHub, Inc., USA",
        what: "Hosts this site, and logs visitors' IP addresses for security.",
        gets: "The page's own files.",
        policy: "https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement",
        hosts: [],
      },
      {
        name: "Source Cooperative",
        by: "Radiant Earth, USA, served through Cloudflare",
        what: "The glacier data and its map tiles.",
        gets: "The parts of the data on view.",
        policy: null,
        hosts: ["https://data.source.coop"],
      },
      {
        name: "OpenFreeMap",
        by: "Hyperknot Software Kft., Hungary",
        what: "The standard base map and its fonts.",
        gets: "The map area on view.",
        policy: "https://openfreemap.org/privacy/",
        hosts: ["https://tiles.openfreemap.org"],
      },
      {
        name: "Esri World Imagery",
        by: "Esri, USA",
        what: "Satellite imagery: a small preview of the view on the base map button, the Imagery base map, and a picture of each glacier you open.",
        gets: "The map area on view, or the glacier's location.",
        policy: "https://www.esri.com/en-us/privacy/privacy-statements/privacy-statement",
        hosts: ["https://server.arcgisonline.com", "https://static.arcgis.com"],
      },
    ],
  },
  {
    title: "When you use a feature",
    services: [
      {
        name: "Photon by komoot",
        by: "komoot GmbH, Germany",
        what: "Place search, as you type.",
        gets: "What you type and the centre and zoom of the map.",
        policy: "https://www.komoot.com/privacy",
        note: "komoot's policy covers its own apps and site and does not name Photon.",
        hosts: ["https://photon.komoot.io"],
      },
      {
        name: "Wikidata and Wikimedia Commons",
        by: "Wikimedia Foundation, USA",
        what: "Photos of a glacier you open.",
        gets: "The glacier's location and its GLIMS ID.",
        policy: "https://foundation.wikimedia.org/wiki/Policy:Privacy_policy",
        hosts: [
          "https://query.wikidata.org",
          "https://commons.wikimedia.org",
          "https://upload.wikimedia.org",
          "https://thumb.wikimedia.org",
        ],
      },
      {
        name: "Mapterhorn",
        by: "Mapterhorn, served through Cloudflare",
        what: "Elevation data, in 3D.",
        gets: "The map area on view.",
        policy: "https://mapterhorn.com/privacy-policy/",
        hosts: ["https://tiles.mapterhorn.com", "https://download.mapterhorn.com"],
      },
    ],
  },
];

const hostName = (origin) => new URL(origin).host;

function serviceItem({ name, by, what, gets, policy, note, hosts }) {
  return h(
    "li",
    {},
    h("h4", {}, name),
    h("p", { class: "privacy-by" }, by),
    h("p", {}, `${what} It receives ${gets.charAt(0).toLowerCase()}${gets.slice(1)}`),
    note ? h("p", { class: "privacy-by" }, note) : null,
    h(
      "p",
      { class: "privacy-links" },
      policy ? externalLink(policy, "Privacy policy") : h("span", {}, "Publishes no privacy policy"),
      ...hosts.map((origin) => h("code", {}, hostName(origin))),
    ),
  );
}

let dialog = null;

function build() {
  const close = h("button", { type: "button", class: "icon-button privacy-close", "aria-label": "Close" }, icon("x"));
  const mail = h("a", { href: `mailto:${OPERATOR.email}` }, OPERATOR.email);
  dialog = h(
    "dialog",
    { class: "privacy", "aria-labelledby": "privacy-title" },
    h("div", { class: "pane-header" }, h("h2", { id: "privacy-title" }, "Privacy"), close),
    h(
      "div",
      { class: "privacy-body" },
      h(
        "p",
        {},
        `RGI Explorer is a free, non-commercial map run by ${OPERATOR.name} (`,
        mail,
        "). It sets no cookies and has no analytics, tracking or accounts.",
      ),
      h("h3", {}, "What your browser keeps"),
      h(
        "ul",
        {},
        h("li", {}, "Whether you closed the welcome, so it stays closed."),
        h("li", {}, "Copies of the catalog's and the base maps' description files, so later visits start faster."),
      ),
      h(
        "p",
        {},
        "Neither leaves your browser. Clearing this site's data removes both. If your browser blocks site " +
          "storage, the map works the same and the welcome shows on every visit.",
      ),
      h("h3", {}, "Who receives your IP address"),
      h(
        "p",
        {},
        "The map loads its data straight from the services below, so each one receives your IP address, " +
          "your browser's usual request details and what is listed. Each handles it under its own privacy " +
          "policy. The operator runs no server and sees none of it.",
      ),
      ...SERVICES.flatMap(({ title, services }) => [
        h("h3", { class: "privacy-group" }, title),
        h("ul", { class: "privacy-services" }, services.map(serviceItem)),
      ]),
      h("h3", {}, "Your rights"),
      h(
        "p",
        {},
        "These requests rest on the site's legitimate interest in showing the map, which cannot work without " +
          "them (Swiss FADP; for visitors in the EU, GDPR Art. 6(1)(f)). You can ask about your data or object " +
          "by writing to ",
        mail.cloneNode(true),
        ".",
      ),
      h("p", { class: "privacy-updated" }, `Last updated ${UPDATED}.`),
    ),
  );
  document.body.append(dialog);
  close.addEventListener("click", () => closeDialog(dialog));
  /* A click on the backdrop, outside the box, closes it too. */
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) closeDialog(dialog);
  });
}

/** Open the privacy note, building it on first use. */
export function openPrivacy() {
  if (!dialog) build();
  openDialog(dialog);
}
