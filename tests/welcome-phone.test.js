/* On a phone the help button starts beside the credits, so it rides up with them. */

import assert from "node:assert/strict";
import { test } from "node:test";

import { loadPage, load } from "./helpers/browser.js";

const { document } = await loadPage({ phone: true });
const { mountHelp } = await load("js/welcome.js");

test("mounted on a phone, the help button is in the status line before the credits", () => {
  const desktop = document.createElement("div");
  const phone = document.createElement("div");
  const credits = Object.assign(document.createElement("div"), { className: "credits-box" });
  phone.append(credits);
  const { button } = mountHelp({ desktop, phone }, { onHelp() {} });
  assert.equal(phone.firstElementChild, button);
  assert.equal(button.nextElementSibling, credits);
  assert.equal(desktop.children.length, 0);
});
