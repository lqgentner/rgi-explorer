# Welcome, Help and Tour Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A first-visit welcome, a help button that brings it back, and a four-step guided tour of search, the glacier card, Use this data and 3D.

**Architecture:** Two new modules. `js/welcome.js` holds the welcome card and the help button. `js/tour.js` holds the tour: its steps, the popover placement and the target ring. Both know nothing about the app: `js/app.js` mounts them in `wire()` and passes callbacks for what only it knows (is a panel open, close it, open the sample glacier). `js/catalog.js` gains the glacier count.

**Tech Stack:** Plain ES modules, no build, no new library; jsdom + `node --test` with the fake map in `tests/helpers/browser.js`.

**Spec:** `docs/superpowers/specs/2026-11-02-welcome-tour-design.md`

## Global Constraints

- No new npm dependency; no inline script or style in `index.html` (CSP). Setting `node.style.*` from JS is fine, as `js/ui.js` `place()` does.
- DOM via `h()`, `svg()`, nodes or `textContent`; never HTML interpolation. Icons via `icon(name)`.
- Each new `js/` module goes in the `modulepreload` list in `index.html` (`page-assets.test.js` enforces it).
- One control for both layouts; `style.css` shows the layout's parts. Read `PHONE.matches` when needed and move nodes on `PHONE`'s `change` event. Breakpoint `max-width: 640px`.
- Asset paths relative.
- Copy, verbatim:
  - Welcome heading: `Explore the {count} glaciers of RGI {version}` (count via `formatInt`), or `Explore the glaciers of RGI {version}` without a count.
  - Welcome lines: `Search for a glacier or click one on the map.` and `New to RGI? ` + link `Read the user guide` → `https://rgidata.org/user_guide/` (new tab, external-link pattern).
  - Welcome button: `Take the tour`; close button `aria-label="Close"` with icon `x`. No "Start exploring".
  - Help button: icon `circle-question-mark`, `aria-label="Help"`.
  - Tour steps (title / text):
    1. `Search` / `Find a glacier by name or RGI ID, or jump to a place.`
    2. `The glacier card` / `Click a glacier to see its area, elevations and hypsometry. The ? next to a value explains it.`
    3. `Use this data` / `This map reads the cloud-native RGI catalog directly, with no download. Use this data shows how to read it in Python or QGIS.`
    4. `3D` / `See the terrain in 3D.`
  - Tour buttons: `Back`, `Next`, `Done` (last step), `Take me to a glacier`, close `aria-label="End tour"`; counter `{n} of 4`.
- Sample glacier: `SAMPLE_GLACIER = "RGI2000-v7.0-G-17-04760"` (Upsala Glacier) in `js/config.js`.
- Storage: `localStorage` key `rgi-explorer:welcome`, value `seen`; every access in try/catch.

## Review Focus

1. **Storage throws** (private mode, blocked site data): the welcome still shows, closes and starts the tour; nothing throws. Test in Task 2.
2. **Catalog without `table:row_count`**: the heading drops the number rather than showing "undefined" or "0". Tests in Tasks 1 and 2.
3. **The panel closes mid-tour** (the reader presses the card's Close during step 2 or 3): the tour falls back to step 2's waiting state instead of pointing at a removed node. Test in Task 4.
4. **A resize across the breakpoint while a step is open**: the step re-anchors to the layout's target (`#card` ↔ `#sheet`), and the help button moves between `#controls` and `#status`. Tests in Tasks 3 and 5.
5. **Help pressed during the tour or with a card open**: the tour ends, the card closes and the welcome shows; focus lands on the help button, not on a removed node. Test in Task 5.

---

### Task 1: The glacier count in the catalog

**Files:**
- Modify: `js/catalog.js` (`loadCatalog` return value)
- Test: `tests/catalog.test.js`

**Interfaces:**
- Produces: `catalog.glacierCount: number | null`, which is the glacier collection's data asset `table:row_count` when it is a positive integer, else `null`.

- [ ] **Step 1: Write the failing tests** in `tests/catalog.test.js`:
  - `test("reads the glacier count from the data asset's table:row_count")`: `(await loadCatalog(ROOT, fixtureFetch())).glacierCount === 274531`.
  - `test("the glacier count is null without a usable table:row_count")`: wrap `fixtureFetch()` so the glaciers collection's data asset has `table:row_count` deleted, and then set to `"many"`. Each time, `glacierCount === null`.
- [ ] **Step 2: Run** `node --test tests/catalog.test.js`. Expected: the two new tests FAIL.
- [ ] **Step 3: Implement** in `loadCatalog`: read the data asset of the glaciers collection (the same `roles` includes `"data"` lookup `toColumns` uses) and set `glacierCount` with `Number.isInteger(n) && n > 0 ? n : null`.
- [ ] **Step 4: Run** `node --test tests/catalog.test.js`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: read the glacier count from the catalog`.

### Task 2: The welcome card

**Files:**
- Create: `js/welcome.js`
- Modify: `js/ui.js`. Add `externalLink(href, text)`, moved from `js/card.js:45`, and make `js/card.js` import it.
- Modify: `index.html` (modulepreload `js/welcome.js`), `style.css` (new "Welcome" section)
- Test: `tests/welcome.test.js`, `tests/welcome-no-storage.test.js`

**Interfaces:**
- Consumes: `catalog.glacierCount`, `catalog.version` (Task 1).
- Produces:
  - `welcomeTitle(count: number|null, version: string) -> string`
  - `mountWelcome(root: Element, { title: string, autoShow: boolean, onTour: () => void }) -> { show(): void, dismiss(): void, readonly shown: boolean, readonly node: Element }`
    - On mount, shows itself when `autoShow` is true and storage doesn't hold `seen`.
    - `show()` shows it regardless of storage.
    - `dismiss()` hides it, and marks it `seen` only if it was showing.
    - The X and "Take the tour" both `dismiss()`. "Take the tour" then calls `onTour()`.
  - `externalLink(href, text) -> HTMLAnchorElement` from `js/ui.js`, unchanged markup.

- [ ] **Step 1: Write the failing tests** in `tests/welcome.test.js`. Use `loadPage()` and `load("js/welcome.js")`, and clear `window.localStorage` before each test.
  - `welcomeTitle(274531, "7.0") === "Explore the 274,531 glaciers of RGI 7.0"`, and `welcomeTitle(null, "7.0") === "Explore the glaciers of RGI 7.0"`.
  - With `autoShow: true` and empty storage, the node is not hidden. The heading has the title, and the node is a `section` with `aria-labelledby` pointing at the heading. The text contains both lines verbatim. The link `href === "https://rgidata.org/user_guide/"` has `target === "_blank"` and `rel === "noopener noreferrer"`. There's a button "Take the tour" and a button `[aria-label="Close"]`, and no button "Start exploring".
  - The X hides the node and leaves `localStorage["rgi-explorer:welcome"] === "seen"`. A second `mountWelcome` with `autoShow: true` stays hidden.
  - "Take the tour" hides the node, stores `seen` and calls `onTour` once.
  - With `autoShow: false`, the node is hidden. `dismiss()` stores nothing.
  - `show()` after `seen` shows the node.
- [ ] **Step 2: Write the failing test** in `tests/welcome-no-storage.test.js` (Review Focus 1). Before loading, replace `window.localStorage` with a getter that throws. `mountWelcome` with `autoShow: true` shows; X hides; mounting again shows again; nothing throws.
- [ ] **Step 3: Run** `node --test tests/welcome.test.js tests/welcome-no-storage.test.js`. Expected: FAIL (module missing).
- [ ] **Step 4: Implement** `js/welcome.js` (`welcomeTitle`, `mountWelcome`, and private `readSeen`/`writeSeen` in the style of `readSession`/`writeSession` in `js/layers.js:368`). Move `externalLink` into `js/ui.js`. Add `<link rel="modulepreload" href="js/welcome.js">`.
- [ ] **Step 5: Style** `.welcome` in `style.css`.
  - Desktop: `position: fixed`, under the search box (`top: calc(var(--search-top) + var(--search-h) + 12px)`, `left: 16px`, `width: 376px`, matching `#search`). Use `z-index: 3`, so the search results (z 4) draw over it. Use the card's surface, radius and shadow tokens.
  - Phone (in the existing `max-width: 640px` block): `bottom: 12px; left: 12px; right: 64px`, clear of the round buttons on the right.
  - `[hidden]` hides it.
- [ ] **Step 6: Run** `pixi run --locked test-js`. Expected: PASS, including `page-assets.test.js` and `card.test.js`.
- [ ] **Step 7: Commit** `feat: a first-visit welcome with the glacier count and the user guide`.

### Task 3: The help button

**Files:**
- Modify: `js/welcome.js`, `style.css`
- Test: `tests/welcome.test.js` (add), `tests/welcome-phone.test.js` (new, `loadPage({ phone: true })`)

**Interfaces:**
- Produces: `mountHelp({ desktop: Element, phone: Element }, { onHelp: () => void }) -> { button: HTMLButtonElement }`.
  - The button is `button.help-btn`, `type="button"`, `aria-label="Help"`, with `icon("circle-question-mark")`.
  - It's appended to `desktop` (`#controls`) when `!PHONE.matches`. Otherwise it's inserted at the start of `phone` (`#status`), before `.credits-box`.
  - It moves on `PHONE`'s `change`.
  - A click calls `onHelp()`.

- [ ] **Step 1: Write the failing tests.**
  - Desktop, in `tests/welcome.test.js`: the button is the last child of the `desktop` root. A click calls `onHelp` once. `page.setPhone(true)` moves it to be the first child of the `phone` root. `setPhone(false)` moves it back (Review Focus 4).
  - Phone, in `tests/welcome-phone.test.js`: mounted on a phone, it starts in the `phone` root, before `.credits-box`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement** `mountHelp` in `js/welcome.js`.
- [ ] **Step 4: Style.**
  - Desktop: `.help-btn` matches `.zoom-btn`/`.terrain-btn` sizing inside `#controls`.
  - Phone: a 44 px round button like `.credits-button`, sitting above the credits button with its right edge aligned and an 8 px gap. Because it lives in `#status`, it rides up with the sheet and fades and hides with the credits through the existing `body.card-open #status` rules (`style.css` around line 2098). No new lift rule.
  - `#status`'s published `--status-h` must not push the desktop `#controls`: on desktop the button isn't in `#status`.
- [ ] **Step 5: Run** `pixi run --locked test-js`. Expected: PASS (`status.test.js` included).
- [ ] **Step 6: Commit** `feat: a help button in the controls, beside the credits on the phone`.

### Task 4: The tour

**Files:**
- Create: `js/tour.js`
- Modify: `index.html` (modulepreload `js/tour.js`), `style.css` (new "Tour" section)
- Test: `tests/tour.test.js`

**Interfaces:**
- Produces:
  - `placeNear(target: {top,left,right,bottom,width,height}, box: {width,height}, viewport: {width,height}, sides: Array<"below"|"above"|"right"|"left">) -> {top: number, left: number, side: string}`
    - Pure function. For each side in order, place the box 12 px off the target on that side, centred on the other axis, then clamp the cross axis to 8 px inside the viewport.
    - Accept the first side where the box lies wholly within the viewport's 8 px margin. If none does, use `sides[0]` and clamp both axes.
  - `mountTour(root: Element, { anchor: (name: "search"|"panel"|"useData"|"terrain") => Element|null, panelOpen: () => boolean, onTakeMe: () => void, onEnd: () => void }) -> { start(): void, end(): void, refresh(): void, readonly running: boolean }`
- Behaviour:
  - Steps 1–4 use the global copy and anchors `search`, `panel`, `useData`, `terrain`. Their `sides` are:
    - `search`: `["below"]`
    - `panel` and `useData`: `["right","above","below"]`
    - `terrain`: `["left","below"]`
  - The popover is `div.tour[role="dialog"][aria-modal="false"][aria-labelledby=<title id>]` with `tabIndex = -1`. It holds the title (`h2`), the text, `"{n} of 4"`, Back (hidden on step 1), Next / Done / "Take me to a glacier", and the close button. `start()` and every step change focus it.
  - The current anchor gets class `tour-target`; the class leaves it on step change and on end.
  - **Step 2 waiting:** while `!panelOpen()`, step 2 shows "Take me to a glacier" in place of Next, and anchors to `search`. A click calls `onTakeMe()`. `refresh()` re-checks `panelOpen()`: open, step 2 anchors to `panel` and shows Next.
  - **Steps 3 and 4:** if `refresh()` finds `!panelOpen()` on step 3, the tour returns to step 2 waiting (Review Focus 3). Step 4 doesn't need a panel.
  - **Step 3:** a click on the `useData` anchor (a listener added for the step, removed after) ends the tour.
  - **Ending:** Done, the close button, Escape (keydown on `document` while running) and `end()` remove the popover and the ring and call `onEnd()` once.
  - **Re-placing:** `refresh()` re-anchors and re-places. The tour also re-places on `window` `resize`, on `PHONE` `change` and on `transitionend` bubbling to `document`, while running. Listeners are removed on end.

- [ ] **Step 1: Write the failing `placeNear` tests** in `tests/tour.test.js`. The viewport is 1024×768, the box 280×120.
  - A target at the top left: `["below"]` → `side "below"`, `top === target.bottom + 12`.
  - A target at the bottom: `["below","above"]` → `"above"`, `top === target.top - 12 - 120`.
  - A tall target (`#card`-like, 0..768 × 0..408): `["right","above","below"]` → `"right"`, `left === 420`, top clamped to `>= 8` and `top + 120 <= 760`.
  - Nothing fits → `sides[0]`, clamped inside the 8 px margin.
- [ ] **Step 2: Write the failing flow tests** in `tests/tour.test.js` with `loadPage()`. Use four plain `div` anchors appended to `body`, a mutable `open` flag behind `panelOpen`, and spies for `onTakeMe`/`onEnd`.
  - `start()` shows step 1: the title is "Search", "1 of 4", no visible Back, the `search` anchor has `.tour-target`, and `document.activeElement` is the popover.
  - **Waiting on step 2**, with `open = false`: Next moves to step 2. It shows "Take me to a glacier" and no Next. A click calls `onTakeMe` once.
  - **Panel opens on step 2:** set `open = true` and call `refresh()`. The `panel` anchor has the ring, Next shows, and the `search` anchor lost the ring.
  - **Panel closes on step 3** (Review Focus 3): set `open = false` and call `refresh()`. The tour is back on step 2 with "Take me to a glacier", and the `useData` anchor has no ring.
  - **Clicking Use this data:** on step 3, a click on the `useData` anchor ends the tour. The popover is gone, no node has `.tour-target`, `onEnd` was called once, and `running === false`.
  - **Done:** step 4 shows Done; Done ends the tour.
  - **Escape** ends the tour.
  - **Back:** Back from step 2 returns to step 1.
  - **Breakpoint** (Review Focus 4): the `panel` anchor function returns a different node when `PHONE.matches`. On step 2 with a panel open, `page.setPhone(true)` moves the ring to the phone node.
- [ ] **Step 3: Run** `node --test tests/tour.test.js`. Expected: FAIL (module missing).
- [ ] **Step 4: Implement** `js/tour.js`. Add the modulepreload.
- [ ] **Step 5: Style** `.tour`: popover surface, shadow, radius, about 280 px wide, `position: fixed`, `z-index` above `#card` and the sheet. Style `.tour-target`: `outline: 3px solid var(--accent)` with `outline-offset: 2px`, or `-3px` for `#card` and `#sheet`, which touch the viewport's edge.
- [ ] **Step 6: Run** `pixi run --locked test-js`. Expected: PASS.
- [ ] **Step 7: Commit** `feat: a four-step tour of search, the glacier card, its data and 3D`.

### Task 5: Wire the welcome, help and tour into the page

**Files:**
- Modify: `js/app.js` (`wire()`), `js/config.js` (`SAMPLE_GLACIER`)
- Modify: `js/card.js:99` and the complex panel's "Use this data" button in `js/complexcard.js`: add `data-tour="use-data"`.
- Modify: `scripts/make_fixture_parquet.py`. Add an Upsala row: `variant(4760, reg="17", glac_name="UPSALA GLACIER", display_name="Upsala Glacier", cenlon=-73.26, cenlat=-49.73, bbox={"xmin": -73.45, "ymin": -50.0, "xmax": -73.05, "ymax": -49.45})` in `glacier_rows()`. Fix any test that counts the fixture's glaciers.
- Test: `tests/app-welcome.test.js` (desktop), `tests/app-welcome-link.test.js`, `tests/app-welcome-phone.test.js`

**Interfaces:**
- Consumes:
  - `mountWelcome`, `welcomeTitle` and `mountHelp` (Tasks 2, 3)
  - `mountTour` (Task 4)
  - `catalog.glacierCount` (Task 1)
  - `openGlacier`, `closeGlacier`, `closeComplex`, `shown`, `shownComplex`, `glaciers.index()` and `ALWAYS`, all already in `wire()`
- Wiring in `wire()`:
  - `welcome = mountWelcome(el("sidebar"), { title: welcomeTitle(catalog.glacierCount, catalog.version), autoShow: !state.glacier && !state.complex, onTour: () => tour.start() })`.
    Read `autoShow` from the state at wire time, before the link's glacier opens.
  - `tour = mountTour(document.body, { … })`, with:
    - `anchor`:
      - `search` → `el("search")`
      - `panel` → `PHONE.matches ? el("sheet") : el("card")`
      - `useData` → `document.querySelector(PHONE.matches ? '#sheet [data-tour="use-data"]' : '#card [data-tour="use-data"]')`
      - `terrain` → `document.querySelector(".terrain-btn")`
    - `panelOpen` → `Boolean(shown || shownComplex)`
    - `onTakeMe` → `glaciers.index()`, then `byId.get(SAMPLE_GLACIER)`, then `openGlacier({ rgiId: SAMPLE_GLACIER, row }, ALWAYS)` if found. Otherwise `console.warn` only.
    - `onEnd` → `help.button.focus()`
  - `help = mountHelp({ desktop: el("controls"), phone: el("status") }, { onHelp })`. Mount it after `mountZoom` so it's last in `#controls`. `onHelp` does, in order:
    1. `tour.end()` if running
    2. `closeGlacier()` if `shown`, else `closeComplex()` if `shownComplex`
    3. `welcome.show()`
    4. `help.button.focus()`
  - `openGlacier` and `openComplex` call `welcome.dismiss()` and then `tour.refresh()`. `closeGlacier` and `closeComplex` call `tour.refresh()`.

- [ ] **Step 1: Write the failing desktop scenario** in `tests/app-welcome.test.js`. It's one page, tests in order. Clear storage first, then `loadPage({ fetch: servedFetch(makeParquet()) })` and `load("js/app.js")`.
  - **First visit:** `#sidebar .welcome` shows `Explore the 274,531 glaciers of RGI 7.0`, and `#controls` ends with `button.help-btn`.
  - **Opening a glacier:** the search pick of "Grosser Aletsch Gletscher" (as in `tests/app-phone.test.js`) hides the welcome and stores `seen`.
  - **Help with a card open** (Review Focus 5): the card closes (`#card` hidden, `?glacier=` gone from `location.search`), the welcome shows, and `document.activeElement` is the help button.
  - **The tour:** "Take the tour" starts it, with step 1 ringing `#search`. On Next, step 2 waits, since no panel is open. "Take me to a glacier" opens Upsala: wait for `location.search` to contain `glacier=RGI2000-v7.0-G-17-04760`. The step then rings `#card` and shows Next.
  - **Step 3** rings `#card [data-tour="use-data"]`. Clicking it ends the tour and opens the Use this data dialog.
  - **Help during the tour** (Review Focus 5): restart the tour and press Help on step 2. The tour popover is gone, the card is closed and the welcome shows.
- [ ] **Step 2: Write the failing link test** in `tests/app-welcome-link.test.js`: `?glacier=RGI2000-v7.0-G-11-02596` with empty storage. After the card opens, the welcome is hidden and storage holds no `seen`.
- [ ] **Step 3: Write the failing phone test** in `tests/app-welcome-phone.test.js`, with `loadPage({ phone: true, … })`:
  - The help button is in `#status` before `.credits-box`.
  - After a glacier opens, the tour's step 2 rings `#sheet`.
  - `page.setPhone(false)` moves the ring to `#card` and the help button to `#controls` (Review Focus 4).
- [ ] **Step 4: Run** `node --test tests/app-welcome*.test.js`. Expected: FAIL.
- [ ] **Step 5: Implement** the wiring, `SAMPLE_GLACIER`, the `data-tour` attributes and the fixture row.
- [ ] **Step 6: Run** `pixi run --locked test`. Expected: Python OK, JavaScript 0 fail.
- [ ] **Step 7: Check it in a real browser.**
  - Use Playwright's cached Chromium (`~/.cache/ms-playwright`) with `playwright-core` installed in the scratchpad only, not the repo.
  - Serve with `pixi run --locked serve -- --port <free> --catalog-dir ../rgi-catalog/catalog --catalog-dir ../rgi-catalog/staging`. Open `?catalog=catalog/catalog.json` in a fresh context.
  - Screenshot at 1280×900 and at 390×844:
    - the welcome
    - each tour step, including step 2 waiting and after "Take me to a glacier"
    - Help with a card open
  - Confirm the welcome doesn't cover the search box or the round buttons, and that each tour popover sits fully inside the viewport next to its target.
- [ ] **Step 8: Commit** `feat: show the welcome, help and tour on the page`.
