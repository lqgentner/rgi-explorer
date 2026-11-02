# Glacier images in RGI Explorer

A new photo area for the glacier card and the complex panel. The Esri imagery
crop is always the first image. Photos from Wikidata and Commons follow it in
a strip that you swipe on the phone and scroll or click through on the
desktop. A tap on any image opens a viewer that shows it whole. The card's
buttons and the strip share one corner radius, and the stat tiles a smaller one.

This extends the explorer design in `2026-10-28-rgi-explorer-design.md`. Where
the two disagree about the photo area, this document wins, and the main design
is updated to match (see the last section).

The mockups behind this design are in `.superpowers/brainstorm/` (ignored by
git): `image-strip-v2.html` (phone), `desktop-fullbleed.html` (desktop,
variant A), `desktop-arrows-v2.html` (arrow position, "After") and
`radius.html` (corners).

## Why

- **Photos hide the imagery.** Today a glacier with Commons photos shows the
  photos only, and the reader can no longer see the glacier from above. The
  imagery should always be available.
- **The photo area changes under the reader.** The crop shows first and is
  replaced when photos arrive.
- **Arrows on the phone.** The carousel steps with arrow buttons. On the phone
  a swipe is the natural gesture, and the buttons cover the photo.
- **Mismatched corners.** The buttons are pills (16px), while the stat tiles
  and the complex's member table have 8px corners.

## Goals

- The imagery crop is always the first image, and photos follow it.
- When photos arrive, the first image keeps its place and size.
- On the phone: an inset strip with rounded corners and an 8px sliver of the
  next image to show there is more. Swipe, no buttons.
- On the desktop: the photo area keeps today's look, full bleed under the
  search bar with square corners. It shows a counter and arrows on hover, and
  a trackpad swipe also scrolls it.
- A tap or click on any image, the imagery included, opens a viewer.
- Every photo credits its author and license on the strip itself.
- Matching corners: 16px for the card's buttons and the phone strip, and 12px
  for the stat tiles and the member table, with each tile's ⓘ concentric
  with its corner.

## Non-goals

- No change to how photos are found: the Wikidata SPARQL query, the GLIMS
  match, the outline test, the Commons categories and the limit of eight
  files stay as they are.
- No new image sources such as Mapillary or Panoramax.
- No zooming or panning inside the viewer. *(My call.)*
- No caching or preloading beyond what the browser does.

## Anti-goals

- The first image moving, resizing or flashing when photos arrive.
- A swipe on the strip moving the sheet, or the strip breaking the sheet's
  vertical drag.
- Downloading every photo, or any full-size file, before the reader asks
  for it.
- A photo on the strip without its author's name.
- A single image dressed up as a gallery. About 99% of glaciers have no photo
  (main design, Photo). One image shows no counter, no arrows and no sliver,
  and it must look intentional.

## Constraints

From `AGENTS.md`, restated where they bite:

- No libraries. The viewer is a native `<dialog>`.
- Build DOM with `h()`, never HTML interpolation. Commons metadata stays
  text, as `textOf()` in `js/photo.js` makes it today.
- **One control for both layouts.** The strip is built once. `style.css`
  sets its look per layout. Code reads `PHONE.matches` when it needs it and
  reacts to its `change` event.
- A new `js/` module goes in the `modulepreload` list in `index.html`.
- **CSP.** `img-src` already lists `server.arcgisonline.com`,
  `upload.wikimedia.org` and `thumb.wikimedia.org`, and `connect-src` lists
  `commons.wikimedia.org`. No new host is expected. As of 2026-11-02, Commons
  serves thumbnails from `thumb.wikimedia.org` and rounds the requested width
  up to a standard bucket (640 came back as 960).

## The strip

### Content and order

1. The Esri crop of the bbox, with the credit "Esri, provider, imaged
   date" once `identify` answers, as today.
2. The photos in the order `findPhotos()` returns them: the `P18` files first,
   then the category files. That gives at most eight photos and nine images.

The crop shows as soon as the bbox is known, as today. When photos arrive they
are **appended** after it. The crop's element stays in place, so nothing about
it changes and the reader's scroll position holds. Today's
`renderPhotoArea()` replaces the whole area on each render, so that has to
change.

If the crop fails and there are photos, the crop's tile is dropped and the
photos stand alone. If the crop fails and there are no photos, the plain
placeholder block shows, as today. *(My call.)* The placeholder and every
tile while its image loads are a mid grey (`--image-placeholder`, #9aa0a6),
darker than the card's light greys, so a loading image is not a pale flash.

The strip is a native horizontal scroller (`overflow-x: auto`,
`scroll-snap-type: x mandatory`) with one element per image. Images after the
first carry `loading="lazy"`, so an image is fetched only as it nears view.
Opening a glacier costs the crop and about one photo.

### On every image

- **Credit**, bottom left, inset 8px from both edges: a small rounded chip
  (8px radius) of translucent glass, 11px, as in the mockups. It takes the
  width the counter leaves free and wraps to a second line when it needs to.
  The imagery's credit is never cut short. Past two lines, a photo's author
  is cut short with "…". *(My call: a credit wraps before it is cut.)* This
  replaces today's credit, which sits flush in the corner. See Credits below
  for what it says.
- **Counter** "n / N", bottom right, inset like the credit and aligned with
  the credit's last line, dark glass with white text. Only when there are two or more
  images.

### Phone

- The strip sits where the photo sits today, at the top of the sheet's
  body, below the band. It is 180px high, as today.
- It is inset by the card's 16px gutters, and its images have 16px corners.
- **Every image has the same width: the sheet's width minus 32px.** The gap
  between images is 8px, so 8px of a neighbour shows in the gutter. Photos are
  cropped to the frame (`object-fit: cover`), and the viewer shows them whole.
- The images snap to the centre. Because the strip cannot scroll past its
  ends, the first image sits against the left gutter with a sliver of the
  second on the right, and the last mirrors that.
- There are no buttons.
- **Gestures.** A horizontal swipe scrolls the strip. A vertical drag starting
  on the strip behaves as it does on the rest of the body: it moves the sheet,
  or scrolls the body at full height. `#sheet-body` is `touch-action: pan-y
  pinch-zoom` today, and `js/sheet.js` locks each gesture to an axis, so the
  strip needs a `touch-action` that allows horizontal panning. A horizontal
  gesture must not start a sheet drag. At compact height the body is inert,
  and a tap on the visible top of the photo raises the sheet, as today.
  Verify this on a real phone (iOS Safari and Android Chrome) as well as in
  tests.

### Desktop

- The photo area is unchanged: 280px high, edge to edge, square corners,
  with the search bar over its top 72px. The crop keeps framing the glacier
  in the rows below the search bar (`DESKTOP_CROP` in `js/app.js`). Photos
  stay centred in the full 280px, so their top goes under the search bar.
- Each image takes the full width with no gap, and images snap to their
  start.
- **Arrows.** Previous and next buttons in today's faint glass style
  (`.photo-prev` and `.photo-next`), 8px from the edges, with Lucide's
  `chevron-left` and `chevron-right` through `icon()`, as today. The viewer's
  buttons use the same icons. They show while the
  pointer is over the photo area or focus is inside it *(focus: my call)*. On
  the first image only next shows, and on the last only previous. A click
  scrolls one image smoothly. With a single image there are no arrows.
- **The arrows are centred vertically between the search bar's bottom edge
  and the top of the credit and counter row**, not on the whole image. Derive
  that centre in CSS from the same custom properties that place the search bar
  and size the credit row, so the arrows stay centred if either one changes.
  The reference is the height of a one-line credit row. A credit that wraps
  does not move the arrows. *(My call.)*
- A trackpad's horizontal scroll moves the strip natively.
- The strip never shows a scrollbar of its own, in any browser:
  `scrollbar-width: none`, plus `::-webkit-scrollbar { display: none }` for
  Safari before 18.2.

### The sidebar's scrollbar

`#card` is the desktop sidebar's scroller, `var(--card-w)` (408px) wide.
`#search` is fixed over it at `left: 16px` and 376px wide. Where scrollbars
take up space (Firefox and Chrome on Linux and Windows, and macOS with "always
show scrollbars"), the vertical scrollbar takes about 12–17px from the card's
right side. The content, photo included, gets narrower, the search bar keeps
its width, and its right edge ends up touching the scrollbar (seen on
2026-11-02 with Såtaskavlen). The photo is then also narrower than the 408px
that `DESKTOP_CROP` (816px at 2×) and the arrows' positions assume.

The fix keeps the content 408px wide in every browser and puts the scrollbar
outside it:

- `#card` gets `scrollbar-gutter: stable`, so the gutter is the same whether
  or not the card overflows, and the layout does not shift when it starts to.
- The page measures the scrollbar's width as `offsetWidth - clientWidth` of
  `#card` and stores it as `--scrollbar` on `:root`. That is 0 where
  scrollbars overlay the content (macOS by default, phones). It measures
  again on `resize`, since the browser's zoom changes the width.
- A new property, `--sidebar-w: calc(var(--card-w) + var(--scrollbar))`, is
  the sidebar's outer width. It replaces `--card-w` where the outer edge
  matters: `#card`'s width, its slide-out offset, the left position of
  `#layers`, and `#status`'s `max-width`. Content keeps using `--card-w`.
  `CARD_WIDTH` in `js/app.js`, the map's left padding when it fits a glacier,
  adds the measured scrollbar width as well.
- `#search` stays 376px wide at `left: 16px`, which now leaves 16px on both
  sides of the content, with the scrollbar beyond the right gutter.

Check in Firefox and Chrome with classic scrollbars, and in Safari with
overlay scrollbars, where nothing should change.

### Across the breakpoint

The same elements serve both layouts, and `style.css` switches the gutters,
gap, width, corners, snapping and arrows. The strip keeps track of the image
it shows: the image nearest its snap position, updated as it scrolls. On a
`PHONE` change it jumps to that image without animation.

The crop is framed per layout (`ctx.crop`: `DESKTOP_CROP` keeps the top rows
clear for the search bar, `PHONE_CROP` does not). On a `PHONE` change the
crop's `<img>` stays the same element but gets the other layout's `src`, and
its credit asks `identify` again. `PHONE_CROP` becomes 720×360, twice a
360×180 tile, to suit the inset tile's shape. Narrower and wider phones crop
the rest with `object-fit: cover`. *(My call.)* That index lives with
the card's photo state, as `current.photos.index` does today, so a re-render
keeps the position. Tests cross the breakpoint with `setPhone()`.

## The viewer

Revised on 2026-11-02 after a look at the first build (mockups:
`viewer-fixed.html` variant F, `viewer-variants.html` phone variant 2,
`scrim.html`).

- A tap or click on any image opens a modal `<dialog>` at that image. A
  scroll or swipe does not produce a click, so swiping never opens it. A click
  on a link in the credit follows the link and does not open the viewer.
- **The controls never move.** Under the images sits one dock, fixed to the
  bottom of the screen: the image's credit, centred and wrapping to as many
  lines as it needs, and below it ‹ "n / N" ›. ✕ is fixed in the screen's top
  right corner. A longer credit grows upwards, so the arrows stay in place.
  At the first and last image an arrow is disabled, not hidden. With one
  image there is no counter and no arrows.
- **Desktop:** the page behind the viewer is darkened with `--scrim-strong`,
  dark grey (`#202124`) at 80%, so the app stays recognisable and the white
  credit and controls read over it. The image floats above the dock at its
  own size and shape, as large as fits, with 16px corners. A click anywhere
  outside the image and the dock closes the viewer.
- **Phone:** the image fills the screen's width. Behind it, in place of black,
  is a strongly blurred, more saturated copy of the shown image (blur so
  strong only its colours remain), drawn from the image already loaded. The
  background does not move with a swipe: it is one layer behind the images
  that cross-fades to the next image's colours. It is darkened to 40%
  brightness, so even an all-white glacier blurs to about #666 and the white
  credit keeps a contrast of about 5.7:1, with no text shadow. A 16px gap
  separates the images while swiping, and the neighbours show their strip
  thumbnails at once, so a swipe never reveals an empty slide. There
  are no arrows; a swipe moves between images, the counter shows in the dock,
  and ✕ closes. A tap on the background does nothing. *(My call: a stray tap
  between swipes should not close the viewer.)*
- **Moving between images:** the arrow keys, the arrows on the desktop, and
  swiping. ✕ and Esc close it. When it closes, the strip shows the image the
  viewer was last on, and focus goes to that image.
- **Larger files, fetched only when the viewer opens.** A photo loads a
  Commons thumbnail about 1600px wide. Until it arrives, the strip's
  thumbnail stands in, scaled up. That is the same picture, so nothing
  jumps. Only the image on screen loads. Prefetching its neighbours is left
  to the builder.
- **The imagery in the viewer is framed by the glacier, not the screen.** It
  uses `esriCrop()` on the bbox at a fixed 1200×800 (3:2, the shape of the
  photos it sits among) with `top: 0`, since nothing covers it there. Phone
  and desktop get the same image. The strip's crop is framed differently (on
  the desktop it keeps its top rows clear for the search bar), so it does not
  stand in. Its shape is known, so until the export loads the viewer shows a
  solid dark-grey placeholder (#3c4043) of exactly the image's size, on its
  own slide and while swiping to it.
  Framing to the screen was tried first and gave tall, narrow crops on
  phones. Asking for more detail, such as twice the screen's pixels, costs
  more bytes and can tip World Imagery into a finer level: around
  Vatnajökull a patchwork of scenes from different dates (Dyngjujökull,
  RGI2000-v7.0-G-06-00375: the 75 m level at 2000 px wide against the even
  150 m Earthstar level at 1400 px and below).
- **The viewer's imagery gets its own `identify`** for that extent and size.
  A finer export can come from different imagery than the strip's crop, and
  the credit has to name what is shown. Until `identify` answers, the credit
  reads "Esri, Vantor, Earthstar Geographics", as on the strip. *(My call.)*
- **The full credit** in the dock:
  - for a photo: the author, the license linking to its deed, the source
    ("Wikidata Q204658 · P18" or "· P373"), and a link to the Commons file
    page;
  - for the imagery: "Esri", the provider and the capture date, as on the
    strip.

### Scrims

A scrim is the translucent dark layer laid over the page behind a pane or
dialog. Two strengths, as custom properties in `:root`:

- `--scrim`, dark grey (`#202124`) at 40%: the phone's layer pane
  (`.layers-scrim`, black at 40% today) and the "Use this data" dialog's
  backdrop (already this value). One value for both.
- `--scrim-strong`, the same grey at 80%: the desktop image viewer, whose
  white credit and controls sit on it.

## Credits

CC BY and BY-SA require the author, the license with a link, and a link to the
source. Version 4.0 accepts "any reasonable manner based on the medium",
including a link to a page that carries the credit. Wikimedia nevertheless
recommends naming the author beside the image. We do both.

- **On the strip, a photo's credit is "Author · License".** The author links
  to the Commons file page, and the license links to `licenseUrl`. Today's
  source text ("Wikidata Q… · P18") moves to the viewer. A long author name
  wraps, and is cut short with "…" only past two lines. The link and the
  viewer carry it in full.
- **Author text:** Commons' `extmetadata.Attribution` when it is present and
  not empty, otherwise `Artist`. Some files name a required credit there, and
  `js/photo.js` reads only `Artist` today. *(My call.)*
- A file with no author, such as a public domain one, shows its license
  alone.
- The imagery's credit is unchanged: "Esri, Vantor, Earthstar Geographics"
  until `identify` answers, then "Esri, provider, imaged date". Esri requires
  it wherever its imagery shows, so the viewer shows it too.

## Corners

Two custom properties in `:root`.

`--radius: 16px` is for what is round on the outside:

- `.btn` (16px today, so the pills stay as they are);
- the phone strip's images.

`--tile-radius: 12px` is for the boxes that hold text:

- `.key-tile`, the stat tiles of both the glacier card and the complex panel
  (8px today);
- `.members-scroll`, the complex's member table (8px today).

**The stat tile's ⓘ is concentric with its corner.** The corner's inner
curve, inside the 1px border, has an 11px radius. The ⓘ's 14px icon is
centred on that curve's centre, 11px from the inner edges. That moves
`.key-tile .info` from 6px to 4px from the right and bottom. Derive it in CSS
as `calc(var(--tile-radius) - 1px - 7px)`, where 1px is the border and 7px is
half the icon, so the ⓘ stays concentric if the radius changes. The value's
16px right padding still clears the ⓘ. (Mockup: `tile-radius-v2.html`.)

Other radii stay as they are: the search bar, the sheet, popovers, the
layer pane, the credit and counter chips, and the desktop photo, which has
square corners.

## The complex panel

The complex panel shows only the imagery crop. It uses the same strip with
one image: inset with 16px corners on the phone, full bleed on the desktop,
and no counter, arrows or sliver. A tap opens the viewer on that one image.
*(My call, for consistency.)*

## Tests

jsdom has no layout, scrolling or snapping, so tests check structure and
state, and a real browser checks feel.

- `photo.test.js`: `Attribution` wins over `Artist`, and an empty
  `Attribution` falls back to `Artist`.
- Card and complex tests:
  - the crop is the first image and is the same element after photos arrive;
  - the counter and arrows appear only with two or more images;
  - the strip's credit reads "Author · License" with both links;
  - a failed crop with photos drops the crop's tile;
  - `setPhone()` keeps the shown image and gives the crop's `<img>` the other
    layout's `src`;
  - a click opens the viewer at that image, Esc closes it, and focus returns;
  - a click on a credit link does not open the viewer;
  - the viewer requests its larger file only when it opens, and for the
    imagery, an `identify` for the viewer's own extent.
- `page-assets.test.js` covers the `modulepreload` entry for any new module.
- The scrollbar: with a stubbed `offsetWidth` and `clientWidth`,
  `--scrollbar` is set and the map's fit padding includes it.
- By hand on a phone: horizontal swipe against the sheet's vertical drag, at
  each sheet height.

## Left to the builder

- How the code is split into modules (for example `js/strip.js` and
  `js/viewer.js`).
- How the viewer gets the larger Commons thumbnail: a second `imageinfo`
  request when it opens, or a wider thumbnail requested up front and used only
  by the viewer.
- How the shown image is tracked (`scrollend` and its fallback).
- The viewer's styling on the desktop, within the page's existing visual
  style.
- Whether the viewer prefetches its neighbours.

## Changes to the main design

In `2026-10-28-rgi-explorer-design.md`:

- **Layout:** the translucent controls over the photo are now the arrows, the
  credit chip and the counter.
- **Photo, step 4:** the hits follow the imagery in the strip described here,
  and each credit reads "Author · License" on the strip, with the source in
  the viewer.
- **Photo, step 6:** the Esri crop is always shown, as the first image, not
  only when there is no hit.
- **Phone sheet:** the photo is the inset strip.
