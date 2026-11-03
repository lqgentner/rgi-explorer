# Glacier complexes in RGI Explorer

A complex panel: a glacier complex can be found by its ID and opened in its
own panel, like a glacier. This extends the explorer design in
`2026-10-28-rgi-explorer-design.md`; where the two disagree about complexes,
this document wins, and the main design is updated to match.

## Why

RGI 7.0 publishes a glacier complex product: every cluster of touching
glaciers merged into one outline. The explorer knows complexes only as a row
on the glacier card that draws the complex's outline, dashed grey. Someone
who opens a complex wants two things: its statistics, such as its area, and
how to get its data into Python or QGIS.

The explorer is a showcase of what RGI provides. It adds no data on top of
RGI.

## Goals

- Find a complex by its ID in the search bar.
- Open a complex from the "Glacier complex" row of a glacier's card. This is
  the usual way in.
- Show a complex in a panel with RGI's attributes of the complex, the number
  of its glaciers and a table of them.
- Select a complex on the map the way a glacier is selected today.
- Offer "Use this data" for the complex, in Python and QGIS.

## Non-goals

- Clicking the map never opens a complex. A click selects the glacier under
  the pointer, as it does now.
- No back button from a glacier to the complex it was opened from. Each
  glacier card links to its complex again.
- No search by complex name. Complexes have no names.

## Anti-goals

- **Figures RGI does not publish.** No elevation range, date span, slope or
  any other figure computed from the member glaciers. Simple metadata derived
  from RGI's own fields is fine: the number of member glaciers, and the
  member table built from the glaciers file.
- **A complex that hijacks a glacier click.** See the non-goals.

## What RGI provides

The complexes collection (`rgi-v7-0-complexes`, already loaded by
`js/catalog.js` as `catalog.collections.complexes`) holds one GeoParquet file,
`rgi7.0-complexes.parquet`, 192,869 rows, 215 MB. Its columns:

| Column | Content |
| --- | --- |
| `rgi_id` | the complex ID, such as `RGI2000-v7.0-C-11-01208` |
| `o1region`, `o2region` | the region codes |
| `cenlon`, `cenlat` | a representative point inside the outline |
| `utm_zone` | the UTM zone of that point |
| `area_km2` | the area |
| `glacier_ids` | the `rgi_id` of every member glacier, sorted |
| `geometry`, `bbox` | the outline and its bounding box |

The column descriptions are in the collection's `table:columns`, as for the
glaciers.

The file is sorted by `rgi_id` in 48 row groups of 4,096 rows, and each row
group's `rgi_id` statistics give its first and last ID. A complex's row can be
found from those statistics without reading the ID column of the whole file.

Every glacier has a `complex_id` in the glaciers file. 171,009 complexes (89 %)
hold one glacier. The largest, `RGI2000-v7.0-C-01-09429`, holds 893.

The `complexes` layer of `rgi7.0.pmtiles` holds the outlines with `rgi_id`,
`area_km2` and a centre point, at zoom 0 to 12.

## How a complex opens

- **From a glacier card.** The "Glacier complex" row in the Overview tab
  becomes a link to the complex. It opens the complex panel in place of the
  glacier card. It no longer draws the dashed grey outline. That layer,
  `selection-complex`, and `showComplex` go away.
- **From search.** The search bar recognises a complex ID in these forms:
  `RGI2000-v7.0-C-11-01208` and `C-11-01208`, in any letter case. A bare
  `11-01208` matches both products: it lists the glacier `G-11-01208` first
  and the complex `C-11-01208` second, each when it exists. RGI numbers the
  two products separately, so the complex is generally not the one that holds
  that glacier; the "Glacier ·" and "Complex ·" subtitles tell them apart. A
  complex ID that is not in the file gives no complex hit.
- **From the address.** `?complex=RGI2000-v7.0-C-11-01208` opens the complex on
  load, as `?glacier=` opens a glacier. An open complex writes this parameter.
  A page holds at most one of `glacier` and `complex`. Opening one removes the
  other.

Opening a complex closes any glacier card, and opening a glacier closes any
complex panel. Only one panel is open at a time.

## The complex panel

The panel takes the glacier card's place: the left sidebar on desktop and the
bottom sheet on the phone, with the same widths, motion and close behaviour.

- **Picture.** The Esri World Imagery crop of the complex's bbox, as a glacier
  without a photo gets, with the same credit. Complexes have no Wikidata
  entries, so there is no photo search.
- **Title.** The complex ID, as an unnamed glacier's card shows its ID.
- **Subtitle.** "Complex" first, then the first-order region's name:
  "Complex · Central Europe".
- **Actions.** The glacier card's: zoom to the complex, share the link, Use
  this data, close.
- **Attributes.** No tabs; laid out as the glacier card's overview:
  - key number tiles for the area, in km², and the number of glaciers in the
    complex;
  - a "Location" group with the glacier card's location rows: first-order
    and second-order region, each with its code and name, the
    representative point (`cenlon`, `cenlat`) and the UTM zone. A complex
    has no terminus, so that row is left out.
- **Glaciers.** A table of the member glaciers with name, RGI ID and area,
  largest first. A glacier without a name shows an empty name cell. The table
  scrolls inside its own box when it is long, so a complex of 893 glaciers
  does not stretch the panel. Clicking a row opens that glacier's card, which
  closes the complex panel.

A single-glacier complex gets the same panel, with a one-row table.

## The glacier card's subtitle

The glacier card's subtitle starts with "Glacier", so the two panels tell
themselves apart: "Glacier · RGI2000-v7.0-G-11-01450 · Central Europe" for a
named glacier, "Glacier · Central Europe" for an unnamed one, whose title is
already its ID.

## The map

- **Selection.** A selected complex gets the treatment a selected glacier
  gets today, applied to the whole complex: the map is dimmed, the complex is
  lifted out of the dimming with the base map's normal glacier fill (opaque
  white on the standard map, none on imagery), and its outline is drawn in the
  selection red, dashed, as a glacier's is. The outline comes from the
  `complexes` tile layer. There is no red fill. Where the tiles hold a complex
  as a point, it gets the selection dot, as a glacier does. A complex has no
  selection label, as it has no name.
- **Member outlines.** The glacier outlines inside the complex stay visible
  in their normal grey. The lifting fill sits above the RGI layers and would
  hide them, so the member outlines are drawn again above it. The glacier
  tiles carry `complex_id`, so that layer can filter on it.
- **Fit.** Opening a complex always fits the view to the whole complex's
  bbox, with the same padding and the same room around it as a glacier. This holds however it opens: from
  the "Glacier complex" link on a glacier card and from a search hit. A
  shared `?complex=` link fits only when the address holds no view, as a
  shared `?glacier=` link does, so the sender's view is kept. A complex is often much larger than the glacier it was
  opened from, so the view zooms out to show all of it.

## Use this data

The dialog in `js/usedata.js`, with the same Python and QGIS forms. For a
complex the three scopes match a glacier's:

| Scope | File | Filter |
| --- | --- | --- |
| This complex | complexes | `rgi_id` |
| Its region | complexes | `o1region` |
| All complexes | complexes | none, with the size note |

## Search results

A complex hit shows the complex ID as its title and "Complex · " with the
region's name as its subtitle, as a glacier hit's subtitle starts with
"Glacier · ". It has its own icon and ranks as an ID hit, just below a glacier hit
for the same bare ID.

## Data reads

The explorer already reads the glaciers file by row group over HTTP ranges
(`js/parquet.js`).

- **A complex's row** comes from the complexes file: find its row group from
  the `rgi_id` statistics, then read that group's columns except `geometry`.
- **The member names** come from the glacier search index, which is loaded
  for search anyway, through `glacier_ids`.
- **The member areas** are not in the search index today. The builder picks
  how to get them while keeping reads small. Two ways: add `area_km2` to the
  search columns, or read `area_km2` from the row groups that hold the
  members.

## Constraints

- The contracts in `AGENTS.md` hold: the modulepreload list, the
  Content-Security-Policy, DOM built with `h()`, relative paths. The complexes
  file is on the same host as the glaciers file, so the CSP needs no new host.
- A failed or slow read never blocks the panel. The panel shows what it has
  and says what is missing, as the glacier card does.
- Tests use the strict fake map and jsdom, as now.

## Left to the builder

- Module boundaries: a new module for the complex panel or a shared card
  shell with the glacier card.
- The search hit's icon, from Lucide.
- How the member areas are read (see Data reads).
- How the main design document is updated: the glacier card row in its
  Overview list, the URL section, the search section and the selection
  layers.
- Smaller calls the builder can make and change cheaply: whether opening a
  member glacier from the table fits the view (it does today for a glacier
  picked in search), what the compact phone sheet shows for a complex,
  whether the header repeats the area, the ⓘ on the glacier-count row, which
  parameter wins when an address holds both `?glacier=` and `?complex=`, and
  how search checks that a complex ID exists.
