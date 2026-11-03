/*
 * Photos of a glacier from Wikidata and Wikimedia Commons, and the Esri
 * imagery crop that stands in when there are none. Nothing here touches the map
 * or the DOM: the caller supplies the outline rings.
 */

import { fetchJson } from "./catalog.js";
import { COMMONS_API, ESRI_EXPORT, ESRI_IDENTIFY, mercatorX, mercatorY, SPARQL, TIMEOUT_MS } from "./config.js";

const GLIMS_ID = /^G\d{6}E\d{5}[NS]$/;
const GLACIER_CLASS = "wd:Q35666";
const MAX_FILES = 8;
const MAX_CATEGORIES = 2;
const CATEGORY_FILES = 5;
const THUMB_WIDTH = 640;
const IMAGE_FILE = /\.(jpe?g|png|gif|webp|tiff?)$/i;
const PAD = 0.15;

const corner = (x, y) => `"Point(${Number(x)} ${Number(y)})"^^geo:wktLiteral`;

/**
 * The SPARQL query for glacier items inside `bbox`, plus the item whose GLIMS ID
 * is `glimsId`. A malformed ID leaves the second branch out.
 */
export function sparqlQuery(bbox, glimsId) {
  const { xmin, ymin, xmax, ymax } = bbox;
  if (![xmin, ymin, xmax, ymax].every((v) => Number.isFinite(v))) throw new TypeError("bbox needs four numbers");
  const byBox = `{
    SERVICE wikibase:box {
      ?item wdt:P625 ?coord .
      bd:serviceParam wikibase:cornerSouthWest ${corner(xmin, ymin)} .
      bd:serviceParam wikibase:cornerNorthEast ${corner(xmax, ymax)} .
    }
    ?item wdt:P31/wdt:P279* ${GLACIER_CLASS} .
  }`;
  const byGlims = GLIMS_ID.test(glimsId ?? "")
    ? `UNION {
    ?item wdt:P6799 "${glimsId}" .
    OPTIONAL { ?item wdt:P625 ?coord . }
  }`
    : "";
  return `SELECT ?item ?coord ?image ?category ?glims WHERE {
  ${byBox}
  ${byGlims}
  OPTIONAL { ?item wdt:P18 ?image . }
  OPTIONAL { ?item wdt:P373 ?category . }
  OPTIONAL { ?item wdt:P6799 ?glims . }
}`;
}

function inRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** An even-odd test over every ring, so a point in a hole is outside. */
export function pointInRings(point, rings) {
  let inside = false;
  for (const ring of rings) if (inRing(point, ring)) inside = !inside;
  return inside;
}

const lastSegment = (url) => String(url).split("/").pop();
const qidOf = (binding) => lastSegment(binding.item?.value);

function safeDecode(text) {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

function pointOf(binding) {
  const match = /^Point\(\s*(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)\s*\)$/.exec(binding.coord?.value ?? "");
  return match ? [Number(match[1]), Number(match[2])] : null;
}

/** Kept items in order: GLIMS matches first, then items whose point is inside the rings. */
function keptItems(bindings, rings, glimsId) {
  const byItem = new Map();
  for (const binding of bindings ?? []) {
    const qid = qidOf(binding);
    if (!qid) continue;
    const entry = byItem.get(qid) ?? { qid, glims: false, point: null, rows: [] };
    if (glimsId && binding.glims?.value === glimsId) entry.glims = true;
    entry.point ??= pointOf(binding);
    entry.rows.push(binding);
    byItem.set(qid, entry);
  }
  const all = [...byItem.values()];
  const inside = (entry) => entry.point !== null && pointInRings(entry.point, rings);
  return [...all.filter((e) => e.glims), ...all.filter((e) => !e.glims && inside(e))];
}

/**
 * The P18 files of the items that belong to the glacier, as `{ file, item, property }`.
 * An item belongs when its GLIMS ID matches or its point is inside the rings.
 * Files appear once and at most eight come back.
 */
export function pickFiles(bindings, rings, glimsId) {
  const seen = new Set();
  const picked = [];
  for (const entry of keptItems(bindings, rings, glimsId)) {
    for (const row of entry.rows) {
      if (!row.image?.value) continue;
      const file = safeDecode(lastSegment(row.image.value));
      if (!file || seen.has(file)) continue;
      seen.add(file);
      picked.push({ file, item: entry.qid, property: "P18" });
    }
  }
  return picked.slice(0, MAX_FILES);
}

/* An element that Commons hides with an inline style, such as the second "Unknown author" of its template. */
const HIDDEN = /<(\w+)[^>]*style="[^"]*display:\s*none[^"]*"[^>]*>[\s\S]*?<\/\1>/gi;

/**
 * Plain text of an HTML fragment, without the parts its inline styles hide and
 * with runs of white space as one space. Commons markup never reaches the DOM.
 */
function textOf(html) {
  if (!html) return "";
  let text;
  if (typeof globalThis.DOMParser === "function") {
    const { body } = new globalThis.DOMParser().parseFromString(String(html), "text/html");
    for (const node of body.querySelectorAll("[style]")) if (node.style.display === "none") node.remove();
    text = body.textContent;
  } else {
    text = String(html)
      .replace(HIDDEN, "")
      .replace(/<[^>]*>/g, "")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#0?39;/g, "'")
      .replace(/&amp;/g, "&");
  }
  return text.replace(/\s+/g, " ").trim();
}

const normalName = (name) => String(name).replace(/^File:/, "").replaceAll("_", " ");
const pageUrl = (name) => `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(normalName(name).replaceAll(" ", "_"))}`;

/**
 * Photos with author and license for `files` (`{ file, item, property? }`), in input order.
 * Files Commons has no thumbnail for are skipped.
 */
export async function commonsCredits(files, { fetch, signal } = {}) {
  if (!files.length) return [];
  const params = new URLSearchParams({
    action: "query",
    prop: "imageinfo",
    iiprop: "url|extmetadata",
    iiurlwidth: String(THUMB_WIDTH),
    format: "json",
    origin: "*",
    titles: files.map((f) => `File:${normalName(f.file)}`).join("|"),
  });
  const data = await fetchJson(`${COMMONS_API}?${params}`, { fetch, signal });
  const byName = new Map();
  for (const page of Object.values(data?.query?.pages ?? {})) {
    if (page?.title) byName.set(normalName(page.title), page.imageinfo?.[0]);
  }
  const photos = [];
  for (const { file, item, property = "P18" } of files) {
    const info = byName.get(normalName(file));
    if (!info?.thumburl) continue;
    const meta = info.extmetadata ?? {};
    photos.push({
      src: info.thumburl,
      file: normalName(file),
      page: pageUrl(file),
      /* A file that names its required credit carries it in Attribution. */
      author: textOf(meta.Attribution?.value) || textOf(meta.Artist?.value),
      license: textOf(meta.LicenseShortName?.value),
      licenseUrl: String(meta.LicenseUrl?.value ?? ""),
      source: `Wikidata ${item} · ${property}`,
    });
  }
  return photos;
}

/**
 * The URL of a `width`-wide Commons thumbnail of `file`, or null on any error.
 * Commons may round the width up to one of its standard sizes.
 */
export async function commonsThumb(file, width, { fetch, signal } = {}) {
  const params = new URLSearchParams({
    action: "query",
    prop: "imageinfo",
    iiprop: "url",
    iiurlwidth: String(width),
    format: "json",
    origin: "*",
    titles: `File:${normalName(file)}`,
  });
  try {
    const data = await fetchJson(`${COMMONS_API}?${params}`, { fetch, signal });
    const page = Object.values(data?.query?.pages ?? {})[0];
    return page?.imageinfo?.[0]?.thumburl ?? null;
  } catch {
    return null;
  }
}

/** The first image files in each Commons category, categories in order. */
export async function categoryFiles(categories, { fetch, signal } = {}) {
  const results = await Promise.all(
    categories.map(async (name) => {
      const params = new URLSearchParams({
        action: "query",
        generator: "categorymembers",
        gcmtitle: `Category:${name}`,
        gcmtype: "file",
        gcmlimit: String(CATEGORY_FILES),
        format: "json",
        origin: "*",
      });
      const data = await fetchJson(`${COMMONS_API}?${params}`, { fetch, signal });
      return Object.values(data?.query?.pages ?? {})
        .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
        .map((page) => normalName(page.title ?? ""))
        .filter((file) => IMAGE_FILE.test(file));
    }),
  );
  return results.flat();
}

/* The finest scale a crop asks for, in metres per pixel. */
const MIN_SCALE = 1;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * The Web Mercator extent of a `width` by `height` crop of `bbox`, padded by
 * 15% on each side, and the bbox's centre, both rounded. The first `top` rows
 * stay clear: the bbox is centred in the rows below them. The extent has the
 * image's shape, so the server neither stretches nor re-centres it.
 */
function cropFrame(bbox, width, height, top) {
  const [x0, x1] = [mercatorX(bbox.xmin), mercatorX(bbox.xmax)];
  const [y0, y1] = [mercatorY(bbox.ymin), mercatorY(bbox.ymax)];
  const rows = height - top;
  const scale = Math.max(((x1 - x0) * (1 + 2 * PAD)) / width, ((y1 - y0) * (1 + 2 * PAD)) / rows, MIN_SCALE);
  const [cx, cy] = [(x0 + x1) / 2, (y0 + y1) / 2];
  const ymax = cy + (top + rows / 2) * scale;
  const extent = [cx - (width / 2) * scale, ymax - height * scale, cx + (width / 2) * scale, ymax].map((v) => Math.round(v));
  return { extent, centre: [cx, cy].map((v) => Math.round(v)) };
}

/** The Esri World Imagery export URL for a `width` by `height` crop of `bbox`, framed as cropFrame says. */
export function esriCrop(bbox, width, height, top = 0) {
  const { extent } = cropFrame(bbox, width, height, top);
  return `${ESRI_EXPORT}?bbox=${extent.join(",")}&bboxSR=3857&imageSR=3857&size=${width},${height}&format=jpg&f=image`;
}

/**
 * The Esri identify URL for the imagery under the centre of `bbox` in the crop
 * esriCrop draws. Given the crop's extent and size, only the metadata layer
 * drawn at the crop's scale answers.
 */
export function cropSourceUrl(bbox, width, height, top = 0) {
  const { extent, centre } = cropFrame(bbox, width, height, top);
  const params = new URLSearchParams({
    geometry: centre.join(","),
    geometryType: "esriGeometryPoint",
    sr: "3857",
    layers: "visible",
    tolerance: "0",
    mapExtent: extent.join(","),
    imageDisplay: `${width},${height},96`,
    returnGeometry: "false",
    f: "json",
  });
  return `${ESRI_IDENTIFY}?${params}`;
}

/**
 * The provider and capture date ("20 Aug 2023", or null) in an identify
 * answer's metadata, or null when no result names a provider.
 */
export function imagerySource(data) {
  const results = Array.isArray(data?.results) ? data.results : [];
  const found = results.map((result) => result?.attributes ?? {}).find(({ NICE_DESC: name }) => name && name !== "Null");
  if (!found) return null;
  const [, year, month, day] = /^(\d{4})(\d{2})(\d{2})$/.exec(found.SRC_DATE ?? "") ?? [];
  const date = MONTHS[month - 1] ? `${Number(day)} ${MONTHS[month - 1]} ${year}` : null;
  return { provider: found.NICE_DESC, date };
}

/** An AbortSignal that fires on the caller's signal, if any, or after `timeoutMs`. */
const withTimeout = (outer, timeoutMs) =>
  outer ? AbortSignal.any([outer, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);

/** The imagery source of the crop esriCrop draws, or null on any error or timeout. */
export async function findCropSource(bbox, width, height, top = 0, { fetch = globalThis.fetch, timeoutMs = TIMEOUT_MS } = {}) {
  try {
    return imagerySource(await fetchJson(cropSourceUrl(bbox, width, height, top), { fetch, signal: withTimeout(null, timeoutMs) }));
  } catch {
    return null;
  }
}

async function gather(glacier, rings, { fetch, signal }) {
  const { glims_id: glimsId, bbox } = glacier.props ?? {};
  const data = await fetchJson(
    `${SPARQL}?${new URLSearchParams({ format: "json", query: sparqlQuery(bbox, glimsId) })}`,
    { fetch, signal },
  );
  const bindings = data?.results?.bindings ?? [];
  const files = pickFiles(bindings, rings, glimsId);

  const categories = [];
  for (const entry of keptItems(bindings, rings, glimsId)) {
    const name = entry.rows.find((row) => row.category?.value)?.category.value;
    if (name && !categories.some((c) => c.name === name)) categories.push({ name, item: entry.qid });
  }
  const fromCategories = await Promise.all(
    categories.slice(0, MAX_CATEGORIES).map(async ({ name, item }) => {
      try {
        const names = await categoryFiles([name], { fetch, signal });
        return names.map((file) => ({ file, item, property: "P373" }));
      } catch {
        return [];
      }
    }),
  );
  const seen = new Set();
  const wanted = [...files, ...fromCategories.flat()]
    .filter(({ file }) => {
      const key = normalName(file);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, MAX_FILES);
  return commonsCredits(wanted, { fetch, signal });
}

/**
 * Photos for `glacier` (`{ props: { glims_id, bbox } }`) given the outline `rings`.
 * Resolves to `[]` without a bbox, on any error, on abort and after the timeout.
 */
export async function findPhotos(glacier, rings, { fetch = globalThis.fetch, signal, timeoutMs = TIMEOUT_MS } = {}) {
  if (!glacier?.props?.bbox) return [];
  const guard = withTimeout(signal, timeoutMs);
  const stopped = new Promise((resolve) => {
    if (guard.aborted) resolve([]);
    guard.addEventListener("abort", () => resolve([]), { once: true });
  });
  return Promise.race([gather(glacier, rings ?? [], { fetch, signal: guard }).catch(() => []), stopped]);
}
