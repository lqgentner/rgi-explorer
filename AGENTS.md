# Working on RGI Explorer

Read [README.md](README.md) for the scope and local startup. This file records
the contracts to keep when you change the page.

## Commands

Work from the repository root with Node 26 (`.node-version`), after `npm ci`.
Its `prepare` script points git at `.githooks/`, which reruns `npm ci` after a
pull, checkout or rebase that changes `package-lock.json`, so a merged
Dependabot PR reaches `node_modules` too.

```sh
npm run serve   # http://localhost:8000/
npm test        # node --test: every tests/*.test.js
npm run smoke   # SMOKE=1 node --test tests/smoke.test.js
npm run typecheck  # tsc --checkJs over js/, scripts/ and sw.js (not tests/ yet)
```

Run `node --test tests/<file>.test.js` for a focused run. There is no
compilation or bundling, and no Python: the parquet fixtures in
`tests/fixtures/parquet/` are committed, and `scripts/make_fixture_parquet.py`
regenerates them with `uv run` only when they change.

## Libraries

- The page's libraries are npm `dependencies`, loaded unchanged from
  `./node_modules/` through the import map in `index.html`.
- Use exact versions in `package.json` and commit `package-lock.json`.
- Map every bare import that a library makes.
- Load no library that compiles WebAssembly. The CSP has no
  `'wasm-unsafe-eval'`. `js/parquet.js` decodes ZSTD with `fzstd`, which is
  plain JavaScript.
- Start every import-map address with `./`. Browsers ignore others.
- Give each library a license in `assets/third-party-licenses.txt`.
- `stage-libraries.test.js` walks the import graph as a browser does.

## The Content-Security-Policy

`index.html` allows same-origin scripts and styles only. Two inline scripts run
by hash: the import map and the globals module. When you edit one, replace its
`sha256-` hash. `page-assets.test.js` prints the failing script.

`connect-src` and `img-src` list exactly the data hosts that
`page-assets.test.js` names. A new host needs a CSP entry, a change to that
test, and an entry in `SERVICES` in `js/privacy.js`: `privacy.test.js` checks
that the privacy note names every host the CSP allows. A module worker's
imports fall under `worker-src`.

## Page rules

- Keep every asset path in HTML, CSS, JS and `sw.js` relative. The site lives
  under `/rgi-explorer/`.
- Add each new `js/` module to the `modulepreload` list in `index.html`,
  except `app.js`. A test enforces it.
- Fonts and icons come from `node_modules` (`@fontsource`, `lucide-static`).
  `icon(name)` in `js/ui.js` points at a symbol in Lucide's sprite, so any
  Lucide name works.
- Build DOM with `h()`, nodes or `textContent`, never HTML interpolation.
- The `PHONE` query in `js/ui.js` and the breakpoint in `style.css` must agree.
- The page follows a resize across the breakpoint without a reload. Build a
  control once for both layouts and let `style.css` show the layout's parts;
  read `PHONE.matches` when it is needed, not once at mount, and move nodes
  on its `change` event. `setPhone()` from `loadPage()` crosses it in tests.

## The development server

`scripts/serve.mjs` supports byte ranges and turns off caching for page code and
JSON. `--catalog-dir DIR` is repeatable and mounts each directory under
`/catalog/`. The first directory that holds a file wins. A path that escapes a
directory is a 404. `sw.js` serves JSON stale-while-revalidate on the deployed
site and is not registered on localhost.

## Tests

The JavaScript suites use jsdom and the strict fake map in
`tests/helpers/browser.js`. `loadPage()` installs the DOM and the library
globals. The fake throws on duplicate ids and on writes to missing layers.
Modules hold state, so put a scenario that needs fresh state in its own test
file. `node --test` runs each file in its own process.

`CLAUDE.md` points to this file. Keep one set of instructions.
