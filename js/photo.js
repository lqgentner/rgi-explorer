/*
 * Photos of a glacier from Wikidata and Wikimedia Commons, and the Esri
 * imagery crop that stands in when there are none. Nothing here touches the map
 * or the DOM: the caller supplies the outline rings.
 */

import { COMMONS_API, ESRI_EXPORT, SPARQL, TIMEOUT_MS } from "./config.js";

const GLIMS_ID = /^G\d{6}E\d{5}[NS]$/;
const GLACIER_CLASS = "wd:Q35666";
const MAX_FILES = 8;
const MAX_CATEGORIES = 2;
const CATEGORY_FILES = 5;
const THUMB_WIDTH = 640;
const IMAGE_FILE = /\.(jpe?g|png|gif|webp|tiff?)$/i;
const PAD = 0.15;
const MAX_LAT = 85.05;

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

/** Plain text of an HTML fragment. Commons markup never reaches the DOM. */
function textOf(html) {
  if (!html) return "";
  if (typeof globalThis.DOMParser === "function") {
    return new globalThis.DOMParser().parseFromString(String(html), "text/html").body.textContent.trim();
  }
  return String(html)
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

async function getJson(url, { fetch = globalThis.fetch, signal } = {}) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`${response.status} from ${new URL(url).host}`);
  return response.json();
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
  const data = await getJson(`${COMMONS_API}?${params}`, { fetch, signal });
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
      page: pageUrl(file),
      author: textOf(meta.Artist?.value),
      license: textOf(meta.LicenseShortName?.value),
      licenseUrl: String(meta.LicenseUrl?.value ?? ""),
      source: `Wikidata ${item} · ${property}`,
    });
  }
  return photos;
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
      const data = await getJson(`${COMMONS_API}?${params}`, { fetch, signal });
      return Object.values(data?.query?.pages ?? {})
        .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
        .map((page) => normalName(page.title ?? ""))
        .filter((file) => IMAGE_FILE.test(file));
    }),
  );
  return results.flat();
}

/** The Esri World Imagery export URL for `bbox` padded by 15% on each side. */
export function esriCrop(bbox, width, height) {
  const dx = (bbox.xmax - bbox.xmin) * PAD;
  const dy = (bbox.ymax - bbox.ymin) * PAD;
  const round = (v) => Number(v.toFixed(6));
  const extent = [
    bbox.xmin - dx,
    Math.max(-MAX_LAT, bbox.ymin - dy),
    bbox.xmax + dx,
    Math.min(MAX_LAT, bbox.ymax + dy),
  ].map(round);
  return `${ESRI_EXPORT}?bbox=${extent.join(",")}&bboxSR=4326&imageSR=3857&size=${width},${height}&format=jpg&f=image`;
}

/** An AbortSignal that fires on the caller's signal or after `timeoutMs`, and a cleanup. */
function withTimeout(outer, timeoutMs) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (outer?.aborted) abort();
  outer?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);
  return {
    signal: controller.signal,
    done() {
      clearTimeout(timer);
      outer?.removeEventListener("abort", abort);
    },
  };
}

async function gather(glacier, rings, { fetch, signal }) {
  const { glims_id: glimsId, bbox } = glacier.props ?? {};
  const data = await getJson(
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
    if (guard.signal.aborted) resolve([]);
    guard.signal.addEventListener("abort", () => resolve([]), { once: true });
  });
  try {
    return await Promise.race([
      gather(glacier, rings ?? [], { fetch, signal: guard.signal }).catch(() => []),
      stopped,
    ]);
  } catch {
    return [];
  } finally {
    guard.done();
  }
}
