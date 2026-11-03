# RGI Explorer

A static web map to explore the Randolph Glacier Inventory (RGI) 7.0. It reads
the cloud-native mirror published at `https://data.source.coop/lqgentner/rgi/`.

RGI Explorer and the RGI mirror are unofficial and not endorsed by the RGI
Consortium.

## Run it locally

It needs Node 24, the version in `.node-version`.

```sh
npm ci
npm run serve    # http://localhost:8000/
npm test
```

The catalog may not be published yet. Serve a local copy under `/catalog/`.
The first directory that holds a file wins, so a catalog tree and a staging
tree of data files work together:

```sh
npm run serve -- --catalog-dir ../rgi-catalog/catalog --catalog-dir ../rgi-catalog/staging
```

Then open `http://localhost:8000/?catalog=catalog/catalog.json`. The `catalog`
query parameter replaces the published catalog address. A relative value
resolves against the page.

## Smoke test

The smoke test reads a real catalog. It checks the five collections, the column
descriptions, the tile layers and the GeoParquet, including its compression.
It skips in `npm test`.

```sh
npm run smoke    # the published catalog
SMOKE_CATALOG=http://localhost:8000/catalog/catalog.json npm run smoke
```

`SMOKE_CATALOG` points the test at another catalog, for example the local
server above. A weekly workflow runs the test against the published catalog.

## Deployment

The site deploys to GitHub Pages from `main` through
`.github/workflows/deploy.yml`. The workflow runs the tests, copies the page
files and the libraries into `_site/` and publishes it. The data stays in the
mirror and never enters the site.

## Toolchain

There is no bundler and no other toolchain: Node runs the development server,
the tests and the site's staging. npm installs the page's libraries into
`node_modules/`, and an import map in `index.html` loads them unchanged.
`scripts/stage-libraries.mjs` copies them into the Pages site.

Dependabot opens pull requests for the npm libraries and the GitHub Actions
(`.github/dependabot.yml`). A library that gains a dependency needs its license
added to `assets/third-party-licenses.txt` by hand.

The parquet fixtures in `tests/fixtures/parquet/` are committed. pyarrow writes
them as the mirror's files are written; to change them, edit
`scripts/make_fixture_parquet.py` and run it with
`uv run scripts/make_fixture_parquet.py tests/fixtures/parquet`.
`scripts/make_layer_previews.py` writes `js/previews.js` from the rgi-catalog
checkout's environment, as its docstring says.

## License

MIT. Third-party notices are in `assets/third-party-licenses.txt`.
