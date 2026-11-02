# A welcome and a guided tour in RGI Explorer

A short welcome for first-time readers, a help button that brings it back, and
an optional guided tour of the main controls. This extends the explorer design
in `2026-10-28-rgi-explorer-design.md`.

## Why

Most readers are glaciologists. Some are curious visitors who found a link.
Both can land on a globe of outlines with no hint of what it shows or what to
do with it: today nothing says that a click on a glacier opens its card, or
that the search finds glaciers by name and ID.

Neither group knows the cloud-native RGI catalog yet. The explorer only works
because the RGI is published that way, and "Get data" points readers to the
catalog. The tour is the place to say so.

## Goals

- On the first visit, say in a few lines what the map shows and how to start:
  search for a glacier or click one.
- Point newcomers to the RGI user guide rather than explain the RGI.
- Offer a tour of the main controls, for readers who want one.
- In the tour, say that the map reads the cloud-native RGI catalog directly,
  and that "Get data" shows how to read it yourself.
- Let a returning reader bring the welcome and the tour back from a help
  button.

## Non-goals

- Explaining glaciology or the RGI's methods. The user guide does that.
- Teaching every control. The layers, the compass and the photo viewer are not
  in the tour.
- Tracking whether readers take or finish the tour.

## Anti-goals

- **Intrusive.** The welcome must not block the map or the search. A frequent
  visitor ignores it and starts panning, searching or clicking as if it weren't
  there. No modal, no backdrop, no focus trap, no forced first step.
- **Wordy.** People don't read. The welcome is a heading and two lines. Each
  tour step is one or two short sentences.
- **Coming back.** Once dismissed, the welcome stays gone on later visits.

## The welcome

Shown on the first visit, after the map has loaded:

> **Explore the 274,531 glaciers of RGI 7.0**
> Search for a glacier or click one on the map.
> New to RGI? [Read the user guide](https://rgidata.org/user_guide/)
> [Take the tour]

- It has a close button (X) and no "Start exploring" button. The owner decided
  this.
- The glacier count comes from `table:row_count` on the glacier collection's
  data asset (274,531 in RGI 7.0), not a hard-coded number. If the catalog
  doesn't give a count, the heading is "Explore the glaciers of RGI 7.0".
- The cloud-native catalog is not mentioned here. The owner moved that line
  into the tour.
- The user-guide link opens in a new tab, like the card's other external
  links.

### When it goes away

These are my calls, not the owner's.

- The X, "Take the tour" or opening a glacier or complex (by any route) hides
  the welcome and marks it seen.
- Once it's marked seen, it doesn't show on later visits. The mark lives in
  `localStorage`, wrapped in try/catch like `readSession`/`writeSession` in
  `js/layers.js`. Without storage, the welcome shows on each visit and can
  still be closed.
- Panning or zooming doesn't hide it. It is small enough to leave in place.
- A page opened with `?glacier=` or `?complex=` in the address opens straight
  into the card. The welcome doesn't show then, and is not marked seen.

### Where it sits

My call, which the builder may refine after seeing it:

- **Desktop:** a small card in the sidebar under the search box, where the
  glacier card appears. It uses the same surface, shadow and radius as the
  card.
- **Phone:** a compact card above the bottom edge, under the search bar's
  column, sized like the sheet's compact state. It must not cover the search
  bar or the round buttons on the right.
- Following AGENTS.md, it is one control for both layouts. `style.css` places
  it, and it follows a resize across the breakpoint without a reload.

## The help button

- A round "?" button (Lucide `circle-question-mark`, the sprite's name for
  `circle-help`) with the accessible name "Help". The card's info buttons use
  the same icon. That's acceptable, since the help button is round and sits
  with the map controls (my call).
- It shows the welcome again, whether or not it was marked seen. The welcome
  always shows in its usual spot, in the sidebar or the sheet's place.
- **Open card or complex panel:** pressing Help closes it first, then shows
  the welcome. The owner decided this for the phone. The desktop does the same,
  so there is one behaviour (my call).
- **Phone:** the owner placed it at the bottom right, beside the credits'
  round info button. When a card is open it moves up above the sheet, the way
  the credits do. The builder reuses the mechanism that lifts the credits
  (the sheet's height variable in `style.css`/`js/sheet.js`).
- **Desktop:** in the controls column with 3D, the compass and zoom. The
  builder picks the exact slot, so the column stays tidy.

## The tour

"Take the tour" in the welcome starts it. The help button reaches it through
the welcome.

A tour step is a small popover anchored to one control. It has a short text, a
step counter ("2 of 4"), Back, Next (Done on the last step) and a close
button. The control it points at is highlighted with a ring. Nothing else on
the page is dimmed or blocked, and the reader can use the highlighted control
while the step is open. Esc or the close button ends the tour.

The owner named the steps: search, the glacier's numbers, Get data, and 3D.
The texts are my drafts:

1. **Search:** "Find a glacier by name or RGI ID, or jump to a place."
2. **The glacier card:** "Click a glacier to see its area, elevations and
   hypsometry. The ? next to a value explains it."
3. **Use this data:** "This map reads the cloud-native RGI catalog directly,
   with no download. Use this data shows how to read it in Python or QGIS."
4. **3D:** "See the terrain in 3D."

The button is labelled "Use this data" in the card, the complex panel and the
pane, and the tour uses that name. Renaming it is out of scope (my call).

If a complex panel is open rather than a glacier card, steps 2 and 3 point at
the complex panel and its own Use this data button. The texts still fit, and
the reader's complex stays open (my call).

Clicking the highlighted Use this data button in step 3 ends the tour. On the
desktop it opens a modal dialog that would sit over the tour popover anyway.
The reader has reached the point of the step (my call).

When the tour ends, focus goes to the help button. "Take the tour" is hidden
by then (my call).

Steps 2 and 3 point at the glacier card and its Use this data button, which
only exist once a glacier is open. The owner decided how the tour gets there:
if no glacier or complex is open when the tour reaches step 2, the step asks
the reader to click a glacier on the map, and offers a button,
"Take me to a glacier".

- While no glacier is open, step 2 shows "Take me to a glacier" in place of
  Next. Back and close still work (my call).
- The button opens a sample glacier the way a search pick does: it moves the
  map, writes `?glacier=` to the address and opens the card.
- A glacier the reader clicks on the map does the same for the tour. Either
  way, once a card is open, step 2 points at it and Next returns.
- The owner asked for a well-known glacier outside the Alps, in South America.
  Perito Moreno is `RGI2000-v7.0-G-17-14719`, but RGI 7.0 names it "S/N"
  (unnamed), so the card would show no name. The sample is **Upsala Glacier**,
  `RGI2000-v7.0-G-17-04760` (779 km², Southern Patagonian Icefield), which
  carries its name (my call). It is a constant in `js/config.js`.
- Closing the tour leaves the glacier open.

On the phone, step 2 points at the sheet in its compact state, and step 3 at
the Get data button in the sheet's header, if it shows there. Otherwise the
tour raises the sheet as needed. The builder checks where Get data sits on
the phone.

## Constraints

- No new library. The CSP allows same-origin scripts only and AGENTS.md
  governs libraries. A tour library would also need a license entry. The tour
  is small enough to write by hand.
- DOM is built with `h()` and `textContent`, never HTML interpolation.
- Icons come from Lucide through `icon(name)`.
- A new `js/` module (e.g. `js/welcome.js`, `js/tour.js`) goes in the
  `modulepreload` list in `index.html`.
- Accessibility: the welcome is a labelled region (not `role="dialog"`, since
  it doesn't take focus). A tour step is a non-modal dialog that takes focus on
  Next and Back and returns focus to "Take the tour" or the help button when it
  ends. The help button is keyboard reachable.
- Tests follow the repository's pattern: jsdom, the fake map, `loadPage()`,
  `setPhone()`. A scenario that needs fresh module state goes in its own test
  file.

## Left to the builder

- Exact styling, spacing and the popover's arrow, within the existing look.
- Where in `js/app.js` the welcome mounts, and how it learns that a glacier
  opened.
- Anchoring the popover. A plain absolute position computed from
  `getBoundingClientRect` is enough. It must stay inside the viewport and
  re-place itself on resize and when the sheet moves.
- The storage key names.
