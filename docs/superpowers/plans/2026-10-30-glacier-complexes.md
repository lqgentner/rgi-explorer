# Glacier Complexes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a glacier complex be found by ID and opened in its own panel, selected on the map like a glacier, with "Use this data" for it.

**Architecture:** A new `js/complexcard.js` panel sits beside the glacier card in the same root (sidebar or bottom sheet); only one is open at a time. The complex's row is read from the complexes GeoParquet by row group, found from the `rgi_id` statistics; member names come from the glacier search index, which gains `complex_id`; member areas come from the glaciers file's `area_km2` in the member rows' row groups. The map gets its own complex selection layers. `js/app.js` wires search, the glacier card's complex link, the address and map clicks.

**Tech Stack:** Plain ES modules, MapLibre GL JS, hyparquet, node:test with jsdom and the strict fake map.

**Spec:** `docs/superpowers/specs/2026-10-30-glacier-complexes-design.md` (read it first; it wins on behaviour). Contracts: `AGENTS.md`.

## Global Constraints

- No figures beyond RGI's own fields: no elevation range, dates or anything computed from members. The member count and the member table are allowed.
- Clicking the map never opens a complex.
- Build DOM with `h()` from `js/ui.js`; no HTML interpolation.
- Every new `js/` module goes into the `modulepreload` list in `index.html` (a test enforces it).
- No new data host: the complexes file sits on `data.source.coop` like the glaciers file.
- Copy: panel subtitle `Complex · <region name>`; glacier card subtitle starts `Glacier · `; complex search hit subtitle `Complex · <region name>`; complex title is the full ID `RGI2000-v7.0-C-11-01323`.
- Complex IDs: `RGI2000-v7.0-C-\d{2}-\d{5}`. Search accepts `RGI2000-v7.0-C-11-01208` and `C-11-01208` (any case) for a complex only, and a bare `11-01208` for both glacier and complex, glacier first.
- Run tests with `pixi run --locked test-js` (all) or `node --test tests/<file>.test.js` after `pixi run --locked install`.

## Review Focus

1. A `?complex=` ID that is not in the file: dropped from the address, no panel, as an unknown `?glacier=` is (Task 7 test `an unknown complex in the address is dropped`).
2. Fast switching glacier → complex → member glacier: a late complex or member read must not render into the glacier card or reopen the complex (Task 6 test `a late read after close renders nothing`; Task 7 test `opening a member glacier closes the complex`).
3. The complexes read fails: the panel shows the ID and "The complex could not be read." instead of staying on "Loading…" (Task 6 test `a failed read says so`).
4. The search index is not loaded or fails: the member table still lists `glacier_ids` with empty name and area cells (Task 6 test `members without the index show their IDs`).
5. A click on empty map while a complex is open closes it, and a click on a glacier opens that glacier (Task 7 test `a map click leaves the complex`).

---

### Task 1: Complexes fixture and the key lookup in parquet.js

**Files:**
- Modify: `scripts/make_fixture_parquet.py`
- Modify: `tests/helpers/served.js`
- Modify: `js/parquet.js`
- Test: `tests/parquet.test.js`

**Interfaces:**
- Produces: `groupOfKey(handle, column: string, key: string) -> number` (row group index, or -1) in `js/parquet.js`; `COMPLEXES_URL` export and the complexes bytes in `makeParquet()` in `tests/helpers/served.js`; fixture file `complexes.parquet`.

Fixture facts (later tasks' tests use these exact values):

| Glacier | complex_id |
| --- | --- |
| `RGI2000-v7.0-G-11-02596` (Aletsch, 81.78146453981194 km²) | `RGI2000-v7.0-C-11-01323` |
| `RGI2000-v7.0-G-11-00001` (Morteratsch, 0.5) | `RGI2000-v7.0-C-11-00001` |
| `RGI2000-v7.0-G-03-00002` (Athabasca, 1.0) | `RGI2000-v7.0-C-03-00002` |
| `RGI2000-v7.0-G-11-00003` (unnamed, 1.5) | `RGI2000-v7.0-C-11-01323` |
| `RGI2000-v7.0-G-11-00004` (unnamed, 2.0) | `RGI2000-v7.0-C-11-00004` |

Complexes rows, sorted by `rgi_id`, `row_group_size=2` (groups: rows 0–1, 2–3):

| rgi_id | o1region | o2region | area_km2 | glacier_ids | bbox |
| --- | --- | --- | --- | --- | --- |
| `RGI2000-v7.0-C-03-00002` | 03 | 03-01 | 1.0 | [G-03-00002] | Athabasca's |
| `RGI2000-v7.0-C-11-00001` | 11 | 11-01 | 0.5 | [G-11-00001] | Morteratsch's |
| `RGI2000-v7.0-C-11-00004` | 11 | 11-01 | 2.0 | [G-11-00004] | its glacier's |
| `RGI2000-v7.0-C-11-01323` | 11 | 11-01 | 83.28146453981194 | [G-11-00003, G-11-02596] | `{xmin: 7.931361, ymin: 46.397437, xmax: 8.31, ymax: 46.61}` |

`cenlon`, `cenlat`, `utm_zone` copy the first member's values. Schema: `rgi_id` string, `o1region` string, `o2region` string, `cenlon` float64, `cenlat` float64, `utm_zone` uint8, `area_km2` float64, `glacier_ids` list<string>, `bbox` BBOX (no geometry, like the glaciers fixture).

- [ ] **Step 1: Write the failing tests** in `tests/parquet.test.js` (`complexes` path is `path.join(dir, "complexes.parquet")`):

```js
test("finds the row group of a key from the column statistics", async () => {
  const h = await openParquet(await hyparquet.asyncBufferFromFile(complexes));
  assert.equal(groupOfKey(h, "rgi_id", "RGI2000-v7.0-C-03-00002"), 0);
  assert.equal(groupOfKey(h, "rgi_id", "RGI2000-v7.0-C-11-01323"), 1);
  assert.equal(groupOfKey(h, "rgi_id", "RGI2000-v7.0-C-01-00001"), -1);
  assert.equal(groupOfKey(h, "rgi_id", "RGI2000-v7.0-C-19-00001"), -1);
  assert.equal(groupOfKey(h, "no_such_column", "x"), -1);
});

test("the glaciers fixture names each glacier's complex", async () => {
  const cols = await readColumns(await open(), ["rgi_id", "complex_id"]);
  assert.equal(cols.complex_id[cols.rgi_id.indexOf("RGI2000-v7.0-G-11-00003")], "RGI2000-v7.0-C-11-01323");
});
```

- [ ] **Step 2: Run** `node --test tests/parquet.test.js`. Expected: FAIL (`groupOfKey` is not exported; complex_id of G-11-00003 is wrong).

- [ ] **Step 3: Implement.** In the fixture script: give `variant()` a `complex_id=f"RGI2000-v7.0-C-{reg}-{n:05d}"` default, pass `complex_id="RGI2000-v7.0-C-11-01323"` for variant 3, add `COMPLEX_SCHEMA`, `complex_rows()` from the table above and write `complexes.parquet` with `row_group_size=2`. In `served.js` export `COMPLEXES_URL = \`${DATA}v7.0/complexes/rgi7.0-complexes.parquet\`` and add it to `makeParquet()`. In `js/parquet.js` add `groupOfKey(handle, column, key)`: find the column chunk whose `meta_data.path_in_schema` is `[column]` in each `handle.metadata.row_groups[g].columns`, and return the first `g` with `statistics.min_value <= key <= statistics.max_value`; -1 when no group or no statistics.

- [ ] **Step 4: Run** `node --test tests/parquet.test.js`, then `pixi run --locked test-js`. Expected: PASS everywhere (other suites use the glaciers fixture; only the complex IDs of variants changed).

- [ ] **Step 5: Commit** `git commit -m "test: add a complexes fixture and find a row group by key"`

---

### Task 2: Complex rows and the catalog's complex columns

**Files:**
- Modify: `js/catalog.js` (`loadCatalog` result)
- Modify: `js/columns.js`
- Test: `tests/catalog.test.js`, `tests/columns.test.js`

**Interfaces:**
- Produces: `catalog.complexColumns: Map<name, {name, description, unit, classes}>` (same shape as `catalog.columns`, from the complexes collection); `complexRows(props, columns, regions) -> {label, value, description}[]` in `js/columns.js`.

`complexRows` rows, in order, each left out when its value is missing:

| label | value | description from column |
| --- | --- | --- |
| `Region` | `11 · Central Europe` (as `regionName`) | `o1region` |
| `Subregion` | `11-01 · Central Europe` | `o2region` |
| `Central point` | `formatCoord(cenlat, cenlon)` | `cenlat` |
| `UTM zone` | `"32"` | `utm_zone` |
| `Glaciers` | `formatInt(glacier_ids.length)` | `glacier_ids` |

Area is not a row: the header shows it, as on the glacier card.

- [ ] **Step 1: Write the failing tests.**

```js
// tests/catalog.test.js
test("the catalog carries the complexes column descriptions", async () => {
  const catalog = await loadCatalog(ROOT, fetchJson);
  assert.match(catalog.complexColumns.get("glacier_ids").description, /rgi_id of every glacier/);
});

// tests/columns.test.js
const COMPLEX = { rgi_id: "RGI2000-v7.0-C-11-01323", o1region: "11", o2region: "11-01", cenlon: 7.97, cenlat: 46.48,
  utm_zone: 32, area_km2: 83.28, glacier_ids: ["RGI2000-v7.0-G-11-00003", "RGI2000-v7.0-G-11-02596"] };
test("a complex shows its region, point, UTM zone and glacier count", () => {
  const rows = complexRows(COMPLEX, new Map(), REGIONS);
  assert.deepEqual(rows.map((r) => [r.label, r.value]), [
    ["Region", "11 · Central Europe"], ["Subregion", "11-01 · Central Europe"],
    ["Central point", "46.4800° N, 7.9700° E"], ["UTM zone", "32"], ["Glaciers", "2"],
  ]);
  assert.deepEqual(complexRows({ rgi_id: COMPLEX.rgi_id }, new Map(), REGIONS), []);
});
```

(Use the test files' existing catalog root, fetch and `REGIONS` helpers; check the fixture description text and adjust the regex to it.)

- [ ] **Step 2: Run** `node --test tests/catalog.test.js tests/columns.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** `complexColumns: toColumns(<complexes collection json>)` in `loadCatalog`, and `complexRows` in `js/columns.js` through a `COMPLEX_DISPLAY` list and the existing `valueOf`/`formatValue` helpers; the `Glaciers` row is the one special case.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat: describe a complex's rows from the catalog"`

---

### Task 3: Search finds complexes by ID

**Files:**
- Modify: `js/parquet.js` (`SEARCH_COLUMNS`)
- Modify: `js/search.js`
- Modify: `js/searchbox.js` (`ICONS`)
- Test: `tests/search.test.js`, `tests/searchbox.test.js`

**Interfaces:**
- Produces: `SEARCH_COLUMNS = ["rgi_id", "display_name", "glac_name", "complex_id"]`; `index.complexes: Set<string>` built by `buildGlacierIndex`; `parseIds(q) -> {glacier: string|null, complex: string|null}` replacing `parseRgiId`; complex hits `{kind: "complex", title: complexId, subtitle: "Complex · <region>", score: SCORE.id - 1, complexId}`; `ICONS.complex = "group"`.

- [ ] **Step 1: Write the failing tests** in `tests/search.test.js` (index from cols with a `complex_id` column; update the existing `parseRgiId` test to `parseIds`):

```js
test("an ID names a glacier, a complex or both", () => {
  assert.deepEqual(parseIds("RGI2000-v7.0-G-11-02596"), { glacier: "RGI2000-v7.0-G-11-02596", complex: null });
  assert.deepEqual(parseIds("c-11-01323"), { glacier: null, complex: "RGI2000-v7.0-C-11-01323" });
  assert.deepEqual(parseIds("RGI2000-v7.0-C-11-01323"), { glacier: null, complex: "RGI2000-v7.0-C-11-01323" });
  assert.deepEqual(parseIds("11-00001"), { glacier: "RGI2000-v7.0-G-11-00001", complex: "RGI2000-v7.0-C-11-00001" });
  assert.deepEqual(parseIds("aletsch"), { glacier: null, complex: null });
});

test("a bare ID lists the glacier first and the complex second, each when it exists", () => {
  const hits = searchGlaciers(index, "11-00001");
  assert.deepEqual(hits.map((h) => [h.kind, h.title, h.subtitle]), [
    ["glacier", "Morteratsch", "Glacier · RGI2000-v7.0-G-11-00001 · Central Europe"],
    ["complex", "RGI2000-v7.0-C-11-00001", "Complex · Central Europe"],
  ]);
  assert.equal(hits[1].complexId, "RGI2000-v7.0-C-11-00001");
  assert.ok(hits[0].score > hits[1].score);
  assert.deepEqual(searchGlaciers(index, "C-11-02596"), [], "a complex ID that does not exist gives no hit");
  assert.deepEqual(searchGlaciers(index, "C-11-01323").map((h) => h.kind), ["complex"]);
});
```

In `tests/searchbox.test.js` add: typing `C-11-01323` lists one row whose icon `use` href ends with `#group`, and picking it calls `onPick` with `{ kind: "complex", complexId: "RGI2000-v7.0-C-11-01323" }` among its fields.

- [ ] **Step 2: Run** `node --test tests/search.test.js tests/searchbox.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement.** The ID pattern becomes `/^(?:(?:RGI2000-v7\.0-)?([GC])-)?(\d{2})-(\d{5})$/i`; the prefix letter picks one product, none picks both. `searchGlaciers` keeps its name name; in the ID branch it returns the glacier hit (if `byId` has it) followed by the complex hit (if `complexes` has it). Region name of a complex hit from `regionNames` by the two-digit code.
- [ ] **Step 4: Run** the same command, then `pixi run --locked test-js`. Expected: PASS (fix the `tests/parquet.test.js` search-columns assertions if they list the columns).
- [ ] **Step 5: Commit** `git commit -m "feat: find glacier complexes by ID in search"`

---

### Task 4: The address holds a complex

**Files:**
- Modify: `js/state.js`
- Test: `tests/state.test.js`

**Interfaces:**
- Produces: `state.complex: string|null` from `?complex=`; `writeState` writes `complex=<id>`; `complex` joins `OWNED`.

- [ ] **Step 1: Write the failing test.**

```js
test("the address holds a complex, and a glacier wins over a complex", () => {
  const id = "RGI2000-v7.0-C-11-01323";
  assert.equal(parseState(new URL(`${BASE}?complex=${id}`)).complex, id);
  assert.equal(parseState(new URL(`${BASE}?complex=C-11-01323`)).complex, null);
  const both = parseState(new URL(`${BASE}?glacier=RGI2000-v7.0-G-11-02596&complex=${id}`));
  assert.deepEqual([both.glacier, both.complex], ["RGI2000-v7.0-G-11-02596", null]);
  const url = new URL(writeState({ ...parseState(new URL(BASE)), complex: id }, new URL(BASE)));
  assert.equal(url.searchParams.get("complex"), id);
});
```

- [ ] **Step 2: Run** `node --test tests/state.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** with a `COMPLEX_ID` pattern beside `GLACIER_ID`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat: keep an open complex in the page address"`

---

### Task 5: The map selects a complex

**Files:**
- Modify: `js/map.js` (selection layers in `buildStyle`, `setBase`, `select`, remove `showComplex` and `selection-complex`)
- Test: `tests/map.test.js` (replace the `showComplex` test near line 300)

**Interfaces:**
- Produces: `rgiMap.selectComplex(complexId: string|null)`. Layers, in this order after `selection-label`'s group (all hidden by default): `complex-fill` (fill, source-layer `complexes`, paint copied from `glaciers-fill` like `selection-fill`), `complex-members` (line, source-layer `glaciers`, paint copied from `glaciers-outline`), `complex-outline` (line, `complexes`, paint same as `selection-outline`), `complex-dot` (circle, `complexes`, `POINTS` filter, paint same as `selection-dot`). `selectComplex(id)` filters `complex-fill`, `complex-outline` by `rgi_id`, `complex-dot` by `["all", POINTS, idFilter]`, `complex-members` by `["==", ["get", "complex_id"], id]`, shows them and `selection-dim`, and hides the glacier selection layers; `selectComplex(null)` hides the complex layers and `selection-dim`. `select(rgiId)` hides the complex layers. `setBase` sets `complex-fill` `fill-opacity` as it does for `selection-fill`.

- [ ] **Step 1: Write the failing test.**

```js
test("a complex is selected like a glacier: dimmed map, lifted complex, red outline, member outlines kept", async () => {
  const { rgiMap, map } = await build();
  const id = "RGI2000-v7.0-C-11-01323";
  rgiMap.selectComplex(id);
  for (const layer of ["selection-dim", "complex-fill", "complex-members", "complex-outline", "complex-dot"]) {
    assert.equal(map.layout(layer).visibility, "visible", layer);
  }
  for (const layer of ["selection-fill", "selection-outline", "selection-label"]) assert.equal(map.layout(layer).visibility, "none");
  assert.deepEqual(map.getLayer("complex-outline").filter, ["==", ["get", "rgi_id"], id]);
  assert.deepEqual(map.getLayer("complex-members").filter, ["==", ["get", "complex_id"], id]);
  assert.equal(map.getLayer("complex-outline").paint["line-color"], "#d93025");
  assert.ok(map.indexOf("complex-members") > map.indexOf("complex-fill"));
  assert.ok(map.indexOf("complex-outline") > map.indexOf("complex-members"));
  rgiMap.setBase("imagery");
  assert.equal(map.getLayer("complex-fill").paint["fill-opacity"], 0);
  rgiMap.select("RGI2000-v7.0-G-11-02596");
  assert.equal(map.layout("complex-outline").visibility, "none");
  rgiMap.selectComplex(null);
  assert.equal(map.layout("selection-dim").visibility, "none");
  assert.equal(map.getLayer("selection-complex"), undefined);
});
```

(`complex-members` over imagery: its paint follows `glaciers-outline`, so also set its `line-color` in `setBase` from `BASE_PAINT[base]["glaciers-outline"]`; add `assert.equal(map.getLayer("complex-members").paint["line-color"], "#ffffff")` after `setBase("imagery")`.)

- [ ] **Step 2: Run** `node --test tests/map.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** as in Interfaces. Remove `selection-complex`, `showComplex` and the `showComplex(null)` call in `select`.
- [ ] **Step 4: Run** `node --test tests/map.test.js`. Expected: PASS. `app.js` still calls `showComplex`; Task 7 replaces those calls, so run only this file here.
- [ ] **Step 5: Commit** `git commit -m "feat: select a glacier complex on the map"`

---

### Task 6: The complex panel and the shared card pieces

**Files:**
- Create: `js/complexcard.js`
- Modify: `js/card.js` (export `photoCredit`, `infoButton`, `IMAGERY_CREDIT`; subtitle starts with `Glacier`; band nodes hidden while closed)
- Modify: `js/usedata.js` (complex scopes)
- Modify: `index.html` (modulepreload `js/complexcard.js`)
- Modify: `style.css` (complex panel table)
- Test: `tests/complexcard.test.js` (new), `tests/card.test.js`, `tests/usedata.test.js`, `tests/app-phone.test.js`, `tests/app-unnamed-glacier.test.js`

**Interfaces:**
- Consumes: `complexRows`, `catalog.complexColumns` (Task 2); `esriCrop` from `js/photo.js`; `formatArea`, `formatInt` from `js/columns.js`.
- Produces: `mountComplexCard(root, ctx) -> { open(complexId: string), close() }` where `ctx = { catalog, regions, band?, crop?, read(complexId) -> Promise<props|null>, members(props) -> Promise<{rgiId, name: string|null, area: number|null}[]>, onClose(), onZoom(bbox), onShare(), onUseData({kind: "complex", rgiId, o1region}), onOpenGlacier(rgiId) }`. `read` resolves `null` for an unknown ID and rejects on a failed read. `members` resolves sorted largest first, unknown areas last. `mountUseData(...).open(target)` now takes `{kind: "glacier"|"complex", rgiId, o1region?}`.

Panel layout (desktop inside `section.card.complex-card`, `aria-label="Glacier complex"`; on the phone the close button, head and actions go to `ctx.band` like the glacier card):
- photo: the Esri crop of `props.bbox` with `photoCredit(... IMAGERY_CREDIT)`, the plain block when it fails;
- head: `h2.card-title` = ID, `p.card-subtitle` = `Complex · <o1 region name>` (from the ID's code before the read), `p.card-area` = area once read;
- actions: `Use this data` (primary), `Zoom to`, `Share`;
- `section.group` with `.row`s from `complexRows` (with ⓘ from `infoButton`), "Loading…" before the read, `The complex could not be read.` after a failed read;
- `section.group.members` with `h3` `Glaciers` and `div.members-scroll > table.members` (`thead`: Name, RGI ID, Area (km²); one `tr` per member; the RGI ID cell holds `button.link` that calls `onOpenGlacier`). `.members-scroll { max-height: 320px; overflow-y: auto }`.

Use this data scopes for a complex: `complex` "This complex" (complexes file, `rgi_id`), `members` "Its glaciers" (glaciers file, `complex_id`), `region` "Its region" (complexes file, `o1region`), `all` "All complexes" (complexes file, size note from that file's HEAD). Opening with a different `kind` rebuilds the Fetch control and resets the scope to the first one.

- [ ] **Step 1: Write the failing tests** in `tests/complexcard.test.js` (jsdom via `loadPage()`, the catalog fixture through `loadCatalog`, regions as in `tests/card.test.js`):

```js
const ID = "RGI2000-v7.0-C-11-01323";
const PROPS = { rgi_id: ID, o1region: "11", o2region: "11-01", cenlon: 7.97, cenlat: 46.48, utm_zone: 32, area_km2: 83.28,
  glacier_ids: ["RGI2000-v7.0-G-11-00003", "RGI2000-v7.0-G-11-02596"],
  bbox: { xmin: 7.931361, ymin: 46.397437, xmax: 8.31, ymax: 46.61 } };
const MEMBERS = [
  { rgiId: "RGI2000-v7.0-G-11-02596", name: "Grosser Aletsch Gletscher", area: 81.78 },
  { rgiId: "RGI2000-v7.0-G-11-00003", name: null, area: 1.5 },
];

test("the panel shows the ID, the region, the area, the rows and the members", async () => { /* open(ID) with read→PROPS, members→MEMBERS;
  title "RGI2000-v7.0-C-11-01323"; subtitle "Complex · Central Europe"; area "83.3 km²";
  row labels ["Region", "Subregion", "Central point", "UTM zone", "Glaciers"]; Glaciers value "2";
  table body cells [["Grosser Aletsch Gletscher", "RGI2000-v7.0-G-11-02596", "81.8"], ["", "RGI2000-v7.0-G-11-00003", "1.50"]];
  img.photo-crop present */ });
test("clicking a member opens that glacier", ...);           // onOpenGlacier called with "RGI2000-v7.0-G-11-00003"
test("the actions report the complex", ...);                  // Use this data → {kind:"complex", rgiId: ID, o1region:"11"}; Zoom to → PROPS.bbox
test("a failed read says so", ...);                           // read rejects → text "The complex could not be read.", no "Loading…"
test("members without the index show their IDs", ...);        // members resolves [{rgiId, name:null, area:null}, …] → ID cells filled, name and area cells empty
test("a late read after close renders nothing", ...);         // close() before read resolves → section stays hidden, no rows
test("on the phone the head goes to the band and hides when closed", ...); // band gets .card-head; close() hides band nodes
```

In `tests/card.test.js` change the subtitle expectations to `Glacier · ${IDS[0]} · Central Europe` and `Glacier · Central Europe`, and add that a closed card hides its band nodes. Update the same strings in `tests/app-phone.test.js` and `tests/app-unnamed-glacier.test.js`. In `tests/usedata.test.js`:

```js
test("a complex offers itself, its glaciers, its region and all complexes", () => {
  const target = { kind: "complex", rgiId: "RGI2000-v7.0-C-11-01323", o1region: "11" };
  const complexes = catalog.collections.complexes.dataUrl;
  assert.match(snippet({ tool: "python", scope: "complex" }, target, catalog).code,
    new RegExp(`url = "${complexes}"[\\s\\S]*\\("rgi_id", "==", "RGI2000-v7.0-C-11-01323"\\)`));
  assert.match(snippet({ tool: "python", scope: "members" }, target, catalog).code, /\("complex_id", "==", "RGI2000-v7.0-C-11-01323"\)/);
  assert.equal(snippet({ tool: "qgis", scope: "region" }, target, catalog).filter, `"o1region" = '11'`);
  assert.equal(snippet({ tool: "python", scope: "all" }, target, catalog, 214686136).note, "Reads the whole file, about 215 MB.");
});
```

and that `open()` of a complex shows the four scope labels `This complex`, `Its glaciers`, `Its region`, `All complexes`, while a following glacier `open()` shows `This glacier`, `Its region`, `All of RGI` with the first checked.

- [ ] **Step 2: Run** `node --test tests/complexcard.test.js tests/card.test.js tests/usedata.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** `js/complexcard.js` per Interfaces; reuse the glacier card's classes (`card`, `photo`, `card-head`, `card-actions`, `group`, `row`, `row-label`, `row-value`) so existing CSS applies. Track the open complex like `card.js` does (`current` + `AbortController`) so late reads are dropped. Change `snippet()` to take the target and pick file and key per `kind` and `scope`; `sizeOf` uses the file of the `all` scope. Add the modulepreload line and the `.members` table CSS (small text, `th` left aligned, numbers right aligned, sticky `thead`).
- [ ] **Step 4: Run** the same command plus `node --test tests/page-assets.test.js`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "feat: show a glacier complex in its own panel"`

---

### Task 7: Wire complexes into the page

**Files:**
- Modify: `js/app.js`
- Modify: `docs/superpowers/specs/2026-10-28-rgi-explorer-design.md`
- Test: `tests/app-complex.test.js` (new), `tests/app-complex-view.test.js` (new), `tests/app.test.js` (the Glacier complex row click)

**Interfaces:**
- Consumes: everything above. `groupOfKey`, `readColumns`, `openParquet` (Task 1); `index.byId`, `index.cols` with `complex_id` (Task 3); `state.complex` (Task 4); `rgiMap.selectComplex` (Task 5); `mountComplexCard`, `useData.open({kind, …})` (Task 6).
- Produces in `js/app.js`: `complexFile(url)` → `{ open(), read(complexId) -> Promise<props|null> }` reading `COMPLEX_COLUMNS = ["rgi_id", "o1region", "o2region", "cenlon", "cenlat", "utm_zone", "area_km2", "glacier_ids", "bbox"]` from the group `groupOfKey` names (null when -1 or the ID is not in that group); `membersOf(props)` using `glaciers.index()` for rows and names and `readColumns(handle, ["area_km2"], group)` once per distinct row group (`rowGroupOf`) for areas, falling back to `{rgiId, name: null, area: null}` when the index or a read fails; `openComplex(complexId, fit)` and `closeComplex()`.

Behaviour to wire:
- `openComplex` closes the glacier card (without clearing the search), sets `state.complex`, clears `state.glacier`, calls `rgiMap.select(null)` then `rgiMap.selectComplex(id)`, shows the panel, sets the search Close button, opens the complex card, and with `fit` fits to the read bbox under the same `camera` counter rule as `fitGlacierLater` (padding uses `CARD_WIDTH` while the panel is open).
- `openGlacier` closes an open complex panel first and calls `rgiMap.selectComplex(null)`.
- The glacier card's `onAction` `complex` → `openComplex(action.id, true)`; `onPick` `complex` → `openComplex(hit.complexId, true)`; complex card `onOpenGlacier(id)` → `openGlacier({ rgiId: id }, true)`; `onUseData` of both cards → `useData.open({ kind, rgiId, o1region })`.
- Map click: a glacier opens it; empty map closes whichever panel is open.
- `state.complex` on load: read it; `null` drops it from the address; else `openComplex(id, !hadView)`.
- Main design: replace "glacier complex (click to outline the whole complex)" with the link to the complex panel, and add the complex parts of the URL, search and selection sections, pointing to the complexes design.

- [ ] **Step 1: Write the failing tests.** `tests/app-complex.test.js` (one page, tests in order, as `tests/app.test.js` does; serve `makeParquet()` which now holds the complexes file):

```js
test("the Glacier complex row opens the complex panel and fits the whole complex", ...);
  // open Aletsch via ?glacier=, click the "Glacier complex" row button;
  // #card section.complex-card visible, glacier section hidden, title "RGI2000-v7.0-C-11-01323";
  // location.search has complex=RGI2000-v7.0-C-11-01323 and no glacier=;
  // map.layout("complex-outline").visibility === "visible";
  // the last fitBounds call covers [[7.931361, 46.397437], [8.31, 46.61]]
test("the member table lists both glaciers, largest first", ...);
  // rows: ["Grosser Aletsch Gletscher", "RGI2000-v7.0-G-11-02596", "81.8"], ["", "RGI2000-v7.0-G-11-00003", "1.50"]
test("opening a member glacier closes the complex", ...);
  // click the G-11-00003 button; glacier card shows G-11-00003; complex panel hidden; complex= gone; complex-outline hidden
test("search opens a complex by its ID", ...);
  // type "C-11-00001", pick the row; panel title RGI2000-v7.0-C-11-00001
test("a map click leaves the complex", ...);
  // with a complex open: map.fire("click") on empty map closes it; with glacierAt returning Morteratsch it opens Morteratsch
```

`tests/app-complex-view.test.js`: `?complex=RGI2000-v7.0-C-11-01323#12/46.5/8.0` opens the panel and makes no fit (the view stays), and a second test file or test in the same file with fresh state — `an unknown complex in the address is dropped`: `?complex=RGI2000-v7.0-C-11-09999` opens no panel and the address loses `complex=`. (Put scenarios that need fresh module state in their own file, per `AGENTS.md`.)

- [ ] **Step 2: Run** `node --test tests/app-complex.test.js tests/app-complex-view.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** per Interfaces and Behaviour; remove the `showComplex` calls.
- [ ] **Step 4: Run** `pixi run --locked test`. Expected: PASS, Python and JavaScript.
- [ ] **Step 5: Check it in a browser.** `pixi run --locked serve -- --catalog-dir ../rgi-catalog/catalog --catalog-dir ../rgi-catalog/staging` (or the running server), open `http://localhost:8000/?catalog=catalog/catalog.json&glacier=RGI2000-v7.0-G-11-01450`, click the Glacier complex row, and check: the view zooms out to the whole complex, red dashed outline with grey member outlines inside, the member table scrolls, a member click opens its card. Repeat on imagery and at phone width (390 × 844). Search `C-01-09429` (893 members) and confirm the table scrolls and the panel stays usable.
- [ ] **Step 6: Commit** `git commit -m "feat: open glacier complexes from search, the glacier card and the address"`
