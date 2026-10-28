import assert from "node:assert/strict";
import test from "node:test";

import { buildGlacierIndex, parseRgiId, rankHits, searchGlaciers, searchRegions } from "../js/search.js";
import { searchPlaces } from "../js/photon.js";

const ID = (code, n) => `RGI2000-v7.0-G-${code}-${String(n).padStart(5, "0")}`;
const UNNAMED_ID = ID("11", 1);
const cols = {
  rgi_id: [ID("11", 2596), UNNAMED_ID, ID("11", 3), ID("11", 4), ID("01", 5), ID("11", 6)],
  display_name: ["Aletsch", null, "Aletschfirn", null, "Müller", "Rhône"],
  glac_name: [null, null, null, "Grosser Aletsch", null, null],
};
const names = new Map([["11", "Central Europe"]]);
const idx = buildGlacierIndex(cols, names);
const placeHit = (title, score = 600) => ({ kind: "place", title, subtitle: "", score, center: [0, 0] });

test("parses every ID form", () => {
  for (const q of ["RGI2000-v7.0-G-11-02596", "g-11-02596", " 11-02596 "]) {
    assert.equal(parseRgiId(q), "RGI2000-v7.0-G-11-02596");
  }
  assert.equal(parseRgiId("11-2596"), null);
  assert.equal(parseRgiId("aletsch"), null);
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

test("an equal name scores 900, a prefix 700, a fuzzy match at most 500", () => {
  const hits = searchGlaciers(idx, "aletsch");
  const byTitle = Object.fromEntries(hits.map((hit) => [hit.title, hit.score]));
  assert.equal(byTitle.Aletsch, 900);
  assert.equal(byTitle.Aletschfirn, 700);
  assert.equal(byTitle["Grosser Aletsch"], 500);
  assert.equal(hits[0].title, "Aletsch");
});

test("names match without case or accents, and glac_name fills a missing display_name", () => {
  assert.equal(searchGlaciers(idx, "MULLER")[0].score, 900);
  assert.equal(searchGlaciers(idx, "rhone")[0].title, "Rhône");
  assert.equal(searchGlaciers(idx, "grosser")[0].title, "Grosser Aletsch");
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
      { kind: "place", title: "Matterhorn", subtitle: "peak · Switzerland", score: 600, center: [7.65, 45.97] },
      { kind: "place", title: "Zermatt", subtitle: "Switzerland", score: 590, center: [7.75, 46.02] },
      { kind: "place", title: "Nowhere", subtitle: "", score: 580, center: [1, 2] },
    ],
  );
});

test("a Photon error status gives no places", async () => {
  const fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
  assert.deepEqual(await searchPlaces("matter", { lat: 0, lon: 0, zoom: 2 }, { fetch }), []);
});
