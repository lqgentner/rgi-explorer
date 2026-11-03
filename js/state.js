/* The shareable page state: query parameters for choices, the hash for the view. */

export const LAYERS = ["regions", "centerlines", "intersects"];
export const DEFAULT_LAYERS = new Set(["regions"]);

/** The first-order region code inside an RGI glacier or complex ID, such as "11" in RGI2000-v7.0-G-11-02596. */
export const regionOfId = (id) => /-[GC]-(\d{2})-/.exec(id ?? "")?.[1] ?? null;

const GLACIER_ID = /^RGI2000-v7\.0-G-\d{2}-\d{5}$/;
const COMPLEX_ID = /^RGI2000-v7\.0-C-\d{2}-\d{5}$/;
const NUMBER = /^-?\d+(\.\d+)?$/;
const BASES = ["standard", "imagery"];
const OWNED = ["glacier", "complex", "base", "layers", "3d"];

function parseView(hash) {
  const parts = hash.replace(/^#/, "").split("/");
  if (parts.length !== 3 || !parts.every((part) => NUMBER.test(part))) return null;
  const [zoom, lat, lon] = parts.map(Number);
  if (zoom < 0 || zoom > 24 || lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { zoom, lat, lon };
}

/*
 * The toggles a `layers` value names. A missing value, or a value that names no
 * known layer, gives the default. An empty value turns every toggle off.
 */
function parseLayers(value) {
  if (value === null) return new Set(DEFAULT_LAYERS);
  const known = LAYERS.filter((name) => value.split(",").includes(name));
  return value !== "" && known.length === 0 ? new Set(DEFAULT_LAYERS) : new Set(known);
}

/**
 * Read the state from a page URL; a missing or invalid part takes its default.
 * One panel is open at a time, so a glacier wins over a complex.
 */
export function parseState(url) {
  const params = url.searchParams;
  const glacier = GLACIER_ID.test(params.get("glacier") ?? "") ? params.get("glacier") : null;
  const complex = params.get("complex");
  const base = params.get("base");
  const layers = params.get("layers");
  return {
    glacier,
    complex: !glacier && COMPLEX_ID.test(complex ?? "") ? complex : null,
    view: parseView(url.hash),
    base: BASES.includes(base) ? base : "standard",
    layers: parseLayers(layers),
    terrain: params.get("3d") === "1",
  };
}

const round = (value, digits) => String(Number(value.toFixed(digits)));

/**
 * The page address for a state. Parameters at their default are left out and
 * parameters the state does not own are kept.
 */
export function writeState(state, url) {
  const params = new URLSearchParams(url.search);
  for (const key of OWNED) params.delete(key);
  const query = params.size ? [params.toString()] : [];

  if (state.glacier) query.push(`glacier=${encodeURIComponent(state.glacier)}`);
  if (state.complex) query.push(`complex=${encodeURIComponent(state.complex)}`);
  if (state.base !== "standard") query.push(`base=${state.base}`);
  const layers = LAYERS.filter((name) => state.layers.has(name));
  const isDefault =
    layers.length === DEFAULT_LAYERS.size && layers.every((name) => DEFAULT_LAYERS.has(name));
  if (!isDefault) query.push(`layers=${layers.join(",")}`);
  if (state.terrain) query.push("3d=1");

  const { zoom, lat, lon } = state.view ?? {};
  const hash = state.view ? `#${round(zoom, 2)}/${round(lat, 4)}/${round(lon, 4)}` : "";
  return `${url.origin}${url.pathname}${query.length ? `?${query.join("&")}` : ""}${hash}`;
}
