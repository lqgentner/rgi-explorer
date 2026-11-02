# A tour that asks the reader to act

This revises the tour in `2026-11-02-welcome-tour-design.md`. Where the two
disagree, this document wins. The welcome, the help button and their rules for
when they show stay as built, except for the heading and the corner radii
below.

## Why

The first tour explains each control and moves on when the reader presses
Next. On the phone, a tap on "Use this data", which step 3 invites, opens the
pane over the sheet and the tour is lost. Step 2 already waits for a glacier,
and that step felt right: the reader learns by doing, and the action explains
itself, so the text gets shorter.

## Goals

- Each step asks for one action and moves on by itself when the reader does it.
- The tour survives the panes it sends the reader into. While "Use this data"
  or the photo viewer is open, the tour says "Close to continue the tour" and
  picks up again when the reader closes it.
- No reader gets stuck. Every step has a way on that doesn't need the action.
- The text stays as short as before or shorter.

## Non-goals

- Checking that the reader did the task well, for example that they copied the
  snippet.
- New steps. The tour still covers finding a glacier, the card, Use this data
  and 3D.

## Anti-goals

- **A trap.** A step the reader can't leave without doing its action.
- **Moving under the reader.** A step that jumps away while the reader is
  still reading or using the control.
- **A loud secondary choice.** Only the step's main action is a filled button.

## The steps

The owner set the actions and the button styles. The texts are my drafts.

1. **Find a glacier.** Points at the search. "To start, click a glacier on the
   map or search for one."
   - Buttons: "Take me to a glacier" and "Skip", both outline buttons.
   - It moves on by itself once a glacier card or a complex panel opens, by any
     route: a map click, a search result or the button.
   - "Take me to a glacier" opens the sample glacier (Upsala), as today,
     including its "Opening…" state and its removal when the catalog has no
     sample glacier.
   - If a card is already open when the tour starts, step 1 is already done
     and the tour starts on step 2 (my call).
2. **The glacier card.** Points at the card, or the sheet on the phone. "Its
   area, elevations and hypsometry. Tap a [?] to see what a value means."
   - [?] stands for the info buttons' own icon, Lucide `circle-question-mark`
     via `icon()`, drawn inline at text size, never the "?" character. The
     owner decided this. Every "?" in the tour's text is that icon.
   - **On the phone** the glacier opens in the compact sheet, whose body is
     inert, so none of the interactions below can happen yet. The owner
     decided: on the phone the text is "Swipe up to see its area, elevations
     and hypsometry. Tap a [?] to see what a value means.", and raising the
     sheet above compact counts as an interaction.
   - Buttons: an outline "Skip" until the reader interacts with the card, then
     a filled "Next" in its place. It does not move on by itself, so it never
     jumps away while the reader is reading.
   - What counts as an interaction (the owner's list): a scroll of the card's
     body, opening any info "?" popover in the card, and switching to the
     Hypsometry tab.
   - **A complex panel instead of a card** (my call). The step's title is
     "The complex panel" and its text is "Its area and its glaciers. Tap a [?]
     to see what a value means." On the phone it begins "Swipe up to see its
     area and its glaciers." A scroll and a "?" count as interactions,
     and so does a click on a member glacier. That click swaps in the
     glacier's card, and the tour stays on step 2 with Next showing.
3. **Use this data.** Points at the card's Use this data button. "This map
   reads the cloud-native RGI catalog directly, with no download. Open Use
   this data to read it in Python or QGIS."
   - Button: an outline "Skip".
   - Opening Use this data doesn't end the tour any more. The tour shows
     "Close to continue the tour" over the dialog (desktop) or the pane
     (phone), and moves on to step 4 when the reader closes it.
4. **3D.** Points at the 3D button. "Switch to 3D to see the terrain."
   - Button: an outline "Skip".
   - It moves on by itself when 3D turns on, by the button or by tilting the
     map.
   - If 3D is already on when the step opens, the step is already done and
     the tour goes to the last card (my call).
5. **The last card.** It points at nothing. "You're all set. Have fun
   exploring the glaciers on your own." The wording is my draft; the owner
   asked for something like "Have fun exploring on your own".
   - Button: a filled "Done".
   - Placement is my call: on the desktop, centred below the search box; on
     the phone, above the status line where the welcome sits.

**Every step:**

- The X (End tour) stays.
- The counter becomes "n of 4" for steps 1 to 4; the last card shows none (my
  call).
- Back is gone. The steps follow from the reader's actions, so a step back
  would point at something the reader has already done (my call).
- **Skip moves to the next step, not out of the tour.** Skip on step 1 leaves
  no card open, so steps 2 and 3 can't point at anything. A skip past them
  goes straight to step 4 (my call).
- **The card closes mid-tour** (the reader presses the card's Close on step 2
  or 3): the tour goes back to step 1.
- **Use this data closes on step 3 by another route** (my call):
  - A route that also closes the card, such as a tap on empty map, sends the
    tour back to step 1. The card rule wins.
  - A route that leaves a card open, such as another glacier opening, counts
    as closing it, and the tour goes to step 4.
  - Help ends the tour, as today.

## Close to continue the tour

- **When it shows:** while the Use this data dialog or pane is open, or the
  photo viewer is open, at any step. The owner asked for the viewer to behave
  like Use this data.
- **What it is:** the tour's popover shows only "Close to continue the tour"
  and the X. It has no other buttons. The step it came from is remembered.
- **After the reader closes:** if they closed Use this data on step 3, the
  tour goes to step 4. In every other case, the tour returns to the step it
  came from.
- **Where it sits:** the dialog and the viewer are modal, in the top layer,
  and make the rest of the page inert. The message must still show above them,
  so it lives in the top layer too (the Popover API, `popover="manual"`, shown
  after the dialog opens) or inside the dialog. The builder picks the
  mechanism. The message needs no interaction except the X, so an inert X is
  acceptable if keeping it live isn't possible; Escape on the dialog still
  closes the dialog only.
- On the phone, the Use this data pane lives in the sheet and is not modal.
  The message sits above it, clear of the pane's own close button.

## When the welcome goes away

This changes the first design, which kept the welcome through pans and zooms.
The owner decided: an interaction with the map or the search means the reader
isn't interested in the tour, so it closes the welcome and marks it seen.

- **The map:** a drag, a pinch, a wheel or keyboard zoom, a rotation or a
  tilt by the reader, and a click on the map. These are the MapLibre events
  that carry an `originalEvent`; the page's own camera moves don't count.
- **The search:** typing in it or pressing on it. Tabbing into it doesn't
  count, so a keyboard reader's first Tab, which lands in the search, still
  reaches "Take the tour" (changed after review). Opening a result already
  counts, through opening a glacier.
- The welcome shown again by Help follows the same rule.
- The X, "Take the tour" and opening a glacier or complex still close it, as
  built.

## The welcome heading

"Explore the 274,531 glaciers of the Randolph Glacier Inventory 7.0". The
owner decided this.

- The count comes from the catalog as today. Without a count, the heading is
  "Explore the glaciers of the Randolph Glacier Inventory 7.0".
- The version and the word before it stay together (no break between
  "Inventory" and "7.0").

## Corner radii

The owner decided the rule: buttons keep the glacier card's button radius,
`var(--radius)` (16 px), and a card's corner radius is the button radius plus
the card's inner padding, so the corners are concentric.

- The rule covers the welcome, the tour's popovers and the "Close to
  continue the tour" message only. Other rounded boxes keep their radii (my
  call).
- The welcome and the tour cards get 12 px inner padding, so a 28 px corner
  radius. Keep it as a CSS custom property derived from `--radius`, e.g.
  `calc(var(--radius) + 12px)`.
- The close X keeps its place, inset by the same 12 px.

## Button styles

- One filled (`.btn.primary`) button at most per step: Next on step 2 after an
  interaction, and Done on the last card.
- "Take me to a glacier" and "Skip" are outline buttons (`.btn`), the same as
  the card's Zoom to and Share.

## Constraints

As in the first design: no new library, the CSP, DOM via `h()`, Lucide icons,
one control for both layouts, the tests' patterns. The tour keeps reading the
app's state only through callbacks from `js/app.js`. It learns of panel, data,
viewer and 3D changes through new callbacks or events that the builder adds.

## Left to the builder

- How the tour hears each action: open/close of Use this data and the viewer,
  3D on, a card scroll, an info popover's toggle, the Hypsometry tab.
- The mechanism that keeps "Close to continue the tour" above modal dialogs.
- Exact spacing, within the radius rule.

## After the first build (owner's review, 2026-11-02)

These replace the matching points above.

- **Placement on the phone:** every step sits at the top, under the search
  bar, from 12 px on the left to clear of the round buttons on the right. It
  no longer follows the sheet or the credits, so a swipe of the sheet moves
  nothing. The last card sits there too.
- **"Close to continue the tour":** the message has no X of its own; it
  rings the close button of Use this data or the viewer, so the reader closes
  that and not the message. On the phone it waits at the bottom over the Use
  this data pane, whose heading is at the top.
- **Buttons:** the main action (Done, Take the tour, Next) sits on the right.
  The text and the buttons run to the card's 12 px padding; only the heading
  keeps clear of the X.
- **3D notice:** removed from the explorer.
