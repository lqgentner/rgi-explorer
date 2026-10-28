/* Turns the catalog's default styles into layers one map can draw together. */

/** Source layers that a toggle shows and hides, keyed by the toggle's name. */
export const TOGGLES = {
  regions: ["regions", "region-labels"],
  centerlines: ["centerlines"],
  intersects: ["intersects"],
};

/** The zoom from which each toggle's tiles hold data. */
export const TOGGLE_MINZOOM = { regions: 0, centerlines: 8, intersects: 10 };

const PMTILES = "pmtiles://";
const FONT = /^Open Sans (Regular|Bold|Italic)$/;

/**
 * The sources and layers of a catalog style. The PMTiles address becomes
 * absolute against the style's own URL, and the Open Sans fonts become the
 * Noto Sans fonts the glyph server holds. Nothing else changes.
 */
export function adaptStyle(style, styleUrl) {
  const sources = structuredClone(style.sources ?? {});
  for (const source of Object.values(sources)) {
    if (typeof source.url === "string" && source.url.startsWith(PMTILES)) {
      source.url = PMTILES + new URL(source.url.slice(PMTILES.length), styleUrl).href;
    }
  }
  const layers = structuredClone(style.layers ?? []);
  for (const layer of layers) {
    const fonts = layer.layout?.["text-font"];
    if (Array.isArray(fonts)) {
      layer.layout["text-font"] = fonts.map((font) =>
        typeof font === "string" ? font.replace(FONT, "Noto Sans $1") : font,
      );
    }
  }
  return { sources, layers };
}

/** Joins styles, keeping the first layer and the first source for each id. */
export function mergeStyles(parts) {
  const sources = {};
  const layers = [];
  const seen = new Set();
  for (const part of parts) {
    for (const [id, source] of Object.entries(part.sources)) sources[id] ??= source;
    for (const layer of part.layers) {
      if (seen.has(layer.id)) continue;
      seen.add(layer.id);
      layers.push(layer);
    }
  }
  return { sources, layers };
}
