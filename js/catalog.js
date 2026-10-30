/* Reads the RGI catalog: collection assets, column labels, citation and license. */

const COLLECTION_ID = /^rgi-v(\d+)-(\d+)-(\w+)$/;
const NAMES = ["glaciers", "regions", "complexes", "centerlines", "intersects"];

const defaultFetchJson = (url) =>
  fetch(url).then((response) => {
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    return response.json();
  });

const resolve = (href, base) => new URL(href, base).href;

/**
 * Every RGI collection under a catalog, in link order. The children of one
 * catalog are fetched in parallel. `seen` stops a URL from being read twice.
 */
async function walk(url, fetchJson, seen) {
  if (seen.has(url)) return [];
  seen.add(url);
  const json = await fetchJson(url);
  if (json.type === "Collection") {
    const match = COLLECTION_ID.exec(json.id ?? "");
    return match ? [{ major: Number(match[1]), minor: Number(match[2]), name: match[3], url, json }] : [];
  }
  const children = (json.links ?? [])
    .filter((link) => link.rel === "child")
    .map((link) => walk(resolve(link.href, url), fetchJson, seen));
  return (await Promise.all(children)).flat();
}

function toCollection({ url, json }) {
  const assets = Object.values(json.assets ?? {});
  const data = assets.find((a) => a.roles?.includes("data"));
  const style = assets.find((a) => a.roles?.includes("default"));
  const pmtiles = json.assets?.pmtiles;
  const abs = (asset) => (asset ? resolve(asset.href, url) : null);
  return { id: json.id, dataUrl: abs(data), pmtilesUrl: abs(pmtiles), styleUrl: abs(style), json };
}

function toColumns(collection) {
  const data = Object.values(collection.assets ?? {}).find((a) => a.roles?.includes("data"));
  const columns = new Map();
  for (const column of data?.["table:columns"] ?? []) {
    const classes = column["classification:classes"];
    columns.set(column.name, {
      name: column.name,
      description: column.description ?? "",
      unit: column.unit ?? null,
      classes: classes ? new Map(classes.map((c) => [c.value, c.description])) : null,
    });
  }
  return columns;
}

/**
 * Walks the catalog at `rootUrl` and returns the highest version's five
 * collections with absolute asset URLs, the glaciers and complexes column labels, the
 * citation and the license. Rejects when a collection is missing.
 */
export async function loadCatalog(rootUrl, fetchJson = defaultFetchJson) {
  const found = await walk(rootUrl, fetchJson, new Set());
  if (!found.length) throw new Error("The catalog holds no RGI collections");

  const top = found.reduce((best, c) =>
    c.major > best.major || (c.major === best.major && c.minor > best.minor) ? c : best,
  );
  const inVersion = found.filter((c) => c.major === top.major && c.minor === top.minor);
  const collections = {};
  for (const name of NAMES) {
    const entry = inVersion.find((c) => c.name === name);
    if (!entry) throw new Error(`The catalog has no "${name}" collection`);
    collections[name] = toCollection(entry);
  }

  const { json, url } = inVersion.find((c) => c.name === "glaciers");
  const complexes = inVersion.find((c) => c.name === "complexes").json;
  const licenseLink = (json.links ?? []).find((l) => l.rel === "license");
  return {
    version: `${top.major}.${top.minor}`,
    collections,
    columns: toColumns(json),
    complexColumns: toColumns(complexes),
    citation: json["sci:citation"],
    license: { id: json.license, href: licenseLink ? resolve(licenseLink.href, url) : null },
    doi: json["sci:doi"],
  };
}
