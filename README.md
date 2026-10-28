# RGI Explorer

A static web map to explore the Randolph Glacier Inventory (RGI) 7.0. It reads
the cloud-native mirror published at `https://data.source.coop/lqgentner/rgi/`.

RGI Explorer and the RGI mirror are unofficial and not endorsed by the RGI
Consortium.

## Run it locally

```sh
pixi install
pixi run serve    # http://localhost:8000/
pixi run test     # Python and JavaScript tests
```

The catalog may not be published yet. Serve a local copy under `/catalog/`.
The first directory that holds a file wins, so a catalog tree and a staging
tree of data files work together:

```sh
pixi run serve --catalog-dir ../rgi-catalog/catalog --catalog-dir ../rgi-catalog/staging
```

## Toolchain

There is no bundler. pixi provides Node and Python. npm installs the page's
libraries into `node_modules/`, and an import map in `index.html` loads them
unchanged. `scripts/stage-libraries.mjs` copies them into the Pages site.

## License

MIT. Third-party notices are in `assets/third-party-licenses.txt`.
