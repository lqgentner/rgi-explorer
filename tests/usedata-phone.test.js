/* "Use this data" on the phone: a pane in the sheet, not a dialog. */

import assert from "node:assert/strict";
import { test } from "node:test";

import { load, loadPage } from "./helpers/browser.js";
import { fixtureCatalog } from "./helpers/served.js";


const { document, window, setPhone } = await loadPage({ phone: true });
const { loadCatalog } = await load("js/catalog.js");
const { snippet, mountUseData } = await load("js/usedata.js");
const catalog = await fixtureCatalog(loadCatalog);
const ALETSCH = { rgiId: "RGI2000-v7.0-G-11-02596", o1region: "11" };

test("the phone opens a pane in the sheet with the same snippet", () => {
  const sheet = document.getElementById("sheet");
  const useData = mountUseData(document.body, { catalog, sheet });
  const pane = sheet.querySelector(".usedata-pane");
  assert.equal(document.querySelector("dialog.usedata").childElementCount, 0, "the desktop's dialog waits empty");
  assert.equal(pane.hidden, true);

  useData.open(ALETSCH);
  assert.equal(pane.hidden, false);
  assert.equal(pane.getAttribute("role"), "dialog");
  assert.equal(pane.querySelector(".usedata-code code").textContent,
    snippet({ tool: "python", scope: "glacier" }, ALETSCH, catalog).code);

  pane.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.equal(pane.hidden, true);
  useData.open(ALETSCH);
  pane.querySelector(".usedata-close").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  assert.equal(pane.hidden, true);
});

test("an open offer moves between the pane and the dialog when the layout changes", () => {
  const sheet = document.getElementById("sheet");
  const useData = mountUseData(document.body, { catalog, sheet });
  const pane = [...sheet.querySelectorAll(".usedata-pane")].at(-1);
  const dialog = [...document.querySelectorAll("dialog.usedata")].at(-1);
  dialog.showModal ??= function () { this.setAttribute("open", ""); };
  dialog.close ??= function () { this.removeAttribute("open"); };
  useData.open(ALETSCH);
  pane.querySelector('input[value="region"]').click();

  setPhone(false);
  assert.equal(pane.hidden, true);
  assert.equal(pane.childElementCount, 0);
  assert.ok(dialog.hasAttribute("open"), "still open, now as the dialog");
  assert.equal(dialog.querySelector("input:checked[value=region]")?.value, "region", "the choice stays");
  assert.ok(dialog.querySelector(".usedata-code"));

  useData.close();
  setPhone(true);
  assert.equal(pane.hidden, true, "a closed offer stays closed");
  assert.ok(pane.querySelector(".usedata-code"));
});

test("a move hears no close and open, and takes keyboard focus along", () => {
  const sheet = document.getElementById("sheet");
  /* The sheet shows while a card is open; jsdom focuses nothing inside a hidden one. */
  sheet.hidden = false;
  const toggles = [];
  const useData = mountUseData(document.body, { catalog, sheet, onToggle: (open) => toggles.push(open) });
  const pane = [...sheet.querySelectorAll(".usedata-pane")].at(-1);
  const dialog = [...document.querySelectorAll("dialog.usedata")].at(-1);
  dialog.showModal ??= function () { this.setAttribute("open", ""); };
  dialog.close ??= function () { this.removeAttribute("open"); };
  useData.open(ALETSCH);
  assert.ok(pane.contains(document.activeElement), "open, focus starts on the pane's tab");

  setPhone(false);
  assert.ok(dialog.contains(document.activeElement), "focus moves into the dialog with the content");
  setPhone(true);
  assert.ok(pane.contains(document.activeElement), "and back into the pane, not to the button it covers");
  assert.equal(document.activeElement.getAttribute("aria-selected"), "true", "on the chosen tab");
  useData.close();
  assert.deepEqual(toggles, [true, false], "the tour hears one open and one close, none for the moves");
  sheet.hidden = true;
});
