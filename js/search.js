/*
 * Search over glacier names and IDs, and over region names. Every function
 * returns hits of one shape: { kind, title, subtitle, score, rgiId?, row?, complexId?, bbox?, center? }.
 */

import uFuzzy from "@leeoniya/ufuzzy";

/* The product letter picks a glacier (G) or a complex (C); a bare ID may be either. */
const ID_PATTERN = /^(?:(?:RGI2000-v7\.0-)?([GC])-)?(\d{2})-(\d{5})$/i;
/** The fewest characters a query needs before any search runs. */
export const MIN_QUERY = 2;

/* Above this many fuzzy matches uFuzzy skips ranking and the hits keep row order. */
const RANK_LIMIT = 1e4;

/* A glacier name with a word that starts with the query ranks above places and below regions. */
export const SCORE = { id: 1000, equal: 900, prefix: 700, region: 650, word: 620, place: 600, fuzzy: 500 };

const WORD_BREAK = /[\s\-'’]/;

/** A lowercase form of text without accents, for comparing names. */
export function fold(text) {
  return text.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase();
}

/**
 * The full glacier and complex IDs a query names: `G-11-02596` names a glacier,
 * `C-11-01323` a complex, each also with the `RGI2000-v7.0-` prefix, and a bare
 * `11-02596` both. A query that is no ID names neither.
 */
export function parseIds(q) {
  const match = ID_PATTERN.exec(q.trim());
  if (!match) return { glacier: null, complex: null };
  const [, letter, code, number] = match;
  const id = (product) => (!letter || letter.toUpperCase() === product ? `RGI2000-v7.0-${product}-${code}-${number}` : null);
  return { glacier: id("G"), complex: id("C") };
}

/**
 * Index the glaciers for search.
 *
 * @param {{rgi_id: string[], display_name: (string|null)[], complex_id?: string[]}} cols
 * @param {Map<string, string>} [regionNames]  two-digit region code to region name
 */
export function buildGlacierIndex(cols, regionNames = new Map()) {
  const byId = new Map();
  const complexes = new Set(cols.complex_id ?? []);
  const rows = [];
  const folded = [];
  for (let row = 0; row < cols.rgi_id.length; row += 1) {
    byId.set(cols.rgi_id[row], row);
    const name = cols.display_name[row];
    if (name) {
      rows.push(row);
      folded.push(fold(name));
    }
  }
  return { cols, regionNames, byId, complexes, rows, folded, fuzzy: new uFuzzy() };
}

/** Whether a word of the folded name, split on spaces, hyphens and apostrophes, starts with the query. */
function hasWordStart(name, needle) {
  for (let at = name.indexOf(needle); at !== -1; at = name.indexOf(needle, at + 1)) {
    if (at === 0 || WORD_BREAK.test(name[at - 1])) return true;
  }
  return false;
}

function glacierHit(index, row, score) {
  const { cols, regionNames } = index;
  const rgiId = cols.rgi_id[row];
  const name = cols.display_name[row];
  const region = regionNames.get(rgiId.split("-G-")[1].slice(0, 2));
  return {
    kind: "glacier",
    title: name || rgiId,
    subtitle: `Glacier · ${rgiId}${region ? ` · ${region}` : ""}`,
    score,
    rgiId,
    row,
  };
}

/* A complex has no name: its ID is the title. It ranks just below a glacier with the same number. */
function complexHit(index, complexId) {
  const region = index.regionNames.get(complexId.split("-C-")[1].slice(0, 2));
  return {
    kind: "complex",
    title: complexId,
    subtitle: region ? `Complex · ${region}` : "Complex",
    score: SCORE.id - 1,
    complexId,
  };
}

/**
 * Glacier and complex hits for an ID, then glacier hits for an equal name, a
 * name prefix, a word prefix and a fuzzy match, best first.
 */
export function searchGlaciers(index, q, limit = 8) {
  const text = q.trim();
  if (text.length < MIN_QUERY) return [];
  const ids = parseIds(text);
  if (ids.glacier || ids.complex) {
    const row = ids.glacier ? index.byId.get(ids.glacier) : undefined;
    return [
      ...(row === undefined ? [] : [glacierHit(index, row, SCORE.id)]),
      ...(index.complexes.has(ids.complex) ? [complexHit(index, ids.complex)] : []),
    ];
  }

  const needle = fold(text);
  const { rows, folded } = index;
  const scored = [];
  const seen = new Set();
  for (let i = 0; i < folded.length; i += 1) {
    if (folded[i] === needle) scored.push([i, SCORE.equal]);
    else if (folded[i].startsWith(needle)) scored.push([i, SCORE.prefix]);
    else if (hasWordStart(folded[i], needle)) scored.push([i, SCORE.word]);
    else continue;
    seen.add(i);
  }

  const [found, , order] = index.fuzzy.search(folded, needle, false, RANK_LIMIT);
  const ranked = (order ? order.map((k) => found[k]) : (found ?? [])).filter((i) => !seen.has(i));
  ranked.forEach((i, rank) => scored.push([i, (SCORE.fuzzy * (ranked.length - rank)) / ranked.length]));

  scored.sort((a, b) => b[1] - a[1]);
  return scored.slice(0, limit).map(([i, score]) => glacierHit(index, rows[i], score));
}

/** Region hits for a name that starts with the query or a query equal to the region code. */
export function searchRegions(regions, q) {
  const text = q.trim();
  if (text.length < MIN_QUERY) return [];
  const needle = fold(text);
  const hits = [];
  for (const region of regions) {
    const code = region.level === 1 ? region.o1region : region.o2region;
    if (!fold(region.full_name).startsWith(needle) && code.toLowerCase() !== needle) continue;
    hits.push({
      kind: "region",
      title: region.full_name,
      subtitle: region.level === 1 ? `RGI region · ${code}` : `RGI subregion · ${code}`,
      score: SCORE.region,
      bbox: region.bbox,
    });
  }
  return hits;
}

/** Merge hit lists, best score first with input order on ties. A trailing number is the limit. */
export function rankHits(...args) {
  const limit = typeof args.at(-1) === "number" ? args.pop() : 8;
  return args
    .flat()
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
