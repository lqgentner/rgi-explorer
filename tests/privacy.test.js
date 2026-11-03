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

test("every service says who runs it, what it gets, and links its policy over https or says it has none", () => {
  for (const service of services) {
    assert.ok(service.name && service.by && service.what && service.gets, service.name);
    assert.ok(service.policy === null || service.policy.startsWith("https://"), service.name);
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
  assert.match(text, /What your browser keeps/);
  for (const service of services) assert.match(text, new RegExp(service.name), service.name);
  const mails = [...dialog.querySelectorAll('a[href^="mailto:"]')].map((a) => a.getAttribute("href"));
  assert.deepEqual(mails, [`mailto:${OPERATOR.email}`, `mailto:${OPERATOR.email}`]);
  const policies = [...dialog.querySelectorAll("a.external")].map((a) => a.getAttribute("href"));
  assert.deepEqual(policies, services.map((s) => s.policy).filter(Boolean));
  assert.match(text, /Publishes no privacy policy/, "Source Cooperative says it has none");

  dialog.querySelector(".privacy-close").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  assert.equal(dialog.open || dialog.hasAttribute("open"), false);
});

test("opening it again reuses the one dialog", () => {
  openPrivacy();
  openPrivacy();
  assert.equal(document.querySelectorAll("dialog.privacy").length, 1);
});
