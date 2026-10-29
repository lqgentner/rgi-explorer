/*
 * Check that page assets exist, dependency pins agree, the CSP and its hashes
 * cover the page, and preloads stay complete.
 */

import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { JSDOM } from "jsdom";

import { REPO } from "./helpers/browser.js";

const read = (file) => fs.readFileSync(path.join(REPO, file), "utf8");
const html = read("index.html");
const css = read("style.css");
const page = () => new JSDOM(html).window.document;

const importMap = (document) =>
  JSON.parse(document.querySelector('script[type="importmap"]').textContent);

const policy = () =>
  page().querySelector('meta[http-equiv="Content-Security-Policy"]').getAttribute("content");

/** The sources of one CSP directive that are remote hosts. */
const cspHosts = (directive) =>
  policy()
    .split(";")
    .map((part) => part.trim().split(/\s+/))
    .find(([name]) => name === directive)
    .filter((source) => /^https:/.test(source));

/* Every local src/href and import-map target, without a leading "./". Absolute
 * ones are other origins' to keep alive. */
function localReferences() {
  const document = page();
  const values = [
    ...Object.values(importMap(document).imports),
    ...[...document.querySelectorAll("[src], [href]")].map(
      (el) => el.getAttribute("src") ?? el.getAttribute("href"),
    ),
  ];
  const local = values.filter((value) => value && !/^[a-z]+:|^\/\//i.test(value));
  return [...new Set(local.map((value) => value.replace(/^\.\//, "")))];
}

const libraries = () => localReferences().filter((ref) => ref.startsWith("node_modules/"));
const packageName = (ref) => /^node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(ref)[1];

test("every file the page references is in the repository", () => {
  const refs = localReferences();
  // A guard on the guard: a selector that matched nothing would pass silently.
  assert.ok(refs.includes("style.css"), "the stylesheet is one of them");

  for (const ref of refs) {
    assert.ok(
      fs.existsSync(path.join(REPO, ref)),
      `index.html asks for ${ref}, which is missing; run pixi run --locked install`,
    );
  }
});

test("every file the stylesheet references is in the repository", () => {
  const urls = [...css.matchAll(/url\(["']?([^"')]+)["']?\)/g)].map((m) => m[1]);
  assert.ok(urls.length > 0);
  for (const url of urls) {
    assert.doesNotMatch(url, /^[a-z]+:|^\//i, `${url} is not relative`);
    assert.ok(fs.existsSync(path.join(REPO, url)), `style.css asks for ${url}, which is missing`);
  }
});

/* A browser ignores an address that is neither a URL nor starts with "/", "./"
 * or "../", and the bare name then fails to resolve. */
test("every import-map address is a relative URL", () => {
  for (const [name, address] of Object.entries(importMap(page()).imports)) {
    assert.match(address, /^\.\/node_modules\//, `${name} maps to ${address}`);
  }
});

/* Direct runtime dependencies, so Dependabot moves them and npm installs each
 * at the top of node_modules/, where the import map looks. */
test("every library the page loads is a runtime dependency in package.json", () => {
  const manifest = JSON.parse(read("package.json"));
  const names = [...new Set(libraries().map(packageName))].sort();
  assert.deepEqual(names, [
    "@leeoniya/ufuzzy",
    "fflate",
    "fzstd",
    "hyparquet",
    "maplibre-gl",
    "pmtiles",
  ]);
  for (const name of names) {
    assert.ok(manifest.dependencies?.[name], `package.json does not depend on ${name}`);
  }
  // The fonts and icons are served from node_modules too.
  for (const name of ["@fontsource/noto-sans", "@fontsource/noto-sans-mono", "lucide-static"]) {
    assert.ok(manifest.dependencies?.[name], `package.json does not depend on ${name}`);
  }
});

/* An exact version in package.json and a committed lockfile make installs repeatable. */
test("runtime and test dependencies are pinned exactly", () => {
  const manifest = JSON.parse(read("package.json"));
  for (const group of ["dependencies", "devDependencies"]) {
    for (const [name, version] of Object.entries(manifest[group])) {
      assert.match(version, /^\d+\.\d+\.\d+$/, `${name} is ${version}`);
    }
  }
  assert.ok(fs.existsSync(path.join(REPO, "package-lock.json")));
});

/* The jsdom suites use fakes, so a release that renames an export would pass
 * them and fail only in the browser. */
test("the libraries export what the page calls", async () => {
  const imports = importMap(page()).imports;
  const load = (name) => import(pathToFileURL(path.join(REPO, imports[name])).href);
  const source = fs
    .readdirSync(path.join(REPO, "js"))
    .map((name) => read(`js/${name}`))
    .join("\n");
  const used = (global) => [
    ...new Set([...source.matchAll(new RegExp(`\\b${global}\\.(\\w+)`, "g"))].map((m) => m[1])),
  ];

  const expected = {
    "maplibre-gl": used("maplibregl"),
    pmtiles: used("pmtiles"),
    hyparquet: used("hyparquet"),
  };
  for (const [name, members] of Object.entries(expected)) {
    const module = await load(name);
    for (const member of members) assert.ok(member in module, `${name} has no export ${member}`);
  }
  // The globals script names what the modules read.
  const globals = /Object\.assign\(globalThis, \{([^}]*)\}\)/.exec(html)[1];
  assert.deepEqual(globals.split(",").map((name) => name.trim()), ["maplibregl", "pmtiles", "hyparquet"]);
});

/* BSD, MIT, ISC and OFL require the notice wherever the code is redistributed. */
test("every library and font the page serves has its license notice", () => {
  const notices = read("assets/third-party-licenses.txt");
  const served = new Set([
    ...libraries().map(packageName),
    "@fontsource/noto-sans",
    "@fontsource/noto-sans-mono",
    "lucide-static",
  ]);
  for (const name of served) {
    assert.ok(notices.includes(`==== ${name} ====`), `third-party-licenses.txt lacks ${name}`);
  }
});

/* An edited inline script no longer matches its hash, and the browser skips it. */
test("the content security policy allows each inline script by hash", () => {
  const document = page();
  const scriptSrc = policy()
    .split(";")
    .find((part) => part.trim().startsWith("script-src"));
  const inline = [...document.querySelectorAll("script:not([src])")];
  assert.equal(inline.length, 2, "the import map and the globals module");
  for (const script of inline) {
    const hash = crypto.createHash("sha256").update(script.textContent).digest("base64");
    assert.ok(scriptSrc.includes(`'sha256-${hash}'`), `CSP lacks the hash of:\n${script.textContent}`);
  }
});

/* Same-origin code needs no integrity hash, and a CDN host in the policy would
 * let any package on that host run. */
test("the page loads its code and styles from its own origin", () => {
  const document = page();
  const code = [
    ...Object.values(importMap(document).imports),
    ...[...document.querySelectorAll('script[src], link[rel="modulepreload"], link[rel="stylesheet"]')].map(
      (el) => el.getAttribute("src") ?? el.getAttribute("href"),
    ),
  ];
  for (const url of code) assert.doesNotMatch(url, /^[a-z]+:|^\/\//i, `${url} is on another origin`);
  assert.equal(importMap(document).integrity, undefined, "same-origin modules need no integrity");

  for (const directive of ["script-src", "style-src", "worker-src"]) {
    const sources = policy()
      .split(";")
      .find((part) => part.trim().startsWith(directive));
    assert.doesNotMatch(sources, /https?:/, `${directive} still allows a remote host`);
  }
  assert.match(policy(), /worker-src 'self' blob:/);
});

test("CSP lists exactly the spec's data hosts", () => {
  const hosts = [
    "https://commons.wikimedia.org",
    "https://data.source.coop",
    "https://photon.komoot.io",
    "https://query.wikidata.org",
    "https://server.arcgisonline.com",
    "https://tiles.mapterhorn.com",
    "https://tiles.openfreemap.org",
    "https://upload.wikimedia.org",
  ];
  assert.deepEqual(cspHosts("connect-src").sort(), hosts);
  assert.deepEqual(cspHosts("img-src").sort(), [...hosts, "https://thumb.wikimedia.org"].sort());
});

test("fonts load from node_modules, not a CDN", () => {
  assert.match(css, /node_modules\/@fontsource\/noto-sans\//);
  assert.match(css, /node_modules\/@fontsource\/noto-sans-mono\//);
  assert.doesNotMatch(html + css, /fonts\.googleapis|fonts\.gstatic/);
});

/* app.js is fetched as a script; the modules below it would otherwise wait for
 * their importers, one level at a time. */
test("every js/ module but app.js is preloaded", () => {
  const preloaded = new Set(
    [...page().querySelectorAll('link[rel="modulepreload"]')].map((link) => link.getAttribute("href")),
  );
  const modules = fs
    .readdirSync(path.join(REPO, "js"))
    .filter((name) => name.endsWith(".js") && name !== "app.js")
    .map((name) => `js/${name}`);
  assert.ok(modules.includes("js/ui.js"), "the scan found the modules");
  for (const module of modules) assert.ok(preloaded.has(module), `index.html does not preload ${module}`);
});

test("no module is preloaded twice", () => {
  const hrefs = [...page().querySelectorAll('link[rel="modulepreload"]')].map((link) => link.getAttribute("href"));
  assert.deepEqual(hrefs.filter((href, i) => hrefs.indexOf(href) !== i), []);
});

test("the page has the containers the modules fill", () => {
  const document = page();
  for (const id of ["map", "sidebar", "search", "layers", "controls", "status", "notice", "sheet"]) {
    assert.ok(document.getElementById(id), `#${id} is missing`);
  }
});

test("Tab reaches the search before the map", () => {
  const document = page();
  const search = document.getElementById("search");
  const map = document.getElementById("map");
  assert.ok(search.compareDocumentPosition(map) & document.defaultView.Node.DOCUMENT_POSITION_FOLLOWING);
});

test("the page loads no script but the inline ones and app.js", () => {
  const sources = [...page().querySelectorAll("script[src]")].map((script) => script.getAttribute("src"));
  assert.deepEqual(sources, ["js/app.js"]);
});

test("the service worker is registered by a relative path", () => {
  const app = read("js/app.js");
  assert.match(app, /register\("sw\.js"\)/);
  assert.ok(fs.existsSync(path.join(REPO, "sw.js")));
});

test("the icon sprite holds the icons the interface uses", () => {
  const sprite = read("node_modules/lucide-static/sprite.svg");
  for (const name of ["layers-2", "search", "x", "info", "copy", "share-2", "maximize", "box", "chevron-down"]) {
    assert.ok(sprite.includes(`id="${name}"`), `Lucide has no icon ${name}`);
  }
});

test("the stylesheet's phone breakpoint is js/ui.js's query", () => {
  const ui = read("js/ui.js");
  const [, query] = ui.match(/PHONE = window\.matchMedia\("([^"]+)"\)/);
  assert.equal(query, "(max-width: 640px)");
  // Nothing in the stylesheet needs the phone layout yet; any block that does must match.
  for (const [, width] of css.matchAll(/@media \(max-width: (\d+px)\)/g)) {
    assert.equal(width, "640px");
  }
});
