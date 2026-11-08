/* The privacy note: every host the page may contact, who runs it, and how to reach the operator. */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { JSDOM } from "jsdom";

import { load, loadPage, REPO } from "./helpers/browser.js";

const page = await loadPage();
const { document, window } = page;
const { OPERATOR, SERVICES, openPrivacy } = await load("js/privacy.js");

const services = SERVICES.flatMap((group) => group.services);

/** The remote hosts of the CSP's connect-src and img-src, together. */
function cspHosts() {
  const html = fs.readFileSync(path.join(REPO, "index.html"), "utf8");
  const policy = new JSDOM(html).window.document
    .querySelector('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute("content");
  const directives = policy.split(";").map((part) => part.trim().split(/\s+/));
  const hosts = directives
    .filter(([name]) => name === "connect-src" || name === "img-src")
    .flatMap(([, ...sources]) => sources.filter((source) => source.startsWith("https:")));
  return [...new Set(hosts)].sort();
}

test("the note names every host the CSP lets the page contact, and no other", () => {
  assert.deepEqual(services.flatMap((s) => s.hosts).sort(), cspHosts());
});

test("every service says what it is for and links its privacy policy or, where none covers it, its website", () => {
  for (const service of services) {
    assert.ok(service.name && service.use, service.name);
    assert.ok(service.link.href.startsWith("https://"), service.name);
    assert.ok(["Privacy policy", "Website"].includes(service.link.label), service.name);
  }
});

test("the dialog shows the operator, the storage, each service and the rights, and closes", () => {
  openPrivacy();
  const dialog = document.querySelector("dialog.privacy");
  assert.ok(dialog.open || dialog.hasAttribute("open"));
  const title = dialog.querySelector("#privacy-title");
  assert.equal(title.textContent, "Privacy");
  assert.equal(dialog.getAttribute("aria-labelledby"), title.id);
  const text = dialog.textContent;
  assert.match(text, new RegExp(OPERATOR.name));
  assert.match(text, /no cookies/);
  assert.match(text, /Stored in your browser/);
  assert.match(text, /When you press the location button/);
  assert.match(text, /legitimate interest/);
  for (const service of services) assert.match(text, new RegExp(service.name), service.name);
  const mails = [...dialog.querySelectorAll('a[href^="mailto:"]')].map((a) => a.getAttribute("href"));
  assert.deepEqual(mails, [`mailto:${OPERATOR.email}`], "one address, in the contact at the end");
  const contact = [...dialog.querySelectorAll("h3")].at(-1);
  assert.equal(contact.textContent, "Contact");
  assert.match(contact.nextElementSibling.textContent, new RegExp(`run by ${OPERATOR.name}`));
  const policies = [...dialog.querySelectorAll("a.external")].map((a) => a.getAttribute("href"));
  assert.deepEqual(policies, services.map((s) => s.link.href));

  dialog.querySelector(".privacy-close").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  assert.equal(dialog.open || dialog.hasAttribute("open"), false);
});

test("opening it again reuses the one dialog", () => {
  openPrivacy();
  openPrivacy();
  assert.equal(document.querySelectorAll("dialog.privacy").length, 1);
});
