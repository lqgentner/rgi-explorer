/*
 * The privacy note: what the page stores in the browser, and which services
 * receive the visitor's IP address, from what the page does. The welcome links
 * to it, and the help button opens the welcome again, so it is always one
 * click away. One modal dialog serves both layouts.
 *
 * SERVICES names every host the page may contact; a test checks them against
 * the CSP in index.html, so a new host needs a line here.
 */

import { closeButton, closeDialog, externalLink, h, isDialogOpen, modal, openDialog } from "./ui.js";

export const OPERATOR = { name: "Luis Gentner", email: "luis.gentner@geo.uzh.ch" };
export const UPDATED = "7 November 2026";

/**
 * @typedef {object} Service
 * @property {string} name
 * @property {string} [by]      who runs it, and where, when it says
 * @property {string} use       what it does for the map and what it receives besides the IP address, in sentences
 * @property {{href: string, label: string}} link  its privacy policy where one covers it, else its website
 * @property {string[]} hosts   the origins the page contacts
 */

const policy = (href) => ({ href, label: "Privacy policy" });
const website = (href) => ({ href, label: "Website" });

/** @type {{title: string, services: Service[]}[]} */
export const SERVICES = [
  {
    title: "On every visit",
    services: [
      {
        name: "GitHub Pages",
        by: "GitHub, USA",
        use: "GitHub hosts this site and logs visitors' IP addresses for security.",
        link: policy("https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement"),
        hosts: [],
      },
      {
        name: "Source Cooperative",
        by: "Radiant Earth, USA",
        use: "Source Cooperative serves the glacier data and its map tiles for the area you view.",
        link: website("https://source.coop"),
        hosts: ["https://data.source.coop"],
      },
      {
        name: "OpenFreeMap",
        by: "Hyperknot Software, Hungary",
        use: "OpenFreeMap serves the standard base map for the area you view.",
        link: policy("https://openfreemap.org/privacy/"),
        hosts: ["https://tiles.openfreemap.org"],
      },
      {
        name: "Esri World Imagery",
        by: "Esri, USA",
        use: "Esri serves satellite imagery of the area you view, including the small preview on the base map button, and a picture of each glacier you open.",
        link: policy("https://www.esri.com/en-us/privacy/privacy-statements/privacy-statement"),
        hosts: ["https://server.arcgisonline.com", "https://static.arcgis.com"],
      },
    ],
  },
  {
    title: "When you use a feature",
    services: [
      {
        name: "Photon",
        by: "komoot, Germany",
        use: "When you search for a place, Photon receives your query and the position of the map.",
        link: website("https://photon.komoot.io"),
        hosts: ["https://photon.komoot.io"],
      },
      {
        name: "Wikidata and Wikimedia Commons",
        by: "Wikimedia Foundation, USA",
        use: "When you open a glacier, Wikidata and Wikimedia Commons receive its location and GLIMS ID, to find photos of it.",
        link: policy("https://foundation.wikimedia.org/wiki/Policy:Privacy_policy"),
        hosts: [
          "https://query.wikidata.org",
          "https://commons.wikimedia.org",
          "https://upload.wikimedia.org",
          "https://thumb.wikimedia.org",
        ],
      },
      {
        name: "Mapterhorn",
        use: "When you switch to 3D, Mapterhorn serves elevation data for the area you view.",
        link: policy("https://mapterhorn.com/privacy-policy/"),
        hosts: ["https://tiles.mapterhorn.com", "https://download.mapterhorn.com"],
      },
    ],
  },
];

const hostName = (origin) => new URL(origin).host;

function serviceItem({ name, by, use, link, hosts }) {
  return h(
    "li",
    {},
    h("h4", {}, name, by ? h("span", { class: "privacy-by" }, ` · ${by}`) : null),
    h("p", {}, use),
    h(
      "p",
      { class: "privacy-links" },
      externalLink(link.href, link.label),
      ...hosts.map((origin) => h("code", {}, hostName(origin))),
    ),
  );
}

let dialog = null;
/** @type {ReturnType<typeof modal> | null} */
let surface = null;

function build() {
  const close = closeButton({ className: "pane-close privacy-close" });
  const mail = h("a", { href: `mailto:${OPERATOR.email}` }, OPERATOR.email);
  dialog = h(
    "dialog",
    { class: "modal privacy", "aria-labelledby": "privacy-title" },
    h("div", { class: "pane-header" }, h("h2", { id: "privacy-title" }, "Privacy"), close),
    h(
      "div",
      { class: "privacy-body" },
      h(
        "p",
        {},
        "RGI Explorer is a free, non-commercial map of the world's glaciers. It uses no cookies, analytics or tracking.",
      ),
      h("h3", {}, "Stored in your browser"),
      h(
        "p",
        {},
        "Your browser remembers whether you closed the welcome screen and keeps copies of the catalog and base " +
          "map descriptions, so that later visits load faster. If you block site storage in your browser's " +
          "settings, the map still works.",
      ),
      h("h3", {}, "Your location"),
      h(
        "p",
        {},
        "When you press the location button, the page asks your browser where you are and shows it on the map. " +
          "The page address then holds that view, as after any move.",
      ),
      h("h3", {}, "Services that receive your IP address"),
      h(
        "p",
        {},
        "The map loads its data directly from the services below. Each of them receives your IP address and " +
          "the details described, and handles them under its own terms.",
      ),
      ...SERVICES.flatMap(({ title, services }) => [
        h("h3", { class: "privacy-group" }, title),
        h("ul", { class: "privacy-services" }, services.map(serviceItem)),
      ]),
      h("h3", {}, "Contact"),
      h(
        "p",
        {},
        `RGI Explorer is run by ${OPERATOR.name}. The requests above rest on a legitimate interest in showing ` +
          "the map, which cannot work without them (Swiss FADP; GDPR Art. 6(1)(f)). To ask about your data or " +
          "to object, contact ",
        mail,
        ". You can also complain to a data protection authority.",
      ),
      h("p", { class: "privacy-updated" }, `Updated ${UPDATED}.`),
    ),
  );
  document.body.append(dialog);
  const node = dialog;
  /* Escape, the ✕ and a click on the backdrop close it, and focus goes back to the Privacy link. */
  surface = modal({ nodes: [node], isOpen: () => isDialogOpen(node), show: () => openDialog(node), hide: () => closeDialog(node), backdrop: true });
  close.addEventListener("click", () => surface?.close());
}

/** Open the privacy note, building it on first use. */
export function openPrivacy() {
  if (!dialog) build();
  surface?.open();
}
