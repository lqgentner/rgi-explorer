# RGI Explorer design

Date: 2026-10-28. Repository: `lqgentner/rgi-explorer`. Site:
`https://lqgentner.github.io/rgi-explorer/`.

## Intent

RGI Explorer is a web map that lets people look at the Randolph Glacier
Inventory (RGI 7.0) without downloading or installing anything. It reads the
unofficial cloud-native RGI mirror (`lqgentner/rgi-catalog`, published at
`https://data.source.coop/lqgentner/rgi/`) straight from the browser: vector
tiles from the mirror's PMTiles and attributes from its GeoParquet. It is a
showcase of what those two files make possible on the web, as much as it is a
tool.

It serves two groups:

- **Glaciologists who already use RGI.** They want an approachable way to look
  at the outlines of a region they don't know, and to read a glacier's
  attributes without opening a GIS.
- **Newcomers**, typically young PhD students who keep hearing that RGI is
  standard in glaciology. They want to see it in action before they download
  it, and then they want to know how to get it into their own tools.

Success: someone opens the page, finds a glacier by name, ID or clicking,
understands what RGI records about it, and leaves with a working snippet for
GeoPandas or QGIS.

## Goals

- A layout that feels instantly familiar because it follows Google Maps.
- Search across every RGI glacier (by name and RGI ID), the RGI regions, and
  OpenStreetMap places.
- A glacier card that shows all the metadata RGI provides, in two tabs
  (Overview, Hypsometry), plus a photo when one exists.
- A "Use this data" dialog that hands over a ready-to-run snippet.
- A phone layout that is touch-first and as good as the desktop one.

## Non-goals (first version)

- No dark mode. It may come later, so colors live in CSS custom properties.
- No hillshade. A Mapterhorn hillshade was tried and looked too strong. It may
  come back later as an optional layer.
- No thematic styles. The catalog publishes styles for terminus type, surge
  evidence, median elevation and same-as-RGI6, and the explorer does not
  offer them yet.
- No downloads from the explorer itself, no editing, no accounts, no
  analytics, no build step or bundler.
- English only.

## Anti-goals

These would make the project a failure even if everything technically works:

- **Looking official.** The mirror is not endorsed by the RGI Consortium. The
  explorer must not use the RGI logo or anything that implies endorsement.
  The README says the explorer and the mirror are unofficial.
- **Two glacier datasets on one map.** The base map's own OSM glacier fills
  must be hidden so that RGI is the only glacier layer.
- **Invented facts.** Every field description, unit, code label and
  explanation comes from the catalog's metadata. The explorer holds only
  presentation: a short display label, a display form of the unit (`km2` →
  km²), and the group and order of each column (see "Display table" under
  Overview tab).
- **A third-party service blocking the card.** Wikidata, Commons, Photon or
  Esri being slow or down must never stop a glacier card from opening.

## Constraints

- **Static site on GitHub Pages under a path prefix.** Every asset path and
  the service worker scope are relative to `/rgi-explorer/`.
- **Same toolchain as glace-viewer.** pixi provides Node; npm locks the page's
  libraries and the test dependencies. Libraries load unchanged from
  `./node_modules/` through an import map in `index.html`, and
  `scripts/stage-libraries.mjs` copies them into the Pages artifact. There is
  no bundler.
- **Content-Security-Policy.** Same-origin scripts and styles only. Each data
  host is listed explicitly: `data.source.coop`, `tiles.openfreemap.org`,
  `server.arcgisonline.com`, `tiles.mapterhorn.com`, `photon.komoot.io`,
  `query.wikidata.org`, `commons.wikimedia.org`, `upload.wikimedia.org`, and
  `download.mapterhorn.com` for `connect-src` only.
  A test checks the policy offline, as glace-viewer's `page-assets.test.js`
  does.
- **The explorer depends only on the published catalog**, never on
  `rgi-catalog`'s repository internals.
- **Fonts and icons are served by the explorer.** Noto Sans and Noto Sans
  Mono come from `@fontsource` packages. Icons come from Lucide.

### Starting point

The repo is new, not a fork. These pieces are copied from `../glace-viewer`
on purpose, and the first commit names them:

- the import-map setup and `scripts/stage-libraries.mjs`;
- `pixi.toml` with Node and `npm ci` as a task;
- `scripts/serve.py`, which supports byte ranges and turns off caching for page code;
- the CSP and its offline test;
- `sw.js`, which serves JSON stale-while-revalidate;
- the jsdom test helpers;
- `js/sheet.js`, the phone bottom sheet with two snap heights and flick handling.

Nothing raster-specific is copied. Of glace-viewer's visual style, only the
globe projection and the halo behind it (`js/sky.js`) are.

## The catalog contract

One config value pins the catalog root:
`https://data.source.coop/lqgentner/rgi/catalog.json`. A `?catalog=` URL
parameter overrides it for development, for example to point at
`rgi_catalog preview` running locally. The credits stay the same.

The explorer walks the STAC links from the root to the five RGI 7.0
collections: `rgi-v7-0-glaciers`, `-regions`, `-complexes`, `-centerlines`
and `-intersects`. It resolves every asset href against its collection.
Paths are never hard-coded. Each collection's assets give:

- `data`: the GeoParquet file.
- `pmtiles` (role `visual`): one shared archive, `v7.0/rgi7.0.pmtiles`.
- `style` (the `default` role wins): the MapLibre style for that collection.
  The explorer draws with its own style instead (see The map).

The **glaciers collection's `table:columns`** supply each column's
description, unit and `classification:classes` (the code labels). The Overview
tab reads all labels and ⓘ texts from there.

Measured from the staged 7.0-r1 files:

| Layer in `rgi7.0.pmtiles` | Zooms | Fields |
|---|---|---|
| `glaciers` | 0–12 | every glacier attribute except `hypso_permille`, `rgi6_links` and `bbox` |
| `glacier-labels` | 7–12 | `display_name`, `rgi_id`, `area_km2`, `label_minzoom` |
| `regions`, `region-labels` | 0–12 | `o1region`, `o2region`, `full_name`, `level` |
| `region-boundaries` | 0–12 | `level`: each border once, 1 where it bounds a first-order region |
| `complexes` | 0–12 | `rgi_id`, `area_km2`, centre point |
| `centerlines` | 8–12 | `rgi_id`, `segment_id`, `strahler_n`, `is_main`, … |
| `intersects` (ice divides) | 10–12 | `rgi_id`, `rgi_g_id_1`, `rgi_g_id_2`, `length_m` |

The glaciers GeoParquet (258 MB, 274,531 rows, 24 row groups of about
11,400 rows) is sorted on the Hilbert curve. It has no page index. Measured
compressed column sizes across the whole file:

- `geometry`: 221.5 MB
- `hypso_permille`: 3.1 MB
- `rgi_id`: 0.32 MB
- `glac_name`: 0.13 MB
- `display_name`: 0.07 MB
- footer: 145 KB

A CI smoke test loads the live root catalog, the glaciers collection, the
PMTiles header and the GeoParquet footer, and fails if any of them changed shape.

## Layout

Visual style: a bright base map, a solid white monochrome UI, a blue accent (`#1a73e8` in the mockups) for the active tab,
the primary button and the selected search result, and Noto Sans throughout.
Shadows follow Google Maps' elevation style. Only the controls that sit over
the map or the photo are translucent white (the status line, the photo's
arrows and ⓘ, and the photo credits), so what is behind them shows through.
Every ⓘ opens a popover next to its button, below it or above when there is
no room. It floats over the page without moving anything, and a click
elsewhere closes it.

### Desktop

- **Search bar** at the top left, a white pill that floats over the
  sidebar when the sidebar is open.
- **Sidebar** on the left, about 408 px wide, running the full window height.
  It slides in from the left when a glacier is selected and slides out when
  the ✕ in the search bar closes it.
- **Layers control** at the bottom left of the map area. A white card shows
  a preview of the *other* base map with Lucide's `layers-2` icon and the
  word "Layers" in white along its bottom, over a gradient that darkens
  towards the bottom. On hover or focus a white drawer with the three
  toggles slides out to the right from behind the card, and the card keeps
  its size. Open, the bottom line names the map a click swaps to, and
  hovering the picture zooms it slightly and rings it in dark grey. On a touch screen the first tap opens the
  control and a press elsewhere closes it. A mouse that leaves keeps it open
  while keyboard focus is inside. Its accessible name starts with the visible
  "Layers" ("Layers: show Imagery map") and it reports whether it is
  expanded. When the sidebar is open and the window is narrower than 810 px,
  the drawer would run under + / −, so it opens upwards as a column instead. Each toggle has a small static preview
  tile drawn from the layer's real data at a fixed place (the Caucasus and
  Middle East region and its two subregions, with finer dashes than the
  map's; the Hardangerjøkulen complex's centerlines and intersects), in the
  map's colors. It does not follow the view.
  `scripts/make_layer_previews.py` cuts them from the GeoParquet files into
  `js/previews.js`:
  - RGI regions, on by default;
  - Centerlines, off by default;
  - Intersects, off by default.
- **3D button**, then **+ / −**, at the bottom right.
- **Status line** over the map's bottom right corner, translucent and only
  as wide as its text. It holds a compact scale bar and the credits,
  custom-built because MapLibre's controls are too large. It never reaches
  under the sidebar, and wraps when the map area is narrow.

### Phone

- The search bar stretches across the top.
- Round **layer** and **3D** buttons sit at the top right, using Lucide's
  `layers-2` icon for the layers. There is no scale bar and no + / −, since
  the phone is touch only.
- The **layer button** opens a bottom pane like Google Maps' "Map type" pane.
  It has a header with ✕, a "Map type" row with Standard and Imagery tiles,
  and an "RGI layers" row with the three toggle tiles. A selected tile's
  square has a blue border drawn inside it, on the phone and the desktop.
- **One bottom sheet** for the glacier card, with GLACE Viewer's behavior.
  - Compact height: the name, the RGI ID, area and region, and "Use this
    data".
  - Pulled up all the way: the photo and both tabs.
- The credits fold into an ⓘ button.

## The map

- **Standard base map:** OpenFreeMap Liberty
  (`https://tiles.openfreemap.org/styles/liberty`), loaded as is except that
  the explorer hides its `landcover_ice` layer.
- **Imagery base map:** Esri World Imagery raster tiles, with Esri's credit.
  Liberty's borders and labels stay above it. The Liberty layers it covers
  are switched off, so they neither draw nor fetch tiles; the background
  stays and shows while the imagery loads.
- **The map is a globe.** MapLibre's globe projection turns into Mercator as
  the view zooms in. A halo, as in glace-viewer, shows around the globe.
  The centre stops at the Mercator edge (±85.05°), where the tiles end, so
  the globe never turns on a pole. The imagery picture in the layers card
  keeps its export box inside the world, since Esri draws past an edge in
  black.
- **The opening view** without a view in the address turns the globe toward
  the reader: the longitude of the browser's standard UTC offset and a rough
  latitude for its time zone's area. The time zone never leaves the browser.
  There is no IP lookup, which would send the address to a third party, and
  no geolocation prompt.
- **RGI layers** are drawn from `rgi7.0.pmtiles` with the explorer's own
  style (`js/styles.js`), not the catalog's. They sit above the base map's fills
  and lines and below its country borders and labels. Glaciers are opaque white with a grey outline,
  so OSM water and woods mapped on the ice don't tint them, and small ones are dots at low zoom. Over imagery glaciers have no fill and a
  white outline with a soft dark shadow, so the ice shows and the outline
  stands out on snow, and the region outlines turn light. Regions are dashed outlines without a fill, drawn from
  `region-boundaries`, which holds each border once. Glacier labels and
  region labels come from the archive, in Noto Sans, the only fonts Liberty's
  glyph server holds.
- A toggle whose layer has no data at the current zoom (centerlines below 8,
  intersects below 10) stays usable. In the phone's pane it shows "visible
  from zoom N".
- **Selecting a glacier:**
  - draws its outline in red (`#d93025`), dashed and about 2 px wide;
  - dims the rest of the map a little, the way Google Maps highlights an area;
  - fits the view to the glacier's bbox, padded so the sidebar or sheet
    doesn't cover it, with half the glacier's size free on every side and
    no closer than zoom 15, so the map around it shows for orientation.
- **Clicking the map** selects the glacier under the pointer. Only glaciers
  are selectable: a complex opens from search or from a glacier's card.
  Clicking empty map closes the card or the complex panel.
- **Selecting a complex** looks the same, for the whole complex, with its
  member glaciers' outlines drawn again above it (see the complexes design).
- **3D mode:**
  - the 3D button loads Mapterhorn terrain
    (`https://tiles.mapterhorn.com/tilejson.json`, terrarium, 512 px) and
    tilts the camera;
  - a small notice in a map corner, closable with ✕, says the terrain is
    newer than the RGI outlines and may not match them;
  - closing the notice is remembered for the session.

## Search

- One ranked list. The most likely match is at the top, and the list is not
  grouped. Each result has an icon and a subtitle naming its kind:
  - glacier (RGI ID and area);
  - RGI region (its code);
  - place (OSM type, capitalised, and country; an OSM glacier reads
    "Glacier (OSM)" to set it apart from RGI glaciers);
  - glacier complex (its ID; see the complexes design,
    `2026-10-30-glacier-complexes-design.md`).
- **Glacier names and IDs.** The first focus of the search bar reads three
  columns from every row group of the glaciers GeoParquet: `rgi_id`,
  `display_name` and `complex_id` (for finding complexes), about 0.4 MB on
  the 7.0 file, using hyparquet. `glac_name` is not a name: it holds
  placeholders such as "Unnamed_23", so a glacier without a `display_name`
  is found and titled by its ID. The explorer builds a fuzzy index from them in
  the browser. Each match keeps its row position (row group and offset), so
  no lookup table is needed.
- **Typing an RGI ID** (full, or the region-and-number part, for example
  `11-02596`) puts that glacier first. A complex ID (`C-11-01323`) finds that
  complex, and a bare `11-01323` lists the glacier and then the complex.
- **The search bar names the open glacier or complex** (its title), however
  it was opened: from search, the map, a link or another panel. Closing the
  panel empties it. Someone typing in it keeps their text, and Escape puts
  the name back.
- **RGI regions** come from the regions GeoParquet (`full_name`, codes), which
  is small. Picking one fits the region's bbox.
- **OSM places** come from Photon (`photon.komoot.io`), queried with a
  debounce and biased towards the current view. Nominatim is not used,
  because its usage policy forbids search-as-you-type. Picking a place moves
  the map there and highlights nothing.

## Glacier card

### Opening a glacier

1. The `rgi_id` is known, from the click or from the search index.
2. Header and Overview render at once. From a click, they come from the tile
   feature's properties. From search, they come from that glacier's row,
   which is read next.
3. The explorer reads the glacier's row group for the columns the tile
   doesn't have: `bbox`, `hypso_permille`, `hypso_z0_m` and `rgi6_links`.
   That is a few hundred KB, cached per row group. For a search pick, it also
   reads the attribute columns for that row.
4. The photo is looked up in parallel and never blocks the card.

### Header

- **Photo area** at the top, about 280 px high on desktop (see Photo below).
- **Name:** `display_name`. When that is empty, the RGI ID is the title.
- **Subtitle:** "Glacier", the RGI ID and the first-order region name, so the
  card tells itself apart from the complex panel.
- **Buttons:**
  - "Use this data", the primary button in blue;
  - "Zoom to";
  - "Share", which copies the current URL.

### Overview tab

From top to bottom:

1. **Key numbers** in a grid: area, length (`lmax_m`), mean slope, minimum,
   median and maximum elevation.
2. **Location:**
   - region and subregion, by code and name from the regions data;
   - central point;
   - terminus point (click to drop a pin);
   - UTM zone.
3. **Outline:**
   - source date;
   - same as RGI 6.0;
   - RGI 6.0 overlaps from `rgi6_links`;
   - glacier complex (opens the complex panel; see the complexes design);
   - topography DEM;
   - GLIMS ID (links to the GLIMS viewer in a new tab, marked with an
     external-link icon).
4. **Classification:**
   - primary class;
   - terminus type;
   - surge evidence;
   - aspect (sector and degrees);
   - connection to the Greenland ice sheet, shown only in region 05.

   This group sits low because many values are "Not assigned" or "No
   evidence".
5. **Submission**, collapsed by default:
   - analysts, submitters and affiliation;
   - processing description, analysis time and release date;
   - number of outlines;
   - `anlys_id`, `subm_id` and `subm_rc_id` under "show more".

Every row label has an ⓘ that shows that column's description from
`table:columns`. Coded values show the `classification:classes` label.

**Display table.** `table:columns` has no short labels, so the explorer keeps
one small table. It maps each shown column name to a short label ("Area"), a
display unit (km²), its group and its order. A unit test checks that every
column in the table exists in the fixture `table:columns`. The smoke test
checks the same against the live catalog. The table never holds a
description or a code label.

### Hypsometry tab

- Horizontal bars, one per elevation band, from `hypso_permille` (thousandths
  of the glacier area). Band n is centered at `hypso_z0_m + 50 * n`. The
  explorer holds the 50 m step as a constant, because the catalog states it
  only in the `hypso_z0_m` description ("The elevation bands are all 50 m in
  height."). The smoke test checks that the live description still says so.
- Elevation is on the vertical axis. Dashed lines mark the median
  (`zmed_m`) and mean (`zmean_m`) elevations.
- The minimum and maximum elevations appear below the chart.
- The bars use the accent color, and the median line is red.

### Photo

The approach comes from OSMapp (`zbycz/osmapp`, `src/services/images/`),
adapted because an RGI glacier has no OSM tags.

1. Query Wikidata SPARQL for two kinds of item:
   - glacier items (`P31/P279* Q35666`) whose coordinates (`P625`) lie in the
     glacier's bbox;
   - any item whose GLIMS ID (`P6799`) equals `glims_id`.
2. Keep the items whose point lies inside the RGI outline. A GLIMS ID match
   always counts. The outline comes from the glacier's rendered tile
   geometry, so the point-in-polygon test is approximate at tile resolution.
3. Collect each kept item's `P18` image and, as OSMapp does, files from its
   Commons category (`P373`).
4. Show the hits as a carousel. Each image's credit always shows, as one
   line of text along the photo's bottom left, set like the map's credits:
   "Photo", then its source ("Wikidata Q204658 · P18", linking to the
   Commons file page), the author and the license.
5. The author and license come from the Commons API (`imageinfo` with
   `extmetadata`).
6. With no hit, or on any error or timeout, show an Esri World Imagery crop
   framed on the glacier's bbox, with the line "Imagery Esri, Maxar,
   Earthstar Geographics". On desktop
   the search bar covers the photo's top, so the crop centres the glacier in
   the rows below it.

Expect few photos. Measured on 2026-10-28, 2,416 Wikidata items carry a
GLIMS ID and 626 of them have an image. About 10,000 Wikidata glaciers have
coordinates, and 1,982 of those have an image. So the Esri crop is the
normal case, for about 99% of glaciers, and it must look intentional.
Accepted risk: a Wikidata point for a large glacier can fall inside one of
the smaller pieces that RGI 7.0 split it into, and that piece then shows the
large glacier's photo.

### "Use this data"

A dialog, or a bottom pane on the phone, with two choices and a snippet with
a Copy button:

- **I work in:** Python or QGIS.
- **Fetch:** this glacier, its region (`o1region`), or all glaciers.

The Python snippets use GeoPandas, because GeoPandas is more common in
science than DuckDB:

```python
import geopandas as gpd

url = "https://data.source.coop/lqgentner/rgi/v7.0/glaciers/rgi7.0-glaciers.parquet"
gdf = gpd.read_parquet(url, filters=[("rgi_id", "==", "RGI2000-v7.0-G-11-02596")])
```

- The region snippet filters on `o1region`. The all-glaciers snippet reads the
  whole file and says how large it is.
- **The QGIS variant** adds the GeoParquet file as an HTTP(S) vector source.
  It offers no PMTiles. The steps, as the author confirmed in QGIS's Data
  Source Manager:
  1. Layer › Add Layer › Add Vector Layer…
  2. Source Type: **Protocol: HTTP(S), cloud, etc.**
  3. Protocol Type: **HTTP/HTTPS/FTP**.
  4. URI: the GeoParquet URL, with a Copy button next to it.
  5. Leave Authentication at "No Authentication" and click **Add**.

  The filters work like this:
  - For this glacier, the dialog includes a ready filter
    (`"rgi_id" = 'RGI2000-v7.0-G-11-02596'`) to paste into the layer's Query
    Builder (right-click the layer › Filter…).
  - For a region, the filter is `"o1region" = '11'`. For all glaciers, there is
    no filter, and the dialog states the file size.
  - The catalog README's QGIS route, the Portolan Registry plugin, does not
    apply. The plugin finds only registered catalogs, and this mirror stays
    unregistered until the RGI Consortium approves it.
  - Before writing the text, the builder checks two things in a current QGIS
    release. The first is that the layer loads and the filter applies. The
    second is which installers include GDAL's Parquet driver. The dialog
    states the tested QGIS version.
- URLs come from the catalog contract and are never typed in.
- A single-glacier read currently fetches 32 to 79 MB, because of the row-group
  layout. `lqgentner/rgi-catalog#1` tracks the fix. The snippet stays the same
  either way. Only its speed changes when the catalog changes.

## URL state

- `?glacier=<rgi_id>` opens that glacier's card, and `?complex=<rgi_id>`
  opens a complex's panel. A glacier wins when both are given.
- `#zoom/lat/lon` holds the view.
- `?base=imagery` and `?layers=regions,centerlines,intersects` record the
  base map and toggles.
- `?3d=1` turns on 3D.
- The URL updates with `history.replaceState`, so "Share" copies a link that
  reproduces the view.

## Credits

The status line, or the ⓘ on the phone, lists the credits in groups, each
named for what it draws:

- **Glaciers:** "RGI Consortium" and the year of the catalog's citation,
  linked to the catalog's DOI, whose landing page names the license;
- **Basemap:** © OpenStreetMap contributors, OpenFreeMap, © OpenMapTiles;
- **Imagery:** Esri, when imagery is shown;
- **Terrain:** © Mapterhorn, when 3D is on, then the producers of the
  elevation sources in view, finest data first. After each move the page
  reads them from Mapterhorn's coverage index
  (`download.mapterhorn.com/coverage-index.pmtiles`, zooms 4 to 12), as
  Mapterhorn's "attribute visible sources" example does. It reads at most 16
  index tiles, at a coarser zoom for a wide view. Below zoom 4, past 15
  sources, or when the index does not answer, © Mapterhorn stands alone and
  links to its attribution page, which lists every source.

Photo credits sit with the photo.

## Testing and deployment

- `pixi run test` runs jsdom unit tests. They cover:
  - the catalog walk and asset resolution against fixture JSON;
  - the label lookup from `table:columns`;
  - search ranking;
  - the hypsometry band math;
  - URL state;
  - snippet generation;
  - the photo matching, against canned Wikidata responses;
  - the CSP and the import map, offline.
- The smoke test against the live catalog runs in CI on a schedule and on
  demand, not on every push.
- A GitHub Actions workflow stages the libraries and deploys the site to
  GitHub Pages.

## Left to the builder

- Exact colors, spacing, shadows and animation timings, within the look
  described above. The mockups in the brainstorming session are a guide, not
  a spec.
- The fuzzy-search library and the ranking formula, as long as exact ID and
  name matches come first and OSM places can outrank weak glacier matches.
- How long to debounce Photon and how many results to show (about 6–8).
- Timeouts for Wikidata, Commons and Photon.
- Module structure.
