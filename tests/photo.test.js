/* Photos: the Wikidata query, picking files, Commons credits, the timeout and the carousel. */

import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

import { loadPage, load, settle } from "./helpers/browser.js";

const { document, window } = await loadPage();
const { sparqlQuery, pointInRings, pickFiles, commonsCredits, categoryFiles, esriCrop, findPhotos } =
  await load("js/photo.js");
const { TIMEOUT_MS, SPARQL, COMMONS_API } = await load("js/config.js");
const { mountCard } = await load("js/card.js");

const fixture = (p) => JSON.parse(fs.readFileSync(new URL(`./fixtures/${p}`, import.meta.url), "utf8"));
const WD = fixture("wikidata/aletsch.json");
const COMMONS = fixture("commons/aletsch.json");
const RINGS = fixture("aletsch-rings.json");
const GLIMS = "G008032E46504N";
const BBOX = { xmin: 7.931361, ymin: 46.397437, xmax: 8.087402, ymax: 46.563295 };
const G = { rgiId: "RGI2000-v7.0-G-11-02596", props: { glims_id: GLIMS, bbox: BBOX } };
const FILE_2021 = "Glacier d'Aletsch - 2021.jpg";

const json = (data) => async () => ({ ok: true, status: 200, json: async () => data });
const hang = (url, { signal }) => new Promise((_, reject) => signal?.addEventListener("abort", () => reject(new Error("aborted"))));

test("the query has the bbox corners and the GLIMS ID", () => {
  const q = sparqlQuery(BBOX, GLIMS);
  assert.match(q, /Point\(7\.931361 46\.397437\)/);
  assert.match(q, /Point\(8\.087402 46\.563295\)/);
  assert.match(q, /P6799 "G008032E46504N"/);
  assert.match(q, /wikibase:cornerSouthWest/);
  assert.match(q, /wdt:P31\/wdt:P279\* wd:Q35666/);
  assert.match(q, /SERVICE wikibase:box \{\s*\?item wdt:P625 \?coord/);
});

test("a malformed GLIMS ID is not injected", () => {
  for (const bad of ['G1" } . ?x ?y ?z', "G008032E46504", "", null, undefined, "g008032e46504n"]) {
    const q = sparqlQuery(BBOX, bad);
    assert.doesNotMatch(q, /P6799 "/, String(bad));
    assert.doesNotMatch(q, /UNION/);
    assert.doesNotMatch(q, /\?x \?y/);
  }
});

test("a point in a hole is outside and a point in the ring is inside", () => {
  const square = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
  const hole = [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]];
  assert.equal(pointInRings([2, 2], [square, hole]), true);
  assert.equal(pointInRings([5, 5], [square, hole]), false);
  assert.equal(pointInRings([11, 5], [square, hole]), false);
});

test("a point in the second of several concatenated pieces is inside", () => {
  const first = [[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]];
  const second = [[10, 10], [14, 10], [14, 14], [10, 14], [10, 10]];
  const secondHole = [[11, 11], [12, 11], [12, 12], [11, 12], [11, 11]];
  const rings = [first, second, secondHole];
  assert.equal(pointInRings([12.5, 12.5], rings), true);
  assert.equal(pointInRings([11.5, 11.5], rings), false);
  assert.equal(pointInRings([7, 7], rings), false);
  assert.equal(pointInRings([2, 2], rings), true);
});

test("Aletsch picks the 2021 photo via GLIMS ID", () => {
  const [f] = pickFiles(WD.results.bindings, RINGS, GLIMS);
  assert.equal(f.file, FILE_2021);
  assert.equal(f.item, "Q204658");
});

test("duplicate rows give one file and GLIMS matches come first", () => {
  const files = pickFiles([...WD.results.bindings, ...WD.results.bindings], RINGS, GLIMS);
  const names = files.map((f) => f.file);
  assert.equal(new Set(names).size, names.length);
  assert.equal(names.filter((n) => n === FILE_2021).length, 1);
  assert.equal(names[0], FILE_2021);
});

test("items outside the outline and without a GLIMS match are dropped", () => {
  const files = pickFiles(WD.results.bindings, RINGS, GLIMS);
  assert.ok(!files.some((f) => f.item === "Q108577039"), "Guggigletscher lies outside");
  assert.deepEqual(pickFiles(WD.results.bindings, [], "G000000E00000N"), []);
});

test("at most eight files come back", () => {
  const bindings = Array.from({ length: 12 }, (_, i) => ({
    item: { value: `http://www.wikidata.org/entity/Q${i + 1}` },
    glims: { value: GLIMS },
    image: { value: `http://commons.wikimedia.org/wiki/Special:FilePath/F%20${i}.jpg` },
  }));
  assert.equal(pickFiles(bindings, [], GLIMS).length, 8);
});

test("commons credits read author, license and the thumbnail, with the HTML stripped", async () => {
  globalThis.DOMParser = window.DOMParser;
  const calls = [];
  const fetch = async (url, init) => { calls.push([url, init]); return { ok: true, json: async () => COMMONS }; };
  const photos = await commonsCredits(
    [{ file: FILE_2021, item: "Q204658", property: "P18" }, { file: "Oberaletsch.jpg", item: "Q691650" }], { fetch });
  assert.equal(calls.length, 1);
  const url = new URL(calls[0][0]);
  assert.equal(url.origin + url.pathname, COMMONS_API);
  assert.equal(url.searchParams.get("titles"), `File:${FILE_2021}|File:Oberaletsch.jpg`);
  assert.equal(url.searchParams.get("iiurlwidth"), "640");
  assert.equal(url.searchParams.get("iiprop"), "url|extmetadata");
  assert.equal(url.searchParams.get("origin"), "*");
  assert.equal(photos[0].author, "Christian David");
  assert.equal(photos[0].license, "CC BY-SA 4.0");
  assert.equal(photos[0].licenseUrl, "https://creativecommons.org/licenses/by-sa/4.0");
  assert.equal(photos[0].source, "Wikidata Q204658 · P18");
  assert.equal(photos[0].page, "https://commons.wikimedia.org/wiki/File:Glacier_d'Aletsch_-_2021.jpg");
  assert.match(photos[0].src, /^https:\/\/thumb\.wikimedia\.org\//);
  assert.doesNotMatch(JSON.stringify(photos), /<|&lt;/);
  assert.equal(photos[1].licenseUrl, "");
});

test("the Artist fallback strips tags without a DOMParser", async () => {
  const saved = globalThis.DOMParser;
  delete globalThis.DOMParser;
  try {
    const data = { query: { pages: { 1: { title: "File:A.jpg", imageinfo: [{ thumburl: "https://t/a.jpg",
      extmetadata: { Artist: { value: '<b onclick="x()">Ann</b> &amp; <i>Bob</i><script>alert(1)</script>' } } }] } } } };
    const [photo] = await commonsCredits([{ file: "A.jpg", item: "Q1" }], { fetch: json(data) });
    assert.doesNotMatch(photo.author, /[<>]/);
    assert.match(photo.author, /^Ann & Bob/);
  } finally {
    globalThis.DOMParser = saved;
  }
});

test("a file without a thumbnail is skipped", async () => {
  const data = { query: { pages: { 1: { title: "File:A.jpg", imageinfo: [{ extmetadata: {} }] } } } };
  assert.deepEqual(await commonsCredits([{ file: "A.jpg", item: "Q1" }], { fetch: json(data) }), []);
});

test("category files make one call per category and keep image files in order", async () => {
  const urls = [];
  const fetch = async (url) => {
    urls.push(new URL(url));
    return { ok: true, json: async () => ({ query: { pages: {
      2: { title: "File:Two.jpg", index: 2 }, 1: { title: "File:One.jpg", index: 1 }, 3: { title: "File:Doc.pdf", index: 3 } } } }) };
  };
  const files = await categoryFiles(["Aletschgletscher", "Langgletscher"], { fetch });
  assert.equal(urls.length, 2);
  assert.equal(urls[0].searchParams.get("gcmtitle"), "Category:Aletschgletscher");
  assert.equal(urls[0].searchParams.get("gcmtype"), "file");
  assert.equal(urls[0].searchParams.get("gcmlimit"), "5");
  assert.deepEqual(files, ["One.jpg", "Two.jpg", "One.jpg", "Two.jpg"]);
});

test("findPhotos puts the P18 photo first, then category files, and asks Commons once for credits", async () => {
  globalThis.DOMParser = window.DOMParser;
  const calls = [];
  const fetch = async (url) => {
    const u = new URL(url);
    calls.push(u);
    if (url.startsWith(SPARQL)) return { ok: true, json: async () => WD };
    if (u.searchParams.get("generator")) {
      return { ok: true, json: async () => ({ query: { pages: {
        1: { title: "File:Oberaletsch.jpg", index: 1 }, 2: { title: `File:${FILE_2021}`, index: 2 } } } }) };
    }
    return { ok: true, json: async () => COMMONS };
  };
  const photos = await findPhotos(G, RINGS, { fetch });
  const sparql = calls.find((u) => u.origin + u.pathname === SPARQL);
  assert.equal(sparql.searchParams.get("format"), "json");
  assert.match(sparql.searchParams.get("query"), /P6799 "G008032E46504N"/);
  assert.equal(calls.filter((u) => u.searchParams.get("generator")).length <= 2, true);
  assert.equal(calls.filter((u) => u.searchParams.get("prop") === "imageinfo").length, 1);
  assert.equal(photos[0].source, "Wikidata Q204658 · P18");
  assert.equal(photos[0].author, "Christian David");
  assert.ok(photos.some((p) => p.source === "Wikidata Q204658 · P373"));
  assert.equal(new Set(photos.map((p) => p.src)).size, photos.length);
});

test("findPhotos resolves [] without a bbox, on an HTTP error and on bad JSON", async () => {
  assert.deepEqual(await findPhotos({ props: { glims_id: GLIMS } }, RINGS, { fetch: json(WD) }), []);
  assert.deepEqual(await findPhotos(G, RINGS, { fetch: async () => ({ ok: false, status: 500, json: async () => ({}) }) }), []);
  assert.deepEqual(await findPhotos(G, RINGS, { fetch: async () => { throw new Error("offline"); } }), []);
  assert.deepEqual(await findPhotos(G, RINGS, { fetch: async () => ({ ok: true, json: async () => { throw new Error("bad"); } }) }), []);
});

test("Wikidata down resolves to no photos within the timeout", async () => {
  const t = Date.now();
  assert.deepEqual(await findPhotos(G, RINGS, { fetch: hang, timeoutMs: 50 }), []);
  assert.ok(Date.now() - t < 50 + 200);
  assert.equal(TIMEOUT_MS, 4000);
});

test("the timeout aborts the in-flight request and a fetch that ignores the signal still resolves", async () => {
  let aborted = false;
  const fetch = (url, { signal }) => new Promise(() => signal.addEventListener("abort", () => { aborted = true; }));
  assert.deepEqual(await findPhotos(G, RINGS, { fetch, timeoutMs: 30 }), []);
  assert.equal(aborted, true);
});

test("the caller's signal stops findPhotos", async () => {
  const controller = new AbortController();
  const pending = findPhotos(G, RINGS, { fetch: hang, signal: controller.signal, timeoutMs: 5000 });
  controller.abort();
  assert.deepEqual(await pending, []);
});

test("Esri crop URL pads the bbox and asks for jpg", () => {
  const url = esriCrop({ xmin: 10, ymin: 40, xmax: 12, ymax: 41 }, 816, 400);
  assert.equal(
    url,
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export" +
      "?bbox=9.7,39.85,12.3,41.15&bboxSR=4326&imageSR=3857&size=816,400&format=jpg&f=image",
  );
});

/* The carousel and late results, through mountCard. */

const CATALOG = { columns: new Map() };
function setup(over = {}) {
  document.getElementById("card")?.remove();
  const root = document.createElement("div");
  root.id = "card";
  document.getElementById("sidebar").append(root);
  const ctx = { catalog: CATALOG, regions: [], parquet: { handle: null, rowOf: async () => null }, photos: async () => [], ...over };
  return { root, card: mountCard(root, ctx) };
}
const click = (node) => node.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
const photo = (n, extra = {}) => ({
  src: `https://thumb.wikimedia.org/${n}.jpg`, page: `https://commons.wikimedia.org/wiki/File:${n}.jpg`,
  author: `Author ${n}`, license: "CC BY-SA 4.0", licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0",
  source: `Wikidata Q${n} · P18`, ...extra,
});
const OPEN = (id, props = {}) => ({ rgiId: id, props: { display_name: `Glacier ${id}`, ...props } });

test("a photo for A arriving after B opens is dropped", async () => {
  const resolvers = {};
  const { root, card } = setup({ photos: (g) => new Promise((resolve) => { resolvers[g.rgiId] = resolve; }) });
  card.open(OPEN("A", { bbox: BBOX }));
  card.open(OPEN("B", { bbox: BBOX }));
  resolvers.A([photo(1)]);
  await settle();
  assert.ok(root.querySelector(".photo img.photo-crop"), "A's photo never reaches B's card, which keeps its crop");
  assert.equal(root.querySelectorAll(".photo img").length, 1);
  resolvers.B([photo(2)]);
  await settle();
  assert.equal(root.querySelector(".photo img").getAttribute("src"), photo(2).src);
});

test("one photo has no arrows, several have them, and the buttons move the image", async () => {
  const one = setup({ photos: async () => [photo(1)] });
  await one.card.open(OPEN("A"));
  await settle();
  assert.equal(one.root.querySelector('[aria-label="Next photo"]'), null);
  assert.equal(one.root.querySelector('[aria-label="Previous photo"]'), null);
  const img = one.root.querySelector(".photo img");
  assert.equal(img.getAttribute("alt"), "Photo of Glacier A");
  assert.equal(img.getAttribute("loading"), "lazy");

  const many = setup({ photos: async () => [photo(1), photo(2), photo(3)] });
  await many.card.open(OPEN("A"));
  await settle();
  const src = () => many.root.querySelector(".photo img").getAttribute("src");
  assert.equal(src(), photo(1).src);
  click(many.root.querySelector('[aria-label="Next photo"]'));
  assert.equal(src(), photo(2).src);
  click(many.root.querySelector('[aria-label="Previous photo"]'));
  click(many.root.querySelector('[aria-label="Previous photo"]'));
  assert.equal(src(), photo(3).src, "previous wraps to the last photo");
});

test("the info button reveals source, author and license as text with safe links", async () => {
  const hostile = photo(1, { author: "<img src=x onerror=alert(1)>", licenseUrl: "javascript:alert(1)" });
  const { root, card } = setup({ photos: async () => [hostile, photo(2)] });
  await card.open(OPEN("A"));
  await settle();
  const info = root.querySelector('[aria-label="Photo details"]');
  assert.equal(root.querySelector(".photo-details").hidden, true);
  click(info);
  const details = root.querySelector(".photo-details");
  assert.equal(details.hidden, false);
  assert.equal(info.getAttribute("aria-expanded"), "true");
  assert.equal(info.getAttribute("aria-label"), "Photo details");
  assert.match(details.textContent, /Wikidata Q1 · P18/);
  assert.match(details.textContent, /<img src=x onerror=alert\(1\)>/);
  assert.equal(details.querySelector("img"), null);
  assert.equal(details.querySelector('a[href="https://commons.wikimedia.org/wiki/File:1.jpg"]').textContent, "Wikidata Q1 · P18");
  assert.equal(details.querySelector('a[href^="javascript"]'), null);
  assert.match(details.textContent, /CC BY-SA 4\.0/);
  click(root.querySelector('[aria-label="Next photo"]'));
  assert.equal(root.querySelector('.photo-details a[href="https://creativecommons.org/licenses/by-sa/4.0"]').textContent, "CC BY-SA 4.0");
});

test("with no photos the card shows the Esri crop and its credit", async () => {
  const { root, card } = setup();
  await card.open(OPEN("A", { bbox: BBOX }));
  await settle();
  const img = root.querySelector(".photo img");
  assert.equal(img.getAttribute("src"), esriCrop(BBOX, 816, 400));
  assert.match(root.querySelector(".photo").textContent, /Imagery: Esri, Maxar, Earthstar Geographics/);
  img.dispatchEvent(new window.Event("error"));
  assert.equal(root.querySelector(".photo img"), null);
  assert.ok(root.querySelector(".photo-placeholder"));
  assert.equal(root.querySelector(".photo-placeholder").style.background, "var(--line)");
});

test("the crop shows while the photo lookup runs, and photos replace it when they arrive", async () => {
  let resolve;
  const { root, card } = setup({ photos: () => new Promise((r) => { resolve = r; }) });
  card.open(OPEN("A", { bbox: BBOX }));
  assert.equal(root.querySelector(".photo img.photo-crop").getAttribute("src"), esriCrop(BBOX, 816, 400));
  resolve([photo(1)]);
  await settle();
  assert.equal(root.querySelector(".photo img.photo-crop"), null);
  assert.equal(root.querySelector(".photo img").getAttribute("src"), photo(1).src);
});

test("a crop that fails while the photo lookup runs leaves the plain block", async () => {
  const { root, card } = setup({ photos: () => new Promise(() => {}) });
  card.open(OPEN("A", { bbox: BBOX }));
  root.querySelector(".photo img.photo-crop").dispatchEvent(new window.Event("error"));
  assert.ok(root.querySelector(".photo-placeholder"));
});

test("without a bbox the area stays empty until the parquet read supplies it", async () => {
  const { openParquet } = await load("js/parquet.js");
  const real = globalThis.hyparquet;
  globalThis.hyparquet = {
    ...real,
    parquetMetadataAsync: async () => ({ row_groups: [{ num_rows: 1n }] }),
    parquetReadObjects: async () => [{ bbox: BBOX, hypso_z0_m: null, hypso_permille: null, rgi6_links: null }],
  };
  try {
    const handle = await openParquet({});
    const { root, card } = setup({ parquet: { handle, rowOf: async () => 0 } });
    const done = card.open({ rgiId: "A", row: 0, props: { display_name: "A" } });
    await settle();
    await done;
    assert.equal(root.querySelector(".photo img").getAttribute("src"), esriCrop(BBOX, 816, 400));
  } finally {
    globalThis.hyparquet = real;
  }
  const bare = setup();
  await bare.card.open(OPEN("A"));
  await settle();
  assert.equal(bare.root.querySelector(".photo img"), null);
  assert.equal(bare.root.querySelector(".photo-placeholder"), null);
});

test("a late crop error for A does not touch B and a crop error after close does not throw", async () => {
  const { root, card } = setup();
  await card.open(OPEN("A", { bbox: BBOX }));
  await settle();
  const oldImg = root.querySelector(".photo img");
  const other = { xmin: 1, ymin: 2, xmax: 3, ymax: 4 };
  await card.open(OPEN("B", { bbox: other }));
  await settle();
  const crop = root.querySelector(".photo img");
  assert.equal(crop.getAttribute("src"), esriCrop(other, 816, 400));
  oldImg.dispatchEvent(new window.Event("error"));
  assert.equal(root.querySelector(".photo img").getAttribute("src"), esriCrop(other, 816, 400));
  assert.equal(root.querySelector(".photo-placeholder"), null);
  card.close();
  assert.doesNotThrow(() => crop.dispatchEvent(new window.Event("error")));
});

test("the crop image is kept when the card re-renders with the same bbox", async () => {
  const { openParquet } = await load("js/parquet.js");
  const real = globalThis.hyparquet;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  globalThis.hyparquet = {
    ...real,
    parquetMetadataAsync: async () => ({ row_groups: [{ num_rows: 1n }] }),
    parquetReadObjects: async () => { await gate; return [{ bbox: BBOX, hypso_z0_m: null, hypso_permille: null, rgi6_links: null }]; },
  };
  try {
    const handle = await openParquet({});
    const { root, card } = setup({ parquet: { handle, rowOf: async () => 0 } });
    const done = card.open({ rgiId: "A", row: 0, props: { display_name: "A", bbox: BBOX } });
    await settle();
    const img = root.querySelector(".photo img");
    assert.ok(img);
    release();
    await done;
    assert.equal(root.querySelector(".photo img"), img);
    assert.equal(root.querySelectorAll(".photo-credit").length, 1);
  } finally {
    globalThis.hyparquet = real;
  }
});
