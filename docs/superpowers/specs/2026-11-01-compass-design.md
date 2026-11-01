# A compass in RGI Explorer

A compass for the map: it shows which way north is, turns the map, and brings
it back to north and out of 3D in one click. This extends the explorer design
in `2026-10-28-rgi-explorer-design.md`. Where the two disagree about the map
controls, this document wins, and the main design is updated to match.

## Why

MapLibre lets a reader turn the map: right-drag or Ctrl-drag with a mouse,
Shift and the arrow keys, and a two-finger twist on a touch screen. The 3D
mode tilts the camera, and the reader can then turn it to look along a
valley. Today nothing on the page shows that the map is turned, and the only
way back to north is to leave 3D, which also flattens the map. A reader who
twisted the map by accident on a phone has no way back at all.

The same gestures also tilt the map without 3D: right-drag and Ctrl-drag on
the desktop, Shift and the up and down arrows, and a two-finger vertical drag
on a touch screen. A tilted 2D map has no button that shows it and no way back
but tilting it flat again by hand.

## Goals

- Show at all times on the desktop which way north is, and let the reader
  turn the map with buttons.
- One click on the compass faces north and leaves 3D.
- On the phone, offer the same way back, but only when the map is turned or
  in 3D, so the compass takes no space the rest of the time.
- A tilted map is always in 3D, and a flat map never is. Tilting by hand
  turns 3D on and off.

## Non-goals

- Tilting with the compass. It turns the map and resets it. Tilting stays
  with the 3D button and the map's own gestures.
- Keeping the bearing in the address. The view in the hash stays
  `#zoom/lat/lon`.
- A way to set an exact bearing or type a direction.

## Anti-goals

- A copy of Google Maps' compass. Google's dark round dial with grey arrows
  was the reference for the idea. This compass is the explorer's own white
  capsule.
- A compass that covers the map's content on the phone when it isn't needed.

## Desktop

### Layout

The bottom-right column holds, from top to bottom, the compass, the 3D button
and the + / − pair, 8 px apart as now. The column centres its controls, so the
54 px compass sticks out 9 px either side of the 36 px buttons below it. The
compass keeps the column's 16 px from the map's right edge, and the buttons
below sit 9 px further in than today.

The 3D button and the + / − buttons shrink from 40 × 40 with 8 px corners
to **36 × 36 with 11 px corners**. Their straight edge is then 14 px, the same
as the compass's (54 − 2 × 20), so the column reads as one family. The phone
keeps its 44 px round buttons.

### The compass

A white capsule, 54 × 40 px, with round ends (radius 20) and the controls'
shadow. Inside it, from left to right:

- **Rotate left:** a curved arrow on the left.
- **The needle:** in the middle, 28 px tall. It is a diamond: the north half
  red (`#d93025`, the page's red) and the south half light grey (`#bdc1c6`).
- **Rotate right:** a curved arrow on the right, mirroring the left one.

Outside a 20 px disc around the centre, each half of the capsule is its
arrow's button. The disc is the needle's button and covers both halves'
inner edges. It is smaller than the 28 px needle, so the arrows are easy to
reach. Hovering a button greys it (`#f1f3f4`), as
the other controls do: the disc, or the half of the capsule around it. The
arrows are drawn over the buttons and don't catch the pointer.

The arrows are near-black (`#202124`, the page's text color, like the other
icons). Each one is a 2 px stroke with a round cap and a filled head:

- **Curvature:** the arc shares the centre of the capsule's round end and sits
  7 px in from the edge, radius 13, so it bends exactly like the outline.
- **Head:** an isosceles triangle. Its base lies along the radius where the
  stroke ends, and its tip lies along the stroke's direction, so the stroke
  leads straight into the middle of the head. The head points down: the left
  arrow runs down the left side, counter-clockwise, and the right arrow
  clockwise.
- **Balance:** the top of the stroke and the tip of the head are both 12.1 px
  from the capsule's middle, so the arrow reaches as far up as down.
- **Clearance:** at any angle, the needle stays at least 1.7 px clear of the
  arrows.

The geometry, in the capsule's own 54 × 40 coordinates:

```svg
<!-- left -->
<path d="M13.25 8.89 A13 13 0 0 0 9.1 27.08" fill="none" stroke="#202124" stroke-width="2" stroke-linecap="round"/>
<polygon points="6.08 29.04 12.37 32.11 12.12 25.12" fill="#202124"/>
<!-- right -->
<path d="M40.75 8.89 A13 13 0 0 1 44.9 27.08" fill="none" stroke="#202124" stroke-width="2" stroke-linecap="round"/>
<polygon points="47.92 29.04 41.63 32.11 41.88 25.12" fill="#202124"/>
<!-- needle, 28 × 28, centred in the capsule -->
<polygon points="14,0 18.7,14 9.3,14" fill="#d93025"/>
<polygon points="9.3,14 18.7,14 14,28" fill="#bdc1c6"/>
```

### What it does

- **The needle shows north on screen.** It turns by minus the map's bearing,
  so its red half always points to the map's north. In 3D it flattens with
  the tilt (`rotateX(pitch) rotateZ(−bearing)`). It doesn't grow, so it
  never reaches the arrows. It follows the map live, during a drag as well.
- **Rotate left and Rotate right** ease the map 45° counter-clockwise or
  clockwise. The pitch, the 3D mode and the centre stay as they are.
- **A click on the needle** eases the map to bearing 0 and pitch 0 and leaves
  3D. Leaving 3D this way is the same as pressing the 3D button off: the 3D
  button's pressed state, the address (`?3d=1`) and the terrain notice follow.
  In 2D and already facing north it does nothing visible.
- **The 3D button** keeps today's behavior: turning 3D on eases to a 60° tilt,
  and turning it off also brings the map back to north (`setTerrain(false)`
  eases to pitch 0 and bearing 0).

## Tilting turns 3D on and off

On the desktop and the phone alike:

- **Tilting from 2D turns on 3D.** When the reader tilts the map by hand and
  the tilt passes 5°, the page does what the 3D button does: the terrain
  loads, the 3D button shows pressed, `?3d=1` goes into the address, and the
  terrain notice shows the first time in the session. The camera stays where
  the reader put it. It doesn't jump to 60°.
- **Tilting back flat turns 3D off.** When a tilt by hand ends below 5° in 3D,
  the map eases to pitch 0 and 3D turns off: the terrain goes, the 3D button
  shows unpressed, `?3d=1` leaves the address, and the notice hides. The
  bearing stays as the reader left it.
- **Only the reader's tilts count.** A tilt counts when it comes from a
  gesture or the keyboard, which MapLibre marks with the original input
  event. The page's own camera moves never toggle 3D: fitting the view to a
  glacier, the 3D button's 60° ease, the compass's reset.
- **Between 0° and 5° in 2D**, a tilt by hand that ends there eases back to
  pitch 0, so a flat map is never left slightly tilted.

## Phone

- A **round 44 px compass button** with the same 28 px needle and no arrows.
  It sits under the 3D button in the right-hand column, 8 px below it.
- It shows while **the map isn't facing north or 3D is on**, and hides once
  the map faces north in 2D. In 3D it is a second sign of the tilt, next to
  the pressed 3D button. It eases in and out (scale and fade, about 160 ms;
  none with reduced motion).
- A tap on it does what a click on the desktop needle does: north, pitch 0,
  and out of 3D.

## Shared behavior

- **North-facing** means a bearing of 0. MapLibre snaps the bearing to 0 when
  a rotate gesture ends within 7° of north (its default `bearingSnap`), so a
  near miss doesn't leave the phone compass on screen.
- **One control for both layouts**, as `AGENTS.md` asks: the compass is built
  once. `style.css` hides the arrows and makes it a round 44 px button on the
  phone, and sets its place in the column with flex `order` (first on the
  desktop, after 3D on the phone). A resize across the breakpoint needs no
  reload, and the phone's hidden-when-north rule applies only on the phone.
- **Labels:** the group is labelled "Map direction". The buttons are "Rotate
  left", "Rotate right" and "Face north". Each has a matching tooltip.
- **After a reload** the map faces north, since the bearing isn't in the
  address, and `?3d=1` tilts it as now.

## Constraints

- The contracts in `AGENTS.md` hold: DOM built with `h()` or nodes, no HTML
  interpolation, no style attributes (the needle's transform is set through
  the CSSOM), relative paths, and any new `js/` module in the modulepreload
  list.
- The arrows and needle are inline SVG built with DOM calls. Lucide has no
  matching icon, and the sprite isn't needed for them.
- The `PHONE` query in `js/ui.js` and the breakpoint in `style.css` stay in
  agreement.
- Tests use jsdom and the strict fake map. The fake map already has
  `easeTo`, `getBearing` and `getPitch`, and fires `moveend`. It will need
  `rotate` and `pitch` events, and a way to change the bearing and pitch as a
  gesture would, with an original event, so tests can tell the reader's
  moves from the page's.

## Reference mockups

The mockups from the design conversation are in
`.superpowers/brainstorm/3855014-1793547497/content/` (not committed):
`compass-capsule-v5.html` shows the compass and its states,
`compass-buttons-small.html` the 36 px column. The geometry above is the
source of truth.

## Calls made in the design conversation, not by the reader

These were proposed and not discussed further. Each is cheap to change.

- The 5° tilt that turns 3D on, and below which a tilt ends flat and turns 3D
  off.
- Tilting flat keeps the bearing, while the 3D button turned off still
  brings the map back to north.
- Turning 3D on by tilting keeps the reader's tilt rather than easing to 60°.
- Relying on MapLibre's 7° snap for "north-facing".
- The labels and tooltips.

## Left to the builder

- Where the code lives: a new function next to `mountTerrain` and
  `mountZoom` in `js/layers.js`, or a new module.
- How the compass learns the bearing and pitch: the `rotate` and `pitch`
  events, or `move`, and how `js/map.js` exposes them.
- How `setTerrain` splits into turning the terrain on or off and moving the
  camera, so a tilt by hand can turn 3D on without the 60° ease, and how
  `js/app.js` routes it through the same state, address and notice as the
  3D button.
- Whether a tilt turns 3D on while the gesture runs, once it passes 5°, or
  when it ends.
- Whether the phone compass appears during a twist once the bearing passes
  7°, or only when the twist ends.
- The easing duration for the rotate buttons and the reset.
- The focus outline inside the capsule.
- Checking the layer drawer's upward opening when the sidebar is open and the
  window is narrower than 810 px, since the column is shorter by 12 px and
  taller by the compass.
- Updating the main design document's controls lines for the desktop and the
  phone.
