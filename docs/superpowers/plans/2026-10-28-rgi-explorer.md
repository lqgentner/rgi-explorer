# RGI Explorer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build RGI Explorer, a static Google-Maps-style web map that reads the
RGI 7.0 mirror's PMTiles and GeoParquet in the browser and deploys to GitHub
Pages.

**Architecture:** Plain ES modules with no bundler. Libraries load from
`./node_modules/` through an import map, the same setup as `../glace-viewer`.
Pure modules (catalog walk, URL state, search, display table, hypsometry,
photo matching, snippets, style adaptation) carry the logic and the unit
tests. Thin DOM modules mount the UI. `js/app.js` wires them together.
MapLibre, PMTiles and hyparquet are exposed as globals before `app.js`, so
jsdom tests can replace them with fakes.

**Tech Stack:** MapLibre GL JS 6.16, pmtiles 4.5, hyparquet 1.31 and
hyparquet-compressors 1.1 (the files use ZSTD), @leeoniya/ufuzzy 1.0,
lucide-static 1.63, @fontsource/noto-sans and noto-sans-mono 5.3, jsdom 30
with `node --test`, pixi (Node 24, Python 3.12 and pyarrow, for fixtures and
`serve.py`).

**Spec:** `docs/superpowers/specs/2026-10-28-rgi-explorer-design.md`. Read it
before every task. This plan cites its sections and does not repeat them.

## Global Constraints

- Every asset path in HTML, CSS, JS and `sw.js` is relative. The site lives
  under `https://lqgentner.github.io/rgi-explorer/`.
- The CSP allows same-origin scripts and styles only. `connect-src` and
  `img-src` list exactly these hosts: `data.source.coop`,
  `tiles.openfreemap.org`, `server.arcgisonline.com`, `tiles.mapterhorn.com`,
  `photon.komoot.io`, `query.wikidata.org`, `commons.wikimedia.org`,
  `upload.wikimedia.org`. MapLibre's worker needs `worker-src 'self' blob:`.
- Every bare import a library makes must appear in the import map, and every
  library the page loads is a direct npm dependency with its license in
  `assets/third-party-licenses.txt`.
- No URL to a data file is typed in. The only pinned data URL is
  `https://data.source.coop/lqgentner/rgi/catalog.json`, which `?catalog=`
  overrides.
- The explorer never holds a column description or a code label. Those come
  from `table:columns`. Only `js/columns.js` holds presentation: label,
  display unit, group and order.
- Accent `#1a73e8`, selection red `#d93025`. Font Noto Sans in the UI and
  Noto Sans Mono in code. No transparency in UI surfaces.
- Phone layout applies at `max-width: 640px` (`PHONE` media query in
  `js/ui.js`).
- No RGI logo. The credits say: "RGI Explorer and the RGI mirror are
  unofficial and not endorsed by the RGI Consortium."
- A request to Photon, Wikidata, Commons or Esri never blocks the card or
  the search. Each has a timeout of 4000 ms and fails quietly to the
  fallback.
- Measured facts this plan relies on (staged 7.0-r1):
  - the glaciers GeoParquet has 274,531 rows in 24 row groups, ZSTD-compressed;
  - 216,535 glaciers (79%) have neither `display_name` nor `glac_name`;
  - `hypso_permille` is never empty, and holds at most 105 bands;
  - no glacier bbox crosses the antimeridian;
  - six regions have bboxes spanning 360° or reaching −90° latitude, among
    them North Asia and Antarctic Mainland.
- Commit messages: Conventional Commits subject. The body is in Simplified
  Technical English, with the `Co-Authored-By` trailer.

## Review Focus

1. **An unnamed glacier** (79% of RGI). The card title is the RGI ID and the
   subtitle is the region name. A search finds it by ID, and an empty name
   never shows as "null" or blank. Tests are in Tasks 5 and 8.
2. **Results that arrive late.** Select glacier A, then B before A's photo or
   row group arrives. A's results are dropped and never shown on B's card.
   Tests are in Tasks 8 and 9.
3. **A third-party service down or slow** (Photon, Wikidata, Commons or Esri
   returning an error or hanging). The search still shows RGI hits, and the
   card opens with the Esri crop or, if Esri also fails, a plain placeholder.
   Tests are in Tasks 5 and 9.
4. **Region bboxes that span the world or reach the pole.** Picking "North
   Asia" or "Antarctic Mainland" never throws. Latitude is clamped to ±85.05°.
   A bbox 360° wide fits to the region's label point at zoom 3. Test is in
   Task 6.
5. **Bad URL state.** An unknown `?glacier=` ID, a malformed hash or an
   unknown layer name opens the default view, with no card and no console
   error, and the URL is cleaned. Tests are in Tasks 2 and 10.

---

## File structure

```text
index.html            page skeleton, CSP, import map, module preloads, globals
style.css             tokens, desktop and phone layout, all components
sw.js                 stale-while-revalidate for JSON (from glace-viewer)
site-config.js        optional deployment overrides (window.RGI_EXPLORER_CONFIG)
js/config.js          constants and resolved settings
js/state.js           URL state parse and write
js/catalog.js         STAC walk, asset resolution, column metadata
js/parquet.js         hyparquet wrapper, row-group cache
js/search.js          glacier index, ID parsing, ranking
js/photon.js          OSM place search
js/searchbox.js       search bar DOM and result list
js/map.js             map, base maps, RGI layers, selection, 3D
js/styles.js          pure catalog-style adaptation and merge
js/layers.js          desktop layer control and phone layer pane
js/status.js          scale bar math, credits, status line DOM
js/columns.js         display table and Overview rows
js/hypsometry.js      band math and SVG chart
js/photo.js           Wikidata match, Commons credit, Esri crop
js/usedata.js         snippet text and the dialog DOM
js/card.js            card header, tabs, actions, lifecycle
js/sheet.js           phone bottom sheet (from glace-viewer)
js/ui.js              DOM helpers, PHONE, icons from lucide-static
js/app.js             startup and wiring
scripts/serve.py      dev server with byte ranges (from glace-viewer)
scripts/stage-libraries.mjs   copies import-map targets into _site (from glace-viewer)
scripts/make_fixture_parquet.py  writes small test GeoParquet files with pyarrow
tests/helpers/browser.js      jsdom page loader and strict fake map
tests/fixtures/catalog/       copy of the published catalog JSON (no data files)
tests/*.test.js
tests/smoke.test.js   live-catalog check, runs only with SMOKE=1
.github/workflows/test.yml, deploy.yml, smoke.yml
```

---

### Task 1: Scaffold the repository

**Files:**
- Create: `package.json`, `pixi.toml`, `.gitignore` (extend), `LICENSE`
  (MIT, Luis Gentner), `README.md`, `AGENTS.md`, `CLAUDE.md` (`@AGENTS.md`),
  `index.html`, `style.css`, `site-config.js`, `sw.js`,
  `assets/third-party-licenses.txt`, `scripts/serve.py`,
  `scripts/stage-libraries.mjs`, `js/ui.js`, `js/app.js` (startup stub)
- Create: `tests/helpers/browser.js`, `tests/page-assets.test.js`,
  `tests/stage-libraries.test.js`
- Create: `.github/workflows/test.yml`

**Interfaces:**
- Produces: `loadPage({ url = "https://lqgentner.github.io/rgi-explorer/", fetch } = {}) -> Promise<{ window, document, map: FakeMap }>`
  in `tests/helpers/browser.js`. `FakeMap` records `addSource`, `addLayer`,
  `setLayoutProperty`, `setPaintProperty`, `setFilter`, `setTerrain`,
  `fitBounds` and `jumpTo`, and throws on duplicate ids or on writes to
  missing layers, as glace-viewer's fake does.
- Produces: `el(id)`, `h(tag, attrs, ...children)`, `PHONE` (a
  `MediaQueryList`-like object from `matchMedia("(max-width: 640px)")`) and
  `icon(name) -> SVGElement` for the names `layers-2`, `search`, `x`,
  `info`, `copy`, `share-2`, `maximize`, `box` and `chevron-down`, all in
  `js/ui.js`. SVG strings come from `lucide-static`.

- [ ] **Step 1: Copy the infrastructure from glace-viewer and adapt it**

  Copy these from `../glace-viewer`:
  - `scripts/serve.py`, `scripts/stage-libraries.mjs`, `sw.js`;
  - the `pixi.toml` tasks (`install`, `test-py`, `test-js`, `test`, `serve`).
    Drop tippecanoe and `build-tiles`, and add `pyarrow` and a `smoke` task
    (`SMOKE=1 node --test tests/smoke.test.js`);
  - the import-map and CSP structure of `index.html`, with the
    `window.maplibregl` / `window.pmtiles` / `window.hyparquet` globals
    script;
  - the strict fake-map approach of `tests/helpers/browser.js`, without the
    Protomaps fakes;
  - `tests/page-assets.test.js` (the CSP hash check, the import-map targets
    existing, the relative paths and the modulepreload list) and
    `tests/stage-libraries.test.js`.

  Set the CSP hosts to exactly the Global Constraints list.

  `package.json` dependencies: maplibre-gl, pmtiles, fflate, hyparquet,
  hyparquet-compressors, @leeoniya/ufuzzy, lucide-static,
  @fontsource/noto-sans, @fontsource/noto-sans-mono. devDependencies: jsdom,
  es-module-lexer. Map every bare import found in hyparquet-compressors'
  package (run `npm ls --all hyparquet-compressors` and read its `exports`).

- [ ] **Step 2: Write the failing page-assets test additions**

  ```js
  test("CSP lists exactly the spec's data hosts", () => {
    assert.deepEqual(cspHosts("connect-src").sort(), [
      "https://commons.wikimedia.org", "https://data.source.coop",
      "https://photon.komoot.io", "https://query.wikidata.org",
      "https://server.arcgisonline.com", "https://tiles.mapterhorn.com",
      "https://tiles.openfreemap.org", "https://upload.wikimedia.org"]);
  });
  test("fonts load from node_modules, not a CDN", () => {
    assert.match(css, /node_modules\/@fontsource\/noto-sans\//);
    assert.doesNotMatch(html + css, /fonts\.googleapis|fonts\.gstatic/);
  });
  ```

- [ ] **Step 3: Run the tests and see them fail**

  Run `pixi run --locked test`. Expected: the two new tests fail.

- [ ] **Step 4: Fill `index.html` and `style.css`**

  `index.html`: the full-page `#map`, `#sidebar`, `#search`, `#layers`,
  `#controls`, `#status` and `#sheet` containers. `style.css`:
  - `:root` tokens (`--accent`, `--red`, `--surface #fff`, `--text #202124`,
    `--muted #5f6368`, `--line #dadce0`, `--shadow`);
  - the `@font-face` imports from `@fontsource`;
  - the `body` background.

  The map itself appears in Task 6. At this point the page shows only the
  empty containers.

- [ ] **Step 5: Run the tests and see them pass**

  Run `pixi run --locked test`. Expected: all pass.

- [ ] **Step 6: Commit**

  Commit everything with the subject `chore: scaffold RGI Explorer from the
  glace-viewer setup`. The body names each file copied from glace-viewer.

---

### Task 2: URL state and configuration

**Files:**
- Create: `js/config.js`, `js/state.js`, `tests/state.test.js`

**Interfaces:**
- Produces in `js/config.js`:
  - `CATALOG_URL`, `LIBERTY_STYLE = "https://tiles.openfreemap.org/styles/liberty"`;
  - `GLYPHS = "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf"`;
  - `ESRI_TILES = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"`;
  - `ESRI_EXPORT = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export"`;
  - `TERRAIN_TILEJSON = "https://tiles.mapterhorn.com/tilejson.json"`;
  - `PHOTON = "https://photon.komoot.io/api/"`, `SPARQL = "https://query.wikidata.org/sparql"`;
  - `COMMONS_API = "https://commons.wikimedia.org/w/api.php"`;
  - `HYPSO_BAND_M = 50`, `TIMEOUT_MS = 4000`;
  - `DEFAULT_VIEW = { zoom: 2, lat: 30, lon: 10 }`;
  - `resolveCatalogUrl(search: URLSearchParams) -> string`.
- Produces in `js/state.js`:
  - `parseState(url: URL) -> State` and `writeState(state: State, url: URL) -> string` (an href);
  - `State = { glacier: string|null, view: {zoom,lat,lon}|null, base: "standard"|"imagery", layers: Set<"regions"|"centerlines"|"intersects">, terrain: boolean }`;
  - `LAYERS = ["regions", "centerlines", "intersects"]`, `DEFAULT_LAYERS = new Set(["regions"])`.

- [ ] **Step 1: Write the failing tests**

  ```js
  test("round-trips a full state", () => {
    const href = "https://x/rgi-explorer/?glacier=RGI2000-v7.0-G-11-02596&base=imagery&layers=regions,centerlines&3d=1#11/46.48/7.99";
    const s = parseState(new URL(href));
    assert.equal(s.glacier, "RGI2000-v7.0-G-11-02596");
    assert.deepEqual(s.view, { zoom: 11, lat: 46.48, lon: 7.99 });
    assert.equal(s.base, "imagery"); assert.equal(s.terrain, true);
    assert.deepEqual([...s.layers], ["regions", "centerlines"]);
    assert.equal(writeState(s, new URL(href)), href);
  });
  test("defaults leave the query empty", () => {
    const s = parseState(new URL("https://x/rgi-explorer/"));
    assert.deepEqual([...s.layers], ["regions"]);
    assert.equal(writeState(s, new URL("https://x/rgi-explorer/")), "https://x/rgi-explorer/");
  });
  test("layers= with no value means every toggle off", () => {
    assert.equal(parseState(new URL("https://x/?layers=")).layers.size, 0);
  });
  test("bad values fall back to defaults", () => {   // Review Focus 5
    const s = parseState(new URL("https://x/?glacier=nonsense&base=moon&layers=foo,regions&3d=yes#abc"));
    assert.equal(s.glacier, null); assert.equal(s.base, "standard");
    assert.deepEqual([...s.layers], ["regions"]); assert.equal(s.terrain, false); assert.equal(s.view, null);
  });
  ```

  A valid `glacier` matches `/^RGI2000-v7\.0-G-\d{2}-\d{5}$/`. Whether the ID
  exists is checked in Task 10.

- [ ] **Step 2: Run the tests and see them fail**

  Run `pixi run --locked test-js`. Expected: FAIL, "Cannot find module".

- [ ] **Step 3: Implement `parseState` and `writeState`**

  Write the view hash with `zoom` to 2 decimals and lat/lon to 4.

- [ ] **Step 4: Run the tests and see them pass**

- [ ] **Step 5: Commit** with the subject `feat: add the URL state`.

---

### Task 3: Catalog walk and column metadata

**Files:**
- Create: `js/catalog.js`, `tests/catalog.test.js`
- Create: `tests/fixtures/catalog/`, a copy of `../rgi-catalog/catalog/`'s
  `catalog.json`, `v7.0/catalog.json`, `v7.0/*/collection.json` and
  `v7.0/*/styles/*.json`. JSON only, no README, no thumbnails.

**Interfaces:**
- Produces: `loadCatalog(rootUrl: string, fetchJson = (u) => fetch(u).then(r => r.json())) -> Promise<Catalog>`
- `Catalog = { version: "7.0", collections: Record<"glaciers"|"regions"|"complexes"|"centerlines"|"intersects", Collection>, columns: Map<string, Column>, citation: string, license: { id: string, href: string }, doi: string }`
- `Collection = { id, dataUrl, pmtilesUrl, styleUrl, json }`. Each URL is
  absolute, resolved against the collection's own URL. `styleUrl` is the
  style asset with the `default` role.
- `Column = { name, description, unit: string|null, classes: Map<string|number, string>|null }`.
  The class value maps to the class `description` ("Not assigned").

- [ ] **Step 1: Write the failing tests**

  Use a `fetchJson` that reads `tests/fixtures/catalog/` for URLs under
  `https://data.source.coop/lqgentner/rgi/`.

  ```js
  test("resolves the glaciers assets to absolute URLs", async () => {
    const c = await loadCatalog(ROOT, fixtureFetch);
    assert.equal(c.version, "7.0");
    assert.equal(c.collections.glaciers.dataUrl, "https://data.source.coop/lqgentner/rgi/v7.0/glaciers/rgi7.0-glaciers.parquet");
    assert.equal(c.collections.glaciers.pmtilesUrl, "https://data.source.coop/lqgentner/rgi/v7.0/rgi7.0.pmtiles");
    assert.equal(c.collections.regions.styleUrl, "https://data.source.coop/lqgentner/rgi/v7.0/regions/styles/regions.json");
  });
  test("reads column labels from table:columns", async () => {
    const c = await loadCatalog(ROOT, fixtureFetch);
    assert.equal(c.columns.get("area_km2").unit, "km2");
    assert.equal(c.columns.get("term_type").classes.get(9), "Not assigned");
    assert.equal(c.columns.get("dem_source").classes.get("COPDEM90"), "Copernicus DEM, 90 m");
  });
  test("reads citation and license", async () => {
    const c = await loadCatalog(ROOT, fixtureFetch);
    assert.match(c.citation, /^RGI 7\.0 Consortium\. \(2023\)/);
    assert.deepEqual(c.license, { id: "CC-BY-4.0", href: "https://creativecommons.org/licenses/by/4.0/" });
  });
  test("a missing collection rejects with its name", async () => { /* drop regions from the fixture */ });
  ```

- [ ] **Step 2: Run the tests and see them fail**

- [ ] **Step 3: Implement `loadCatalog`**

  Follow `child` links depth-first. Collections match
  `/^rgi-v(\d+)-(\d+)-(\w+)$/`. When several versions exist, the highest one
  wins.

- [ ] **Step 4: Run the tests and see them pass**

- [ ] **Step 5: Commit** with the subject `feat: read the catalog contract`.

---

### Task 4: GeoParquet access

**Files:**
- Create: `js/parquet.js`, `scripts/make_fixture_parquet.py`,
  `tests/parquet.test.js`

**Interfaces:**
- Consumes: `window.hyparquet` (`parquetMetadataAsync`,
  `parquetReadObjects`, `asyncBufferFromUrl`) and the compressors from
  hyparquet-compressors.
- Produces:
  - `openParquet(source: string | AsyncBuffer) -> Promise<Handle>`;
  - `Handle = { metadata, groups: { start: number, count: number }[] }`;
  - `rowGroupOf(handle, row: number) -> number`;
  - `readColumns(handle, columns: string[], group?: number) -> Promise<Record<string, any[]>>`.
    It reads all groups when `group` is omitted, and caches by
    `group + columns.join()`;
  - `readRow(handle, row: number, columns: string[]) -> Promise<object>`.
- Produces: `SEARCH_COLUMNS = ["rgi_id", "display_name", "glac_name"]` and
  `CARD_COLUMNS = ["bbox", "hypso_z0_m", "hypso_permille", "rgi6_links"]`.

- [ ] **Step 1: Write the fixture generator**

  `scripts/make_fixture_parquet.py <out-dir>` writes `glaciers.parquet`, five
  rows in row groups of 2, ZSTD. It uses the glaciers schema columns that
  Tasks 4–9 read, with the Aletsch row from the spec: `rgi_id`
  `RGI2000-v7.0-G-11-02596`, `hypso_z0_m` 1625, the 50-value
  `hypso_permille`, and the bbox 7.931361, 46.397437, 8.087402, 46.563295.
  It adds one row with both names null, and one `rgi6_links` list with two
  structs. It also writes `regions.parquet`, three rows including North Asia
  with bbox −180, 31, 180, 78.

  The tests run it once in `before()` into `fs.mkdtempSync`, using
  `execFileSync("python", [...])`. Tests always run inside pixi.

- [ ] **Step 2: Write the failing tests**

  ```js
  test("reads the search columns across groups", async () => {
    const h = await openParquet(await asyncBufferFromFile(file));
    const cols = await readColumns(h, SEARCH_COLUMNS);
    assert.equal(cols.rgi_id.length, 5); assert.equal(h.groups.length, 3);
    assert.equal(cols.display_name[4], null);
  });
  test("finds the group of a row", async () => { assert.equal(rowGroupOf(h, 3), 1); });
  test("reads one row's card columns", async () => {
    const r = await readRow(h, 0, CARD_COLUMNS);
    assert.equal(r.hypso_z0_m, 1625); assert.equal(r.hypso_permille.length, 50);
    assert.deepEqual(r.bbox, { xmin: 7.931361, ymin: 46.397437, xmax: 8.087402, ymax: 46.563295 });
    assert.equal(r.rgi6_links.length, 2);
  });
  test("a second read of the same group hits the cache", async () => { /* count AsyncBuffer.slice calls */ });
  ```

- [ ] **Step 3: Run the tests and see them fail**

- [ ] **Step 4: Implement `js/parquet.js`**

  Pass `compressors` to every hyparquet read. Convert BigInt values to
  Number.

- [ ] **Step 5: Run the tests and see them pass**

- [ ] **Step 6: Commit** with the subject `feat: read GeoParquet columns by row group`.

---

### Task 5: Search

**Files:**
- Create: `js/search.js`, `js/photon.js`, `js/searchbox.js`,
  `tests/search.test.js`, `tests/searchbox.test.js`

**Interfaces:**
- Produces in `js/search.js`:
  - `parseRgiId(q: string) -> string|null`. It returns the full ID for
    `RGI2000-v7.0-G-11-02596`, `G-11-02596` and `11-02596`, ignoring case
    and surrounding spaces.
  - `buildGlacierIndex(cols: {rgi_id, display_name, glac_name}) -> GlacierIndex`,
    built with uFuzzy over the strings `display_name ?? glac_name`. It
    skips rows with neither name.
  - `searchGlaciers(index, q, limit = 8) -> Hit[]`;
  - `searchRegions(regions: {o1region, o2region, full_name, bbox}[], q) -> Hit[]`;
  - `rankHits(...lists: Hit[][], limit = 8) -> Hit[]`.
- `Hit = { kind: "glacier"|"region"|"place", title, subtitle, score, rgiId?, row?, bbox?, center? }`.
- Glacier subtitle: `"Glacier · " + rgiId + " · " + regionName`, where the
  region name comes from the ID's two-digit region code. (Area is not in the
  search columns. Reading it would add 2 MB to the first focus.)
- Scores:
  - 1000 for an ID match;
  - 900 for a name equal to the query, ignoring case and accents;
  - 700 for a name starting with the query;
  - 600 − 10·i for Photon result i;
  - 650 for a region whose name starts with the query;
  - 500 × the normalized uFuzzy rank for other glacier matches.

  Ties keep the input order.
- Produces in `js/photon.js`: `searchPlaces(q, {lat, lon, zoom}, {fetch, signal}) -> Promise<Hit[]>`.
  It calls `PHOTON?q=…&lat=…&lon=…&zoom=…&limit=5&lang=en`. The subtitle is
  the OSM value and the country ("peak · Switzerland"), and `center` is
  `[lon, lat]`.
- Produces in `js/searchbox.js`: `mountSearch(root, { onPick: (hit) => void, loadGlacierIndex: () => Promise<GlacierIndex>, regions, view: () => {lat,lon,zoom} })`.
  It debounces Photon by 250 ms, aborts the older request, and supports
  arrow keys and Enter. Each result row shows a Lucide icon by kind
  (`mountain-snow` for a glacier, `square-dashed` for a region, `map-pin`
  for a place) and the subtitle.

- [ ] **Step 1: Write the failing tests**

  ```js
  test("parses every ID form", () => {
    for (const q of ["RGI2000-v7.0-G-11-02596", "g-11-02596", " 11-02596 "])
      assert.equal(parseRgiId(q), "RGI2000-v7.0-G-11-02596");
    assert.equal(parseRgiId("11-2596"), null);
  });
  test("an exact ID outranks every name", () => {
    const hits = rankHits(searchGlaciers(idx, "11-02596"), [placeHit("Aletsch Arena")]);
    assert.equal(hits[0].rgiId, "RGI2000-v7.0-G-11-02596");
  });
  test("an unnamed glacier is found by ID with the ID as title", () => {   // Review Focus 1
    const [hit] = searchGlaciers(idx, UNNAMED_ID);
    assert.equal(hit.title, UNNAMED_ID); assert.match(hit.subtitle, /^Glacier · /);
  });
  test("a strong place outranks a weak fuzzy glacier", () => { /* score 600 vs ≤500 */ });
  test("Photon failing still shows glacier hits", async () => {   // Review Focus 3
    // searchbox with fetch rejecting for photon.komoot.io → list shows the glacier hits, no error text
  });
  ```

- [ ] **Step 2: Run the tests and see them fail**

- [ ] **Step 3: Implement the three modules**

- [ ] **Step 4: Run the tests and see them pass**

- [ ] **Step 5: Commit** with the subject `feat: search glaciers, regions and places`.

---

### Task 6: Map, base maps and RGI layers

**Files:**
- Create: `js/styles.js`, `js/map.js`, `tests/styles.test.js`,
  `tests/map.test.js`

**Interfaces:**
- Produces in `js/styles.js` (pure):
  - `adaptStyle(style: object, styleUrl: string) -> {sources, layers}`. It
    makes the `pmtiles://` source URL absolute against `styleUrl` and maps
    `text-font` "Open Sans Regular|Bold|Italic" to "Noto Sans
    Regular|Bold|Italic". It changes nothing else.
  - `mergeStyles(parts: {sources, layers}[]) -> {sources, layers}`. It keeps
    the first layer per id and the first source per id.
  - `TOGGLES = { regions: ["regions", "region-labels"], centerlines: ["centerlines"], intersects: ["intersects"] }`,
    keyed by `source-layer`;
  - `TOGGLE_MINZOOM = { regions: 0, centerlines: 8, intersects: 10 }`, from
    the PMTiles metadata in the spec.
- Produces in `js/map.js`:
  - `createMap(container, catalog, state) -> Promise<RgiMap>`;
  - `RgiMap = { map, setBase(base), setToggle(name, on), select(rgiId|null), showComplex(complexId|null), pin([lon, lat]|null), setTerrain(on), fitBbox(bbox, padding, center?), glacierAt(point) -> props|null, onMove(cb) }`.
    `showComplex` draws `selection-complex`, a dashed `#5f6368` line on
    `source-layer` complexes filtered by `rgi_id`. `pin` draws a GeoJSON
    circle layer `terminus-pin` in `#d93025`. `select` clears both.

  `createMap` does the following:
  - loads `LIBERTY_STYLE` and sets `glyphs` to `GLYPHS`;
  - hides `landcover_ice`;
  - fetches the default styles of glaciers, regions, centerlines and
    intersects, then runs `adaptStyle` and `mergeStyles`;
  - inserts the RGI non-symbol layers before Liberty's first symbol layer,
    and the RGI symbol layers on top;
  - registers the `pmtiles://` protocol.
- Imagery adds the `esri` raster source and layer directly above Liberty's
  last non-symbol layer. Liberty's symbols stay visible.
- Selection adds three layers on top:
  - `selection-dim`, a fill over a world GeoJSON polygon, `#5f6368` at
    opacity 0.15;
  - `selection-fill`, the glaciers fill paint filtered to the ID;
  - `selection-outline`, a line on `source-layer` glaciers filtered by
    `["==", ["get", "rgi_id"], id]`, `#d93025`, width 2.5, dash `[2, 1.2]`.

  `select(null)` hides all three.
- `fitBbox` clamps latitude to ±85.05. A bbox 360° or more wide fits the
  matching `region-labels` point at zoom 3 when it is given as `center`, and
  the clamped bbox otherwise.

- [ ] **Step 1: Write the failing tests**

  ```js
  test("adaptStyle rewrites only source URL and fonts", () => {
    const out = adaptStyle(fixtureStyle("glaciers"), GLACIERS_STYLE_URL);
    assert.equal(out.sources.data.url, "pmtiles://https://data.source.coop/lqgentner/rgi/v7.0/rgi7.0.pmtiles");
    assert.ok(out.layers.every(l => !JSON.stringify(l.layout ?? {}).includes("Open Sans")));
    assert.deepEqual(stripFonts(out.layers), stripFonts(fixtureStyle("glaciers").layers));
  });
  test("mergeStyles drops repeated layer ids", () => { /* glaciers.json + regions.json share regions-outline-1 */ });
  test("the base map glacier fill is hidden", async () => {
    const { map } = await loadPage(); assert.equal(map.layout("landcover_ice").visibility, "none");
  });
  test("selection draws a red dashed outline filtered to the ID", async () => { /* paint + filter */ });
  test("North Asia and Antarctic Mainland fit without throwing", () => {   // Review Focus 4
    rgiMap.fitBbox({ xmin: -180, ymin: -90, xmax: 180, ymax: -63.2 }, 0);
    assert.ok(map.lastFit.bounds[0][1] >= -85.05);
  });
  ```

- [ ] **Step 2: Run the tests and see them fail**

- [ ] **Step 3: Implement `js/styles.js` and `js/map.js`**

- [ ] **Step 4: Run the tests and see them pass**

- [ ] **Step 5: Check by hand**

  Run `pixi run --locked serve` and open `http://localhost:8000/`. Expected:
  Liberty with no white OSM glacier fill, and the RGI outlines and region
  lines visible.

- [ ] **Step 6: Commit** with the subject `feat: draw the base maps and the RGI layers`.

---

### Task 7: Layer controls, 3D and the status line

**Files:**
- Create: `js/layers.js`, `js/status.js`, `tests/layers.test.js`,
  `tests/status.test.js`
- Create: `assets/base-standard.webp` and `assets/base-imagery.webp`, two
  thumbnails of the Aletsch area taken by hand from the running page, each
  under 20 KB. The toggle preview tiles are inline SVG.

**Interfaces:**
- Consumes: `RgiMap` (Task 6), `State` (Task 2), `TOGGLE_MINZOOM` (Task 6).
- Produces:
  - `mountLayers(root, { base, layers, onBase(base), onToggle(name, on), zoom: () => number })`.
    On desktop it draws a thumbnail of the *other* base map, with a panel
    that grows from behind it on hover or click. On the phone it draws a
    round `layers-2` button that opens a bottom pane titled "Map type" with
    "RGI layers" below.
  - Toggle labels are "RGI regions", "Centerlines" and "Ice divides". Each
    shows "visible from zoom N" when `zoom() < TOGGLE_MINZOOM[name]`.
- Produces: `mountTerrain(root, { on, onChange(on) })`. It draws the 3D
  button. The first time 3D turns on in a session, it shows a notice with
  ✕: "3D terrain is newer than the RGI outlines. Mapterhorn elevation and
  the outlines come from different years, so edges may not match." The ✕
  state lives in `sessionStorage` key `rgi-explorer.terrain-notice`, read
  and written in try/catch.
- Produces in `js/status.js`:
  - `metersPerPixel(lat, zoom) = 40075016.686 * cos(lat) / (512 * 2 ** zoom)`;
  - `scaleBar(mpp, maxPx = 80) -> { px, label }`, using steps 1, 2 and 5
    × 10ⁿ, labeled "m" below 1000 and "km" from 1000;
  - `credits({ base, terrain, catalog }) -> string[]`, in the spec's order,
    ending with the Global Constraints unofficial sentence;
  - `mountStatus(root, rgiMap, catalog, getState)`. It hides the scale bar
    on the phone and folds the credits into an `info` button there.

- [ ] **Step 1: Write the failing tests**

  ```js
  test("scale bar picks a round length", () => {
    assert.deepEqual(scaleBar(metersPerPixel(46.48, 11)), { px: 59, label: "5 km" });
  });
  test("credits name Esri only on imagery and Mapterhorn only in 3D", () => { ... });
  test("credits always end with the unofficial note", () => { ... });
  test("the desktop thumbnail shows the other base map and swaps on click", () => { ... });
  test("a hidden-at-this-zoom toggle says so", () => { /* zoom 6 → "visible from zoom 10" on Ice divides */ });
  test("the terrain notice shows once per session and survives a throwing sessionStorage", () => { ... });
  ```

  Compute the `px` for the first test from the formula when writing it, and
  fix the number in the test.

- [ ] **Step 2: Run the tests and see them fail**

- [ ] **Step 3: Implement both modules**

  Add the desktop and phone CSS for the layer control, the 3D button, the
  ± control (hidden on the phone), the notice and the status line. The
  status line sits under the map area only, and wraps to two rows.

- [ ] **Step 4: Run the tests and see them pass**

- [ ] **Step 5: Commit** with the subject `feat: add the layer controls, 3D mode and the status line`.

---

### Task 8: Card, Overview and Hypsometry

**Files:**
- Create: `js/columns.js`, `js/hypsometry.js`, `js/card.js`,
  `tests/columns.test.js`, `tests/hypsometry.test.js`, `tests/card.test.js`

**Interfaces:**
- Consumes: `Catalog.columns` (Task 3), `readRow` (Task 4), the regions list.
- Produces in `js/columns.js`:
  - `DISPLAY: { column, label, unit?: string, group: "key"|"location"|"outline"|"classification"|"submission", more?: true, format?: "date"|"int"|"km"|"deg"|"coord" }[]`,
    following the spec's Overview order and groups. `unit` is the display
    form: `km2` becomes "km²", `degrees` becomes "°", `m` stays "m".
  - `overviewRows(props, columns, regions) -> { group, rows: { label, value, description, link?, action? }[] }[]`.
    The `action` is `{ type: "pin", lonlat }` for the terminus and
    `{ type: "complex", id }` for `complex_id`. `link` is a GLIMS page for
    the outline. Before writing it, find a GLIMS URL that takes `anlys_id` or
    `glims_id` and test it with Aletsch (`anlys_id` 753957,
    `G008032E46504N`). If no such URL works, render the GLIMS ID as plain
    text. RGI 6.0 overlaps list each `rgi6_id` from
    `rgi6_links`, the first three with "+ N more".
  - `GROUP_TITLES = { location: "Location", outline: "Outline", classification: "Classification", submission: "Submission" }`.
- Produces in `js/hypsometry.js`:
  - `bands(z0, permille) -> { center, permille }[]`, with
    `center = z0 + HYPSO_BAND_M * i`;
  - `renderHypsometry(el, props)`, an SVG with horizontal bars in
    `--accent`, a dashed red median line and a mean line, and the minimum
    and maximum below.
- Produces in `js/card.js`:
  - `mountCard(root, ctx) -> { open(glacier), close() }`;
  - `glacier = { rgiId, row?, props? }`;
  - `ctx = { catalog, parquet, regions, photos: (g, signal) => Promise<Photo[]>, onClose, onZoom, onShare, onUseData }`.

  `open` renders the header and Overview from `props` straight away. It then
  reads `CARD_COLUMNS` (and, for a search pick, the attribute columns) with
  an `AbortController`. It aborts the previous open, and ignores late
  results whose `rgiId` is not the current one.
- Title: `display_name ?? glac_name ?? rgiId`. Subtitle:
  `rgiId + " · " + regionName` when a name exists. Otherwise it is
  `regionName` alone, because the ID is already the title.
- The connection to the Greenland ice sheet (`conn_lvl`) shows only when
  `o1region === "05"`. Submission starts collapsed. `anlys_id`, `subm_id`
  and `subm_rc_id` sit behind "show more".

- [ ] **Step 1: Write the failing tests**

  ```js
  test("every DISPLAY column exists in table:columns", async () => {
    const c = await loadCatalog(ROOT, fixtureFetch);
    for (const d of DISPLAY) assert.ok(c.columns.has(d.column), d.column);
  });
  test("coded values show the catalog label", () => {
    const rows = overviewRows(ALETSCH, columns, regions).find(g => g.group === "classification").rows;
    assert.equal(rows.find(r => r.label === "Terminus type").value, "Not assigned");
    assert.equal(rows.find(r => r.label === "Primary class").value, "Miscellaneous");
  });
  test("group order puts Classification just above Submission", () => {
    assert.deepEqual(overviewRows(ALETSCH, columns, regions).map(g => g.group),
      ["key", "location", "outline", "classification", "submission"]);
  });
  test("bands start at hypso_z0_m in 50 m steps", () => {
    const b = bands(1625, ALETSCH.hypso_permille);
    assert.equal(b.length, 50); assert.equal(b[0].center, 1625); assert.equal(b[49].center, 4075);
  });
  test("an unnamed glacier's title is its ID", () => { /* Review Focus 1 */ });
  test("a late row-group read for A is ignored after B opens", async () => { /* Review Focus 2 */ });
  test("the ⓘ shows the column description verbatim", () => { ... });
  ```

- [ ] **Step 2: Run the tests and see them fail**

- [ ] **Step 3: Implement the three modules and their CSS**

  The CSS covers the sidebar (408 px), the tabs (blue underline) and the
  Overview grid.

- [ ] **Step 4: Run the tests and see them pass**

- [ ] **Step 5: Commit** with the subject `feat: add the glacier card with Overview and Hypsometry`.

---

### Task 9: Photo

**Files:**
- Create: `js/photo.js`, `tests/photo.test.js`,
  `tests/fixtures/wikidata/aletsch.json`,
  `tests/fixtures/commons/aletsch.json` (canned responses, written by hand
  from one live call each)

**Interfaces:**
- Produces:
  - `sparqlQuery(bbox, glimsId) -> string`. It holds glacier items
    (`wdt:P31/wdt:P279* wd:Q35666`) inside `wikibase:box` with
    `cornerSouthWest`/`cornerNorthEast` set from the bbox, UNION items with
    `wdt:P6799 "<glimsId>"`. It selects `?item ?coord ?image ?category`
    (`P625`, `P18`, `P373`) and `?glims`.
  - `pointInRings([lon, lat], rings: number[][][]) -> boolean`, an even-odd
    test over all rings, so holes count;
  - `pickFiles(bindings, rings, glimsId) -> { file, item }[]`. It keeps an
    item when its point is inside or its GLIMS ID matches, puts GLIMS
    matches first, and removes duplicate files.
  - `commonsCredits(files, {fetch, signal}) -> Promise<Photo[]>`. It makes
    one `COMMONS_API?action=query&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=640&format=json&origin=*&titles=File:a|File:b`
    call and reads `Artist`, `LicenseShortName` and `LicenseUrl`, with HTML
    stripped from `Artist`.
  - `Photo = { src, page, author, license, licenseUrl, source: "Wikidata Q… · P18" }`;
  - `esriCrop(bbox, w, h) -> string`, the `ESRI_EXPORT` URL with
    `bbox=xmin,ymin,xmax,ymax&bboxSR=4326&imageSR=3857&size=w,h&format=jpg&f=image`.
    The bbox is padded by 15% on each side.
  - `categoryFiles(categories: string[], {fetch, signal}) -> Promise<string[]>`.
    It makes one
    `COMMONS_API?action=query&generator=categorymembers&gcmtitle=Category:<name>&gcmtype=file&gcmlimit=5&format=json&origin=*`
    call per category, as OSMapp's `getImageFromApi.ts` does. Its files come
    after the P18 files.
  - `findPhotos(glacier, rings, {fetch, signal}) -> Promise<Photo[]>`. It
    resolves to `[]` on any error or after `TIMEOUT_MS`.
- The outline `rings` come from `rgiMap.map.querySourceFeatures(…, { sourceLayer: "glaciers", filter: ["==", ["get", "rgi_id"], id] })`
  after the fit, with every piece's rings concatenated. `js/app.js` passes
  them in, so `photo.js` stays free of the map.
- The card's photo area shows a carousel of `Photo` with an `info` button
  that reveals `source`, the author and the license under the image. With
  no photo, it shows `<img src=esriCrop(...)>` captioned "Imagery: Esri,
  Maxar, Earthstar Geographics". If that image errors, it shows a plain
  `--line`-colored block.

- [ ] **Step 1: Write the failing tests**

  ```js
  test("the query has the bbox corners and the GLIMS ID", () => {
    const q = sparqlQuery(ALETSCH_BBOX, "G008032E46504N");
    assert.match(q, /Point\(7\.931361 46\.397437\)/); assert.match(q, /P6799 "G008032E46504N"/);
  });
  test("a point in a hole is outside", () => { ... });
  test("Aletsch picks the 2021 photo via GLIMS ID", () => {
    const [f] = pickFiles(WD.results.bindings, ALETSCH_RINGS, "G008032E46504N");
    assert.equal(f.file, "Glacier d'Aletsch - 2021.jpg");
  });
  test("Wikidata down resolves to no photos within the timeout", async () => {   // Review Focus 3
    const t = Date.now(); assert.deepEqual(await findPhotos(G, RINGS, { fetch: hang }), []);
    assert.ok(Date.now() - t < TIMEOUT_MS + 200);
  });
  test("a photo for A arriving after B opens is dropped", async () => { /* Review Focus 2, through mountCard */ });
  test("Esri crop URL pads the bbox and asks for jpg", () => { ... });
  ```

  Use a fake timer, or a `TIMEOUT_MS` passed in, so the timeout test runs
  fast.

- [ ] **Step 2: Run the tests and see them fail**

- [ ] **Step 3: Implement `js/photo.js` and the carousel**

  The carousel lives in `js/card.js`.

- [ ] **Step 4: Run the tests and see them pass**

- [ ] **Step 5: Commit** with the subject `feat: show a Commons photo or an imagery crop on the card`.

---

### Task 10: "Use this data", the phone sheet and app wiring

**Files:**
- Create: `js/usedata.js`, `js/sheet.js` (copied from glace-viewer, with
  element ids renamed), `tests/usedata.test.js`, `tests/app.test.js`
- Modify: `js/app.js`, `index.html` (the modulepreload list), `style.css`

**Interfaces:**
- Consumes: everything above.
- Produces in `js/usedata.js`:
  - `snippet({ tool: "python"|"qgis", scope: "glacier"|"region"|"all" }, { rgiId, o1region }, catalog) -> { code?: string, steps?: string[], filter?: string, note?: string }`;
  - `mountUseData(root, ctx)`. On desktop it opens a dialog, and on the
    phone a bottom pane. It has two segmented controls and a Copy button
    using `navigator.clipboard.writeText`.
- Exact Python for scope `glacier`, where `URL` is
  `catalog.collections.glaciers.dataUrl`:

  ```python
  import geopandas as gpd

  url = "URL"
  gdf = gpd.read_parquet(url, filters=[("rgi_id", "==", "RGI2000-v7.0-G-11-02596")])
  ```

  - `region` uses `filters=[("o1region", "==", "11")]`.
  - `all` has no filters, and its `note` is "Reads the whole file, about
    258 MB." The size comes from the HEAD `Content-Length`, formatted to MB,
    and the note is omitted if HEAD fails.
- Exact QGIS `steps`: the five steps in the spec's "Use this data" section,
  with the URL in step 4. `filter` is `"rgi_id" = 'RGI2000-v7.0-G-11-02596'`
  or `"o1region" = '11'`. It is absent for `all`. The `note` names the QGIS
  version tested, which the implementer fills in after checking in QGIS
  (spec requirement).
- `js/app.js` does the following:
  - parses the state, loads the catalog and creates the map;
  - mounts the search, the layers, the terrain, the status line, the card
    and Use this data;
  - on a map click, `glacierAt` → `card.open({ rgiId, props })`, and a click
    on empty map → `card.close()`;
  - on a pick, a glacier opens the card using its row, a region runs
    `fitBbox`, and a place runs `jumpTo` at zoom 12;
  - every change runs `history.replaceState(writeState(...))`;
  - for `?glacier=`, it finds the row through the search index. If the ID
    is unknown, it drops the parameter and opens no card (Review Focus 5);
  - registers `sw.js` outside `localhost`.
- The phone shows one sheet with glace-viewer's two heights. The compact
  height holds the name, the ID or region line, the area and "Use this
  data". The open height holds the photo and the tabs.

- [ ] **Step 1: Write the failing tests**

  ```js
  test("python glacier snippet is exact", () => {
    assert.equal(snippet({ tool: "python", scope: "glacier" }, ALETSCH, catalog).code,
      'import geopandas as gpd\n\nurl = "https://data.source.coop/lqgentner/rgi/v7.0/glaciers/rgi7.0-glaciers.parquet"\ngdf = gpd.read_parquet(url, filters=[("rgi_id", "==", "RGI2000-v7.0-G-11-02596")])\n');
  });
  test("qgis glacier gives the five steps and the filter", () => { ... });
  test("?glacier= with an unknown ID opens no card and cleans the URL", async () => {   // Review Focus 5
    const { window, document } = await loadPage({ url: BASE + "?glacier=RGI2000-v7.0-G-11-99999" });
    assert.equal(document.querySelector("#sidebar").hidden, true);
    assert.equal(window.location.search, "");
  });
  test("clicking a glacier opens the card and writes ?glacier=", async () => { ... });
  test("clicking empty map closes the card", async () => { ... });
  ```

- [ ] **Step 2: Run the tests and see them fail**

- [ ] **Step 3: Implement the modules, the wiring and the phone CSS**

- [ ] **Step 4: Run the full suite**

  Run `pixi run --locked test`. Expected: all pass.

- [ ] **Step 5: Check by hand at desktop and phone widths**

  Run `pixi run --locked serve`. Search "aletsch", open Grosser Aletsch
  Gletscher, check both tabs, the photo, the dashed outline, the dimming,
  Share, and both Use this data tools. Repeat at a 390 px viewport.

- [ ] **Step 6: Commit** with the subject `feat: wire the explorer and add Use this data`.

---

### Task 11: Smoke test and deployment

**Files:**
- Create: `tests/smoke.test.js`, `.github/workflows/deploy.yml`,
  `.github/workflows/smoke.yml`
- Modify: `README.md` (local development, `?catalog=`, deployment)

**Interfaces:**
- Consumes: `loadCatalog`, `openParquet`, `DISPLAY`, `HYPSO_BAND_M`.

- [ ] **Step 1: Write the smoke test**

  It skips unless `process.env.SMOKE === "1"`. Against the live
  `CATALOG_URL`, it checks the following:
  - `loadCatalog` resolves all five collections;
  - every `DISPLAY.column` exists in `columns`;
  - the `hypso_z0_m` description contains `+ 50 * n`, matching
    `HYPSO_BAND_M`;
  - the PMTiles header lists the layers `glaciers`, `regions`,
    `region-labels`, `glacier-labels`, `centerlines` and `intersects`;
  - `openParquet(dataUrl)` gives 274,531 rows and `SEARCH_COLUMNS` all exist;
  - reading `display_name` for group 0 decompresses (ZSTD).

- [ ] **Step 2: Run it**

  Run `pixi run --locked smoke`. Expected: PASS once the catalog is
  uploaded. Before that, it fails at the first fetch. Record which, and do
  not change the test to pass.

- [ ] **Step 3: Write `deploy.yml` and `smoke.yml`**

  Base `deploy.yml` on glace-viewer's, without tile building. The site
  stages `index.html style.css site-config.js sw.js js assets`, plus
  `node scripts/stage-libraries.mjs _site`. `smoke.yml` runs on
  `workflow_dispatch` and on a weekly schedule.

- [ ] **Step 4: Commit** with the subject `ci: deploy to GitHub Pages and check the live catalog weekly`.
