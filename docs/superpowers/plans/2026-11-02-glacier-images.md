# Glacier Images Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the glacier card's photo carousel with a strip that always
starts with the Esri crop and is followed by the photos. Add a full-screen
viewer, matching corners, and a sidebar that leaves room for its scrollbar.

**Architecture:** `js/strip.js` is a generic horizontal scroll-snap strip of
keyed tiles that reuses a tile's element while its key stays the same.
`js/viewer.js` is a generic modal `<dialog>` that loads each image's larger
file only when it is shown. `js/card.js` and `js/complexcard.js` turn the
crop and the photos into strip and viewer items, so all Esri and Commons
knowledge stays in `card.js` and `photo.js`. `style.css` styles one DOM for
both layouts: an inset strip with rounded corners on the phone, and a full
bleed strip under the search bar on the desktop.

**Tech Stack:** Vanilla ES modules, no build. `node --test` with jsdom
through `tests/helpers/browser.js`, run in the pixi environment.

**Spec:** `docs/superpowers/specs/2026-11-02-glacier-images-design.md`. Read
it before starting, and read `AGENTS.md`.

## Global Constraints

- No new libraries. The viewer is a native `<dialog>`, opened with
  `showModal()` when it exists and the `open` attribute otherwise, as
  `js/usedata.js` does.
- Build DOM with `h()` from `js/ui.js`, which takes `style` as an object
  only. Commons text enters as text.
- Use icons through `icon(name)`: `chevron-left`, `chevron-right` and `x`.
- Add each new module to the `modulepreload` list in `index.html`, before
  `js/card.js`. `page-assets.test.js` enforces this.
- Build one DOM for both layouts. Code reads `PHONE.matches` when it needs it
  and reacts to `PHONE`'s `change` event.
- No new CSP host. Thumbnails come from `thumb.wikimedia.org`, and the crops
  come from `server.arcgisonline.com`.
- `--radius: 16px` for the buttons and the phone strip, and
  `--tile-radius: 12px` for the stat tiles and the member table. The phone
  strip is 180px high, with 16px gutters, an 8px
  gap and an 8px sliver. The desktop photo is 280px high. Chips are inset
  8px, with 8px corners, 11px text and 16px lines. `PHONE_CROP` is
  `{ size: [720, 360], top: 0 }`. Viewer photos are 1600px wide, and the
  Esri export is capped at 4096px.
- Credit copy. A photo reads "Author · License". The imagery reads "Esri,
  Vantor, Earthstar Geographics", then "Esri, provider, imaged D Mon YYYY".
- Run commands from the repository root:
  - one file: `pixi run --locked node --test tests/<file>.test.js`
  - everything: `pixi run --locked test`
- End each commit message with
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Opening another glacier after browsing to image 3.** The new glacier
   starts at its first image. Tested in Task 5.
2. **A photo whose thumbnail fails to load.** It drops out of the strip, and
   the counters and arrows recount. Tested in Task 5.
3. **Browser zoom changes the scrollbar's width.** `--scrollbar` is measured
   again on `resize`. Tested in Task 3.
4. **The viewer opened from the keyboard.** Enter on a tile opens it, and Esc
   closes it and returns focus to that tile. Tested in Task 6.
5. **Crossing the breakpoint with the viewer open.** The viewer stays open on
   the same image. Tested in Task 6.

---

### Task 1: Commons credits read `Attribution`, keep the file name, and fetch a larger thumbnail

**Files:**
- Modify: `js/photo.js` (`commonsCredits`, new `commonsThumb`)
- Test: `tests/photo.test.js`

**Interfaces:**
- Produces:
  - `commonsCredits(files, opts)`: each photo gains `file: string`, the
    normalised name without `File:`.
  - Its `author` becomes `textOf(Attribution) || textOf(Artist)`.
  - `commonsThumb(file: string, width: number, { fetch?, signal? } = {}) -> Promise<string | null>`.

- [ ] **Step 1: Write the failing tests** in `tests/photo.test.js`:

```js
test("a file's Attribution wins over its Artist, and an empty one falls back", async () => {
  const page = (title, meta) => ({ title, imageinfo: [{ thumburl: `https://thumb.wikimedia.org/${title}`, extmetadata: meta }] });
  const data = { query: { pages: {
    1: page("File:A.jpg", { Artist: { value: "Ann" }, Attribution: { value: "Photo: Ann Example / Agency" } }),
    2: page("File:B.jpg", { Artist: { value: "Bob" }, Attribution: { value: "  " } }),
  } } };
  const [a, b] = await commonsCredits([{ file: "A.jpg", item: "Q1" }, { file: "B.jpg", item: "Q2" }], { fetch: json(data) });
  assert.equal(a.author, "Photo: Ann Example / Agency");
  assert.equal(b.author, "Bob");
  assert.equal(a.file, "A.jpg");
});

test("commonsThumb asks for one file at the given width and returns its thumbnail", async () => {
  const calls = [];
  const fetch = async (url) => { calls.push(new URL(url)); return { ok: true, json: async () => ({ query: { pages: { 1: { imageinfo: [{ thumburl: "https://thumb.wikimedia.org/big.jpg" }] } } } }) }; };
  assert.equal(await commonsThumb("Glacier d'Aletsch - 2021.jpg", 1600, { fetch }), "https://thumb.wikimedia.org/big.jpg");
  assert.equal(calls[0].searchParams.get("titles"), "File:Glacier d'Aletsch - 2021.jpg");
  assert.equal(calls[0].searchParams.get("iiurlwidth"), "1600");
  assert.equal(calls[0].searchParams.get("iiprop"), "url");
  assert.equal(calls[0].searchParams.get("origin"), "*");
});

test("commonsThumb resolves to null on an error or a missing thumbnail", async () => {
  assert.equal(await commonsThumb("A.jpg", 1600, { fetch: async () => ({ ok: false, status: 500 }) }), null);
  assert.equal(await commonsThumb("A.jpg", 1600, { fetch: json({ query: { pages: {} } }) }), null);
});
```

  Import `commonsThumb` alongside `commonsCredits`. The `json(data)` helper
  already exists in this file.

- [ ] **Step 2: Run** `pixi run --locked node --test tests/photo.test.js`.
  Expected: the three new tests FAIL.
- [ ] **Step 3: Implement it in `js/photo.js`.**
  - In `commonsCredits`, `author` prefers a non-empty `Attribution`, and each
    photo carries `file: normalName(file)`.
  - `commonsThumb` sends one `imageinfo` request with the same parameters
    `commonsCredits` uses, but `iiprop=url`. It catches every error and
    returns `null`.
- [ ] **Step 4: Run** the same command. Expected: all PASS.
- [ ] **Step 5: Commit:** `git add js/photo.js tests/photo.test.js && git commit -m "feat: credit a photo's required attribution and fetch a larger thumbnail"`

---

### Task 2: Matching corners, with the stat tile's ⓘ concentric

**Files:**
- Modify: `style.css`:
  - `:root`: new `--radius: 16px` and `--tile-radius: 12px`;
  - `.btn`, `.key-tile`, `.members-scroll` and `.key-tile .info`.
- Test: `tests/card.test.js`

**Interfaces:**
- Produces: the CSS custom property `--radius`, which Task 5 uses for the
  phone strip.

- [ ] **Step 1: Write the failing test** in `tests/card.test.js`:

```js
test("the buttons take the outer radius, the tiles and table the tile radius, and the ⓘ sits concentric", () => {
  const css = fs.readFileSync(new URL("../style.css", import.meta.url), "utf8");
  const rule = (sel) => new RegExp(`(^|\\n)${sel}\\s*{([^}]*)}`).exec(css)?.[2] ?? "";
  assert.match(css, /--radius:\s*16px/);
  assert.match(css, /--tile-radius:\s*12px/);
  assert.match(rule("\\.btn"), /border-radius:\s*var\(--radius\)/);
  for (const sel of ["\\.key-tile", "\\.members-scroll"]) assert.match(rule(sel), /border-radius:\s*var\(--tile-radius\)/, sel);
  const info = rule("\\.key-tile \\.info");
  for (const side of ["right", "bottom"]) assert.match(info, new RegExp(`${side}:\\s*calc\\(var\\(--tile-radius\\) - 1px - 7px\\)`), side);
});
```

- [ ] **Step 2: Run** `pixi run --locked node --test tests/card.test.js`.
  Expected: FAIL.
- [ ] **Step 3: Change the CSS.**
  - Add the two properties to `:root`.
  - `.btn` gets `border-radius: var(--radius)`.
  - `.key-tile` and `.members-scroll` get `border-radius: var(--tile-radius)`.
  - `.key-tile .info` gets
    `right: calc(var(--tile-radius) - 1px - 7px); bottom: calc(var(--tile-radius) - 1px - 7px)`.
    That is 4px, centring the 14px icon on the corner's inner curve.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Check by eye** with `pixi run --locked serve`: the ⓘ sits an
  even distance from the corner's curve.
- [ ] **Step 6: Commit:** `git commit -am "feat: match the card's corners and centre each tile's ⓘ in its corner"`

---

### Task 3: The sidebar leaves room for its scrollbar

**Files:**
- Modify: `style.css`:
  - `:root`: `--scrollbar: 0px`, and
    `--sidebar-w: calc(var(--card-w) + var(--scrollbar))`;
  - `#card`: `width: var(--sidebar-w)` and `scrollbar-gutter: stable`;
  - `body.card-open #status`: `max-width: calc(100% - var(--sidebar-w))`;
  - `body.card-open #layers`: `left: calc(var(--sidebar-w) + 16px)`.
- Modify: `js/ui.js` (new `scrollbarWidth`) and `js/app.js` (measure the
  width, and the `padding()` left value)
- Test: create `tests/app-scrollbar.test.js`, and modify `tests/card.test.js`
  ("the card column rises above…")

**Interfaces:**
- Produces: `scrollbarWidth(node: HTMLElement) -> number`, which is
  `Math.max(0, node.offsetWidth - node.clientWidth)`.
- Produces: `--scrollbar` on `document.documentElement.style`, set in pixels.

- [ ] **Step 1: Write the failing tests.**

  In `tests/card.test.js`, the existing test changes to
  `assert.match(css, /#card\s*{[^}]*width:\s*var\(--sidebar-w\)/)` and adds
  `assert.match(css, /#card\s*{[^}]*scrollbar-gutter:\s*stable/)`.

  Create `tests/app-scrollbar.test.js`, following
  `tests/app-glacier-view.test.js`:

```js
test("the sidebar measures its scrollbar, keeps it outside the content and fits the map past it", async () => {
  const page = await loadPage({ url: `https://lqgentner.github.io/rgi-explorer/?glacier=${ID}`, fetch: servedFetch(makeParquet()) });
  globalThis.hyparquet = hyparquet;
  const card = page.document.getElementById("card");
  let outer = 423;
  Object.defineProperty(card, "offsetWidth", { get: () => outer });
  Object.defineProperty(card, "clientWidth", { get: () => 408 });
  await load("js/app.js");
  const root = page.document.documentElement;
  await waitFor(() => page.map.lastFit);
  assert.equal(root.style.getPropertyValue("--scrollbar"), "15px");
  assert.equal(page.map.lastFit.options.padding.left, 408 + 15 + 24);
  outer = 425;
  page.window.dispatchEvent(new page.window.Event("resize"));
  assert.equal(root.style.getPropertyValue("--scrollbar"), "17px", "zoom changes the width, so a resize measures again");
  page.setPhone(true);
  assert.equal(root.style.getPropertyValue("--scrollbar"), "0px", "the phone has no sidebar");
});
```

- [ ] **Step 2: Run** `pixi run --locked node --test tests/app-scrollbar.test.js tests/card.test.js`.
  Expected: FAIL.
- [ ] **Step 3: Implement it.**
  - Add `scrollbarWidth` to `js/ui.js`.
  - In `js/app.js`, write a `measureScrollbar()` that sets `--scrollbar` to
    `scrollbarWidth(el("card"))` on the desktop and to `0` on the phone.
  - Call it at mount, on `window` `resize`, and on `PHONE` `change`.
  - `padding()` uses `CARD_WIDTH + scrollbarWidth(el("card"))` while a panel
    is shown.
  - Apply the CSS changes in this task's Files list.
- [ ] **Step 4: Run** the same command, then `pixi run --locked node --test tests/app.test.js tests/app-complex.test.js`.
  Expected: all PASS. Their `408 + 24` paddings still hold, because jsdom's
  widths are 0.
- [ ] **Step 5: Commit:** `git add -A style.css js/ui.js js/app.js tests/app-scrollbar.test.js tests/card.test.js && git commit -m "fix: keep the sidebar's scrollbar outside its content"`

---

### Task 4: The strip module

**Files:**
- Create: `js/strip.js`
- Modify: `index.html` (add `<link rel="modulepreload" href="js/strip.js" />`
  before `js/card.js`)
- Test: create `tests/strip.test.js`

**Interfaces:**
- Produces:

```js
/** @typedef {{ key: string, src: string, alt: string, credit: () => Node, className?: string, onError?: () => void }} StripItem */
export function mountStrip(photo /* HTMLElement */, { label /* string */, onOpen /* (index, button) => void */ }) -> {
  update(items: StripItem[]): void,
  show(index: number, { smooth = false } = {}): void,
  readonly index: number,
}
```

- **DOM inside `photo`:**
  - `div.strip` (`role="group"`, `aria-label=label`) holds one
    `div.strip-tile[data-key]` per item.
  - Each tile holds a `button.strip-open` (`type=button`,
    `aria-label="Open image i of N"`) wrapping the `img`, then the item's
    credit node, then `span.photo-count` "i / N" when N > 1.
  - The `img` takes `item.className` and `alt`. The first image is eager and
    the rest have `loading="lazy"`. Its `error` event calls `item.onError`.
  - After the strip come `button.icon-button.photo-prev` and `.photo-next`
    (`aria-label` "Previous image" and "Next image"), with `chevron-left`
    and `chevron-right`.
- **`update`:**
  - A tile whose key is unchanged keeps its element.
  - A changed `src` is set on the same `img`, and that tile's credit is
    replaced by a fresh `item.credit()`.
  - `credit()` is called only when a tile is created or its `src` changes.
  - Tiles whose key is gone are removed, and the tiles are put in the items'
    order.
  - Counters and labels are rewritten, `index` is clamped, and the arrows
    refresh.
- **Arrows:** both are hidden when N < 2. `prev` is hidden at 0, and `next`
  at N − 1. A click sets `index` right away and calls `show(index ± 1, { smooth: true })`.
- **`show(i)`:** clamps `i`, sets `index`, and scrolls the strip so tile `i`
  is centred:
  `left = tile.offsetLeft + tile.offsetWidth / 2 - strip.clientWidth / 2`.
  It uses `strip.scrollTo({ left, behavior: smooth ? "smooth" : "instant" })`
  when that exists and sets `scrollLeft` otherwise. `.strip` is
  `position: relative`, so `offsetLeft` is measured from the strip.
- **Scroll:** a passive `scroll` listener sets `index` to the tile whose
  centre is nearest the strip's centre. It does nothing while
  `strip.clientWidth === 0`, which is always the case in jsdom.
- **`PHONE` `change`:** calls `show(index)` without animation.
- **Click on `button.strip-open`:** calls `onOpen(i, button)`. Credit links
  sit outside the button, so a click on one never opens the viewer.

- [ ] **Step 1: Write the failing tests** in `tests/strip.test.js`. Use
  `loadPage()`, mount on a fresh `div` per test, and use a helper
  `item(key, src = \`https://x/${key}.jpg\`)` that counts its `credit()`
  calls. The tests:
  - **"a tile per item in order, with a counter only from two images":**
    one item gives no `.photo-count`. Three items give counters "1 / 3",
    "2 / 3" and "3 / 3", and the `data-key` order matches.
  - **"an update keeps an unchanged key's tile and image and appends new
    ones":** after `update([a])` then `update([a, b, c])`, the first tile
    and its `img` are the same nodes (`assert.equal`), and `a.credit` was
    called once.
  - **"a changed src updates the same image and asks for a new credit":**
    `update([a])`, then `update([{ ...a, src: "https://x/a2.jpg" }])`. The
    same `img` now has the new `src`, and `credit` was called twice.
  - **"only the first image loads eagerly":** `loading` is `"lazy"` on images
    2 and up and absent on the first.
  - **"the arrows show only from two images and hide at the ends":**
    - With one item, both are hidden.
    - With three, at first `prev` is hidden and `next` is not.
    - Click `next` twice: `strip.index === 2`, `next` is hidden, and `prev`
      is not.
    - The arrows hold `use[href$="#chevron-left"]` and
      `use[href$="#chevron-right"]`.
  - **"a click on an image opens it at its index; a credit link does not":**
    the credit is
    `() => h("div", { class: "photo-credit" }, h("a", { href: "https://c" }, "x"))`.
    - Clicking the second `button.strip-open` gives
      `onOpen(1, thatButton)`.
    - Clicking the `a` gives no call.
  - **"a change of layout keeps the shown image and re-centres it at once":**
    stub `strip.scrollTo` to record its argument. `show(2)`, then
    `setPhone(true)`. `index` is 2, and the last recorded `behavior` is
    `"instant"`. Call `setPhone(false)` afterwards.
  - **"an update clamps the index":** `show(2)`, then `update([a])`.
    `index` is 0.
- [ ] **Step 2: Run** `pixi run --locked node --test tests/strip.test.js`.
  Expected: FAIL (the module is missing).
- [ ] **Step 3: Implement `mountStrip` in `js/strip.js`**, as the Interfaces
  block above says. Add the `modulepreload` line.
- [ ] **Step 4: Run** `pixi run --locked node --test tests/strip.test.js tests/page-assets.test.js`.
  Expected: PASS.
- [ ] **Step 5: Commit:** `git add js/strip.js index.html tests/strip.test.js && git commit -m "feat: a swipeable image strip of keyed tiles"`

---

### Task 5: The card and the complex panel use the strip, styled for both layouts

**Files:**
- Modify: `js/card.js`:
  - `imageryCrop` is replaced by `imageryItem` and `imageryCredit`;
  - add `photoItem`;
  - `carousel()` is removed;
  - `renderPhotoArea()` and `open()` change.
- Modify: `js/complexcard.js` (`renderPhoto()`), and `js/app.js`
  (`PHONE_CROP`)
- Modify: `style.css`: the photo area, the strip, the chips, the counter and
  the arrows. Remove `.card .photo > img` and the old flush `.photo-credit`
  rule.
- Test: `tests/card.test.js`, `tests/complexcard.test.js`, `tests/app.test.js`

**Interfaces:**
- Consumes: `mountStrip` (Task 4), `--radius` (Task 2), and `photo.file`
  (Task 1).
- Produces, from `js/card.js`:
  - `imageryCredit(bbox, size: [number, number], top: number) -> HTMLElement`
    builds a `.photo-credit` reading "Esri, Vantor, Earthstar Geographics"
    and replaces its text when `findCropSource(bbox, ...size, top)` answers.
    This is today's logic, moved out of `imageryCrop`.
  - `imageryItem(bbox, { crop = CROP, alt, onError }) -> StripItem` has key
    `"imagery"`, `src: esriCrop(bbox, ...crop.size, crop.top)` and
    `className: "photo-crop"`, and its credit is
    `() => imageryCredit(bbox, crop.size, crop.top)`.
  - `photoItem(photo, { alt, onError }) -> StripItem` has key `photo.page` and
    `src: photo.src`. Its credit is a `div.photo-credit.photo-credit-photo`.
    Inside it, `span.credit-author` holds the author linked to `photo.page`,
    then " · ", then the license linked to `licenseUrl`. Use
    `isHttp()`-guarded links, as today. With no author it shows the license
    alone.
  - `mountCard`'s state:
    `current.photos = { photos, cropFailed, failed: Set<string> }`. The
    `index` field goes, because the strip holds it.
- `PHONE_CROP` in `js/app.js` becomes `{ size: [720, 360], top: 0 }`.

- [ ] **Step 1: Write the failing tests.**

  In `tests/card.test.js`, `PHOTOS` is two photo objects shaped as
  `commonsCredits` returns them, with `src` values on `https://thumb.wikimedia.org/`:
  - **"the imagery is the first image and keeps its element when photos
    arrive":**
    - Open with a deferred `photos`. Hold
      `root.querySelector(".strip-tile img.photo-crop")`.
    - Resolve the photos with `PHOTOS` and `settle()`.
    - The same node is still the first tile's image, there are three tiles,
      and the first counter reads "1 / 3".
  - **"a photo credits its author linked to Commons and its license linked
    to its deed":**
    - The second tile's `.credit-author a` has `href === PHOTOS[0].page` and
      text `PHOTOS[0].author`.
    - The next link has `href === PHOTOS[0].licenseUrl` and text
      `PHOTOS[0].license`.
    - The credit's text contains " · ".
  - **"a photo without an author credits its license alone":** the credit's
    text equals the license.
  - **"a failed crop with photos leaves the photos; without photos the
    placeholder shows":**
    - Dispatch `error` on `img.photo-crop`.
    - With `PHOTOS`: no `.photo-crop`, two tiles, and no visible
      `.photo-placeholder`.
    - With `[]`: no tile, and a visible `.photo-placeholder`.
  - **"a photo whose thumbnail fails drops out and the rest recount"**
    (Review Focus 2): dispatch `error` on the second tile's image. Two tiles
    remain, and the counters read "1 / 2" and "2 / 2".
  - **"a new glacier starts at its first image"** (Review Focus 1): open,
    resolve `PHOTOS`, click `.photo-next` twice, then open `IDS[1]`.
    `root.querySelector(".photo-prev").hidden` is `true`.
  - **"a change of layout re-frames the crop in the same image":**
    - Use `setup({ get crop() { return PHONE_NOW ? { size: [720, 360], top: 0 } : { size: [816, 560], top: 144 }; } })`.
    - Hold the `img.photo-crop`.
    - Inside `onPhone(...)`, with `PHONE_NOW` set alongside, the same node's
      `src` contains `size=720,360`.
  - **"the desktop arrows are centred between the search bar and the credit
    row":** the CSS contains:
    - `#search { top: var(--search-top) }`;
    - `#search input { height: var(--search-h) }`;
    - for `.photo-prev`, a `top: calc(` that uses `--search-top`,
      `--search-h`, `--photo-h`, `--credit-inset` and `--credit-row`.

  In `tests/complexcard.test.js`:
  - **"the complex shows its crop as one image with no counter or arrows":**
    one `.strip-tile`, no `.photo-count`, and both arrows hidden.

  In `tests/app.test.js`, the photo-lookup test's last assertion becomes
  `$("#card .photo img:not(.photo-crop)").getAttribute("src")`.

- [ ] **Step 2: Run** `pixi run --locked node --test tests/card.test.js tests/complexcard.test.js`.
  Expected: the new tests FAIL.
- [ ] **Step 3: Implement it in `js/card.js` and `js/complexcard.js`.**
  - `mountStrip(photo, { label: "Glacier images", onOpen: () => {} })` is
    created once, after `cardFrame`. Task 6 wires `onOpen`.
  - A `div.photo-placeholder`, created once, sits in `photo` next to it.
  - **`renderPhotoArea()`:**
    - `items` is the `imageryItem` when there is a bbox and the crop has not
      failed, then `photoItem` for each photo not in `failed`;
    - then `strip.update(items)`;
    - `placeholder.hidden = !(cropFailed && !visiblePhotos.length)`.
  - **`open()`:** calls `strip.show(0)` after the first render.
  - **`PHONE` `change`:** with a card open, it calls `renderPhotoArea()`.
    `ctx.crop` then answers for the new layout, and the strip swaps the
    `src`.
  - **Complex panel:** the same with label "Complex image", and only the
    imagery item.
- [ ] **Step 4: Style it in `style.css`.** Values come from Global
  Constraints.
  - **Custom properties:** add `--search-top: 16px` and `--search-h: 48px`
    to `:root`, and use them in `#search` and `#search input`. Add
    `--photo-h: 280px`, `--credit-inset: 8px` and `--credit-row: 20px`.
  - **The strip:** `.card .photo` has `height: var(--photo-h)`. `.strip`
    fills it.
    - It uses flex, `overflow-x: auto`, `scroll-snap-type: x mandatory` and
      `overscroll-behavior-x: contain`.
    - Its scrollbar is hidden with `scrollbar-width: none` and
      `::-webkit-scrollbar { display: none }`.
    - It has `position: relative` and
      `touch-action: pan-x pan-y pinch-zoom`.
  - **Tiles:** `.strip-tile` is `flex: 0 0 100%` with
    `scroll-snap-align: start`. Its image uses `object-fit: cover`.
    `.strip-open` is a reset, full-size button.
  - **Credit chip:** `.photo-credit` is absolute at
    `left: var(--credit-inset)` and `bottom: var(--credit-inset)`, with
    `max-width: calc(100% - 2 * var(--credit-inset) - 48px)`.
    - It has 8px corners, `--glass`, 11px text on 16px lines,
      `padding: 2px 8px`, and wraps.
    - `.credit-author` is `inline-block`, `max-width: 100%`, `nowrap` and
      `text-overflow: ellipsis`. The author is cut only past a full line, and
      the license wraps under it.
  - **Counter:** `.photo-count` sits at the bottom right with the same inset,
    in dark glass `rgb(32 33 36 / 62%)` with white text.
  - **Desktop arrows:**
    `top: calc((var(--search-top) + var(--search-h) + var(--photo-h) - var(--credit-inset) - var(--credit-row)) / 2)`.
    They show under `.photo:is(:hover, :focus-within)` and are hidden
    otherwise (`opacity`, keeping the `hidden` attribute for the ends).
  - **Phone** (inside the existing `@media (max-width: 640px)`):
    - `--photo-h: 180px`. The photo has no background.
    - `.strip` gets `gap: 8px` and `padding: 0 16px`.
    - `.strip-tile` gets `border-radius: var(--radius)`,
      `overflow: hidden` and `scroll-snap-align: center`.
    - The arrows get `display: none`.
- [ ] **Step 5: Run** `pixi run --locked test`. Expected: all PASS.
- [ ] **Step 6: Check it by eye.** Run `pixi run --locked serve` and open
  Great Aletsch.
  - On the desktop, the crop shows first and the photos join without the
    crop moving.
  - The arrows appear on hover, centred.
  - In the phone emulator, the strip is inset with the sliver, and a swipe
    scrolls it without moving the sheet.
- [ ] **Step 7: Commit:** `git add -A js/card.js js/complexcard.js js/app.js style.css tests && git commit -m "feat: put the imagery first in a swipeable strip, inset on the phone"`

---

### Task 6: The viewer

**Files:**
- Create: `js/viewer.js`
- Modify: `index.html` (`modulepreload` before `js/card.js`), `js/card.js`
  and `js/complexcard.js` (`onOpen`), and `style.css` (the viewer)
- Test: create `tests/viewer.test.js`, and modify `tests/card.test.js` and
  `tests/app.test.js`

**Interfaces:**
- Consumes: `mountStrip`'s `onOpen(index, button)` and `show(index)` (Task
  4), `commonsThumb` (Task 1), and `imageryCredit` (Task 5).
- Produces:

```js
/** @typedef {{ alt: string, thumb?: string, large: (size: [number, number]) => Promise<string | null> | string | null, credit: (size: [number, number]) => Node }} ViewerItem */
export function openViewer(items: ViewerItem[], index: number, { onClose /* (index) => void */, returnFocus /* HTMLElement */ }) -> void
export function viewerCropSize(width: number, height: number, { scale = 2, max = 4096 } = {}) -> [number, number]
```

- `viewerCropSize` returns `[width, height] × scale`, scaled down evenly so
  the longest side is at most `max`, with each side rounded.
- **The dialog:** one `dialog.viewer` is created on first use and appended
  to `document.body`, outside `#sheet`. It holds:
  - `button.icon-button.viewer-close` (`x`, "Close");
  - `div.viewer-track`, a scroll-snap scroller like the strip, with one
    `figure.viewer-slide` per item: an `img`, a `figcaption.viewer-credit`
    and a `span.photo-count` "i / N";
  - `button.viewer-prev` and `.viewer-next`, with the chevrons.
  `openViewer` rebuilds the slides.
- **The size:** each slide's size is `viewerCropSize(innerWidth, innerHeight)`.
- **When a slide becomes current** (at open, and after each move), and only
  once per slide:
  - its `img.src` is `thumb` until `large(size)` resolves;
  - a non-null result replaces it, and a null keeps the thumbnail;
  - with no `thumb`, the image stays empty on a dark background;
  - the caption is `credit(size)`, built at the same moment.
- **Moving:** ArrowLeft and ArrowRight on the dialog move to the previous or
  next image. Swiping scrolls the track, and a `scroll` listener updates the
  current slide as the strip does. The arrows hide at the ends.
- **Closing:** Escape (`keydown`, plus `cancel` with `preventDefault`, as in
  `js/usedata.js`) and ✕ both close the viewer. Closing calls
  `onClose(current)` and then `returnFocus?.focus()`.
- **Card wiring:** `onOpen(i, button)` calls
  `openViewer(viewerItems(), i, { onClose: (j) => strip.show(j), returnFocus: button })`.
  The items follow the strip's order:
  - **Imagery:**
    `{ alt, large: (size) => esriCrop(bbox, ...size, 0), credit: (size) => imageryCredit(bbox, size, 0) }`.
  - **Photo:**
    `{ alt, thumb: p.src, large: () => commonsThumb(p.file, 1600), credit: () => fullCredit(p) }`.
    `fullCredit` is a `div` holding the author, the license linked, the
    source text (`p.source`), and an `a` "View on Commons" linking to
    `p.page`.

- [ ] **Step 1: Write the failing tests** in `tests/viewer.test.js`. Use
  `loadPage()`. The items are fakes that record their `large` and `credit`
  calls.
  - **"viewerCropSize doubles the CSS size and keeps the longest side within
    4096":** `viewerCropSize(1000, 600)` gives `[2000, 1200]`, and
    `viewerCropSize(3000, 1000)` gives `[4096, 1365]`.
  - **"the viewer opens at the given image with its counter":** after
    `openViewer(items3, 1, …)`, `dialog.viewer` is open and the current
    slide's counter is "2 / 3".
  - **"only the shown image asks for its large file, once":**
    - After open, only item 1's `large` was called, with
      `viewerCropSize(innerWidth, innerHeight)`.
    - ArrowRight calls item 2's `large`. ArrowLeft back does not call item
      1's again.
  - **"the large file replaces the thumbnail, and a null keeps it":** after
    `settle()`, the `img.src` values are as described.
  - **"Escape closes, reports the image and returns focus"** (Review Focus 4):
    - Focus a button. Open at 0, then ArrowRight, then Escape.
    - The dialog is closed, `onClose` got 1, and `document.activeElement` is
      that button.
  - **"the arrows carry Lucide's chevrons and hide at the ends."**
  - **"crossing the breakpoint keeps the viewer open on the same image"**
    (Review Focus 5): open at 2, `setPhone(true)`. The dialog is open and
    the counter reads "3 / 3". Call `setPhone(false)` afterwards.

  In `tests/card.test.js`:
  - **"Enter or a click on an image opens the viewer there, and closing
    shows that image in the strip":**
    - With `PHOTOS`, click the second `.strip-open`.
    - The viewer's counter reads "2 / 3".
    - ArrowRight, then Escape. The strip's `.photo-next` is hidden (index 2).
    - Focus is on the second `.strip-open`.

  In `tests/app.test.js`:
  - **"the imagery's viewer frames its own crop and asks identify for
    it":**
    - Click the first `.strip-open` in `#card`.
    - A logged request to `ESRI_EXPORT` has
      `size=${viewerCropSize(innerWidth, innerHeight)}`.
    - A logged `ESRI_IDENTIFY` request has `imageDisplay` starting with the
      same size.
- [ ] **Step 2: Run** `pixi run --locked node --test tests/viewer.test.js tests/card.test.js tests/app.test.js`.
  Expected: the new tests FAIL.
- [ ] **Step 3: Implement it.**
  - Write `js/viewer.js` and add its `modulepreload` line.
  - Wire `onOpen` in `js/card.js` and `js/complexcard.js`.
  - **Styles in `style.css`:**
    - `dialog.viewer` covers the viewport: `inset: 0`,
      `width: 100vw; height: 100dvh; max-width: none; max-height: none; margin: 0; padding: 0; border: 0`,
      on `rgb(0 0 0 / 92%)`, with a dark `::backdrop`.
    - Slides use `object-fit: contain`, and the captions are white text
      below the image.
    - The prev and next buttons have `display: none` on the phone.
- [ ] **Step 4: Run** `pixi run --locked test`. Expected: all PASS.
- [ ] **Step 5: Check it by eye** with `pixi run --locked serve`.
  - Open a photo and the imagery, and use the keys, swipe in the phone
    emulator, and Esc.
  - The imagery credit names the viewer's provider.
- [ ] **Step 6: Commit:** `git add -A js/viewer.js js/card.js js/complexcard.js index.html style.css tests && git commit -m "feat: open any glacier image whole in a viewer"`

---

### Task 7: Bring the main design up to date, then verify across browsers

**Files:**
- Modify: `docs/superpowers/specs/2026-10-28-rgi-explorer-design.md`
  (Layout, Photo steps 4 and 6, the phone sheet), as listed in the spec's
  "Changes to the main design"

- [ ] **Step 1: Edit the main design.** Make the four changes the spec lists,
  in the main design's voice.
- [ ] **Step 2: Run** `pixi run --locked test` and `pixi run --locked smoke`.
  Expected: all PASS.
- [ ] **Step 3: Check by hand**, with `pixi run --locked serve`:
  - **Firefox and Chrome with classic scrollbars:** the search bar has 16px
    on both sides of the content, the photo is 408px wide, and the scrollbar
    sits outside it.
  - **Safari:** nothing shifts.
  - **A real phone, iOS Safari and Android Chrome:** at each sheet height, a
    horizontal swipe scrolls the strip and a vertical drag moves the sheet.
    At compact height, a tap on the photo raises the sheet.
  - **The complex panel:** one image, and a tap opens the viewer.
- [ ] **Step 4: Commit:** `git add docs/superpowers/specs/2026-10-28-rgi-explorer-design.md docs/superpowers/specs/2026-11-02-glacier-images-design.md docs/superpowers/plans/2026-11-02-glacier-images.md && git commit -m "docs: the glacier image strip and viewer in the main design"`
