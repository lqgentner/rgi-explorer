/* The display table and the Overview rows. */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { loadPage, load } from "./helpers/browser.js";

await loadPage();
const { loadCatalog } = await load("js/catalog.js");
const { ATTRIBUTE_COLUMNS, DISPLAY, GROUP_TITLES, complexRows, formatArea, formatCoord, formatDate, formatInt, overviewRows } =
  await load("js/columns.js");

const ROOT = "https://data.source.coop/lqgentner/rgi/catalog.json";
const DIR = new URL("./fixtures/catalog/", import.meta.url);
const fixtureFetch = async (url) =>
  JSON.parse(await readFile(new URL(url.slice(ROOT.length - "catalog.json".length), DIR), "utf8"));

const catalog = await loadCatalog(ROOT, fixtureFetch);
const columns = catalog.columns;

const ALETSCH = {
  rgi_id: "RGI2000-v7.0-G-11-02596", o1region: "11", o2region: "11-01", glims_id: "G008032E46504N",
  anlys_id: 753957, subm_id: 731, src_date: new Date(Date.UTC(2003, 7, 13)), cenlon: 7.972367555085556,
  cenlat: 46.480362, utm_zone: 32, area_km2: 81.78146453981194, primeclass: 0, conn_lvl: 0, surge_type: 0,
  term_type: 9, glac_name: "GROSSER ALETSCH GLETSCHER", is_rgi6: false, termlon: 8.024125568430303,
  termlat: 46.39832730515637, zmin_m: 1578.3491, zmax_m: 4091.6558, zmed_m: 3152.1602, zmean_m: 3053.717,
  slope_deg: 15.236502, aspect_deg: 141.48456, aspect_sec: 4, dem_source: "COPDEM90", lmax_m: 22911,
  display_name: "Grosser Aletsch Gletscher", complex_id: "RGI2000-v7.0-C-11-01323",
  rgi6_links: [{ rgi6_id: "RGI60-11.01450" }], subm_n_outlines: 4034,
  subm_anlys_time: new Date(Date.UTC(2021, 8, 1)), subm_release_dt: new Date(Date.UTC(2021, 9, 9, 9)),
  subm_proc_desc: "Semi-automated.", subm_chief_affl: "University of Zurich-Irchel",
  subm_submitters: "Paul, Frank", subm_analysts: "Frey, Holger", subm_rc_id: 30,
};
const regions = [
  { level: 1, o1region: "11", o2region: null, full_name: "Central Europe" },
  { level: 2, o1region: "11", o2region: "11-01", full_name: "Alps" },
];
const group = (props, name) => overviewRows(props, columns, regions).find((g) => g.group === name).rows;
const row = (props, name, label) => group(props, name).find((r) => r.label === label);

test("every DISPLAY column exists in table:columns", () => {
  for (const d of DISPLAY) {
    assert.ok(columns.has(d.column), d.column);
    for (const extra of d.with ?? []) assert.ok(columns.has(extra), extra);
  }
});

test("ATTRIBUTE_COLUMNS covers the display and the title, without duplicates", () => {
  assert.equal(new Set(ATTRIBUTE_COLUMNS).size, ATTRIBUTE_COLUMNS.length);
  for (const d of DISPLAY) assert.ok(ATTRIBUTE_COLUMNS.includes(d.column), d.column);
  for (const c of ["rgi_id", "glac_name", "display_name", "o1region", "o2region", "zmean_m", "cenlon", "anlys_id"]) {
    assert.ok(ATTRIBUTE_COLUMNS.includes(c), c);
  }
});

test("coded values show the catalog label", () => {
  assert.equal(row(ALETSCH, "classification", "Terminus type").value, "Not assigned");
  assert.equal(row(ALETSCH, "classification", "Primary class").value, "Miscellaneous");
  assert.equal(row(ALETSCH, "classification", "Surge evidence").value, "No evidence");
});

test("a code missing from the classes shows the raw value", () => {
  assert.equal(row({ ...ALETSCH, term_type: 42 }, "classification", "Terminus type").value, "42");
});

test("group order puts Classification just above Submission", () => {
  assert.deepEqual(overviewRows(ALETSCH, columns, regions).map((g) => g.group),
    ["key", "location", "outline", "classification", "submission"]);
  assert.equal(GROUP_TITLES.classification, "Classification");
});

test("key numbers use the formats", () => {
  const key = group(ALETSCH, "key");
  assert.deepEqual(key.map((r) => [r.label, r.value]), [
    ["Area", "81.8 km²"], ["Length", "22,911 m"], ["Mean slope", "15.2°"],
    ["Min elevation", "1,578 m"], ["Median elevation", "3,152 m"], ["Max elevation", "4,092 m"],
  ]);
});

test("a missing key number shows a dash and other missing rows are hidden", () => {
  const props = { ...ALETSCH, lmax_m: null, utm_zone: undefined };
  assert.equal(row(props, "key", "Length").value, "—");
  assert.equal(row(props, "location", "UTM zone"), undefined);
});

test("area keeps two decimals below 10 km²", () => {
  assert.equal(formatArea(0.5), "0.50");
  assert.equal(formatArea(9.994), "9.99");
  assert.equal(formatArea(10), "10.0");
  assert.equal(row({ area_km2: 0.5 }, "key", "Area").value, "0.50 km²");
});

test("dates, integers and coordinates format", () => {
  const day = "2003-08-13";
  assert.equal(formatDate(new Date(Date.UTC(2003, 7, 13))), day);
  assert.equal(formatDate("2003-08-13T00:00:00Z"), day);
  assert.equal(formatDate(Date.UTC(2003, 7, 13)), day);
  assert.equal(formatInt(1234567), "1,234,567");
  assert.equal(formatCoord(46.480362, 7.972367), "46.4804° N, 7.9724° E");
  assert.equal(formatCoord(-12.5, -70.25), "12.5000° S, 70.2500° W");
});

test("location shows codes with names and the points", () => {
  assert.equal(row(ALETSCH, "location", "Region").value, "11 · Central Europe");
  assert.equal(row(ALETSCH, "location", "Subregion").value, "11-01 · Alps");
  assert.equal(row(ALETSCH, "location", "Central point").value, "46.4804° N, 7.9724° E");
  const terminus = row(ALETSCH, "location", "Terminus point");
  assert.deepEqual(terminus.action, { type: "pin", lonlat: [ALETSCH.termlon, ALETSCH.termlat] });
});

test("outline links the complex and the GLIMS page", () => {
  assert.deepEqual(row(ALETSCH, "outline", "Glacier complex").action, { type: "complex", id: "RGI2000-v7.0-C-11-01323" });
  const glims = row(ALETSCH, "outline", "GLIMS ID");
  assert.equal(glims.value, "G008032E46504N");
  assert.equal(glims.link, "https://www.glims.org/maps/info.html?anlys_id=753957");
  assert.equal(row(ALETSCH, "outline", "Same as RGI 6.0").value, "No");
  assert.equal(row(ALETSCH, "outline", "Source date").value, "2003-08-13");
});

test("GLIMS ID without anlys_id is plain text", () => {
  const glims = row({ ...ALETSCH, anlys_id: undefined }, "outline", "GLIMS ID");
  assert.equal(glims.value, "G008032E46504N");
  assert.equal(glims.link, undefined);
});

test("RGI 6.0 overlaps list each rgi6_id", () => {
  const links = [{ rgi6_id: "A" }, { rgi6_id: "B" }, { rgi6_id: "C" }, { rgi6_id: "D" }, { rgi6_id: "E" }];
  assert.deepEqual(row({ ...ALETSCH, rgi6_links: links }, "outline", "RGI 6.0 overlaps").list, ["A", "B", "C", "D", "E"]);
  assert.equal(row({ ...ALETSCH, rgi6_links: undefined }, "outline", "RGI 6.0 overlaps"), undefined);
});

test("the Greenland connection shows only in region 05", () => {
  const label = "Greenland ice sheet connection";
  assert.equal(row(ALETSCH, "classification", label), undefined);
  assert.equal(row({ ...ALETSCH, o1region: "05", conn_lvl: 1 }, "classification", label).value, "Weak connection");
});

test("aspect shows the sector and the degrees", () => {
  assert.equal(row(ALETSCH, "classification", "Aspect").value, "South-east · 141.5°");
});

test("the IDs sit behind show more", () => {
  const rows = group(ALETSCH, "submission");
  assert.deepEqual(rows.filter((r) => r.more).map((r) => r.label), ["Analysis ID", "Submission ID", "Regional center ID"]);
  assert.equal(rows.find((r) => r.label === "Release date").value, "2021-10-09");
});

test("rows carry the column description verbatim", () => {
  assert.equal(row(ALETSCH, "key", "Area").description, columns.get("area_km2").description);
  assert.equal(row(ALETSCH, "outline", "GLIMS ID").description, columns.get("glims_id").description);
});

const COMPLEX = {
  rgi_id: "RGI2000-v7.0-C-11-01323", o1region: "11", o2region: "11-01", cenlon: 7.97, cenlat: 46.48,
  utm_zone: 32, area_km2: 83.28, glacier_ids: ["RGI2000-v7.0-G-11-00003", "RGI2000-v7.0-G-11-02596"],
};

test("a complex shows its region, point, UTM zone and glacier count", () => {
  const rows = complexRows(COMPLEX, catalog.complexColumns, regions);
  assert.deepEqual(rows.map((r) => [r.label, r.value]), [
    ["Region", "11 · Central Europe"],
    ["Subregion", "11-01 · Alps"],
    ["Central point", "46.4800° N, 7.9700° E"],
    ["UTM zone", "32"],
    ["Glaciers", "2"],
  ]);
  assert.match(rows.at(-1).description, /rgi_id of every glacier/);
  assert.deepEqual(complexRows({ rgi_id: COMPLEX.rgi_id }, catalog.complexColumns, regions), []);
});
