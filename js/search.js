/*
 * Search over glacier names and IDs, and over region names. Every function
 * returns hits of one shape: { kind, title, subtitle, score, rgiId?, row?, bbox?, center? }.
 */

import uFuzzy from "@leeoniya/ufuzzy";

const ID_PATTERN = /^(?:(?:RGI2000-v7\.0-)?G-)?(\d{2})-(\d{5})$/i;
/** The fewest characters a query needs before any search runs. */
export const MIN_QUERY = 2;

/* Above this many fuzzy matches uFuzzy skips ranking and the hits keep row order. */
const RANK_LIMIT = 1e4;

export const SCORE = { id: 1000, equal: 900, prefix: 700, region: 650, place: 600, fuzzy: 500 };

/** A lowercase form of text without accents, for comparing names. */
export function fold(text) {
  return text.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase();
}

/** The full RGI ID for `RGI2000-v7.0-G-11-02596`, `G-11-02596` or `11-02596`; otherwise null. */
export function parseRgiId(q) {
  const match = ID_PATTERN.exec(q.trim());
  return match ? `RGI2000-v7.0-G-${match[1]}-${match[2]}` : null;
}

/**
 * Index the glaciers for search.
 *
 * @param {{rgi_id: string[], display_name: (string|null)[], glac_name: (string|null)[]}} cols
 * @param {Map<string, string>} [regionNames]  two-digit region code to region name
 */
export function buildGlacierIndex(cols, regionNames = new Map()) {
  const byId = new Map();
  const rows = [];
  const folded = [];
  for (let row = 0; row < cols.rgi_id.length; row += 1) {
    byId.set(cols.rgi_id[row], row);
    const name = cols.display_name[row] ?? cols.glac_name[row];
    if (name) {
      rows.push(row);
      folded.push(fold(name));
    }
  }
  return { cols, regionNames, byId, rows, folded, fuzzy: new uFuzzy() };
}

function glacierHit(index, row, score) {
  const { cols, regionNames } = index;
  const rgiId = cols.rgi_id[row];
  const name = cols.display_name[row] ?? cols.glac_name[row];
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

/** Glacier hits for an ID, an equal name, a name prefix and a fuzzy match, best first. */
export function searchGlaciers(index, q, limit = 8) {
  const text = q.trim();
  if (text.length < MIN_QUERY) return [];
  const id = parseRgiId(text);
  if (id) {
    const row = index.byId.get(id);
    return row === undefined ? [] : [glacierHit(index, row, SCORE.id)];
  }

  const needle = fold(text);
  const { rows, folded } = index;
  const scored = [];
  const seen = new Set();
  for (let i = 0; i < folded.length; i += 1) {
    if (folded[i] === needle) scored.push([i, SCORE.equal]);
    else if (folded[i].startsWith(needle)) scored.push([i, SCORE.prefix]);
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
