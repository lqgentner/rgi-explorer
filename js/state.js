/* The shareable page state: query parameters for choices, the hash for the view. */

export const LAYERS = ["regions", "centerlines", "intersects"];
export const DEFAULT_LAYERS = new Set(["regions"]);

const GLACIER_ID = /^RGI2000-v7\.0-G-\d{2}-\d{5}$/;
const NUMBER = /^-?\d+(\.\d+)?$/;
const BASES = ["standard", "imagery"];
const OWNED = ["glacier", "base", "layers", "3d"];

function parseView(hash) {
  const parts = hash.replace(/^#/, "").split("/");
  if (parts.length !== 3 || !parts.every((part) => NUMBER.test(part))) return null;
  const [zoom, lat, lon] = parts.map(Number);
  if (zoom < 0 || zoom > 24 || lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { zoom, lat, lon };
}

/** Read the state from a page URL; a missing or invalid part takes its default. */
export function parseState(url) {
  const params = url.searchParams;
  const glacier = params.get("glacier");
  const base = params.get("base");
  const layers = params.get("layers");
  return {
    glacier: GLACIER_ID.test(glacier ?? "") ? glacier : null,
    view: parseView(url.hash),
    base: BASES.includes(base) ? base : "standard",
    layers:
      layers === null
        ? new Set(DEFAULT_LAYERS)
        : new Set(LAYERS.filter((name) => layers.split(",").includes(name))),
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
