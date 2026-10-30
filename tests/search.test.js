import assert from "node:assert/strict";
import test from "node:test";

import { buildGlacierIndex, parseIds, rankHits, searchGlaciers, searchRegions } from "../js/search.js";
import { searchPlaces } from "../js/photon.js";

const CID = (code, n) => `RGI2000-v7.0-C-${code}-${String(n).padStart(5, "0")}`;
const ID = (code, n) => `RGI2000-v7.0-G-${code}-${String(n).padStart(5, "0")}`;
const UNNAMED_ID = ID("11", 1);
const cols = {
  rgi_id: [ID("11", 2596), UNNAMED_ID, ID("11", 3), ID("11", 4), ID("01", 5), ID("11", 6)],
  display_name: ["Aletsch", null, "Aletschfirn", "Grosser Aletsch", "Müller", "Rhône"],
  glac_name: [null, "Unnamed_23", null, "GROSSER ALETSCH", null, null],
  complex_id: [CID("11", 1323), CID("11", 1), CID("11", 1323), CID("11", 4), CID("01", 5), CID("11", 6)],
};
const names = new Map([["11", "Central Europe"]]);
const idx = buildGlacierIndex(cols, names);
const placeHit = (title, score = 600) => ({ kind: "place", title, subtitle: "", score, center: [0, 0] });

test("an ID names a glacier, a complex or both", () => {
  for (const q of ["RGI2000-v7.0-G-11-02596", "g-11-02596"]) {
    assert.deepEqual(parseIds(q), { glacier: "RGI2000-v7.0-G-11-02596", complex: null });
  }
  for (const q of ["RGI2000-v7.0-C-11-01323", "c-11-01323"]) {
    assert.deepEqual(parseIds(q), { glacier: null, complex: "RGI2000-v7.0-C-11-01323" });
  }
  assert.deepEqual(parseIds(" 11-00001 "), { glacier: "RGI2000-v7.0-G-11-00001", complex: "RGI2000-v7.0-C-11-00001" });
  assert.deepEqual(parseIds("11-2596"), { glacier: null, complex: null });
  assert.deepEqual(parseIds("aletsch"), { glacier: null, complex: null });
});

test("a bare ID lists the glacier first and the complex second, each when it exists", () => {
  const hits = searchGlaciers(idx, "11-00001");
  assert.deepEqual(hits.map((h) => [h.kind, h.title, h.subtitle]), [
    ["glacier", UNNAMED_ID, `Glacier · ${UNNAMED_ID} · Central Europe`],
    ["complex", CID("11", 1), "Complex · Central Europe"],
  ]);
  assert.equal(hits[1].complexId, CID("11", 1));
  assert.ok(hits[0].score > hits[1].score);
  assert.ok(hits[1].score > 900, "a complex ID outranks every name");
  assert.deepEqual(searchGlaciers(idx, "11-01323").map((h) => h.kind), ["complex"], "no glacier 11-01323");
});

test("a complex ID finds only that complex, when it exists", () => {
  assert.deepEqual(searchGlaciers(idx, "C-11-01323").map((h) => [h.kind, h.complexId]), [["complex", CID("11", 1323)]]);
  assert.deepEqual(searchGlaciers(idx, "C-11-02596"), []);
  const [hit] = searchGlaciers(idx, CID("01", 5));
  assert.equal(hit.subtitle, "Complex", "no region name for code 01");
});

test("an exact ID outranks every name", () => {
  const hits = rankHits(searchGlaciers(idx, "11-02596"), [placeHit("Aletsch Arena")]);
  assert.equal(hits[0].rgiId, ID("11", 2596));
  assert.equal(hits[0].score, 1000);
  assert.equal(hits[0].subtitle, `Glacier · ${ID("11", 2596)} · Central Europe`);
  assert.equal(hits[0].row, 0);
});

test("an unnamed glacier is found by ID with the ID as title", () => {
  const [hit] = searchGlaciers(idx, UNNAMED_ID);
  assert.equal(hit.title, UNNAMED_ID);
  assert.match(hit.subtitle, /^Glacier · /);
  assert.equal(hit.row, 1);
});

test("an ID outside the index gives no hit", () => {
  assert.deepEqual(searchGlaciers(idx, ID("11", 99999)), []);
});

test("a glacier subtitle drops the region when the code has no name", () => {
  const [hit] = searchGlaciers(idx, ID("01", 5));
  assert.equal(hit.subtitle, `Glacier · ${ID("01", 5)}`);
});

test("an equal name scores 900, a prefix 700, a word prefix 620, a fuzzy match at most 500", () => {
  const hits = searchGlaciers(idx, "aletsch");
  const byTitle = Object.fromEntries(hits.map((hit) => [hit.title, hit.score]));
  assert.equal(byTitle.Aletsch, 900);
  assert.equal(byTitle.Aletschfirn, 700);
  assert.equal(byTitle["Grosser Aletsch"], 620);
  assert.equal(hits[0].title, "Aletsch");
});

test("a word that starts with the query ranks above every place and below a region", () => {
  const long = buildGlacierIndex({
    rgi_id: [ID("11", 7), ID("11", 8)],
    display_name: ["Grosser Aletsch Gletscher", "Pfaffen-Aletsch"],
    glac_name: [null, null],
  });
  const places = [0, 1, 2, 3, 4].map((i) => placeHit(`Aletsch place ${i}`, 600 - 10 * i));
  const hits = rankHits(searchGlaciers(long, "aletsch"), places, 7);
  assert.equal(hits[0].title, "Grosser Aletsch Gletscher");
  assert.equal(hits[0].score, 620);
  assert.equal(hits[1].score, 620);
  assert.ok(hits.slice(2).every((hit) => hit.kind === "place"));
  assert.equal(searchGlaciers(long, "letsch").length, 2);
  assert.ok(searchGlaciers(long, "letsch").every((hit) => hit.score <= 500));
  const withId = rankHits(searchGlaciers(long, ID("11", 7)), places);
  assert.equal(withId[0].score, 1000);
});

test("names match without case or accents, and only display_name is a name", () => {
  assert.equal(searchGlaciers(idx, "MULLER")[0].score, 900);
  assert.equal(searchGlaciers(idx, "rhone")[0].title, "Rhône");
  assert.equal(searchGlaciers(idx, "grosser")[0].title, "Grosser Aletsch");
  assert.deepEqual(searchGlaciers(idx, "unnamed"), [], "a glac_name such as Unnamed_23 is no name");
  assert.equal(searchGlaciers(idx, UNNAMED_ID)[0].title, UNNAMED_ID);
});

test("a short query gives no hits and the limit caps the list", () => {
  assert.deepEqual(searchGlaciers(idx, " a "), []);
  assert.equal(searchGlaciers(idx, "aletsch", 2).length, 2);
});

const regions = [
  { level: 1, o1region: "11", o2region: "11-00", full_name: "Central Europe", bbox: { xmin: 1, ymin: 2, xmax: 3, ymax: 4 } },
  { level: 2, o1region: "11", o2region: "11-01", full_name: "Alps", bbox: { xmin: 5, ymin: 6, xmax: 7, ymax: 8 } },
];

test("regions match by name prefix or code only", () => {
  const [hit] = searchRegions(regions, "central");
  assert.deepEqual(
    { kind: hit.kind, title: hit.title, subtitle: hit.subtitle, score: hit.score, bbox: hit.bbox },
    { kind: "region", title: "Central Europe", subtitle: "RGI region · 11", score: 650, bbox: regions[0].bbox },
  );
  assert.equal(searchRegions(regions, "11")[0].title, "Central Europe");
  assert.equal(searchRegions(regions, "11-01")[0].subtitle, "RGI subregion · 11-01");
  assert.deepEqual(searchRegions(regions, "europe"), []);
  assert.deepEqual(searchRegions(regions, "1"), []);
});

test("a strong place outranks a weak fuzzy glacier", () => {
  const fuzzy = searchGlaciers(idx, "rosser");
  assert.equal(fuzzy[0].score, 500);
  const hits = rankHits(fuzzy, [placeHit("Grosser Berg", 600)]);
  assert.equal(hits[0].kind, "place");
});

test("rankHits keeps input order on ties and applies the limit", () => {
  const a = [placeHit("a"), placeHit("b")];
  const c = [placeHit("c")];
  assert.deepEqual(rankHits(a, c).map((hit) => hit.title), ["a", "b", "c"]);
  assert.equal(rankHits(a, c, 2).length, 2);
});

test("Photon results map to place hits with decaying scores", async () => {
  let url;
  const features = [
    { properties: { name: "Matterhorn", osm_value: "peak", country: "Switzerland" }, geometry: { coordinates: [7.65, 45.97] } },
    { properties: { osm_value: "peak" }, geometry: { coordinates: [0, 0] } },
    { properties: { name: "Zermatt", country: "Switzerland" }, geometry: { coordinates: [7.75, 46.02] } },
    { properties: { name: "Nowhere" }, geometry: { coordinates: [1, 2] } },
    { properties: { name: "Aletsch", osm_value: "glacier", country: "Switzerland" }, geometry: { coordinates: [8, 46.5] } },
    { properties: { name: "Binntal", osm_value: "nature_reserve" }, geometry: { coordinates: [8.2, 46.4] } },
  ];
  const fetch = async (u) => {
    url = new URL(u);
    return { ok: true, json: async () => ({ features }) };
  };
  const hits = await searchPlaces("matter", { lat: 46, lon: 7, zoom: 5.4 }, { fetch });
  assert.equal(url.origin + url.pathname, "https://photon.komoot.io/api/");
  assert.equal(url.searchParams.get("q"), "matter");
  assert.equal(url.searchParams.get("lat"), "46");
  assert.equal(url.searchParams.get("lon"), "7");
  assert.equal(url.searchParams.get("limit"), "5");
  assert.equal(url.searchParams.get("lang"), "en");
  assert.deepEqual(
    hits.map(({ kind, title, subtitle, score, center }) => ({ kind, title, subtitle, score, center })),
    [
      { kind: "place", title: "Matterhorn", subtitle: "Peak · Switzerland", score: 600, center: [7.65, 45.97] },
      { kind: "place", title: "Zermatt", subtitle: "Switzerland", score: 590, center: [7.75, 46.02] },
      { kind: "place", title: "Nowhere", subtitle: "", score: 580, center: [1, 2] },
      { kind: "place", title: "Aletsch", subtitle: "Glacier (OSM) · Switzerland", score: 570, center: [8, 46.5] },
      { kind: "place", title: "Binntal", subtitle: "Nature reserve", score: 560, center: [8.2, 46.4] },
    ],
  );
});

test("a Photon error status gives no places", async () => {
  const fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
  assert.deepEqual(await searchPlaces("matter", { lat: 0, lon: 0, zoom: 2 }, { fetch }), []);
});

test("a query with over 1,000 fuzzy matches is still ranked by uFuzzy", async () => {
  const { default: uFuzzy } = await import("@leeoniya/ufuzzy");
  const names = Array.from({ length: 1500 }, (_, i) => `zzzz yyyy xxxx ${i} xab`);
  names.push("c xab");
  const big = buildGlacierIndex({
    rgi_id: names.map((_, i) => ID("11", i + 1)),
    display_name: names,
    glac_name: names.map(() => null),
  });
  const folded = names.map((n) => n.toLowerCase());
  const [found, , order] = new uFuzzy().search(folded, "ab", false, 1e4);
  const expected = order.map((k) => found[k]);
  assert.notDeepEqual(expected.slice(0, 5), [0, 1, 2, 3, 4]);
  assert.deepEqual(searchGlaciers(big, "ab", 5).map((hit) => hit.row), expected.slice(0, 5));
});
